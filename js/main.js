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
                  label: "API Key",
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
                    { value: "claude-opus-4-8", label: "Opus 4.8 (most capable)" }
                  ],
                  defaultValue: config.API.MODEL
                },
                proxyUrl: {
                  ref: "props.proxyUrl",
                  label: "Proxy URL (optional — leave blank to call the API directly)",
                  type: "string",
                  expression: "optional",
                  defaultValue: ""
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

        // Persist a key entered via the properties panel, if not already stored.
        if (layout.props.apiKey && !security.getAPIKey()) {
          security.storeAPIKey(layout.props.apiKey);
          console.log("[DEBUG] API key stored from properties");
        }
      }

      // One-time initialization per extension instance. Qlik calls paint() on every
      // property change / selection event; rebuilding the DOM and re-attaching event
      // handlers each time loses panel state and leaks listeners.
      if (!$element.data('anthropicInitialized')) {
        $element.data('anthropicInitialized', true);

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
