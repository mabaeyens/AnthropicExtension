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
                  // Built from the model registry so the panel picker and this dropdown
                  // can never drift apart. A FUNCTION, not a fixed array: it is evaluated
                  // when the panel opens, so models whose transport is not configured
                  // (Claude with a blank Proxy URL) are not offered here either.
                  options: function () {
                    return anthropicAPI.availableModels().map(function (m) {
                      return { value: m.id, label: m.label + (m.hint ? ' (' + m.hint + ')' : '') };
                    });
                  },
                  defaultValue: config.API.MODEL
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
      // Apply per-instance config overrides from the properties panel. Cheap, so it
      // runs on every paint to pick up property changes (model / proxy URL).
      if (layout.props) {
        // The properties dropdown only seeds the model. Once the user picks one in
        // the chat panel, MODEL_LOCKED is set and we stop clobbering their choice —
        // paint() runs on every selection event, which would otherwise silently
        // revert the model mid-conversation.
        //
        // Exception: actually CHANGING the property is an explicit user action and
        // must win over an earlier in-panel pick (otherwise the dropdown is dead for
        // the rest of the page load and the picker looks stuck on the old model).
        // MODEL_FROM_PROPS holds the last value we saw, so a change is detectable
        // and a plain repaint is not.
        if (layout.props.model && layout.props.model !== config.API.MODEL_FROM_PROPS) {
          config.API.MODEL_FROM_PROPS = layout.props.model;
          config.API.MODEL = layout.props.model;
          config.API.MODEL_LOCKED = false;
          config.saveModelState();   // survive a module re-instantiation (sheet change)
        } else if (layout.props.model && !config.API.MODEL_LOCKED) {
          config.API.MODEL = layout.props.model;
          config.saveModelState();
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
        // A model whose transport just disappeared must not stay active. Repaint the
        // picker once, AFTER both the model and the URLs are applied, so it can never
        // render a half-applied state (new model, old endpoints).
        anthropicAPI.resolveActiveModel();
        uiController.renderModelPicker();

        // Console log verbosity (js/log.js). Read on every paint so a change takes
        // effect live without a reload.
        if (layout.props.logLevel) {
          config.LOG_LEVEL = layout.props.logLevel;
        }

        // Keep the panel's connection status line in sync with the property change.
        uiController.renderApiKeyStatus();
      }

      // One-time initialization for the session. The floating widget is injected into
      // document.body, so we guard on its DOM presence rather than on $element — this
      // ensures only one widget exists even when the extension appears on multiple sheets
      // or when Qlik calls paint() repeatedly on property changes / selection events.
      if (!document.getElementById('anthropic-floating-widget')) {
        uiController.initUI($element, layout);

        // Validate config once at init (E07). Non-fatal: a problem is surfaced in the
        // panel (naming the offending key) rather than throwing and wedging the render.
        try {
          var vr = configValidate.validate(config);
          if (!vr.ok) {
            log.error('[config] invalid configuration:', vr.errors);
            uiController.showConfigError(vr.errors);
          }
        } catch (e) {
          log.warn('[config] validation error (ignored):', e && e.message);
        }

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
