define([
  'jquery',
  'qlik',
  './anthropic-api',
  './data-collector',
  './ui-controller',
  './security',
  './config',
  'css!../css/style.css'
], function ($, qlik, anthropicAPI, dataCollector, uiController, security, config) {
  
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
                apiKey: {
                  ref: "props.apiKey",
                  label: "API Key (leave blank to remove the stored key)",
                  type: "string",
                  expression: "optional"
                },
                model: {
                  ref: "props.model",
                  label: "Model",
                  type: "string",
                  component: "dropdown",
                  options: [
                    { value: "claude-haiku-4-5", label: "Haiku 4.5 (fast, low cost)" },
                    { value: "claude-sonnet-4-6", label: "Sonnet 4.6 (balanced)" },
                    { value: "claude-opus-4-8", label: "Opus 4.8 (most capable)" },
                    { value: "ministral-local", label: "Ministral 3 8B (local, via Ollama)" }
                  ],
                  defaultValue: config.API.MODEL
                },
                proxyUrl: {
                  ref: "props.proxyUrl",
                  label: "Proxy URL (optional — leave blank to call the API directly)",
                  type: "string",
                  expression: "optional",
                  defaultValue: ""
                },
                localUrl: {
                  ref: "props.localUrl",
                  label: "Local model URL (Ollama via HTTPS proxy — used when Model is Ministral)",
                  type: "string",
                  expression: "optional",
                  defaultValue: ""
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
        if (layout.props.model) {
          config.API.MODEL = layout.props.model;
        }
        config.API.PROXY_URL = layout.props.proxyUrl || '';

        // Local-model endpoint (Ollama via HTTPS proxy). Only override the default when
        // the property is set, so a blank field keeps the config.js default.
        if (layout.props.localUrl) {
          config.API.LOCAL.URL = layout.props.localUrl;
        }

        // The properties panel is the single source of truth for the API key.
        // Sync localStorage to the property on every paint: a non-empty field
        // sets/updates the stored key; an emptied field clears it.
        var propKey = (layout.props.apiKey || '').trim();
        if (propKey) {
          if (propKey !== security.getAPIKey()) {
            security.storeAPIKey(propKey);
            console.log("[DEBUG] API key stored/updated from properties");
          }
        } else if (security.getAPIKey()) {
          security.clearAPIKey();
          console.log("[DEBUG] API key cleared (properties field emptied)");
        }

        // Keep the panel's status line in sync with the property change.
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
    controller: ['$scope', function ($scope) {
      // Controller logic here
      console.log("AnthropicExtension controller initialized");
    }]
  };
});
