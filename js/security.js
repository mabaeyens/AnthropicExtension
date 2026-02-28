define([], function() {
  'use strict';

  return {
    /**
     * Store API key securely in local storage
     * @param {string} appId - The app ID
     * @param {string} apiKey - The API key to store
     */
    storeAPIKey: function(appId, apiKey) {
      // Change from sessionStorage to localStorage
      localStorage.setItem('anthropic_api_key_' + appId, apiKey);
      console.log("[DEBUG] API key stored in localStorage for app:", appId);
    },

    /**
     * Get stored API key from local storage
     * @param {string} appId - The app ID
     * @returns {string} The stored API key, or null if not found
     */
    getAPIKey: function(appId) {
      // Change from sessionStorage to localStorage
      const apiKey = localStorage.getItem('anthropic_api_key_' + appId);
      console.log("[DEBUG] API key retrieved from localStorage for app:", appId, apiKey ? "Key exists" : "No key found");
      return apiKey;
    },

    /**
     * Clear stored API key from local storage
     * @param {string} appId - The app ID
     */
    clearAPIKey: function(appId) {
      // Change from sessionStorage to localStorage
      localStorage.removeItem('anthropic_api_key_' + appId);
      console.log("[DEBUG] API key removed from localStorage for app:", appId);
    }
  };
});

