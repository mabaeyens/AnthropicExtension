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
    DEBUG_MODE: true,  // Change to false for production
    
    // API Configuration
    API: {
      URL: 'https://localhost:3000/api/anthropic',
      MODEL: 'claude-3-haiku-20240307',
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
      SHOW_DEBUG_AREA: true        // Show debug area in UI when DEBUG_MODE is true
    }
  };
});