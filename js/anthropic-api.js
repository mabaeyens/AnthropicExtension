define(['jquery', './security', './config', './data-format'], function($, security, config, dataFormat) {
  'use strict';

  return {
    /**
     * Resolve the request URL and headers based on config.
     * - When config.API.PROXY_URL is set, route through the local proxy (the proxy
     *   adds the anthropic-version header itself).
     * - Otherwise call api.anthropic.com directly from the browser, which requires
     *   the anthropic-version and anthropic-dangerous-direct-browser-access headers.
     * @param {string} apiKey - The Anthropic API key
     * @returns {{url: string, headers: object}}
     */
    buildTransport: function(apiKey) {
      const proxyUrl = config.API.PROXY_URL;
      if (proxyUrl) {
        return {
          url: proxyUrl,
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
          }
        };
      }
      return {
        url: config.API.URL,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': config.API.VERSION,
          'anthropic-dangerous-direct-browser-access': 'true'
        }
      };
    },

    /**
     * Send data to Anthropic API via proxy
     * @param {string} appId - The Qlik app ID
     * @param {object} data - The data to send to Anthropic
     * @param {function} successCallback - Callback for successful response
     * @param {function} errorCallback - Callback for error handling
     */
    sendToAnthropic: function(appId, data, successCallback, errorCallback) {
      console.log("[DEBUG] Anthropic API called with appId:", appId);
    
      try {
        // Get the API key (shared across all apps)
        const apiKey = security.getAPIKey();

        if (!apiKey) {
          console.error("[DEBUG] API KEY ERROR: No API key found");
          errorCallback('API key not found. Please enter your Anthropic API key in the settings.');
          return;
        }
    
        // Prepare the request payload
        console.log("[DEBUG] Preparing payload");
        const payload = {
          model: config.API.MODEL,
          max_tokens: config.API.MAX_TOKENS,
          messages: [{
            role: "user",
            content: data.userPrompt
          }],
          system: data.systemPrompt || config.API.SYSTEM_PROMPT
        };
        
        // Log which system prompt is being used
        console.log("[DEBUG] Using system prompt:", payload.system.substring(0, 50) + "...");
    
        // Build the message content and get metrics
        const messageMetrics = this.buildMessageContent(payload, data);
    
        // Check payload size
        const payloadString = JSON.stringify(payload);
        const payloadSize = payloadString.length;
        console.log("[DEBUG] Payload size:", payloadSize, "bytes");
    
        // Warn if payload is large
        if (payloadSize > 1000000) {
          console.warn("[DEBUG] WARNING: Very large payload size:", payloadSize, "bytes");
        }
    
        // Resolve URL + headers (direct browser call, or proxy if configured)
        const transport = this.buildTransport(apiKey);
        console.log("[DEBUG] Sending request to:", transport.url);

        // Make the API call
        $.ajax({
          url: transport.url,
          type: 'POST',
          headers: transport.headers,
          data: payloadString,
          timeout: config.API.TIMEOUT,
          success: function(response) {
            console.log("[DEBUG] SUCCESS: Received response from proxy");
            // Pass both response and metrics to callback
            successCallback(response, messageMetrics);
          },
          error: function(xhr, status, error) {
            console.error("[DEBUG] ERROR: Problem with proxy request:", status, error);
            errorCallback({
              message: 'Error communicating with Anthropic API: ' + error,
              status: status,
              details: xhr.responseText || 'No response details'
            });
          }
        });
      } catch (e) {
        console.error("[DEBUG] Exception in sendToAnthropic:", e.message);
        errorCallback({
          message: "Exception occurred: " + e.message
        });
      }
    },
    
    /**
     * Build the message content with context and chart data
     * @param {object} payload - The API payload
     * @param {object} data - The data containing context and chart information
     * @returns {object} Size metrics for the message
     */
    buildMessageContent: function(payload, data) {
      // Start with the user question
      let messageText = data.userPrompt || "";
      let originalUserPrompt = messageText;
      
      // Get detailed metrics including UI settings
      let metricReport = {
        userPromptChars: messageText.length,
        contextChars: 0,
        chartDataChars: 0,
        totalChars: 0,
        rowCount: data.chartData?.rowCount || 0,
        dataSampled: data.chartData?.dataSampled || false,
        actualRows: data.chartData?.data?.length || 0
      };
      
      if (config.DEBUG_MODE) {
        console.log("[DEBUG] Initial metrics:", JSON.stringify(metricReport));
      }
      
      // Format chart data more efficiently if available
      let formattedChartData = "";
      if (data.chartData) {
        if (config.DEBUG_MODE) {
          console.log("[DEBUG] Formatting chart data for efficient LLM consumption");
        }
        
        // First, get a size baseline of raw chart data
        const rawChartDataJson = JSON.stringify(data.chartData);
        
        // Check if this is a map visualization
        const isMapVisualization = data.chartData && 
                                data.chartData.info && 
                                data.chartData.info.type && 
                                data.chartData.info.type.toLowerCase().includes('map');
        
        // Special handling for map visualizations
        if (isMapVisualization) {
          // Get chart information
          const chartTitle = data.chartData.info?.title || "Untitled Map";
          const dimensions = data.chartData.dimensions || [];
          const measures = data.chartData.measures || [];
          
          // Extract any layers information if available
          let layerInfo = "";
          if (data.chartData.mapLayers && data.chartData.mapLayers.length > 0) {
            layerInfo = `\nMap contains ${data.chartData.mapLayers.length} layers.\n`;
            data.chartData.mapLayers.forEach((layer, idx) => {
              layerInfo += `- Layer ${idx+1}: ${layer.name || "Unnamed"} (${layer.type || "Unknown type"})\n`;
            });
          } else if (data.chartData.gaLayers && data.chartData.gaLayers.length > 0) {
            layerInfo = `\nMap contains ${data.chartData.gaLayers.length} layers.\n`;
          }
          
          // Build map information
          formattedChartData = `Map Visualization: "${chartTitle}"\n\n`;
          
          // Add dimensions if available
          if (dimensions.length > 0) {
            formattedChartData += "Dimensions: " + dimensions.map(d => d.name || "Unnamed").join(", ") + "\n";
          }
          
          // Add measures if available  
          if (measures.length > 0) {
            formattedChartData += "Measures: " + measures.map(m => m.name || "Unnamed").join(", ") + "\n";
          }
          
          // Add layer information
          formattedChartData += layerInfo;
          
          // Add note about map data limitations
          formattedChartData += "\nNOTE: Detailed map data extraction is currently limited. " +
                              "Please specify any cities or regions you're interested in analyzing " +
                              "in your question, and I'll focus on those areas if mentioned in the map.\n";
          
          if (config.DEBUG_MODE) {
            console.log(`[DEBUG] Processed map visualization with limited data extraction`);
          }
        } else {
          // For non-map visualizations, use the standard formatting
          formattedChartData = this.formatChartDataForLLM(data.chartData);
          
          // Try city-values extraction if enabled and it's not a map
          if (config.FEATURES && config.FEATURES.EXTRACT_CITY_VALUES) {
            const cityValues = dataFormat.extractCityValues(data.chartData);
            
            // If we found city values, append them to the formatted data
            if (cityValues && cityValues.length > 0) {
              if (config.DEBUG_MODE) {
                console.log(`[DEBUG] Found ${cityValues.length} city-value pairs`);
              }
              
              // Add city values to the end of the formatted data
              formattedChartData += "\n\nCity Values:\n" + dataFormat.formatCityValuesTable(cityValues);
            }
          }
        }
        
        // Report sizes
        metricReport.chartDataChars = formattedChartData.length;
        metricReport.chartDataReduction = Math.round((1 - (formattedChartData.length / rawChartDataJson.length)) * 100);
        
        if (config.DEBUG_MODE) {
          console.log(`[DEBUG] Chart data formatted: ${formattedChartData.length} chars (${metricReport.chartDataReduction}% reduction from raw JSON)`);
        }
      }
      
      // Add app context if available
      if (data.context) {
        if (config.DEBUG_MODE) {
          console.log("[DEBUG] Adding app context to payload");
        }
        
        // Format context more concisely
        const contextStr = this.formatContextForLLM(data.context);
        metricReport.contextChars = contextStr.length;
        
        messageText = "Context about the Qlik Sense environment:\n" + 
          contextStr + "\n\n" + 
          "User question: " + originalUserPrompt;
      } else {
        messageText = "User question: " + originalUserPrompt;
      }
      
      // Add chart data if available
      if (formattedChartData) {
        if (config.DEBUG_MODE) {
          console.log("[DEBUG] Adding formatted chart data to payload");
        }
        
        if (data.context) {
          // We already have context and user question
          messageText = messageText.replace("User question:", "Chart data:\n" + 
            formattedChartData + "\n\nUser question:");
        } else {
          // Just add chart data before the user question
          messageText = "Chart data:\n" + 
            formattedChartData + "\n\n" + 
            messageText;
        }
      }
      
      // Calculate total size
      metricReport.totalChars = messageText.length;
      metricReport.estimatedTokens = Math.ceil(messageText.length / 4);
      
      if (config.DEBUG_MODE) {
        console.log(`[DEBUG] Total message size: ${metricReport.totalChars} chars, ~${metricReport.estimatedTokens} tokens`);
      }
      
      // Set the message content
      payload.messages[0].content = messageText;
      
      return metricReport;
    },
    
    /**
     * Format chart data for LLM consumption
     * @param {object} chartData - The chart data to format
     * @returns {string} Formatted chart data as string
     */
    formatChartDataForLLM: function(chartData) {
      if (!chartData) return "";
      
      let result = "";
      
      // Add chart info
      if (chartData.info) {
        const chartType = chartData.info.type || "Unknown";
        result += `Chart: ${chartData.info.title || "Untitled"} (${chartType})\n\n`;
        
        // Add axis titles if available
        if (chartData.xAxisTitle || chartData.yAxisTitle) {
          result += "Chart axes:\n";
          if (chartData.xAxisTitle) result += `- X-axis: ${chartData.xAxisTitle}\n`;
          if (chartData.yAxisTitle) result += `- Y-axis: ${chartData.yAxisTitle}\n`;
          result += "\n";
        }
        
        // Add chart type specific properties in a compact way
        if (chartData.chartProperties) {
          if (chartType.toLowerCase().includes('bar')) {
            result += "Bar chart properties: ";
            const props = [];
            if (chartData.chartProperties.isStacked) props.push("Stacked");
            else props.push("Grouped");
            if (chartData.chartProperties.isHorizontal) props.push("Horizontal");
            else props.push("Vertical");
            result += props.join(", ") + "\n\n";
          } else if (chartType.toLowerCase().includes('line')) {
            result += "Line chart properties: ";
            const props = [];
            if (chartData.chartProperties.isCurved) props.push("Curved lines");
            else props.push("Straight lines");
            if (chartData.chartProperties.hasSymbols) props.push("With data points");
            result += props.join(", ") + "\n\n";
          } else if (chartType.toLowerCase().includes('combo')) {
            result += "Combo chart combining multiple chart types\n\n";
          }
        }
        
        // Handle map visualizations more concisely
        if (chartType.toLowerCase().includes('map') && chartData.mapLayers) {
          result += `Map with ${chartData.mapLayers.length} layers\n\n`;
        }
      }
      
      // Add dimensions and measures as simple lists
      if (chartData.dimensions && chartData.dimensions.length > 0) {
        result += "Dimensions: " + chartData.dimensions.map(dim => dim.name || "Unnamed").join(", ") + "\n";
      }
      
      if (chartData.measures && chartData.measures.length > 0) {
        result += "Measures: " + chartData.measures.map(meas => meas.name || "Unnamed").join(", ") + "\n";
      }
      
      // Include selections if available
      if (chartData.selections || chartData.currentSelections) {
        const selections = chartData.selections || chartData.currentSelections;
        if (selections && selections.length > 0) {
          result += "\nSelections: " + selections.map(sel => `${sel.field}=${sel.values}`).join(", ") + "\n";
        }
      }
      
      // Format data as a simple table
      if (chartData.data && chartData.data.length > 0) {
        result += "\nData:\n";
        
        // Create headers based on chart type and structure
        let headers = [];
        const chartType = chartData.info?.type?.toLowerCase() || "";
        const isMap = chartType.includes('map');
        const hasStackedData = chartData.chartProperties?.hasStackedData;
        
        // Special case for stacked data in bar/combo charts
        if (hasStackedData && (chartType.includes('bar') || chartType.includes('combo'))) {
          headers = ["Dimension", "Measure", "Value"];
        } else {
          // For maps with layers, add a layer column
          if (isMap && chartData.mapLayers && chartData.mapLayers.length > 0) {
            headers.push("Layer");
          }
          
          // Add dimensions and measures as headers
          if (chartData.dimensions) {
            headers.push(...chartData.dimensions.map(dim => dim.name || "Dimension"));
          }
          
          if (chartData.measures) {
            headers.push(...chartData.measures.map(meas => meas.name || "Measure"));
          }
          
          // If headers don't match data width, use generic headers
          const sampleRow = chartData.data[0];
          if (Array.isArray(sampleRow) && headers.length < sampleRow.length) {
            if (config.DEBUG_MODE) {
              console.log("[DEBUG] Header count mismatch - generating generic headers");
            }
            
            headers = isMap ? ["Layer"] : []; // Reset with layer if it's a map
            
            // Generate column headers based on data width
            for (let i = headers.length; i < sampleRow.length; i++) {
              headers.push(`Column ${i + (isMap ? 0 : 1)}`);
            }
          }
        }
        
        // Add headers to the result
        if (headers.length > 0) {
          result += headers.join("\t") + "\n";
          result += headers.map(() => "---").join("\t") + "\n";
        }
        
        // Helper function to extract cell value in a consistent way
        const getCellValue = (cell) => {
          if (cell === null || cell === undefined) {
            return "";
          } 
          
          if (typeof cell !== "object") {
            return cell.toString();
          }
          
          // Optimized cell value extraction
          // Try text values first
          if (cell.text) return cell.text;
          if (cell.value) return cell.value;
          if (cell.qText) return cell.qText;
          
          // Then try numeric values
          if (cell.num !== undefined && cell.num !== null) return cell.num.toString();
          if (cell.numValue !== undefined && cell.numValue !== null) return cell.numValue.toString();
          if (cell.qNum !== undefined && cell.qNum !== null) return cell.qNum.toString();
          
          // Generic object handling
          return JSON.stringify(cell);
        };
        
        // Add data rows
        chartData.data.forEach(row => {
          if (Array.isArray(row)) {
            const values = row.map(cell => getCellValue(cell));
            result += values.join("\t") + "\n";
          }
        });
        
        // Add data summary
        result += `\n(${chartData.data.length} rows`;
        if (chartData.data[0] && Array.isArray(chartData.data[0])) {
          result += ` x ${chartData.data[0].length} columns`;
        }
        result += ")\n";
      }
      
      return result;
    },
    
    /**
     * Format context data for LLM consumption
     * @param {object} context - The context data
     * @returns {string} Formatted context as string
     */
    formatContextForLLM: function(context) {
      if (!context) return "";
      
      let result = [];
      
      // Add app information
      if (context.appId) {
        result.push(`App: ${context.appName || "Unnamed"} (ID: ${context.appId})`);
      }
      
      // Add fields in a compact way
      if (context.fields && context.fields.length > 0) {
        result.push("Fields: " + context.fields.map(f => f.name).join(", "));
      }
      
      // Add tables in a more compact format
      if (context.tables && context.tables.length > 0) {
        result.push("\nTables:");
        
        // Map each table to a string representation
        const tableStrings = context.tables.map(table => {
          let tableStr = `- ${table.name}`;
          
          if (table.fields && table.fields.length > 0) {
            // List only first 5 fields to save space
            const fieldSample = table.fields.slice(0, 5).join(", ");
            tableStr += `: ${fieldSample}`;
            
            if (table.fields.length > 5) {
              tableStr += `, ... and ${table.fields.length - 5} more fields`;
            }
          }
          
          return tableStr;
        });
        
        result.push(tableStrings.join("\n"));
      }
      
      return result.join("\n");
    },
    
    /**
     * Send a test request to the Anthropic API
     * @param {string} appId - The Qlik app ID
     * @param {function} successCallback - Callback for successful response
     * @param {function} errorCallback - Callback for error handling
     */
    testConnection: function(appId, successCallback, errorCallback) {
      const testData = {
        userPrompt: "Hello Claude, this is a test call from the Qlik Sense extension."
      };
      
      const testPayload = {
        model: config.API.MODEL,
        max_tokens: 100, // Small response for test
        messages: [{
          role: "user",
          content: testData.userPrompt
        }],
        system: config.API.SYSTEM_PROMPT
      };
      
      try {
        // Get API key (shared across all apps)
        const apiKey = security.getAPIKey();

        if (!apiKey) {
          errorCallback('API key not found. Please enter your Anthropic API key in the settings.');
          return;
        }

        // Resolve URL + headers (direct browser call, or proxy if configured)
        const transport = this.buildTransport(apiKey);

        // Send test request
        $.ajax({
          url: transport.url,
          type: 'POST',
          headers: transport.headers,
          data: JSON.stringify(testPayload),
          success: function(response) {
            successCallback(response);
          },
          error: function(xhr, status, error) {
            errorCallback({
              message: error,
              status: status,
              details: xhr.responseText || 'No response details'
            });
          }
        });
      } catch (e) {
        errorCallback({
          message: "Exception occurred: " + e.message
        });
      }
    },
    
    /**
     * Format the response from Anthropic
     * @param {object} response - The response from the API
     * @returns {string} The formatted response text or an error message
     */
    formatResponse: function(response) {
      if (response && response.content && response.content.length > 0) {
        return response.content[0].text;
      } else {
        return "Received invalid response structure from Anthropic.";
      }
    }
  };
});
