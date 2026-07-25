define([
  'jquery',
  'qlik',
  './anthropic-api',
  './data-collector',
  './ui-controller',
  './config',
  'css!../css/style.css'
], function ($, qlik, anthropicAPI, dataCollector, uiController, config) {
  
  // Access debug mode from config
  const DEBUG_MODE = config.DEBUG_MODE;
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
        if (layout.props.model && !config.API.MODEL_LOCKED) {
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

        // Keep the panel's connection status line in sync with the property change.
        uiController.renderApiKeyStatus();
      }

      // One-time initialization for the session. The floating widget is injected into
      // document.body, so we guard on its DOM presence rather than on $element — this
      // ensures only one widget exists even when the extension appears on multiple sheets
      // or when Qlik calls paint() repeatedly on property changes / selection events.
      if (!document.getElementById('anthropic-floating-widget')) {
        uiController.initUI($element, layout);

        const app = qlik.currApp();
        dataCollector.init(app, layout.qInfo.qId);
        dataCollector.setupSelectionTracking(function (objectId, objectData) {
          console.log("Visualization selected:", objectId);
          uiController.updateSelectedVisualization(objectId, objectData);
        });
      }

      return qlik.Promise.resolve();
    },
    // Teardown hook (E03): Qlik calls this when the object is removed from the sheet
    // or the sheet is torn down. Release all global listeners, preview vizzes, session
    // objects, and any in-flight request so nothing accumulates across sheet navigation.
    // Idempotent (each step guards on presence), so a paint/destroy race can't throw.
    destroy: function () {
      try { uiController.teardown(); } catch (e) {
        console.warn("[DEBUG] teardown error (ignored):", e && e.message);
      }
    },
    controller: ['$scope', function ($scope) {
      // Controller logic here
      console.log("AnthropicExtension controller initialized");
    }]
  };
});
