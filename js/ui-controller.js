define(['jquery', 'qlik', './anthropic-api', './data-collector', './security', './formatting', './config'],
  function ($, qlik, anthropicAPI, dataCollector, security, formatting, config) {
    'use strict';

    let $container = null;
    let selectedChartId = null;
    let selectedChartData = null;
    let selectionModeActive = false;

    return {
      /**
       * Test direct API call for debugging
       * @param {string} appId - The app ID
       */
      testDirectApiCall: function (appId) {
        console.log("[DEBUG] Testing direct API call");
        const $responseArea = $container.find("#anthropic-response");
        $responseArea.html(formatting.formatLoadingMessage('Testing API connection...'));

        anthropicAPI.testConnection(
          appId,
          function(response) {
            // Success
            const responseText = anthropicAPI.formatResponse(response);
            $responseArea.html('<div style="color:green">API test successful! Response: ' + responseText + '</div>');
          },
          function(error) {
            // Error
            $responseArea.html(formatting.formatErrorMessage(error));
          }
        );
      },

      /**
       * Initialize the UI
       * @param {jQuery} $element - The element to render the UI in
       * @param {object} layout - The layout object
       */
      initUI: function ($element, layout) {
        $container = $element;

        // Clear the container
        $container.empty();

        // Load the template HTML
        $.get("../extensions/AnthropicExtension/html/template.html", function (templateHtml) {
          $container.html(templateHtml);
          
          // Handle API key status
          const app = qlik.currApp();
          const appId = app.id;
          const storedApiKey = security.getAPIKey(appId);
          
          if (storedApiKey) {
            // API key already stored, update UI
            $container.find(".api-key-input").html(
              '<div class="api-key-status">' +
              '<span style="color: green;">✓ API key stored</span>' +
              '<button id="clear-api-key" class="lui-button lui-button--small" style="margin-left: 10px;">Clear Key</button>' +
              '</div>'
            );
          }
          
          // Show debug area if in debug mode and feature is enabled
          if (config.DEBUG_MODE && config.FEATURES && config.FEATURES.SHOW_DEBUG_AREA) {
            $container.find("#debug-area").show();
          }
          
          // Set up event handlers after ensuring the DOM is ready
          setTimeout(() => {
            this.setupEventHandlers();
            console.log("[DEBUG] Event handlers set up with delay for template");
          }, 100);
          
          console.log("UI initialized from template");
        }.bind(this)).fail(function() {
          console.error("Failed to load template HTML, falling back to direct HTML creation");
          this.initUIFallback($element, layout);
        }.bind(this));
      },
      
      /**
       * Fallback UI initialization if template loading fails
       * @param {jQuery} $element - The element to render the UI in
       * @param {object} layout - The layout object
       */
      initUIFallback: function ($element, layout) {
        $container = $element;

        // Clear the container
        $container.empty();

        // Create the UI elements
        const $uiContainer = $('<div class="anthropic-extension-container"></div>');

        // Create the input area
        const $inputArea = $('<div class="anthropic-input-area"></div>');
        $inputArea.append('<h3>Anthropic AI Assistant</h3>');

        // Add API key input if not already stored
        const app = qlik.currApp();
        const appId = app.id;

        // Check if API key exists in localStorage
        const storedApiKey = security.getAPIKey(appId);

        if (!storedApiKey) {
          // No API key stored, show input field
          $inputArea.append(
            '<div class="api-key-input">' +
            '<label for="anthropic-api-key">Anthropic API Key:</label>' +
            '<input type="password" id="anthropic-api-key" placeholder="Enter your API key">' +
            '</div>'
          );
        } else {
          // API key already stored, show message
          $inputArea.append(
            '<div class="api-key-status">' +
            '<span style="color: green;">✓ API key stored</span>' +
            '<button id="clear-api-key" class="lui-button lui-button--small" style="margin-left: 10px;">Clear Key</button>' +
            '</div>'
          );
        }

        // Add chart selection area
        $inputArea.append(
          '<div class="chart-selection-area">' +
          '<label>Chart Selection:</label>' +
          '<div class="selection-controls">' +
          '<button id="select-chart-button" class="lui-button">Select Chart</button>' +
          '<span id="selection-status">No chart selected</span>' +
          '</div>' +
          '<div id="selection-instructions" style="display:none; margin-top:5px; font-style:italic;">' +
          'Click on any chart in the dashboard to select it for analysis' +
          '</div>' +
          '</div>'
        );

        // Add prompt input
        $inputArea.append(
          '<div class="prompt-input">' +
          '<label for="anthropic-prompt">Ask about your data:</label>' +
          '<textarea id="anthropic-prompt" placeholder="Enter your question or prompt"></textarea>' +
          '</div>'
        );

        // Add context toggle
        $inputArea.append(
          '<div class="context-toggle">' +
          '<label><input type="checkbox" id="include-context" checked> Include app context</label>' +
          '</div>'
        );

        // Add data optimization options
        $inputArea.append(
          '<div class="optimization-options">' +
          '<details>' +
          '<summary>Data Optimization Options</summary>' +
          '<div class="optimization-controls">' +
          '<div class="optimization-row">' +
          '<label>Max data rows: <input type="number" id="max-data-rows" value="1000" min="10" max="10000"></label>' +
          '</div>' +
          '<div class="optimization-row">' +
          '<label><input type="checkbox" id="include-numeric-values" checked> Include numeric values</label>' +
          '</div>' +
          '<div class="optimization-row">' +
          '<label><input type="checkbox" id="simplify-structure" checked> Simplify data structure</label>' +
          '</div>' +
          '<div class="optimization-row">' +
          '<label><input type="checkbox" id="include-dimensions" checked> Include dimensions</label>' +
          '</div>' +
          '<div class="optimization-row">' +
          '<label><input type="checkbox" id="include-measures" checked> Include measures</label>' +
          '</div>' +
          '</div>' +
          '</details>' +
          '</div>'
        );

        // Add submit button
        $inputArea.append(
          '<div class="submit-area">' +
          '<button id="submit-to-anthropic" class="lui-button">Submit</button>' +
          '</div>'
        );

        if (config.DEBUG_MODE) {
          $inputArea.append(
            '<div id="debug-area" class="debug-area">' +
            '<button id="test-direct-api" class="lui-button">Test Direct API Call</button>' +
            '</div>'
          );
        }

        // Create the output area
        const $outputArea = $('<div class="anthropic-output-area"></div>');
        $outputArea.append('<h4>AI Response</h4>');
        $outputArea.append('<div id="anthropic-response" class="response-container"></div>');

        // Add everything to the UI container
        $uiContainer.append($inputArea);
        $uiContainer.append($outputArea);
        $container.append($uiContainer);

        // Set up event handlers after ensuring the DOM is ready
        setTimeout(() => {
          this.setupEventHandlers();
          console.log("[DEBUG] Event handlers set up with delay");
        }, 100);

        console.log("UI initialized with fallback");
      },

      /**
       * Set up event handlers for the UI
       */
      setupEventHandlers: function () {
        // Handle chart selection button
        $container.find("#select-chart-button").on('click', function () {
          this.toggleChartSelectionMode();
        }.bind(this));

        $container.find("#clear-api-key").on('click', function () {
          const app = qlik.currApp();
          const appId = app.id;

          // Clear the API key
          security.clearAPIKey(appId);

          // Reload the extension to show the API key input
          qlik.resize();

          // Show message
          alert("API key cleared. The extension will reload.");

          // Force a refresh of the extension
          location.reload();
        });

        // Handle submit button click
        $container.find("#submit-to-anthropic").on('click', function () {
          console.log("[DEBUG] Submit button clicked");

          // Get values directly
          const $responseArea = $container.find("#anthropic-response");
          $responseArea.html(formatting.formatLoadingMessage('Processing request...'));

          // Get the API key if provided in the input
          const apiKeyInput = $container.find("#anthropic-api-key").val();
          const app = qlik.currApp();
          const appId = app.id;

          if (apiKeyInput) {
            // Store the API key
            security.storeAPIKey(appId, apiKeyInput);
            console.log("[DEBUG] API key stored");
          }

          // Get the user prompt
          const userPrompt = $container.find("#anthropic-prompt").val();
          if (!userPrompt) {
            $responseArea.html(formatting.formatErrorMessage('Please enter a question or prompt.'));
            return;
          }

          // Check if a chart is selected
          if (!selectedChartData) {
            $responseArea.html(formatting.formatWarningMessage('No chart is selected. Your question will be answered without chart context.'));
          }

          // Get optimization settings from the helper function
          const optimizationSettings = this.getOptimizationSettings();

          // Get app context if requested
          const includeContext = $container.find("#include-context").is(":checked");
          
          // Get the system prompt based on selection
          let systemPrompt = null;
          if ($("#analysis-style-default").is(":checked")) {
            systemPrompt = 'You are a business analyst and expert Qlik Sense user. Be concise. Always aggregate the data and show absolute values and percentages. Focus on insights that would help business decision making. Present your analysis in a structured format with bullet points for key findings.';
          } else if ($("#analysis-style-technical").is(":checked")) {
            systemPrompt = 'You are a data scientist analyzing Qlik Sense visualizations. Provide detailed technical analysis including statistical patterns, outliers, and data quality observations. Use precise terminology and reference specific data points.';
          } else if ($("#analysis-style-executive").is(":checked")) {
            systemPrompt = 'You are preparing an executive summary of Qlik Sense data. Focus only on the most significant business insights. Be extremely concise. Highlight key business metrics, trends, and actionable recommendations. Avoid technical details unless critical.';
          } else if ($("#analysis-style-custom").is(":checked")) {
            systemPrompt = $("#custom-system-prompt").val();
          }

          // Prepare API request data
          const requestData = {
            userPrompt: userPrompt,
            chartData: selectedChartData ? 
              dataCollector.optimizeDataForTokens(selectedChartData, optimizationSettings) : 
              null,
            systemPrompt: systemPrompt
          };

          if (includeContext) {
            // Show a message that we're collecting context
            $responseArea.html(formatting.formatLoadingMessage('Collecting app context...'));

            dataCollector.getAppContext().then(function (context) {
              console.log("[DEBUG] Context collected, preparing full request");
              
              // Add context to request data
              requestData.context = context;
              
              // Process the request with context
              this.processAnthropicRequest(appId, requestData, $responseArea);
              
            }.bind(this)).catch(function (error) {
              console.error("[DEBUG] Error collecting context:", error);
              $responseArea.html(formatting.formatErrorMessage('Error collecting app context: ' + error));
            });
          } else {
            // No context needed, process the request directly
            this.processAnthropicRequest(appId, requestData, $responseArea);
          }
        }.bind(this));
        
        // Add a new helper method to handle the API request
        this.processAnthropicRequest = function(appId, requestData, $responseArea) {
          console.log("[DEBUG] Processing Anthropic request");
          $responseArea.html(formatting.formatLoadingMessage('Preparing data for Anthropic API...'));
          
          // Metrics container for request sizes
          let requestMetrics = null;
          
          // Use the anthropic-api module to send the request
          anthropicAPI.sendToAnthropic(
            appId,
            requestData,
            function(response, metrics) {
              // Success callback
              console.log("[DEBUG] Success response received");
              requestMetrics = metrics;
              
              // Get the response text
              const responseText = anthropicAPI.formatResponse(response);
              
              // Format the response with markdown
              const formattedResponse = formatting.formatResponseText(responseText);
              
              // Add token usage information
              let resultHtml = formattedResponse;
              
              // Add token usage footer if metrics are available
              if (requestMetrics) {
                const tokenInfo = `
                <div class="token-usage-info">
                  <details>
                    <summary>LLM Token Usage</summary>
                    <div class="token-details">
                      <p>Prompt: ~${requestMetrics.estimatedTokens} tokens (${requestMetrics.totalChars} chars)</p>
                      <p>Response: ~${Math.ceil(responseText.length / 4)} tokens (${responseText.length} chars)</p>
                      ${requestMetrics.chartDataReduction ? 
                        `<p>Data optimization: ${requestMetrics.chartDataReduction}% reduction in size (${requestMetrics.dataSampled ? 'sampled data, ' : ''}${requestMetrics.actualRows || requestMetrics.rowCount} rows from ${requestMetrics.rowCount} total)</p>` : ''}
                    </div>
                  </details>
                </div>`;
                
                resultHtml += tokenInfo;
              }
              
              $responseArea.html(resultHtml);
            },
            function(error) {
              // Error callback
              console.log("[DEBUG] Error response received:", error);
              $responseArea.html(formatting.formatErrorMessage(error));
            }
          );
        };

        // Add test direct API call button handler
        if (config.DEBUG_MODE) {
          $container.find("#test-direct-api").on('click', function () {
            const app = qlik.currApp();
            const appId = app.id;
            this.testDirectApiCall(appId);
          }.bind(this));
        }
        
        // Handle showing/hiding the custom system prompt textarea
        $container.find("input[name='analysis-style']").on('change', function() {
          if ($("#analysis-style-custom").is(":checked")) {
            $("#custom-system-prompt").show();
          } else {
            $("#custom-system-prompt").hide();
          }
        });
        
        // Add event handlers for optimization options changes
        $container.find("#max-data-rows, #include-numeric-values, #simplify-structure, #include-dimensions, #include-measures")
          .on('change', function() {
            console.log("[DEBUG] Optimization options changed");
            
            // Update the chart data with new settings if we have a selected chart
            if (selectedChartId && selectedChartData) {
              // Get the raw chart data (not optimized)
              dataCollector.getObjectData(selectedChartId).then(rawData => {
                // Apply current settings to the raw data
                const optimizationSettings = this.getOptimizationSettings();
                console.log("[DEBUG] Reapplying optimization with new settings:", 
                           JSON.stringify(optimizationSettings));
                
                // Update with newly optimized data
                // Log the settings we're using to optimize
                console.log("[DEBUG] Reoptimizing with explicit settings:", JSON.stringify(optimizationSettings));
                selectedChartData = dataCollector.optimizeDataForTokens(rawData, optimizationSettings);
                
                // Update the UI to show new row count
                const $status = $container.find("#selection-status");
                let dataInfo = "";
                
                if (selectedChartData.dimensions && selectedChartData.dimensions.length > 0) {
                  dataInfo += selectedChartData.dimensions.length + " dimensions, ";
                }
                if (selectedChartData.measures && selectedChartData.measures.length > 0) {
                  dataInfo += selectedChartData.measures.length + " measures, ";
                }
                
                // Show optimized data rows with original count
                if (selectedChartData.data && selectedChartData.data.length > 0) {
                  if (selectedChartData.rowCount && selectedChartData.rowCount !== selectedChartData.data.length) {
                    dataInfo += selectedChartData.data.length + " rows of data (limited from " + 
                              selectedChartData.rowCount + ")";
                  } else {
                    dataInfo += selectedChartData.data.length + " rows of data";
                  }
                }
                
                // Update data info if we have it
                if (dataInfo) {
                  // Find the second span (data info) and update it, or add if not there
                  const $dataSpan = $status.find('span:eq(1)');
                  if ($dataSpan.length) {
                    $dataSpan.html(dataInfo);
                  } else {
                    $status.append('<br><span style="font-size:0.9em;">' + dataInfo + '</span>');
                  }
                }
                
                console.log("[DEBUG] Chart data updated with new optimization settings");
              }).catch(error => {
                console.error("[DEBUG] Error updating chart data:", error);
              });
            }
          }.bind(this));

        console.log("Event handlers set up");
      },

      /**
       * Toggle chart selection mode on/off
       */
      // Helper function to get current optimization settings from UI
      getOptimizationSettings: function() {
        const maxRowsValue = parseInt($container.find("#max-data-rows").val(), 10);
        console.log("[DEBUG] UI max-data-rows value:", $container.find("#max-data-rows").val(), 
                   "parsed to:", maxRowsValue);
        
        const settings = {
          maxRows: maxRowsValue,
          includeNumericValues: $container.find("#include-numeric-values").is(":checked"),
          simplifyStructure: $container.find("#simplify-structure").is(":checked"),
          includeDimensions: $container.find("#include-dimensions").is(":checked"),
          includeMeasures: $container.find("#include-measures").is(":checked")
        };
        
        console.log("[DEBUG] Full optimization settings from UI:", JSON.stringify(settings));
        return settings;
      },
      
      toggleChartSelectionMode: function () {
        const $button = $container.find("#select-chart-button");
        const $instructions = $container.find("#selection-instructions");
        const $status = $container.find("#selection-status");

        // Toggle selection mode
        selectionModeActive = !selectionModeActive;

        if (selectionModeActive) {
          // Activate selection mode
          $button.addClass('selection-active').text('Cancel Selection');
          $instructions.show();
          $status.html('<span style="color:blue;">Selection mode active</span>');

          // Add selection mode class to body
          $('body').addClass('anthropic-selection-mode');

          // Set up the selection tracking
          dataCollector.startSelectionTracking(this.handleChartSelection.bind(this));

          console.log("[DEBUG] Chart selection mode activated");
        } else {
          // Deactivate selection mode
          $button.removeClass('selection-active').text('Select Chart');
          $instructions.hide();

          if (selectedChartData) {
            // If we have a selected chart, show its info
            const chartTitle = selectedChartData.info ? selectedChartData.info.title : "Unknown Chart";
            const chartType = selectedChartData.info ? selectedChartData.info.type : "";
            $status.html('<span style="color:green;">Selected: ' + chartTitle +
              (chartType ? ' (' + chartType + ')' : '') + '</span>');
          } else {
            // No chart selected
            $status.text('No chart selected');
          }

          // Remove selection mode class from body
          $('body').removeClass('anthropic-selection-mode');

          // Stop the selection tracking
          dataCollector.stopSelectionTracking();

          console.log("[DEBUG] Chart selection mode deactivated");
        }
      },

      /**
       * Handle chart selection callback
       * @param {string} objectId - The ID of the selected visualization
       * @param {object} objectData - The data from the selected visualization
       */
      handleChartSelection: function (objectId, objectData) {
        console.log("[DEBUG] Chart selected via callback:", objectId);

        // Store the selection
        selectedChartId = objectId;
        
        // Apply current optimization settings to the selected chart data
        const optimizationSettings = this.getOptimizationSettings();
        console.log("[DEBUG] Applying optimization settings to selected chart:", 
                    JSON.stringify(optimizationSettings));
        selectedChartData = dataCollector.optimizeDataForTokens(objectData, optimizationSettings);

        // Update the UI
        const $button = $container.find("#select-chart-button");
        const $instructions = $container.find("#selection-instructions");
        const $status = $container.find("#selection-status");

        // Deactivate selection mode
        selectionModeActive = false;
        $button.removeClass('selection-active').text('Select Chart');
        $instructions.hide();

        // Show selected chart info
        const chartTitle = objectData.info ? objectData.info.title : "Unknown Chart";
        const chartType = objectData.info ? objectData.info.type : "";

        $status.html('<span style="color:green;">Selected: ' + chartTitle +
          (chartType ? ' (' + chartType + ')' : '') + '</span>');

        // Add details about the data if available
        let dataInfo = "";
        if (objectData.dimensions && objectData.dimensions.length > 0) {
          dataInfo += objectData.dimensions.length + " dimensions, ";
        }
        if (objectData.measures && objectData.measures.length > 0) {
          dataInfo += objectData.measures.length + " measures, ";
        }
        
        // Show optimized data rows with original count
        if (objectData.data && objectData.data.length > 0) {
          // If we have a rowCount that's different from data.length, it means we've optimized
          if (objectData.rowCount && objectData.rowCount !== objectData.data.length) {
            dataInfo += objectData.data.length + " rows of data (limited from " + objectData.rowCount + ")";
          } else {
            dataInfo += objectData.data.length + " rows of data";
          }
        }

        // Add sampling info if data was sampled
        if (objectData.dataSampled) {
          $status.append('<br><span style="font-size:0.9em; color:#ff9900;">⚠️ ' +
            objectData.samplingRate + ' due to data size</span>');
        }
        
        if (dataInfo) {
          $status.append('<br><span style="font-size:0.9em;">' + dataInfo + '</span>');
        }

        // Remove selection mode class from body
        $('body').removeClass('anthropic-selection-mode');

        // Stop the selection tracking
        dataCollector.stopSelectionTracking();

        console.log("[DEBUG] Chart selection complete");
      },

      /**
       * Update the UI when a visualization is selected (legacy method)
       * @param {string} objectId - The ID of the selected visualization
       * @param {object} objectData - The data from the selected visualization
       */
      updateSelectedVisualization: function (objectId, objectData) {
        // This is kept for backward compatibility
        this.handleChartSelection(objectId, objectData);
      },

      /**
       * Send a request to Anthropic (legacy method)
       * @param {string} appId - The app ID
       * @param {string} userPrompt - The user's prompt
       * @param {object} chartData - The chart data
       * @param {object} context - The app context
       */
      sendRequest: function (appId, userPrompt, chartData, context) {
        // Use the new centralized approach for backward compatibility
        const $responseArea = $container.find("#anthropic-response");
        $responseArea.html(formatting.formatLoadingMessage('Processing legacy request...'));

        console.log("[DEBUG] Legacy sendRequest called, using new API module");

        // Create the request data
        const requestData = {
          userPrompt: userPrompt,
          chartData: chartData,
          context: context
        };

        // Process the request using the new helper method
        this.processAnthropicRequest(appId, requestData, $responseArea);
      }
    };
  });

