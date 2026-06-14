define(['./lib/marked.min', './lib/dompurify.min'], function(marked, DOMPurify) {
  'use strict';

  // Configure the bundled Markdown parser once. gfm enables tables/strikethrough;
  // breaks turns single newlines into <br> (Claude often relies on them).
  if (marked && typeof marked.setOptions === 'function') {
    marked.setOptions({ gfm: true, breaks: true });
  }

  // DOMPurify's AMD build returns a ready instance in the browser; guard for the
  // factory form just in case.
  var purify = (DOMPurify && typeof DOMPurify.sanitize === 'function')
    ? DOMPurify
    : (typeof DOMPurify === 'function' && typeof window !== 'undefined' ? DOMPurify(window) : null);

  // Escape text before placing it inside an HTML string.
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Sanitize HTML before it is injected with .html(). Fails CLOSED: if DOMPurify
  // is unavailable, return escaped text so nothing executable can pass through.
  function sanitize(html) {
    if (purify) return purify.sanitize(html);
    return esc(html);
  }

  return {
    esc: esc,
    sanitize: sanitize,

    /**
     * Render the API response (Markdown) to sanitized HTML. The model output is
     * untrusted (and could be tampered with in transit), so the parsed HTML is
     * always run through DOMPurify before it reaches the DOM.
     * @param {string} text - The response text (Markdown)
     * @returns {string} - Sanitized HTML
     */
    formatResponseText: function (text) {
      if (!text) return '';

      var html;
      if (marked && typeof marked.parse === 'function') {
        try {
          html = marked.parse(text);
        } catch (e) {
          html = null;
        }
      }

      if (html == null) {
        // Fallback: minimal markdown-like formatting on ESCAPED text, so raw
        // HTML in the response cannot survive even on the fallback path.
        html = esc(text)
          .replace(/\n\n/g, '<br><br>')
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.*?)\*/g, '<em>$1</em>')
          .replace(/```([\s\S]*?)```/g, function (match, code) {
            return '<pre><code>' + code + '</code></pre>';
          });
      }

      return sanitize(html);
    },

    /**
     * Format error messages into HTML (all interpolated values are escaped).
     * @param {object|string} error - The error object or string
     * @returns {string} - Formatted HTML error message
     */
    formatErrorMessage: function(error) {
      if (typeof error === 'string') {
        return '<div class="error"><p>' + esc(error) + '</p></div>';
      }

      var errorHtml = '<div class="error"><p>Error communicating with Anthropic API:</p>';

      if (error && error.message) {
        errorHtml += '<p>' + esc(error.message) + '</p>';
      }
      if (error && error.status) {
        errorHtml += '<p>Status: ' + esc(error.status) + '</p>';
      }
      if (error && error.details) {
        errorHtml += '<p>Details: ' + esc(error.details) + '</p>';
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
      return '<div class="loading">' + esc(message) +
        '<div id="request-progress">Processing...</div></div>';
    },

    /**
     * Format warning message
     * @param {string} message - The warning message
     * @returns {string} - Formatted HTML warning message
     */
    formatWarningMessage: function(message) {
      return '<div class="warning">' + esc(message) + '</div>';
    }
  };
});
