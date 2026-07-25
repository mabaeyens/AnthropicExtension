define(['jquery', 'qlik', './anthropic-api', './data-collector', './formatting', './config', './template', './chart-builder', './log'],
  function ($, qlik, anthropicAPI, dataCollector, formatting, config, template, chartBuilder, log) {
    'use strict';

    let $container = null;
    let selectionModeActive = false;

    // Array of { id, title, data } — supports multiple chart selections
    let selectedCharts = [];
    const MAX_CHARTS = 5;

    // Conversation memory. `conversation` holds the API message turns
    // ({ role, content }) and persists across sheet changes / new chart picks
    // (the widget lives in document.body and is never re-initialized). Chart data
    // is only resent when the selection changes; app context only on the first
    // turn — prior turns already carry that context in the history.
    let conversation = [];
    let contextSent = false;
    let lastChartSignature = null;

    // Handle for the single in-flight request ({ abort }) — buffered OR streamed
    // (E02). At most one request per widget instance is in flight; it is aborted on
    // new chat, model switch, and teardown so a dead request can't write into DOM
    // that has been thrown away. `busy` is the single-flight guard: while true,
    // Submit and Suggest a chart are disabled and any further trigger is a no-op.
    let activeRequest = null;
    let busy = false;

    // The wrapper for the exchange currently being rendered. Each turn (user
    // bubble + its assistant reply) is grouped in a .chat-turn that is prepended,
    // so the newest exchange sits at the top of the thread.
    let $currentTurn = null;

    // Threshold above which we warn before shipping chart data to the LLM (E05).
    const LARGE_PAYLOAD_BYTES = (config.DATA && config.DATA.WARN_PAYLOAD_BYTES) || 65 * 1024;

    // If the chart data about to be sent exceeds the size threshold, ask the
    // user to confirm (large payloads mean high token cost / slow / costly
    // requests). Returns true to proceed, false to abort. Null/empty payloads
    // always proceed.
    function confirmLargePayload(chartDataPayload) {
      if (!chartDataPayload) return true;
      var bytes = 0;
      try { bytes = JSON.stringify(chartDataPayload).length; } catch (e) { return true; }
      if (bytes <= LARGE_PAYLOAD_BYTES) return true;
      var kb = Math.round(bytes / 1024);
      return window.confirm(
        'The selected chart data is about ' + kb + ' KB.\n\n' +
        'Sending this much data to the AI will use a large number of tokens and ' +
        'may be slow, costly, or hit the model\'s limits. Consider filtering the ' +
        'data (selections) to reduce it.\n\nSend it anyway?');
    }

    // Bound the conversation history sent per request: keep only the last
    // HISTORY_MAX messages so heap and per-request tokens don't grow without
    // bound over a long session. Preserve user-first alternation for the API.
    function boundedHistory() {
      var max = (config.CHAT && config.CHAT.HISTORY_MAX) || 12;
      if (conversation.length <= max) return conversation.slice();
      var trimmed = conversation.slice(conversation.length - max);
      if (trimmed.length && trimmed[0].role !== 'user') trimmed = trimmed.slice(1);
      return trimmed;
    }

    // ── Model context-window guard ────────────────────────────────────────────
    // Estimate the request size (~4 chars/token) and compare against the selected
    // model's context window. If it won't fit, the user chooses to truncate the
    // data to fit or cancel and refine selections.

    function modelWindow() {
      var m = config.API.MODEL;
      return (config.API.CONTEXT_WINDOWS && config.API.CONTEXT_WINDOWS[m]) ||
        config.API.CONTEXT_WINDOW || 200000;
    }
    function inputBudget() {
      // Reserve room for the response + a safety margin.
      return Math.max(4000, modelWindow() - (config.API.MAX_TOKENS || 4000) - 4000);
    }
    function estimateTokens(chartDataPayload) {
      var chars = 2000; // system prompt + question + formatting overhead
      if (chartDataPayload) { try { chars += JSON.stringify(chartDataPayload).length; } catch (e) {} }
      boundedHistory().forEach(function (m) { chars += (m && m.content ? m.content.length : 0); });
      return Math.ceil(chars / 4);
    }
    // Clone the payload and trim chart rows until it fits the budget.
    function truncateToFit(payload, budget) {
      if (!payload) return { payload: payload, changed: false };
      var clone = payload.map(function (c) {
        var d = (c && typeof c === 'object') ? Object.assign({}, c) : c;
        if (c && Array.isArray(c.data)) d.data = c.data.slice();
        return d;
      });
      var changed = false, guard = 0;
      while (estimateTokens(clone) > budget && guard < 100) {
        var trimmed = false;
        clone.forEach(function (c) {
          if (c && Array.isArray(c.data) && c.data.length > 5) {
            var keep = Math.max(5, Math.floor(c.data.length * 0.8));
            if (keep < c.data.length) { c.data = c.data.slice(0, keep); changed = true; trimmed = true; }
          }
        });
        if (!trimmed) break;
        guard++;
      }
      return { payload: clone, changed: changed };
    }
    // Returns { ok, chartData, truncated }. ok=false means the user cancelled.
    function guardPayload(chartDataPayload) {
      // Hard client-side ceiling reconciled with the proxy BODY_LIMIT (E05 §4.6): a
      // payload the server would 413 is caught HERE first, with a friendlier message.
      var maxBytes = (config.DATA && config.DATA.MAX_PAYLOAD_BYTES) || 1048576;
      if (chartDataPayload) {
        var payloadBytes = 0;
        try { payloadBytes = JSON.stringify(chartDataPayload).length; } catch (e) { payloadBytes = 0; }
        if (payloadBytes > maxBytes) {
          window.alert('The selected chart data is about ' + Math.round(payloadBytes / 1024) +
            ' KB, which exceeds the ' + Math.round(maxBytes / 1024) + ' KB the proxy accepts.\n\n' +
            'Filter the data with selections (or select fewer charts) and try again.');
          return { ok: false };
        }
      }
      var budget = inputBudget();
      var est = estimateTokens(chartDataPayload);
      if (est > budget) {
        var ok = window.confirm(
          'This request is about ' + est.toLocaleString() + ' tokens, which exceeds the ' +
          config.API.MODEL + ' context window (~' + modelWindow().toLocaleString() + ' tokens).\n\n' +
          'OK — truncate the chart data to fit and send.\n' +
          'Cancel — stop, so you can filter the data with selections and try again.');
        if (!ok) return { ok: false };
        var res = truncateToFit(chartDataPayload, budget);
        return { ok: true, chartData: res.payload, truncated: res.changed };
      }
      // Under the model limit — keep the lighter egress-size heads-up.
      if (!confirmLargePayload(chartDataPayload)) return { ok: false };
      return { ok: true, chartData: chartDataPayload, truncated: false };
    }

    // Clipboard fallback for non-secure contexts where navigator.clipboard is
    // unavailable. Copies via a hidden textarea + execCommand.
    function fallbackCopy(text) {
      var ta = document.createElement('textarea');
      ta.value = text == null ? '' : String(text);
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand('copy'); } catch (e) { /* ignore */ }
      document.body.removeChild(ta);
    }

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
        var self = this;
        var $thinking = this.appendThinkingMessage('Testing API connection…');
        anthropicAPI.testConnection(
          appId,
          function(response) {
            var responseText = anthropicAPI.formatResponse(response);
            self.replaceThinking($thinking, '<div style="color:green">API test successful! Response: ' + escapeHtml(responseText) + '</div>');
          },
          function(error) {
            self.replaceThinking($thinking, formatting.formatErrorMessage(error));
          }
        );
      },

      initUI: function($element, layout) {
        var self = this;

        // Inject the floating widget into body (persists across sheet navigation)
        $('body').append(template);
        $container = $('#anthropic-floating-widget').find('.anthropic-extension-container');

        // Toggle button
        $('#anthropic-toggle-btn').on('click', function() {
          var isOpen = $('#anthropic-panel').hasClass('is-open');
          $('#anthropic-panel').toggleClass('is-open', !isOpen);
          $('#anthropic-toggle-btn').toggleClass('is-open', !isOpen);
          // Collapsing must release chart-selection mode so its capture-phase
          // document click handler stops intercepting clicks on the Qlik UI.
          if (isOpen && selectionModeActive) self.toggleChartSelectionMode();
        });

        // Close button
        $('#anthropic-panel-close').on('click', function() {
          $('#anthropic-panel').removeClass('is-open');
          $('#anthropic-toggle-btn').removeClass('is-open');
          if (selectionModeActive) self.toggleChartSelectionMode();
        });

        // Let the user drag the panel out of the way (it can otherwise cover
        // charts during selection).
        this.makePanelDraggable();

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
        this.renderModelPicker();

        if (config.DEBUG_MODE && config.FEATURES && config.FEATURES.SHOW_DEBUG_AREA) {
          $container.find('#debug-area').show();
        }

        // Version/build/author footer at the bottom of the panel
        $('#anthropic-version-info').text('v' + config.VERSION + ' · build ' + config.BUILD +
          (config.AUTHOR ? ' · by ' + config.AUTHOR : ''));

        // Warm the master-item lookup so chart specs resolve to real master
        // dimensions/measures even if "Include app context" is off.
        dataCollector.getAppContextCached().then(function(ctx) {
          if (ctx) chartBuilder.setMasterItems(ctx.masterDimensions, ctx.masterMeasures);
        }).catch(function() { /* ignore — resolution falls back to field names */ });

        this.setupEventHandlers();
        log.debug('UI initialized — floating widget injected into body');
      },

      // Drag the panel by its header. Pins the panel to viewport coords (it
      // normally sits in the bottom-right flex anchor); the inline left/top
      // persist across open/close so the chosen spot sticks for the session.
      makePanelDraggable: function() {
        var $panel = $('#anthropic-panel');
        var $header = $panel.find('.anthropic-panel-header');
        var dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;

        // Document move/up handlers are attached only WHILE dragging and removed
        // on mouseup, so they aren't live (firing on every mouse move) for the
        // whole session.
        function onMove(e) {
          if (!dragging) return;
          var maxLeft = Math.max(0, window.innerWidth  - $panel.outerWidth());
          var maxTop  = Math.max(0, window.innerHeight - $panel.outerHeight());
          var left = Math.min(Math.max(0, startLeft + (e.clientX - startX)), maxLeft);
          var top  = Math.min(Math.max(0, startTop  + (e.clientY - startY)), maxTop);
          $panel.css({ left: left + 'px', top: top + 'px' });
        }
        function onUp() {
          dragging = false;
          $(document).off('mousemove.anthropicDrag mouseup.anthropicDrag');
        }

        $header.on('mousedown', function(e) {
          if ($(e.target).closest('#anthropic-panel-close').length) return; // don't hijack close
          var rect = $panel[0].getBoundingClientRect();
          startX = e.clientX; startY = e.clientY;
          startLeft = rect.left; startTop = rect.top;
          dragging = true;
          $panel.css({ position: 'fixed', left: startLeft + 'px', top: startTop + 'px',
                       right: 'auto', bottom: 'auto', margin: 0 });
          $(document).on('mousemove.anthropicDrag', onMove)
                     .on('mouseup.anthropicDrag', onUp);
          e.preventDefault();
        });
      },

      // Render the connection status line. The browser holds no API key any more
      // (E01) — the proxy holds it and authenticates the Qlik session. So this now
      // only warns when the required proxy URL is not configured. Kept under the
      // old name/#area to avoid churn in call sites. Safe to call from paint().
      renderApiKeyStatus: function() {
        if (!$container) return;
        var $area = $container.find('#api-key-status-area');
        if (!$area.length) return;

        var url = anthropicAPI.isLocalModel() ? config.API.LOCAL.URL : config.API.PROXY_URL;
        if (url) {
          $area.empty();
        } else {
          $area.html(
            '<div class="api-key-notice">' +
            'No proxy URL configured. Set it in <strong>Edit object &#8594; Settings</strong>.' +
            '</div>'
          );
        }
      },

      // ── Model picker ─────────────────────────────────────────────────────────
      // The active model lives in config.API.MODEL. The picker owns it for the
      // rest of the session once used (config.API.MODEL_LOCKED), so a repaint
      // can't revert it. Safe to call from paint() — no-ops before init.

      /** Repaint the picker button, the "talking to" line, and the menu items. */
      renderModelPicker: function() {
        if (!$container) return;
        var activeId = config.API.MODEL;
        var label = anthropicAPI.getModelLabel(activeId);

        $container.find('#anthropic-active-model')
          .html('Talking to <strong>' + escapeHtml(label) + '</strong>');

        var $menu = $container.find('#anthropic-model-menu');
        if (!$menu.length) return;
        var html = '<div class="model-menu-title">Choose a model</div>';
        (config.API.MODELS || []).forEach(function(m) {
          html += '<button type="button" class="model-menu-item' +
            (m.id === activeId ? ' is-active' : '') + '" data-model="' + escapeHtml(m.id) + '">' +
            '<span class="model-menu-name">' + escapeHtml(m.label) + '</span>' +
            (m.hint ? '<span class="model-menu-hint">' + escapeHtml(m.hint) + '</span>' : '') +
            (m.id === activeId ? '<span class="model-menu-check">&#10003;</span>' : '') +
            '</button>';
        });
        $menu.html(html);
      },

      /** Replace the menu body with the change-model confirmation step. */
      renderModelConfirm: function(modelId) {
        var $menu = $container.find('#anthropic-model-menu');
        var label = anthropicAPI.getModelLabel(modelId);
        // Only the "clears your conversation" wording when there IS one to clear.
        var msg = conversation.length
          ? 'This will clear your current conversation! Change model?'
          : 'Switch to ' + label + '?';
        $menu.html(
          '<div class="model-confirm">' +
          '<div class="model-confirm-msg">' + escapeHtml(msg) + '</div>' +
          '<div class="model-confirm-target">' + escapeHtml(label) + '</div>' +
          '<div class="model-confirm-actions">' +
          '<button type="button" class="lui-button model-confirm-yes" data-model="' +
          escapeHtml(modelId) + '">Change model</button>' +
          '<button type="button" class="model-confirm-no">Cancel</button>' +
          '</div></div>');
      },

      /** Commit a model change: clears the thread, since history can't cross models. */
      applyModelChange: function(modelId) {
        config.API.MODEL = modelId;
        config.API.MODEL_LOCKED = true;
        this.startNewChat();
        this.renderModelPicker();
        // Switching to/from a local model changes whether a key is needed.
        this.renderApiKeyStatus();
        this.closeModelMenu();
        this.appendSystemNote(formatting.formatWarningMessage(
          'Model changed to ' + anthropicAPI.getModelLabel(modelId) + '. Conversation cleared.'));
      },

      closeModelMenu: function() {
        if (!$container) return;
        $container.find('#anthropic-model-menu').hide();
        $container.find('#anthropic-model-button').removeClass('is-open');
      },

      setupEventHandlers: function() {
        var self = this;

        // Model picker: open/close, pick → confirm → apply.
        $container.find('#anthropic-model-button').on('click', function(e) {
          e.stopPropagation();
          var $menu = $container.find('#anthropic-model-menu');
          if ($menu.is(':visible')) {
            self.closeModelMenu();
          } else {
            self.renderModelPicker();   // rebuild so it can't show a stale choice
            $menu.show();
            $(this).addClass('is-open');
          }
        });

        $container.find('#anthropic-model-menu').on('click', function(e) {
          e.stopPropagation();   // keep the outside-click handler from closing it
        });

        $container.find('#anthropic-model-menu').on('click', '.model-menu-item', function() {
          var id = $(this).data('model');
          if (id === config.API.MODEL) { self.closeModelMenu(); return; }
          self.renderModelConfirm(id);
        });

        $container.find('#anthropic-model-menu').on('click', '.model-confirm-yes', function() {
          self.applyModelChange($(this).data('model'));
        });

        $container.find('#anthropic-model-menu').on('click', '.model-confirm-no', function() {
          self.renderModelPicker();
          self.closeModelMenu();
        });

        // Click anywhere else closes the menu.
        $(document).on('click.anthropicModel', function() { self.closeModelMenu(); });

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

        // New chat — reset conversation memory (keeps selected charts)
        $container.find('#anthropic-new-chat').on('click', function() {
          self.startNewChat();
        });

        // Stop button — abort the in-flight response (shown only while busy).
        $container.find('#anthropic-stop').on('click', function() {
          self.stopActiveRequest();
        });

        // Delegated Copy button — copies the raw markdown of an assistant reply.
        $container.find('#anthropic-conversation').on('click', '.chat-copy-btn', function() {
          var $btn = $(this);
          var raw  = $btn.closest('.chat-msg').data('raw') || '';
          function flash() {
            $btn.text('Copied ✓').addClass('copied');
            setTimeout(function() { $btn.text('Copy').removeClass('copied'); }, 1500);
          }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(raw).then(flash, function() { fallbackCopy(raw); flash(); });
          } else {
            fallbackCopy(raw);
            flash();
          }
        });

        // Submit button
        $container.find('#submit-to-anthropic').on('click', function() {
          // Single-flight: ignore a click while a request is already in flight (E02).
          if (busy) return;
          var userPrompt = $container.find('#anthropic-prompt').val();
          if (!userPrompt || !userPrompt.trim()) {
            self.appendSystemNote(formatting.formatErrorMessage('Please enter a question or prompt.'));
            return;
          }

          var app   = qlik.currApp();
          var appId = app.id;

          // Resend chart data only when the selected-chart set changed since the
          // last turn — otherwise prior turns already carry it in the history.
          var chartSig = selectedCharts.map(function(c) { return c.id; }).join('|');
          var chartDataPayload = null;
          if (selectedCharts.length > 0 && chartSig !== lastChartSignature) {
            chartDataPayload = selectedCharts.map(function(c) { return c.data; });
          }

          // Guard against exceeding the model's context window (and warn on large
          // egress). Cancel aborts before anything is added to the thread.
          var guard = guardPayload(chartDataPayload);
          if (!guard.ok) return;
          chartDataPayload = guard.chartData;

          // Show the user's question and a temporary "thinking" bubble, clear input
          self.appendUserMessage(userPrompt);
          var $thinking = self.appendThinkingMessage('Thinking…');
          $container.find('#anthropic-prompt').val('');
          if (guard.truncated) {
            self.appendSystemNote(formatting.formatWarningMessage(
              'Chart data was truncated to fit the ' + config.API.MODEL + ' context window.'));
          }

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
            userPrompt:   userPrompt,
            chartData:    chartDataPayload,
            systemPrompt: systemPrompt,
            history:      boundedHistory()
          };

          // Enter the busy state for the whole request (incl. async context build).
          self.beginBusy();

          // App context only on the first turn (subsequent turns inherit it via history)
          var includeContext = $container.find('#include-context').is(':checked');
          if (includeContext && !contextSent) {
            dataCollector.getAppContextCached().then(function(context) {
              requestData.context = context;
              if (context.fieldsTruncated) {
                self.appendSystemNote(formatting.formatWarningMessage(
                  'Field list truncated to ' + context.fieldsTruncated.kept + ' of ' +
                  context.fieldsTruncated.total + ' fields to bound token usage.'));
              }
              chartBuilder.setMasterItems(context.masterDimensions, context.masterMeasures);
              self.processAnthropicRequest(appId, requestData, $thinking, chartSig);
            }).catch(function(error) {
              self.endBusy();
              self.replaceThinking($thinking, formatting.formatErrorMessage('Error collecting app context: ' + error));
            });
          } else {
            self.processAnthropicRequest(appId, requestData, $thinking, chartSig);
          }
        });

        // Suggest a chart — ask the AI for a chart spec and preview it live.
        $container.find('#suggest-chart-button').on('click', function() {
          // Single-flight: ignore a click while a request is already in flight (E02).
          if (busy) return;
          var typed = $container.find('#anthropic-prompt').val();
          var app   = qlik.currApp();
          var appId = app.id;

          var chartSig = selectedCharts.map(function(c) { return c.id; }).join('|');
          var chartDataPayload = null;
          if (selectedCharts.length > 0 && chartSig !== lastChartSignature) {
            chartDataPayload = selectedCharts.map(function(c) { return c.data; });
          }

          // Guard against exceeding the model's context window (and warn on large
          // egress). Cancel aborts before anything is added to the thread.
          var guard = guardPayload(chartDataPayload);
          if (!guard.ok) return;
          chartDataPayload = guard.chartData;

          var displayText = (typed && typed.trim())
            ? typed.trim()
            : '📊 Suggest a chart for the selected data';
          self.appendUserMessage(displayText);
          var $thinking = self.appendThinkingMessage('Designing a chart…');
          $container.find('#anthropic-prompt').val('');
          if (guard.truncated) {
            self.appendSystemNote(formatting.formatWarningMessage(
              'Chart data was truncated to fit the ' + config.API.MODEL + ' context window.'));
          }

          // Follow up on the most recent assistant response (if any) so the
          // suggestion builds on the prior analysis, in addition to any prompt.
          var lastResponse = '';
          for (var i = conversation.length - 1; i >= 0; i--) {
            if (conversation[i].role === 'assistant') { lastResponse = conversation[i].content; break; }
          }
          var typedTrim = (typed && typed.trim()) ? typed.trim() : '';
          var basePrompt;
          if (lastResponse) {
            basePrompt = 'Use your previous response as context for this chart suggestion:\n' +
              '"""\n' + lastResponse + '\n"""\n\n' +
              (typedTrim || 'Suggest a chart that best visualizes the key insight from that response.');
          } else {
            basePrompt = typedTrim || 'Suggest a chart that best visualizes the selected data.';
          }
          var requestData = {
            userPrompt:   basePrompt + chartBuilder.buildPromptSuffix(),
            chartData:    chartDataPayload,
            systemPrompt: 'You are a Qlik Sense visualization expert. When asked to ' +
              'suggest a chart, reply with ONLY the requested fenced qlik-chart JSON ' +
              'block — no prose, no explanation.',
            history:      boundedHistory()
          };

          // Enter the busy state for the whole request (incl. async context build).
          self.beginBusy();

          var includeContext = $container.find('#include-context').is(':checked');
          if (includeContext && !contextSent) {
            dataCollector.getAppContextCached().then(function(context) {
              requestData.context = context;
              if (context.fieldsTruncated) {
                self.appendSystemNote(formatting.formatWarningMessage(
                  'Field list truncated to ' + context.fieldsTruncated.kept + ' of ' +
                  context.fieldsTruncated.total + ' fields to bound token usage.'));
              }
              chartBuilder.setMasterItems(context.masterDimensions, context.masterMeasures);
              self.processChartSuggestion(appId, requestData, $thinking, chartSig);
            }).catch(function(error) {
              self.endBusy();
              self.replaceThinking($thinking, formatting.formatErrorMessage('Error collecting app context: ' + error));
            });
          } else {
            self.processChartSuggestion(appId, requestData, $thinking, chartSig);
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

        log.debug('Event handlers set up');
      },

      processAnthropicRequest: function(appId, requestData, $thinking, chartSig) {
        var self = this;
        // Pin the model at send time so the footer credits whoever actually answered.
        var modelAtSend = config.API.MODEL;

        // Shared completion path for both transports: render the markdown once,
        // attach footers, and persist the turn.
        function finish(responseText, metrics) {
          var html = formatting.formatResponseText(responseText);
          html += self.renderCopyButton();
          if (metrics) html += self.renderTokenUsage(metrics, responseText, modelAtSend);
          self.replaceThinking($thinking, html);
          // Stash the raw markdown so the Copy button copies source, not HTML.
          if ($thinking && $thinking.length) $thinking.data('raw', responseText);

          conversation.push({ role: 'user', content: metrics.builtText });
          conversation.push({ role: 'assistant', content: responseText });
          if (requestData.context) contextSent = true;
          if (requestData.chartData) lastChartSignature = chartSig;
        }

        if (this.streamingEnabled() && anthropicAPI.canStream()) {
          // Text lands in a pre-wrap node as it arrives; markdown is rendered ONCE
          // at the end. Parsing/sanitizing markdown per token is what makes streamed
          // UIs flicker, and half-written markdown renders as visible noise.
          $thinking.removeClass('thinking').empty()
            .append($('<div class="chat-stream"></div>'))
            .append($('<span class="chat-cursor">▌</span>'));
          var $stream = $thinking.find('.chat-stream');
          var node = $stream[0];

          activeRequest = anthropicAPI.streamToAnthropic(
            appId,
            requestData,
            function(chunk) {
              // textContent += is cheap and escapes by construction — no HTML is
              // built from partial model output.
              node.textContent += chunk;
            },
            function(fullText, metrics) {
              self.endBusy();
              finish(fullText, metrics);
            },
            function(error) {
              self.endBusy();
              self.replaceThinking($thinking, formatting.formatErrorMessage(self.friendlyError(error)));
            }
          );
          return;
        }

        activeRequest = anthropicAPI.sendToAnthropic(
          appId,
          requestData,
          function(response, metrics) {
            self.endBusy();
            finish(anthropicAPI.formatResponse(response), metrics);
          },
          function(error) {
            self.endBusy();
            self.replaceThinking($thinking, formatting.formatErrorMessage(self.friendlyError(error)));
          }
        );
      },

      // Map a proxy 503 (P03 concurrency overflow) to a friendly retry message
      // instead of a raw error (E02 §4.7); pass anything else through unchanged.
      friendlyError: function(error) {
        var status = error && (error.status || (error.response && error.response.status));
        if (status === 503 || status === '503') {
          return 'The assistant is busy right now. Please try again in a few seconds.';
        }
        return error;
      },

      // Chart-suggestion flow: same request machinery, but parse the reply as a
      // chart spec and render a live preview via the in-session Qlik viz API.
      // Falls back to normal markdown when no valid spec is returned.
      processChartSuggestion: function(appId, requestData, $thinking, chartSig) {
        var self = this;
        var modelAtSend = config.API.MODEL;
        activeRequest = anthropicAPI.sendToAnthropic(
          appId,
          requestData,
          function(response, metrics) {
            self.endBusy();
            var responseText = anthropicAPI.formatResponse(response);
            var spec = chartBuilder.parseChartSpec(responseText);

            if (spec) {
              // Render preview into the assistant bubble.
              self.replaceThinking($thinking, '<div class="anthropic-chart-intro">Suggested chart:</div>');
              $thinking.data('raw', responseText);
              chartBuilder.renderPreview(spec, $thinking, function(s, $card) {
                self.handleAddToSheet(s, $card);
              }).catch(function(err) {
                var msg = (err && err.message) ? err.message : String(err);
                $thinking.append('<div class="anthropic-chart-error">' +
                  escapeHtml(msg) + '</div>');
              });
            } else {
              // No usable spec — show the model's text so the user sees why.
              var html = formatting.formatResponseText(responseText);
              html += self.renderCopyButton();
              self.replaceThinking($thinking, html);
              $thinking.data('raw', responseText);
              self.appendSystemNote(formatting.formatErrorMessage(
                'Could not parse a chart specification from the response.'));
            }
            // Credit the model on both paths (chart preview and text fallback).
            if (metrics) $thinking.append(self.renderTokenUsage(metrics, responseText, modelAtSend));

            // Persist the turn so follow-ups keep context.
            conversation.push({ role: 'user', content: metrics.builtText });
            conversation.push({ role: 'assistant', content: responseText });
            if (requestData.context) contextSent = true;
            if (requestData.chartData) lastChartSignature = chartSig;
          },
          function(error) {
            self.endBusy();
            self.replaceThinking($thinking, formatting.formatErrorMessage(self.friendlyError(error)));
          }
        );
      },

      // Place a previewed chart onto the current sheet. Requires Edit mode;
      // if the sheet is packed, offers to create a new sheet instead.
      handleAddToSheet: function(spec, $card) {
        var $actions = $card.find('.anthropic-chart-actions');
        var $add = $card.find('.anthropic-chart-add');

        if (!chartBuilder.isEditMode()) {
          $card.find('.anthropic-chart-hint').remove();
          $actions.append('<span class="anthropic-chart-hint">Open the sheet in Edit ' +
            'mode to add charts.</span>');
          return;
        }

        $add.prop('disabled', true).text('Adding…');
        chartBuilder.addToSheet(spec).then(function(result) {
          if (result && result.packed) {
            $actions.empty();
            $actions.append('<span class="anthropic-chart-hint">Sheet is full — ' +
              'existing charts were left untouched.</span>');
            var $newSheet = $('<button type="button" class="lui-button anthropic-chart-add">Create a new sheet</button>');
            $actions.append($newSheet);
            $newSheet.on('click', function() {
              $newSheet.prop('disabled', true).text('Creating…');
              chartBuilder.createSheetWithChart(spec).then(function() {
                $actions.html('<span class="anthropic-chart-ok">Created a new sheet ✓</span>');
              }).catch(function(err) {
                $newSheet.prop('disabled', false).text('Create a new sheet');
                $actions.append('<div class="anthropic-chart-error">' +
                  escapeHtml((err && err.message) || String(err)) + '</div>');
              });
            });
          } else {
            $add.text('Added to sheet ✓').addClass('added');
          }
        }).catch(function(err) {
          var msg = (err && err.message) || String(err);
          if (msg === 'NOT_EDIT_MODE') {
            $add.prop('disabled', false).text('Add to sheet');
            $actions.append('<span class="anthropic-chart-hint">Open the sheet in Edit ' +
              'mode to add charts.</span>');
          } else {
            $add.prop('disabled', false).text('Add to sheet');
            $actions.append('<div class="anthropic-chart-error">' + escapeHtml(msg) + '</div>');
          }
        });
      },

      // ── Conversation thread helpers ───────────────────────────────────────

      appendUserMessage: function(text) {
        // Start a new turn wrapper and prepend it so the newest exchange is on
        // top. .text() escapes; CSS keeps newlines (white-space: pre-wrap).
        $currentTurn = $('<div class="chat-turn"></div>')
          .append($('<div class="chat-msg user"></div>').text(text));
        $container.find('#anthropic-conversation').prepend($currentTurn);
        this.scrollConversation();
      },

      appendThinkingMessage: function(text) {
        var $msg = $('<div class="chat-msg assistant thinking"></div>').text(text || 'Thinking…');
        // Append into the current turn so the assistant reply stays below its
        // question; fall back to the container if no turn is active.
        if ($currentTurn && $currentTurn.length) {
          $currentTurn.append($msg);
        } else {
          $container.find('#anthropic-conversation').append($msg);
        }
        this.scrollConversation();
        return $msg;
      },

      replaceThinking: function($msg, html) {
        if ($msg && $msg.length) {
          $msg.removeClass('thinking').html(html);
          this.scrollConversation();
        } else {
          this.appendSystemNote(html);
        }
      },

      appendSystemNote: function(html) {
        var $msg = $('<div class="chat-msg assistant"></div>').html(html);
        if ($currentTurn && $currentTurn.length) {
          $currentTurn.append($msg);
        } else {
          $container.find('#anthropic-conversation').append($msg);
        }
        this.scrollConversation();
      },

      // Surface config-validation problems in the panel (E07 §4.2). Non-fatal: names
      // the offending keys so the user can fix them in Edit object → Settings.
      showConfigError: function(errors) {
        if (!$container || !errors || !errors.length) return;
        this.appendSystemNote(formatting.formatErrorMessage(
          'Configuration problem — the assistant may not work until this is fixed: ' +
          errors.join('; ')));
      },

      scrollConversation: function() {
        // Newest exchange is at the top, so keep the view pinned there.
        var el = $container.find('.anthropic-panel-body')[0];
        if (el) el.scrollTop = 0;
      },

      // Copy button shown in each assistant message footer. The raw markdown is
      // stored on the message element so the delegated handler can copy the
      // source text (not the rendered HTML).
      renderCopyButton: function() {
        return '<div class="chat-msg-footer">' +
          '<button type="button" class="chat-copy-btn" title="Copy response">Copy</button>' +
          '</div>';
      },

      // ── Single-flight busy state (E02) ───────────────────────────────────────
      // Enter the busy state and disable the trigger buttons. Returns false if a
      // request is already in flight (caller should no-op — the click is ignored,
      // not queued, per X02 §4.1).
      beginBusy: function() {
        if (busy) return false;
        busy = true;
        if ($container) {
          $container.find('#submit-to-anthropic, #suggest-chart-button')
            .prop('disabled', true).addClass('is-busy');
          // Reveal the Stop button so the user can abort a long/local response.
          $container.find('#anthropic-stop').show();
        }
        return true;
      },

      // Leave the busy state, clear the in-flight handle, and re-enable the buttons.
      // Called on every terminal path — success, error, and abort — so the UI can
      // never get stuck disabled (E02 §4.4).
      endBusy: function() {
        busy = false;
        activeRequest = null;
        if ($container) {
          $container.find('#submit-to-anthropic, #suggest-chart-button')
            .prop('disabled', false).removeClass('is-busy');
          $container.find('#anthropic-stop').hide();
        }
      },

      // Abort whatever request is in flight (buffered or streamed) and clear busy.
      abortActiveRequest: function() {
        if (activeRequest) { try { activeRequest.abort(); } catch (e) {} }
        this.endBusy();
      },

      // User-initiated Stop (the "Stop" button). Aborts the in-flight request and
      // finalizes the on-screen message. A user abort fires NO api callback (both the
      // stream and buffered paths return early when aborted), so the DOM is tidied here:
      // the streaming cursor is removed and the message is marked as stopped. Any partial
      // streamed text is kept but is NOT pushed into conversation history (the turn was
      // interrupted). Useful above all for local models, which can generate for minutes.
      stopActiveRequest: function() {
        if (!busy && !activeRequest) return;
        this.abortActiveRequest();
        if (!$container) return;
        var $last = $container.find('#anthropic-conversation .chat-msg').last();
        if (!$last.length) return;
        $last.find('.chat-cursor').remove();
        if ($last.hasClass('thinking')) {
          // Nothing streamed yet (buffered path, or first token hadn't arrived).
          this.replaceThinking($last, '<div class="anthropic-stopped-note">Stopped.</div>');
        } else if (!$last.find('.anthropic-stopped-note').length) {
          $last.append('<div class="anthropic-stopped-note">Stopped.</div>');
        }
      },

      // Full teardown (E03): release everything this widget added so nothing outlives
      // it across sheet navigation. Idempotent and safe to call before init or twice —
      // every step guards on presence — so paint churn / a missing destroy hook can't
      // throw. Called from the extension's `destroy` hook (main.js).
      teardown: function() {
        // 1. Abort any in-flight request (E02 handle) so it can't write into DOM that
        //    is about to be removed.
        try { this.abortActiveRequest(); } catch (e) {}
        // 2. Close preview vizzes + release their engine session objects.
        try { chartBuilder.closeAllPreviews(); } catch (e) {}
        // 3. Stop selection tracking (removes the capture-phase document click
        //    listener) and drop the cached context.
        try { dataCollector.teardown(); } catch (e) {}
        // 4. Remove every global document listener this widget attached.
        $(document).off('click.anthropicModel');
        $(document).off('mousemove.anthropicDrag mouseup.anthropicDrag');
        // 5. Reset transient UI state and remove the injected widget node so a fresh
        //    paint() re-initialises cleanly with no duplicate widget or listeners.
        selectionModeActive = false;
        $('#anthropic-floating-widget').remove();
        $container = null;
      },

      startNewChat: function() {
        // Drop any in-flight request first — its DOM target is about to vanish.
        this.abortActiveRequest();
        conversation = [];
        contextSent = false;
        lastChartSignature = null;
        $currentTurn = null;
        // Close any live preview vizzes before discarding their DOM so the engine
        // session objects don't leak.
        chartBuilder.closeAllPreviews();
        $container.find('#anthropic-conversation').empty();
      },

      // `modelId` is captured when the request is SENT, not when it returns — the
      // user may have switched models while the answer was in flight.
      renderTokenUsage: function(metrics, responseText, modelId) {
        return '<div class="token-usage-info">' +
          '<details>' +
          '<summary>LLM Token Usage</summary>' +
          '<div class="token-details">' +
          '<p>Prompt: ~' + metrics.estimatedTokens + ' tokens (' + metrics.totalChars + ' chars)</p>' +
          '<p>Response: ~' + Math.ceil(responseText.length / 4) + ' tokens (' + responseText.length + ' chars)</p>' +
          (metrics.chartDataReduction
            ? '<p>Data optimization: ' + metrics.chartDataReduction + '% reduction in size (' +
              (metrics.dataSampled ? 'sampled data, ' : '') +
              (metrics.actualRows || metrics.rowCount) + ' rows from ' + metrics.rowCount + ' total)</p>'
            : '') +
          '</div></details>' +
          '<div class="answered-by">You are talking to <strong>' +
          escapeHtml(anthropicAPI.getModelLabel(modelId || config.API.MODEL)) +
          '</strong></div>' +
          '</div>';
      },

      // Advanced Options → "Stream the answer as it is generated". Falls back to
      // the config default before the widget exists.
      streamingEnabled: function() {
        if (!$container) return !!(config.CHAT && config.CHAT.STREAM);
        var $cb = $container.find('#stream-response');
        return $cb.length ? $cb.is(':checked') : !!(config.CHAT && config.CHAT.STREAM);
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

        // Warn early if the table was too large to fetch fully (the engine fetch
        // is hard-capped to avoid freezing the tab).
        if (objectData.dataTruncated) {
          var t = objectData.dataTruncated;
          var $statusTrunc = $container.find('#selection-status');
          $statusTrunc.html('<span style="color:#f39c12;">⚠️ Large table — only the first ' +
            t.fetched.toLocaleString() + ' of ' + t.total.toLocaleString() +
            ' rows will be analyzed.</span>').show();
        }

        log.debug('[DEBUG] Chart added:', objectId, '— total:', selectedCharts.length);
      },

      // Legacy compatibility
      updateSelectedVisualization: function(objectId, objectData, errorInfo) {
        this.handleChartSelection(objectId, objectData, errorInfo);
      },

      sendRequest: function(appId, userPrompt, chartData, context) {
        this.appendUserMessage(userPrompt);
        var $thinking = this.appendThinkingMessage('Thinking…');
        this.processAnthropicRequest(
          appId,
          { userPrompt: userPrompt, chartData: chartData, context: context, history: boundedHistory() },
          $thinking,
          null
        );
      }
    };
  });
