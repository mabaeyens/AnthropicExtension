define(['./lib/marked.min'], function(marked) {
  'use strict';

  // Configure the bundled Markdown parser once. gfm enables tables/strikethrough;
  // breaks turns single newlines into <br> (Claude often relies on them).
  if (marked && typeof marked.setOptions === 'function') {
    marked.setOptions({ gfm: true, breaks: true });
  }

  return {
    /**
     * Render the API response (Markdown) to HTML using the bundled marked parser.
     * Falls back to a minimal replacer if marked failed to load.
     * @param {string} text - The response text (Markdown)
     * @returns {string} - Formatted HTML
     */
    formatResponseText: function (text) {
      if (!text) return '';

      if (marked && typeof marked.parse === 'function') {
        try {
          return marked.parse(text);
        } catch (e) {
          // fall through to the simple replacer below
        }
      }

      // Fallback: simple markdown-like formatting
      let formatted = text
        .replace(/\n\n/g, '<br><br>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>');
      formatted = formatted.replace(/```([\s\S]*?)```/g, function (match, code) {
        return '<pre><code>' + code + '</code></pre>';
      });
      return formatted;
    },
    
    /**
     * Format error messages into HTML
     * @param {object|string} error - The error object or string
     * @returns {string} - Formatted HTML error message
     */
    formatErrorMessage: function(error) {
      if (typeof error === 'string') {
        return '<div class="error"><p>' + error + '</p></div>';
      }
      
      let errorHtml = '<div class="error"><p>Error communicating with Anthropic API:</p>';
      
      if (error.message) {
        errorHtml += '<p>' + error.message + '</p>';
      }
      
      if (error.status) {
        errorHtml += '<p>Status: ' + error.status + '</p>';
      }
      
      if (error.details) {
        errorHtml += '<p>Details: ' + error.details + '</p>';
      }
      
      errorHtml += '</div>';
      return errorHtml;
    },
    
    /**
     * Format loading message with animation
     * @param {string} message - The loading message
     * @returns {string} - Formatted HTML loading message
     */
    formatLoadingMessage: function(message) {
      return '<div class="loading">' + message + 
        '<div id="request-progress">Processing...</div></div>';
    },
    
    /**
     * Format warning message
     * @param {string} message - The warning message
     * @returns {string} - Formatted HTML warning message 
     */
    formatWarningMessage: function(message) {
      return '<div class="warning">' + message + '</div>';
    }
  };
});