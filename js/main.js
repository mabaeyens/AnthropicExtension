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
                  // Built from the model registry so the panel picker and this
                  // dropdown can never drift apart.
                  options: config.API.MODELS.map(function (m) {
                    return { value: m.id, label: m.label + (m.hint ? ' (' + m.hint + ')' : '') };
                  }),
                  defaultValue: config.API.MODEL
                },
                modelHelp: {
                  component: "text",
                  label: "The model each session starts with. Switch models any time with “Pick model” in the chat panel."
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
                  label: "Required. The hardened proxy holds the API key and authenticates your Qlik session — e.g. https://your-qlik-host:3000/api/anthropic. Leave blank to use the config.js default."
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
                  label: "Ollama endpoint, used when a local model is selected. Must be HTTPS on QSEoW — e.g. https://localhost:3000/api/ollama."
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
          uiController.renderModelPicker();
        } else if (layout.props.model && !config.API.MODEL_LOCKED) {
          config.API.MODEL = layout.props.model;
          uiController.renderModelPicker();
        }
        // Proxy endpoint for hosted models (mandatory — E01). Only override the default
        // when the property is set, so a blank field keeps the config.js default.
        if (layout.props.proxyUrl) {
          config.API.PROXY_URL = layout.props.proxyUrl;
        }

        // Local-model endpoint (Ollama via HTTPS proxy). Only override the default when
        // the property is set, so a blank field keeps the config.js default.
        if (layout.props.localUrl) {
          config.API.LOCAL.URL = layout.props.localUrl;
        }

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
