define([], function() {
  'use strict';

  // The extension panel markup, inlined as a module so it loads with the rest of
  // the RequireJS bundle. This removes the previous dependency on a hard-coded
  // "../extensions/AnthropicExtension/html/template.html" fetch, which broke if the
  // deployed folder was renamed and added an HTTP round-trip on every render.
  return `
<div class="anthropic-extension-container">
  <div class="anthropic-input-area">
    <h3>Anthropic AI Assistant</h3>
    <div class="api-key-input">
      <label for="anthropic-api-key">Anthropic API Key:</label>
      <input type="password" id="anthropic-api-key" placeholder="Enter your API key">
    </div>
    <div class="chart-selection-area">
      <label>Chart Selection:</label>
      <div class="selection-controls">
        <button id="select-chart-button" class="lui-button">Select Chart</button>
        <span id="selection-status">No chart selected</span>
      </div>
      <div id="selection-instructions" style="display:none; margin-top:5px; font-style:italic;">
        Click on any chart in the dashboard to select it for analysis
      </div>
    </div>
    <div class="prompt-input">
      <label for="anthropic-prompt">Ask about your data:</label>
      <textarea id="anthropic-prompt" placeholder="Enter your question or prompt"></textarea>
    </div>
    <div class="context-toggle">
      <label><input type="checkbox" id="include-context" checked> Include app context</label>
    </div>
    <div class="optimization-options">
      <details>
        <summary>Advanced Options</summary>
        <div class="optimization-controls">
          <div class="optimization-section">
            <h4>Data Settings</h4>
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
    </div>
    <div id="debug-area" class="debug-area" style="display:none; margin-top:10px; border-top:1px solid #ccc; padding-top:10px;">
      <button id="test-direct-api" class="lui-button">Test Direct API Call</button>
    </div>
  </div>
  <div class="anthropic-output-area">
    <h4>AI Response</h4>
    <div id="anthropic-response" class="response-container"></div>
  </div>
</div>`;
});
