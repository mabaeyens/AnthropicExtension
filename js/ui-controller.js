define(['jquery', 'qlik', './anthropic-api', './data-collector', './security', './formatting', './config', './template'],
  function ($, qlik, anthropicAPI, dataCollector, security, formatting, config, template) {
    'use strict';

    let $container = null;
    let selectionModeActive = false;

    // Array of { id, title, data } — supports multiple chart selections
    let selectedCharts = [];
    const MAX_CHARTS = 5;

    // Escape text before interpolating into HTML strings (chart titles are
    // user-controlled and may contain <, >, &, or quotes).
    function escapeHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // ── Chip rendering ────────────────────────────────────────────────────────

    function renderChips() {
      const $list   = $container.find('#selected-charts-list');
      const $status = $container.find('#selection-status');
      const $clear  = $container.find('#clear-charts-button');

      $list.empty();

      if (selectedCharts.length === 0) {
        $status.text('No charts selected').show();
        $clear.hide();
      } else {
        $status.hide();
        $clear.show();
        selectedCharts.forEach(function(chart) {
          var $chip = $(
            '<div class="chart-chip" data-chart-id="' + escapeHtml(chart.id) + '">' +
            '<span class="chart-chip-title">' + escapeHtml(chart.title) + '</span>' +
            '<button class="remove-chart" title="Remove">&#10005;</button>' +
            '</div>'
          );
          $list.append($chip);
        });
      }

      updateDebugSection();
    }

    // ── Debug section ─────────────────────────────────────────────────────────

    function updateDebugSection() {
      var $section = $container.find('#chart-debug-section');
      var $content = $container.find('#chart-debug-content');

      if (selectedCharts.length === 0) {
        $section.hide();
        return;
      }

      $section.show();
      $content.empty();

      selectedCharts.forEach(function(chart) {
        var d = chart.data;
        var info = d.info || {};
        var dims = (d.dimensions || []).map(function(x) { return x.name; }).join(', ') || '—';
        var meas = (d.measures   || []).map(function(x) { return x.name; }).join(', ') || '—';
        var rowCount = d.rowCount !== undefined ? d.rowCount : (d.data ? d.data.length : 0);
        var sampledNote = d.dataSampled ? ' (sampled: ' + escapeHtml(d.samplingRate) + ')' : '';

        // Build a mini-table of first 3 rows
        var miniTable = '';
        if (d.data && d.data.length > 0) {
          var previewRows = d.data.slice(0, 3);
          miniTable = '<table class="debug-mini-table"><tbody>';
          previewRows.forEach(function(row) {
            miniTable += '<tr>';
            if (Array.isArray(row)) {
              row.forEach(function(cell) {
                var val = (cell && (cell.text || cell.value || cell.qText)) || (typeof cell === 'string' ? cell : '');
                miniTable += '<td>' + escapeHtml(String(val).substring(0, 30)) + '</td>';
              });
            } else {
              miniTable += '<td>' + escapeHtml(String(row).substring(0, 60)) + '</td>';
            }
            miniTable += '</tr>';
          });
          miniTable += '</tbody></table>';
          if (d.data.length > 3) {
            miniTable += '<div class="debug-more">… ' + (d.data.length - 3) + ' more rows</div>';
          }
        } else {
          miniTable = '<em>No data rows</em>';
        }

        var $block = $(
          '<div class="debug-chart-block">' +
          '<div class="debug-chart-header">' + escapeHtml(info.title || 'Untitled') + '</div>' +
          '<div class="debug-chart-meta">' +
          '<span><b>ID:</b> ' + escapeHtml(chart.id) + '</span> · ' +
          '<span><b>Type:</b> ' + escapeHtml(info.type || '?') + '</span> · ' +
          '<span><b>Rows:</b> ' + rowCount + sampledNote + '</span>' +
          '</div>' +
          '<div class="debug-chart-meta"><b>Dimensions:</b> ' + escapeHtml(dims) + '</div>' +
          '<div class="debug-chart-meta"><b>Measures:</b> ' + escapeHtml(meas) + '</div>' +
          '<div class="debug-chart-preview">' + miniTable + '</div>' +
          '</div>'
        );
        $content.append($block);
      });
    }

    // ── Public API ────────────────────────────────────────────────────────────

    return {

      testDirectApiCall: function(appId) {
        var $responseArea = $container.find('#anthropic-response');
        $responseArea.html(formatting.formatLoadingMessage('Testing API connection...'));
        anthropicAPI.testConnection(
          appId,
          function(response) {
            var responseText = anthropicAPI.formatResponse(response);
            $responseArea.html('<div style="color:green">API test successful! Response: ' + responseText + '</div>');
          },
          function(error) {
            $responseArea.html(formatting.formatErrorMessage(error));
          }
        );
      },

      initUI: function($element, layout) {
        // Inject the floating widget into body (persists across sheet navigation)
        $('body').append(template);
        $container = $('#anthropic-floating-widget').find('.anthropic-extension-container');

        // Toggle button
        $('#anthropic-toggle-btn').on('click', function() {
          var isOpen = $('#anthropic-panel').hasClass('is-open');
          $('#anthropic-panel').toggleClass('is-open', !isOpen);
          $('#anthropic-toggle-btn').toggleClass('is-open', !isOpen);
        });

        // Close button
        $('#anthropic-panel-close').on('click', function() {
          $('#anthropic-panel').removeClass('is-open');
          $('#anthropic-toggle-btn').removeClass('is-open');
        });

        // Placeholder in the sheet object
        $element.html(
          '<div class="anthropic-sheet-placeholder">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="#aaa"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>' +
          '<span>AI Assistant</span>' +
          '</div>'
        );

        // API key status area (no input/clear button — key is managed via the
        // properties panel only). renderApiKeyStatus also runs from paint().
        this.renderApiKeyStatus();

        if (config.DEBUG_MODE && config.FEATURES && config.FEATURES.SHOW_DEBUG_AREA) {
          $container.find('#debug-area').show();
        }

        // Version/build footer at the bottom of the panel
        $('#anthropic-version-info').text('v' + config.VERSION + ' · build ' + config.BUILD);

        this.setupEventHandlers();
        console.log('UI initialized — floating widget injected into body');
      },

      // Render the api-key status line. Key management lives entirely in the
      // properties panel, so this is read-only: a "stored" badge or a notice.
      // Safe to call from paint() — no-ops until the widget is initialized.
      renderApiKeyStatus: function() {
        if (!$container) return;
        var $area = $container.find('#api-key-status-area');
        if (!$area.length) return;

        if (security.getAPIKey()) {
          // Key is managed authoritatively in Edit object → Settings; nothing to
          // show in the panel when one is stored.
          $area.empty();
        } else {
          $area.html(
            '<div class="api-key-notice">' +
            'No API key stored. Enter it in <strong>Edit object &#8594; Settings</strong>.' +
            '</div>'
          );
        }
      },

      setupEventHandlers: function() {
        var self = this;

        // "Add Chart" button
        $container.find('#select-chart-button').on('click', function() {
          self.toggleChartSelectionMode();
        });

        // "Clear All" button
        $container.find('#clear-charts-button').on('click', function() {
          selectedCharts = [];
          renderChips();
          // also deactivate selection mode if active
          if (selectionModeActive) self.toggleChartSelectionMode();
        });

        // Delegated × button on chips
        $container.find('#selected-charts-list').on('click', '.remove-chart', function() {
          var id = $(this).closest('.chart-chip').data('chart-id');
          selectedCharts = selectedCharts.filter(function(c) { return c.id !== id; });
          renderChips();
        });

        // Submit button
        $container.find('#submit-to-anthropic').on('click', function() {
          var $responseArea = $container.find('#anthropic-response');
          $responseArea.html(formatting.formatLoadingMessage('Processing request...'));

          var app   = qlik.currApp();
          var appId = app.id;

          var userPrompt = $container.find('#anthropic-prompt').val();
          if (!userPrompt) {
            $responseArea.html(formatting.formatErrorMessage('Please enter a question or prompt.'));
            return;
          }

          // Chart data — already optimized at selection time; pass directly
          var chartDataPayload = null;
          if (selectedCharts.length > 0) {
            chartDataPayload = selectedCharts.map(function(c) { return c.data; });
          } else {
            $responseArea.html(formatting.formatWarningMessage(
              'No charts selected. Your question will be answered without chart context.'
            ));
          }

          var optimizationSettings = self.getOptimizationSettings();

          // Determine system prompt
          var systemPrompt = null;
          if ($('#analysis-style-default').is(':checked')) {
            systemPrompt = 'You are a business analyst and expert Qlik Sense user. Be concise. Always aggregate the data and show absolute values and percentages. Focus on insights that would help business decision making. Present your analysis in a structured format with bullet points for key findings.';
          } else if ($('#analysis-style-technical').is(':checked')) {
            systemPrompt = 'You are a data scientist analyzing Qlik Sense visualizations. Provide detailed technical analysis including statistical patterns, outliers, and data quality observations. Use precise terminology and reference specific data points.';
          } else if ($('#analysis-style-executive').is(':checked')) {
            systemPrompt = 'You are preparing an executive summary of Qlik Sense data. Focus only on the most significant business insights. Be extremely concise. Highlight key business metrics, trends, and actionable recommendations. Avoid technical details unless critical.';
          } else if ($('#analysis-style-custom').is(':checked')) {
            systemPrompt = $('#custom-system-prompt').val();
          }

          var requestData = {
            userPrompt:  userPrompt,
            chartData:   chartDataPayload,
            systemPrompt: systemPrompt
          };

          var includeContext = $container.find('#include-context').is(':checked');
          if (includeContext) {
            $responseArea.html(formatting.formatLoadingMessage('Collecting app context...'));
            dataCollector.getAppContextCached().then(function(context) {
              requestData.context = context;
              self.processAnthropicRequest(appId, requestData, $responseArea);
            }).catch(function(error) {
              $responseArea.html(formatting.formatErrorMessage('Error collecting app context: ' + error));
            });
          } else {
            self.processAnthropicRequest(appId, requestData, $responseArea);
          }
        });

        // Analysis style toggle for custom prompt
        $container.find("input[name='analysis-style']").on('change', function() {
          if ($('#analysis-style-custom').is(':checked')) {
            $('#custom-system-prompt').show();
          } else {
            $('#custom-system-prompt').hide();
          }
        });

        // Debug test button
        if (config.DEBUG_MODE) {
          $container.find('#test-direct-api').on('click', function() {
            var app = qlik.currApp();
            self.testDirectApiCall(app.id);
          });
        }

        console.log('Event handlers set up');
      },

      processAnthropicRequest: function(appId, requestData, $responseArea) {
        $responseArea.html(formatting.formatLoadingMessage('Preparing data for Anthropic API...'));

        var requestMetrics = null;
        anthropicAPI.sendToAnthropic(
          appId,
          requestData,
          function(response, metrics) {
            requestMetrics = metrics;
            var responseText    = anthropicAPI.formatResponse(response);
            var formattedResponse = formatting.formatResponseText(responseText);

            var resultHtml = formattedResponse;
            if (requestMetrics) {
              resultHtml +=
                '<div class="token-usage-info">' +
                '<details>' +
                '<summary>LLM Token Usage</summary>' +
                '<div class="token-details">' +
                '<p>Prompt: ~' + requestMetrics.estimatedTokens + ' tokens (' + requestMetrics.totalChars + ' chars)</p>' +
                '<p>Response: ~' + Math.ceil(responseText.length / 4) + ' tokens (' + responseText.length + ' chars)</p>' +
                (requestMetrics.chartDataReduction
                  ? '<p>Data optimization: ' + requestMetrics.chartDataReduction + '% reduction in size (' +
                    (requestMetrics.dataSampled ? 'sampled data, ' : '') +
                    (requestMetrics.actualRows || requestMetrics.rowCount) + ' rows from ' + requestMetrics.rowCount + ' total)</p>'
                  : '') +
                '</div></details></div>';
            }
            $responseArea.html(resultHtml);
          },
          function(error) {
            $responseArea.html(formatting.formatErrorMessage(error));
          }
        );
      },

      getOptimizationSettings: function() {
        return {
          maxRows:              parseInt($container.find('#max-data-rows').val(), 10),
          includeNumericValues: $container.find('#include-numeric-values').is(':checked'),
          simplifyStructure:    $container.find('#simplify-structure').is(':checked'),
          includeDimensions:    $container.find('#include-dimensions').is(':checked'),
          includeMeasures:      $container.find('#include-measures').is(':checked')
        };
      },

      toggleChartSelectionMode: function() {
        var $button       = $container.find('#select-chart-button');
        var $instructions = $container.find('#selection-instructions');
        var $status       = $container.find('#selection-status');

        selectionModeActive = !selectionModeActive;

        if (selectionModeActive) {
          $button.addClass('selection-active').text('Cancel');
          $instructions.show();
          if (selectedCharts.length === 0) {
            $status.text('Click a chart to add it').show();
          }
          $('body').addClass('anthropic-selection-mode');
          dataCollector.startSelectionTracking(this.handleChartSelection.bind(this));
        } else {
          $button.removeClass('selection-active').text('Add Chart');
          $instructions.hide();
          $('body').removeClass('anthropic-selection-mode');
          dataCollector.stopSelectionTracking();
          renderChips(); // restore chip/status view
        }
      },

      handleChartSelection: function(objectId, objectData, errorInfo) {
        // null/null signals a failed retrieval from the error path
        if (!objectId || !objectData) {
          var $status = $container.find('#selection-status');
          // No id could be extracted — show the copyable DOM dump so the
          // id-bearing attribute can be pinned down.
          if (errorInfo && errorInfo.dom) {
            $status.html('<span style="color:#d9534f;">Could not find a chart id. ' +
              'Copy this and send it back:</span>' +
              '<pre style="white-space:pre-wrap;user-select:text;font-size:10px;' +
              'max-height:160px;overflow:auto;background:#f8f8f8;border:1px solid #ddd;' +
              'border-radius:3px;padding:6px;margin-top:6px;">' +
              escapeHtml(errorInfo.dom) + '</pre>').show();
            return;
          }
          var detail = '';
          if (errorInfo) {
            var e = errorInfo.error;
            var msg = (e && (e.message || (e.toString && e.toString()))) || '';
            detail = ' (id: ' + escapeHtml(errorInfo.objectId || '?') +
              (msg ? ' — ' + escapeHtml(String(msg)) : '') + ')';
          }
          $status.html('<span style="color:#d9534f;">Could not retrieve chart data. Try another chart.' +
            detail + '</span>').show();
          // stay in selection mode so the user can try again
          return;
        }

        // Guard against error data propagated from getObjectData failure path
        if (objectData.info && objectData.info.title && objectData.info.title.indexOf('Error:') === 0) {
          var $statusErr = $container.find('#selection-status');
          $statusErr.html('<span style="color:#d9534f;">' + escapeHtml(objectData.info.title) + '</span>').show();
          return;
        }

        // Skip duplicates
        if (selectedCharts.some(function(c) { return c.id === objectId; })) {
          var $statusDup = $container.find('#selection-status');
          $statusDup.html('<span style="color:#f39c12;">Already added.</span>').show();
          return;
        }

        // Cap at MAX_CHARTS
        if (selectedCharts.length >= MAX_CHARTS) {
          var $statusCap = $container.find('#selection-status');
          $statusCap.html('<span style="color:#f39c12;">Maximum ' + MAX_CHARTS + ' charts.</span>').show();
          return;
        }

        var chartTitle = (objectData.info && objectData.info.title) ? objectData.info.title : 'Chart ' + objectId;

        // Data is already optimized by getObjectData — store directly
        selectedCharts.push({ id: objectId, title: chartTitle, data: objectData });

        // Exit selection mode after each pick
        selectionModeActive = false;
        $container.find('#select-chart-button').removeClass('selection-active').text('Add Chart');
        $container.find('#selection-instructions').hide();
        $('body').removeClass('anthropic-selection-mode');
        dataCollector.stopSelectionTracking();

        renderChips();
        console.log('[DEBUG] Chart added:', objectId, '— total:', selectedCharts.length);
      },

      // Legacy compatibility
      updateSelectedVisualization: function(objectId, objectData, errorInfo) {
        this.handleChartSelection(objectId, objectData, errorInfo);
      },

      sendRequest: function(appId, userPrompt, chartData, context) {
        var $responseArea = $container.find('#anthropic-response');
        $responseArea.html(formatting.formatLoadingMessage('Processing legacy request...'));
        this.processAnthropicRequest(appId, { userPrompt: userPrompt, chartData: chartData, context: context }, $responseArea);
      }
    };
  });
