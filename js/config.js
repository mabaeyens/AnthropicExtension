define([], function() {
  'use strict';

  /**
   * Configuration options for the Anthropic extension
   * 
   * For production use:
   * - Set DEBUG_MODE to false
   * - Update the API.URL to point to your production endpoint
   * - Adjust the MODEL as needed for your use case
   */
  return {
    // Debug mode - set to false for production
    DEBUG_MODE: false,  // Change to true to enable verbose console logging

    // API Configuration
    API: {
      // Direct Anthropic endpoint, called from the browser. Used when PROXY_URL is empty.
      URL: 'https://api.anthropic.com/v1/messages',
      // Optional local proxy URL. When non-empty, requests are routed here instead
      // of calling api.anthropic.com directly (and the direct-browser headers are omitted).
      // Overridden per-instance from the extension's "Proxy URL" property.
      PROXY_URL: '',
      // Anthropic API version header, required for direct browser calls.
      VERSION: '2023-06-01',
      // Default model. Overridden per-instance from the extension's "Model" property.
      MODEL: 'claude-haiku-4-5',
      // Models offered in the properties-panel dropdown.
      MODELS: ['claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-8'],
      MAX_TOKENS: 4000,
      SYSTEM_PROMPT: 'You are a business analyst and expert Qlik Sense user. Be concise. Always aggregate the data and show absolute values and percentages. Focus on insights that would help business decision making. Present your analysis in a structured format with bullet points for key findings.',
      TIMEOUT: 60000
    },
    
    // Data Collection Settings
    DATA: {
      MAX_ROWS: 1000,
      DEFAULT_OPTIMIZATION: {
        maxRows: 1000,
        includeNumericValues: true,
        simplifyStructure: true,
        includeDimensions: true,
        includeMeasures: true
      }
    },
    
    // Feature flags
    FEATURES: {
      EXTRACT_CITY_VALUES: false,  // Disable city-value extraction (not working with maps)
      SHOW_DEBUG_AREA: false       // Show debug area in UI when DEBUG_MODE is true
    }
  };
});