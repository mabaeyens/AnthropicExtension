define([], function() {
  'use strict';

  // The floating widget markup. Injected once into document.body so it persists
  // across sheet navigation (Qlik Sense is a SPA — the body is never reloaded).
  // The extension's own $element is left as a small placeholder on the sheet.
  return `
<div id="anthropic-floating-widget">
  <div id="anthropic-panel" class="anthropic-panel">
    <div class="anthropic-panel-header">
      <span class="anthropic-panel-title">AI Assistant</span>
      <button id="anthropic-panel-close" class="anthropic-panel-close" title="Close">&#10005;</button>
    </div>
    <div class="anthropic-panel-body">
      <div class="anthropic-extension-container">
        <div class="anthropic-input-area">

          <!-- API key status: populated by initUI (no input field — key set via properties panel) -->
          <div id="api-key-status-area"></div>

          <div class="chart-selection-area">
            <label>Chart Selection:</label>
            <div class="selection-controls">
              <button id="select-chart-button" class="lui-button">Add Chart</button>
              <button id="clear-charts-button" class="lui-button lui-button--danger" style="display:none;">Clear All</button>
            </div>
            <div id="selected-charts-list" class="selected-charts-list"></div>
            <span id="selection-status" class="selection-status-hint">No charts selected</span>
            <div id="selection-instructions" style="display:none; margin-top:5px; font-style:italic; font-size:12px;">
              Click any chart on the dashboard to add it
            </div>
          </div>

          <!-- Debug: what data will be sent to the LLM -->
          <details id="chart-debug-section" class="chart-debug-section" style="display:none;">
            <summary>Selected chart data preview</summary>
            <div id="chart-debug-content" class="chart-debug-content"></div>
          </details>

          <div class="prompt-input">
            <label for="anthropic-prompt">Ask about your data:</label>
            <textarea id="anthropic-prompt" placeholder="Enter your question or prompt"></textarea>
          </div>
          <div class="optimization-options">
            <details>
              <summary>Advanced Options</summary>
              <div class="optimization-controls">
                <div class="optimization-section">
                  <h4>Data Settings</h4>
                  <div class="optimization-row">
                    <label><input type="checkbox" id="include-context" checked> Include app context (data model) on first message</label>
                  </div>
                  <div class="optimization-row">
                    <label>Max data rows: <input type="number" id="max-data-rows" value="1000" min="10" max="10000"></label>
                  </div>
                  <div class="optimization-row">
                    <label><input type="checkbox" id="include-numeric-values" checked> Include numeric values</label>
                  </div>
                  <div class="optimization-row">
                    <label><input type="checkbox" id="simplify-structure" checked> Simplify data structure</label>
                  </div>
                  <div class="optimization-row">
                    <label><input type="checkbox" id="include-dimensions" checked> Include dimensions</label>
                  </div>
                  <div class="optimization-row">
                    <label><input type="checkbox" id="include-measures" checked> Include measures</label>
                  </div>
                </div>
                <div class="optimization-section">
                  <h4>Analysis Style</h4>
                  <div class="optimization-row">
                    <label><input type="radio" name="analysis-style" id="analysis-style-default" checked> Business analyst (default)</label>
                  </div>
                  <div class="optimization-row">
                    <label><input type="radio" name="analysis-style" id="analysis-style-technical"> Technical analyst</label>
                  </div>
                  <div class="optimization-row">
                    <label><input type="radio" name="analysis-style" id="analysis-style-executive"> Executive summary</label>
                  </div>
                  <div class="optimization-row">
                    <label><input type="radio" name="analysis-style" id="analysis-style-custom"> Custom</label>
                    <textarea id="custom-system-prompt" placeholder="Enter custom system prompt" style="width:100%; display:none; margin-top:5px;"></textarea>
                  </div>
                </div>
              </div>
            </details>
          </div>
          <div class="submit-area">
            <button id="submit-to-anthropic" class="lui-button">Submit</button>
            <button id="suggest-chart-button" class="lui-button" title="Ask the AI to propose a Qlik chart and preview it">Suggest a chart</button>
          </div>
          <div id="debug-area" class="debug-area" style="display:none; margin-top:10px; border-top:1px solid #ccc; padding-top:10px;">
            <button id="test-direct-api" class="lui-button">Test Direct API Call</button>
          </div>
        </div>
        <div class="anthropic-output-area anthropic-conversation-area">
          <div class="anthropic-conversation-header">
            <h4>AI Conversation</h4>
            <button id="anthropic-new-chat" title="Start a new conversation">New chat</button>
          </div>
          <div id="anthropic-conversation"></div>
        </div>
      </div>
    </div>
    <div class="anthropic-panel-footer" id="anthropic-version-info"></div>
  </div>
  <button id="anthropic-toggle-btn" class="anthropic-toggle-btn" title="AI Assistant">
    <svg width="26" height="26" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
    </svg>
  </button>
</div>`;
});
