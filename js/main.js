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
              label: "Anthropic API Settings",
              items: {
                apiKey: {
                  ref: "props.apiKey",
                  label: "API Key (stored for this session)",
                  type: "string",
                  expression: "optional"
                }
              }
            }
          }
        }
      }
    },
    paint: function ($element, layout) {
      console.log("AnthropicExtension paint method called");

      // Initialize UI
      uiController.initUI($element, layout);

      // Get the app context
      const app = qlik.currApp();
      const appId = app.id;

      // Check if API key is already stored
      const storedApiKey = security.getAPIKey(appId);

      // Store API key securely if provided in properties and not already stored
      if (!storedApiKey && layout.props && layout.props.apiKey) {
        security.storeAPIKey(appId, layout.props.apiKey);
        console.log("[DEBUG] API key stored in localStorage from properties");
      }

      // Initialize the data collector with the current app and our own object ID
      dataCollector.init(app, layout.qInfo.qId);

      // Set up visualization selection tracking
      dataCollector.setupSelectionTracking(function (objectId, objectData) {
        console.log("Visualization selected:", objectId);
        uiController.updateSelectedVisualization(objectId, objectData);
      });

      return qlik.Promise.resolve();
    },
    controller: ['$scope', function ($scope) {
      // Controller logic here
      console.log("AnthropicExtension controller initialized");
    }]
  };
});
