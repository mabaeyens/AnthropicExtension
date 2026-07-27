define([
  'jquery',
  'qlik',
  './anthropic-api',
  './data-collector',
  './ui-controller',
  './config',
  './config-validate',
  './log',
  'css!../css/style.css'
], function ($, qlik, anthropicAPI, dataCollector, uiController, config, configValidate, log) {
  'use strict';

  // ── Config ownership ────────────────────────────────────────────────────────────────
  // `config` is ONE module singleton shared by every object of this extension in the app,
  // but the properties (Default model, Proxy URL, Local model URL) are PER OBJECT. With no
  // gate, every object's paint() writes the shared config and the last one painted wins:
  // navigating to a sheet holding a second, never-configured object silently replaced the
  // configured model with that object's untouched dropdown default, and contributed its
  // blank URLs to validation. The widget is a single floating panel, so it can only follow
  // one object — exactly one is elected the owner and the others' property blocks are
  // skipped.
  //
  // Election: an object may own the config if there is no owner yet, if it already is the
  // owner, or if it is CONFIGURED (has a non-blank URL property) while the incumbent is
  // not — so a never-configured object can never keep ownership from a real one. An owner
  // that stops painting (deleted, or on a sheet nobody visits) goes stale and a configured
  // object can take over.
  var configOwnerId = null;
  var configOwnerConfigured = false;
  var configOwnerSeen = 0;
  var OWNER_STALE_MS = 30000;
  var warnedNonOwner = null;   // throttles the warning to one line per non-owning object

  return {
    initialProperties: {
      qHyperCubeDef: {
        qDimensions: [],
        qMeasures: [],
        qInitialDataFetch: [{
          qWidth: 10,
          qHeight: 1000
        }]
      }
    },
    definition: {
      type: "items",
      component: "accordion",
      items: {
        settings: {
          uses: "settings",
          items: {
            apiKeySettings: {
              type: "items",
              label: "Anthropic AI Settings",
              items: {
                // The properties sidebar is narrow and truncates labels with an
                // ellipsis — it never wraps them. So every label stays short and
                // the explanation goes in a `text` component below the field,
                // which does wrap.
                model: {
                  ref: "props.model",
                  label: "Default model",
                  type: "string",
                  component: "dropdown",
                  // The FULL registry, deliberately not filtered by availability. A Qlik
                  // dropdown whose stored value is absent from its options renders blank
                  // and can commit an empty props.model — which would drop the object's
                  // default entirely. Unreachable models are instead filtered out of the
                  // chat panel's picker, and the notices below say which backend is off.
                  options: config.API.MODELS.map(function (m) {
                    return { value: m.id, label: m.label + (m.hint ? ' (' + m.hint + ')' : '') };
                  }),
                  defaultValue: config.API.MODEL_SHIPPED_DEFAULT
                },
                modelHelp: {
                  component: "text",
                  label: "The model each session starts with. Switch models any time with “Pick model” in the chat panel."
                },
                // Availability notices live HERE rather than in the chat panel: the person
                // who can fix a blank URL is the one editing the object.
                noProxyNote: {
                  component: "text",
                  label: "⚠ Proxy URL is blank — Claude models are unavailable and are hidden from the list above and from the chat panel. Set a Proxy URL to enable them.",
                  show: function (data) {
                    return !(data && data.props && data.props.proxyUrl);
                  }
                },
                noLocalNote: {
                  component: "text",
                  label: "⚠ Local model URL is blank — Ministral (local) models are unavailable and are hidden from the list above and from the chat panel. Set a Local model URL to enable them.",
                  show: function (data) {
                    return !(data && data.props && data.props.localUrl);
                  }
                },
                proxyUrl: {
                  ref: "props.proxyUrl",
                  label: "Proxy URL",
                  type: "string",
                  expression: "optional",
                  defaultValue: ""
                },
                proxyUrlHelp: {
                  component: "text",
                  label: "Required for Claude models — the hardened proxy holds the API key and authenticates your Qlik session, e.g. https://your-qlik-host:3000/api/anthropic. Leave blank to disable Claude entirely and run local models only."
                },
                localUrl: {
                  ref: "props.localUrl",
                  label: "Local model URL",
                  type: "string",
                  expression: "optional",
                  defaultValue: ""
                },
                localUrlHelp: {
                  component: "text",
                  label: "Required for local models — the proxy's Ollama route, e.g. https://your-qlik-host:3000/api/ollama. Must be HTTPS on QSEoW. Leave blank to disable local models."
                },
                logLevel: {
                  ref: "props.logLevel",
                  label: "Log level",
                  type: "string",
                  component: "dropdown",
                  options: [
                    { value: "ERROR", label: "Error — only errors" },
                    { value: "WARN", label: "Warn — errors + warnings" },
                    { value: "INFO", label: "Info — + accepted actions" },
                    { value: "DEBUG", label: "Debug — everything" }
                  ],
                  defaultValue: config.LOG_LEVEL
                },
                logLevelHelp: {
                  component: "text",
                  label: "How much the extension writes to the browser console. DEBUG is the most verbose; lower it to ERROR/WARN to quieten the console once you're past testing."
                },
                versionInfo: {
                  component: "text",
                  label: "Version " + config.VERSION + " · build " + config.BUILD
                }
              }
            }
          }
        }
      }
    },
    paint: function ($element, layout) {
      var qId = (layout.qInfo && layout.qInfo.qId) || null;
      var isConfigured = !!(layout.props && (layout.props.proxyUrl || layout.props.localUrl));
      var now = Date.now();
      var mayOwn = !configOwnerId || configOwnerId === qId ||
        (isConfigured && (!configOwnerConfigured || now - configOwnerSeen > OWNER_STALE_MS));
      if (mayOwn) {
        if (configOwnerId !== qId) {
          log.info('[config] object ' + qId + ' now owns the shared configuration' +
            (configOwnerId ? ' (was ' + configOwnerId + ')' : ''));
        }
        configOwnerId = qId;
        configOwnerConfigured = isConfigured;
        configOwnerSeen = now;   // refresh on EVERY owner paint, so staleness only advances
                                 // while the owner really has stopped painting
      } else if (layout.props && warnedNonOwner !== qId) {
        warnedNonOwner = qId;
        log.warn('[config] object ' + qId + ' is not the configuration owner (' +
          configOwnerId + '); its Default model / URL properties are ignored.');
      }

      // Apply per-instance config overrides from the properties panel. Cheap, so it
      // runs on every paint to pick up property changes (model / proxy URL).
      if (layout.props && mayOwn) {
        // The property is the session DEFAULT; the in-panel picker overrides it. paint()
        // runs on every selection event, so only an actual CHANGE to the property counts
        // as a user action — and a change clears the pick, since editing the property is
        // how an operator overrules a choice made in the panel.
        if (layout.props.model && layout.props.model !== config.API.MODEL_DEFAULT) {
          config.API.MODEL_DEFAULT = layout.props.model;
          config.API.MODEL_PICK = null;
        }
        // Endpoints. The properties are AUTHORITATIVE, including when blank: a blank URL
        // means "this backend is not available here" and its models are withheld from
        // both pickers (anthropicAPI.availableModels), rather than silently falling back
        // to the config.js default and failing at request time. `props` only carries a
        // key once the field has been touched, so an untouched object still gets the
        // config.js defaults.
        if (Object.prototype.hasOwnProperty.call(layout.props, 'proxyUrl')) {
          config.API.PROXY_URL = layout.props.proxyUrl || '';
        }
        if (Object.prototype.hasOwnProperty.call(layout.props, 'localUrl')) {
          config.API.LOCAL.URL = layout.props.localUrl || '';
        }
        // Mirror the user-set facts (default, pick, endpoints) so they survive a page
        // reload or a module re-instantiation, then repaint once — AFTER both the model
        // and the URLs are applied, so the picker can never render a half-applied state.
        config.saveModelState();
        uiController.renderModelPicker();

        // Console log verbosity (js/log.js). Read on every paint so a change takes
        // effect live without a reload.
        if (layout.props.logLevel) {
          config.LOG_LEVEL = layout.props.logLevel;
        }

        // Keep the panel's connection status line in sync with the property change.
        uiController.renderApiKeyStatus();

        // Validate on every OWNER paint, not once at init (E07). Once-only validation
        // meant a banner raised before the owner's URLs were applied could never clear,
        // and a non-owning object's blank properties could raise one at all.
        try {
          var vr = configValidate.validate(config);
          uiController.renderConfigStatus(vr.ok ? [] : vr.errors);
          if (!vr.ok) log.warn('[config] invalid configuration:', vr.errors);
        } catch (e) {
          log.warn('[config] validation error (ignored):', e && e.message);
        }
      }

      // One-time initialization PER MODULE INSTANCE. The guard is uiController's own
      // state, not the presence of #anthropic-floating-widget in the DOM: the widget
      // outlives sheet navigation, so a DOM check would let a freshly instantiated module
      // set adopt a widget whose handlers and config belong to an instance it cannot
      // reach — the panel then renders from the shipped literals instead of the object's
      // properties. Re-initialising rebuilds the widget this instance can actually drive.
      // Repeated paints (property changes, selection events) still initialise only once.
      if (!uiController.isInitialized()) {
        uiController.initUI($element, layout);

        const app = qlik.currApp();
        dataCollector.init(app, layout.qInfo.qId);
        dataCollector.setupSelectionTracking(function (objectId, objectData) {
          log.debug("Visualization selected:", objectId);
          uiController.updateSelectedVisualization(objectId, objectData);
        });
      }

      return qlik.Promise.resolve();
    },
    // NOTE (regression fix): we deliberately do NOT wire a Qlik `destroy` hook to
    // uiController.teardown(). The floating widget is a body-global SINGLETON that is
    // meant to persist across sheet navigation (so you can move between sheets and select
    // charts from any of them). Qlik fires `destroy` on every sheet change — tearing the
    // widget + its capture-phase selection listener down there made the extension appear
    // only on the first sheet and stop tracking selections elsewhere. The single-instance
    // paint guard (`#anthropic-floating-widget`) already prevents duplicate widgets and
    // duplicate listeners, and per-fetch engine session objects are created-read-destroyed
    // inline, so nothing leaks across navigation without a teardown. `uiController.teardown()`
    // / `dataCollector.teardown()` remain available for a genuine teardown (e.g. page unload
    // or tests), just not on per-sheet destroy.
    controller: ['$scope', function ($scope) {
      // Controller logic here
      log.debug("AnthropicExtension controller initialized");
    }]
  };
});
