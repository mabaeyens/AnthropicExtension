define(['./lib/crypto-js.min'], function(CryptoJSModule) {
  'use strict';

  // The bundled crypto-js UMD build registers itself as an AMD module and also
  // exposes a global. Fall back to the global if the AMD return value is empty.
  var CryptoJS = CryptoJSModule || (typeof window !== 'undefined' ? window.CryptoJS : null);

  // Single shared storage key — the API key is entered once and reused across all
  // Qlik apps (no per-app scoping).
  var STORAGE_KEY = 'anthropic_api_key';

  // Fixed in-bundle passphrase. NOTE: this is obfuscation, not real secrecy — anyone
  // with the extension source can derive it. The threat model here is an on-prem,
  // internal deployment where the goal is to keep the key out of plain sight in
  // localStorage, not to defend against a determined local attacker.
  var PASSPHRASE = 'qlik-anthropic-extension-v2';

  return {
    /**
     * Store the API key, encrypted, in localStorage (shared across all apps).
     * @param {string} apiKey - The API key to store
     */
    storeAPIKey: function(apiKey) {
      if (!apiKey) {
        return;
      }
      try {
        var cipher = CryptoJS.AES.encrypt(apiKey, PASSPHRASE).toString();
        localStorage.setItem(STORAGE_KEY, cipher);
      } catch (e) {
        console.error('[Anthropic] Failed to encrypt/store API key:', e);
      }
    },

    /**
     * Retrieve and decrypt the stored API key.
     * @returns {string|null} The API key, or null if not stored / undecryptable
     */
    getAPIKey: function() {
      var cipher = localStorage.getItem(STORAGE_KEY);
      if (!cipher) {
        return null;
      }
      try {
        var plaintext = CryptoJS.AES.decrypt(cipher, PASSPHRASE).toString(CryptoJS.enc.Utf8);
        return plaintext || null;
      } catch (e) {
        console.error('[Anthropic] Failed to decrypt API key:', e);
        return null;
      }
    },

    /**
     * Clear the stored API key.
     */
    clearAPIKey: function() {
      localStorage.removeItem(STORAGE_KEY);
    }
  };
});
