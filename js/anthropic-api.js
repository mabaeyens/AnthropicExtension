define(['jquery', './security', './config', './data-format'], function($, security, config, dataFormat) {
  'use strict';

  return {
    /**
     * Look up a model registry entry (config.API.MODELS) by id. Falls back to a
     * synthetic entry so an unknown id still renders and still routes to the
     * hosted API rather than throwing.
     * @param {string} [id] - defaults to the active model
     * @returns {{id: string, label: string, hint?: string, local?: boolean, tag?: string}}
     */
    getModelEntry: function(id) {
      var wanted = id || config.API.MODEL;
      var found = (config.API.MODELS || []).filter(function(m) { return m.id === wanted; })[0];
      return found || { id: wanted, label: wanted };
    },

    /** Human-readable name for a model id, e.g. "Ministral 3 8B (local, via Ollama)". */
    getModelLabel: function(id) {
      var m = this.getModelEntry(id);
      return m.label + (m.hint ? ' (' + m.hint + ')' : '');
    },

    /**
     * True when the given (or active) model is a local (Ollama) backend rather
     * than an Anthropic model. In that case requests use OpenAI chat-completions
     * format, are routed to config.API.LOCAL.URL, and need no API key.
     * @returns {boolean}
     */
    isLocalModel: function(id) {
      return !!this.getModelEntry(id).local;
    },

    /** Ollama model name for the active local model. */
    localTag: function() {
      return this.getModelEntry().tag || config.API.LOCAL.MODEL_TAG;
    },

    /**
     * Resolve the request URL and headers based on config.
     * - Local model: route to config.API.LOCAL.URL (HTTPS proxy → Ollama). No key,
     *   no anthropic headers — just JSON.
     * - When config.API.PROXY_URL is set, route through the local proxy (the proxy
     *   adds the anthropic-version header itself).
     * - Otherwise call api.anthropic.com directly from the browser, which requires
     *   the anthropic-version and anthropic-dangerous-direct-browser-access headers.
     * @param {string} apiKey - The Anthropic API key
     * @returns {{url: string, headers: object}}
     */
    buildTransport: function(apiKey) {
      if (this.isLocalModel()) {
        return {
          url: config.API.LOCAL.URL,
          headers: { 'Content-Type': 'application/json' }
        };
      }
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
     * Assemble everything a request needs: the turn's message text + metrics, the
     * backend-shaped payload, and the resolved transport. Shared by the buffered
     * and streaming paths so they can never build different requests.
     * @param {object} data - { userPrompt, chartData, context, systemPrompt, history }
     * @param {boolean} [stream] - request an incremental (SSE) response
     * @returns {{local: boolean, payload: object, payloadString: string,
     *            transport: object, metrics: object}}
     * @throws {Error} when a hosted model is selected with no API key stored
     */
    prepareRequest: function(data, stream) {
      const local = this.isLocalModel();

      // Get the API key (shared across all apps). The local (Ollama) backend needs none.
      const apiKey = security.getAPIKey();
      if (!local && !apiKey) {
        console.error("[DEBUG] API KEY ERROR: No API key found");
        throw new Error('API key not found. Please enter your Anthropic API key in the settings.');
      }

      // Build this turn's user-message text (chart data + context + question).
      // buildMessageContent reads only `data`; pass an empty object as the legacy payload arg.
      const systemPrompt = data.systemPrompt || config.API.SYSTEM_PROMPT;
      const messageMetrics = this.buildMessageContent({}, data);

      // Prior conversation turns keep context across questions. History entries are
      // { role, content } string pairs — valid for both Anthropic and OpenAI formats.
      const priorTurns = data.history || [];
      const thisTurn = { role: "user", content: messageMetrics.builtText };

      let payload;
      if (local) {
        // OpenAI chat-completions shape (Ollama /v1/chat/completions): system is the
        // first message, not a top-level field.
        payload = {
          model: this.localTag(),
          max_tokens: config.API.MAX_TOKENS,
          stream: !!stream,
          messages: [{ role: "system", content: systemPrompt }].concat(priorTurns).concat([thisTurn])
        };
      } else {
        // Anthropic Messages shape: system is a top-level field.
        payload = {
          model: config.API.MODEL,
          max_tokens: config.API.MAX_TOKENS,
          system: systemPrompt,
          messages: priorTurns.concat([thisTurn])
        };
        if (stream) payload.stream = true;
      }

      const payloadString = JSON.stringify(payload);
      console.log("[DEBUG] Payload size:", payloadString.length, "bytes");
      if (payloadString.length > 1000000) {
        console.warn("[DEBUG] WARNING: Very large payload size:", payloadString.length, "bytes");
      }

      return {
        local: local,
        payload: payload,
        payloadString: payloadString,
        transport: this.buildTransport(apiKey),
        metrics: messageMetrics
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
        let req;
        try {
          req = this.prepareRequest(data, false);
        } catch (keyErr) {
          errorCallback(keyErr.message);
          return;
        }
        const local = req.local;
        const messageMetrics = req.metrics;
        const payloadString = req.payloadString;
        const transport = req.transport;
        console.log("[DEBUG] Sending request to:", transport.url);

        // Make the API call
        $.ajax({
          url: transport.url,
          type: 'POST',
          headers: transport.headers,
          data: payloadString,
          // Local inference is far slower than the hosted API (model load + low tok/s on
          // a small GPU), so give the local backend a much longer client-side timeout.
          timeout: local ? config.API.LOCAL.TIMEOUT : config.API.TIMEOUT,
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
     * True when incremental (streamed) responses are both enabled and possible.
     * Needs fetch + ReadableStream, which every browser QSEoW supports has.
     */
    canStream: function() {
      return !!(config.CHAT && config.CHAT.STREAM) &&
        typeof window.fetch === 'function' &&
        typeof window.TextDecoder === 'function' &&
        typeof window.AbortController === 'function';
    },

    /**
     * Pull one text delta out of a decoded SSE `data:` payload. The two backends
     * use different envelopes:
     *   - Ollama / OpenAI: { choices: [ { delta: { content: "…" } } ] }
     *   - Anthropic:       { type: "content_block_delta", delta: { text: "…" } }
     * Unknown/keep-alive frames yield '' so the caller can ignore them.
     * @returns {string}
     */
    extractDelta: function(obj, local) {
      if (!obj || typeof obj !== 'object') return '';
      if (local) {
        var ch = obj.choices && obj.choices[0];
        return (ch && ch.delta && ch.delta.content) || '';
      }
      if (obj.type === 'content_block_delta') {
        return (obj.delta && (obj.delta.text || obj.delta.partial_json)) || '';
      }
      return '';
    },

    /**
     * Stream a response, invoking onDelta(textChunk, fullTextSoFar) as tokens
     * arrive and onDone(fullText, metrics) at the end.
     *
     * Deliberately returns PLAIN TEXT per chunk: the caller renders markdown once
     * at the end. Re-parsing markdown (and re-sanitizing) on every token is what
     * makes streamed chat UIs flicker and crawl, and half-parsed markdown renders
     * as visible garbage mid-stream.
     *
     * @returns {{abort: function}} handle so the caller can drop an in-flight
     *          stream (new chat, model switch) instead of leaking it.
     */
    streamToAnthropic: function(appId, data, onDelta, onDone, errorCallback) {
      var self = this;
      var controller = new AbortController();
      var aborted = false;
      var handle = {
        abort: function() { aborted = true; try { controller.abort(); } catch (e) {} }
      };

      var req;
      try {
        req = this.prepareRequest(data, true);
      } catch (keyErr) {
        errorCallback(keyErr.message);
        return handle;
      }

      var headers = Object.assign({}, req.transport.headers, { 'Accept': 'text/event-stream' });
      console.log("[DEBUG] Streaming request to:", req.transport.url);

      // Client-side deadline. fetch has no timeout option, so arm one manually and
      // clear it on completion.
      var timeoutMs = req.local ? config.API.LOCAL.TIMEOUT : config.API.TIMEOUT;
      var timer = setTimeout(function() {
        if (!aborted) { aborted = true; try { controller.abort(); } catch (e) {}
          errorCallback({ message: 'The model did not respond in time.', status: 'timeout',
            details: 'No response details' });
        }
      }, timeoutMs);

      fetch(req.transport.url, {
        method: 'POST',
        headers: headers,
        body: req.payloadString,
        signal: controller.signal
      }).then(function(res) {
        if (!res.ok) {
          return res.text().then(function(body) {
            throw { message: 'Error communicating with Anthropic API: ' + res.status + ' ' +
              res.statusText, status: res.status, details: body || 'No response details' };
          });
        }
        // A backend (or proxy) that ignored `stream` sends one JSON body. Fall
        // back to rendering it whole rather than showing nothing.
        var ctype = (res.headers.get('content-type') || '').toLowerCase();
        if (ctype.indexOf('event-stream') === -1 && ctype.indexOf('json') !== -1) {
          return res.json().then(function(json) {
            var text = self.formatResponse(json);
            onDelta(text, text);
            return text;
          });
        }
        if (!res.body || !res.body.getReader) {
          return res.text().then(function(t) { onDelta(t, t); return t; });
        }

        var reader = res.body.getReader();
        var decoder = new TextDecoder('utf-8');
        var buffer = '';   // holds a partial SSE frame across chunk boundaries
        var full = '';

        function pump() {
          return reader.read().then(function(result) {
            if (result.done) return full;
            buffer += decoder.decode(result.value, { stream: true });

            // SSE frames are separated by a blank line; process only whole ones
            // and keep the remainder for the next chunk.
            var frames = buffer.split(/\r?\n\r?\n/);
            buffer = frames.pop();

            frames.forEach(function(frame) {
              frame.split(/\r?\n/).forEach(function(line) {
                if (line.indexOf('data:') !== 0) return;   // skip `event:`/comments
                var payload = line.slice(5).trim();
                if (!payload || payload === '[DONE]') return;
                var obj;
                try { obj = JSON.parse(payload); } catch (e) { return; }
                var delta = self.extractDelta(obj, req.local);
                if (delta) { full += delta; onDelta(delta, full); }
              });
            });
            return pump();
          });
        }
        return pump();
      }).then(function(full) {
        clearTimeout(timer);
        if (aborted) return;
        onDone(full || '', req.metrics);
      }).catch(function(err) {
        clearTimeout(timer);
        if (aborted) return;   // user navigated away / switched model — not an error
        console.error("[DEBUG] ERROR: streaming request failed:", err);
        errorCallback(err && err.message ? err : {
          message: 'Error communicating with Anthropic API: ' + err,
          status: 'error',
          details: 'No response details'
        });
      });

      return handle;
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
      
      // Format chart data more efficiently if available.
      // data.chartData may be a single object (legacy) or an array (multi-chart).
      let formattedChartData = "";
      if (data.chartData) {
        if (config.DEBUG_MODE) {
          console.log("[DEBUG] Formatting chart data for efficient LLM consumption");
        }

        const rawChartDataJson = JSON.stringify(data.chartData);
        const charts = Array.isArray(data.chartData) ? data.chartData : [data.chartData];

        // Accumulate row/actual-row counts across all charts
        metricReport.rowCount = charts.reduce((sum, c) => sum + (c.rowCount || 0), 0);
        metricReport.actualRows = charts.reduce((sum, c) => sum + (c.data ? c.data.length : 0), 0);
        metricReport.dataSampled = charts.some(c => c.dataSampled);

        const parts = charts.map((chart, idx) => {
          let part = "";
          if (charts.length > 1) {
            part += `=== Chart ${idx + 1}: ${(chart.info && chart.info.title) || "Untitled"} ===\n`;
          }

          const isMap = chart.info && chart.info.type && chart.info.type.toLowerCase().includes('map');

          if (isMap) {
            const dimensions = chart.dimensions || [];
            const measures   = chart.measures   || [];
            part += `Map Visualization: "${(chart.info && chart.info.title) || "Untitled Map"}"\n\n`;
            if (dimensions.length > 0) part += "Dimensions: " + dimensions.map(d => d.name || "Unnamed").join(", ") + "\n";
            if (measures.length   > 0) part += "Measures: "   + measures.map(m => m.name || "Unnamed").join(", ") + "\n";
            if (chart.mapLayers && chart.mapLayers.length > 0) {
              part += `\nMap contains ${chart.mapLayers.length} layers.\n`;
              chart.mapLayers.forEach((layer, i) => {
                part += `- Layer ${i+1}: ${layer.name || "Unnamed"} (${layer.type || "Unknown type"})\n`;
              });
            }
            part += "\nNOTE: Detailed map data extraction is currently limited.\n";
            if (config.DEBUG_MODE) console.log("[DEBUG] Processed map visualization");
          } else {
            part += this.formatChartDataForLLM(chart);
            if (config.FEATURES && config.FEATURES.EXTRACT_CITY_VALUES) {
              const cityValues = dataFormat.extractCityValues(chart);
              if (cityValues && cityValues.length > 0) {
                part += "\n\nCity Values:\n" + dataFormat.formatCityValuesTable(cityValues);
              }
            }
          }
          return part;
        });

        formattedChartData = parts.join("\n");

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
      
      // Expose the built user-turn text so the caller can append it to history.
      metricReport.builtText = messageText;

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
      const PER_TABLE = 60; // soft cap on fields listed per table

      // Add app information
      if (context.appId) {
        result.push(`App: ${context.appName || "Unnamed"} (ID: ${context.appId})`);
      }

      // Tables with their full field lists (this is the data model the LLM needs)
      if (context.tables && context.tables.length > 0) {
        result.push("\nData model tables:");
        const tableStrings = context.tables.map(table => {
          let tableStr = `- ${table.name}`;
          if (table.fields && table.fields.length > 0) {
            const shown = table.fields.slice(0, PER_TABLE).join(", ");
            tableStr += `: ${shown}`;
            if (table.fields.length > PER_TABLE) {
              tableStr += `, … and ${table.fields.length - PER_TABLE} more`;
            }
          }
          return tableStr;
        });
        result.push(tableStrings.join("\n"));
      } else if (context.fields && context.fields.length > 0) {
        // No table breakdown available — at least list the fields.
        result.push("\nFields: " + context.fields.map(f => f.name).join(", "));
      }

      // Master measures (with expressions) — important for chart suggestions
      if (context.masterMeasures && context.masterMeasures.length > 0) {
        result.push("\nMaster measures:");
        result.push(context.masterMeasures.map(m =>
          `- ${m.name}` + (m.expr ? `: ${m.expr}` : "")).join("\n"));
      }

      // Master dimensions
      if (context.masterDimensions && context.masterDimensions.length > 0) {
        result.push("\nMaster dimensions:");
        result.push(context.masterDimensions.map(d => {
          const defs = Array.isArray(d.fields) ? d.fields.join(", ") : "";
          return `- ${d.name}` + (defs ? `: ${defs}` : "");
        }).join("\n"));
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
      const local = this.isLocalModel();
      const testData = {
        userPrompt: "Hello, this is a test call from the Qlik Sense extension."
      };

      // OpenAI shape for the local backend (system as first message); Anthropic shape otherwise.
      const testPayload = local ? {
        model: this.localTag(),
        max_tokens: 100,
        stream: false,
        messages: [
          { role: "system", content: config.API.SYSTEM_PROMPT },
          { role: "user", content: testData.userPrompt }
        ]
      } : {
        model: config.API.MODEL,
        max_tokens: 100, // Small response for test
        messages: [{
          role: "user",
          content: testData.userPrompt
        }],
        system: config.API.SYSTEM_PROMPT
      };

      try {
        // Get API key (shared across all apps). The local (Ollama) backend needs none.
        const apiKey = security.getAPIKey();

        if (!local && !apiKey) {
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
      // Local (Ollama, OpenAI-compatible) shape: choices[0].message.content
      if (response && response.choices && response.choices.length > 0 &&
          response.choices[0].message) {
        return response.choices[0].message.content;
      }
      // Anthropic Messages shape: content[0].text
      if (response && response.content && response.content.length > 0) {
        return response.content[0].text;
      }
      return "Received invalid response structure from the model.";
    }
  };
});
