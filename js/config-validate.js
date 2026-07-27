define(['./config'], function (config) {
  'use strict';

  // Config validation run once at init (E07 §4.1). Returns { ok, errors } — NON-FATAL by
  // design: main.js surfaces a clear panel message naming the offending key rather than
  // throwing deep in paint() (which would wedge the whole sheet render, §8). Also runs
  // config.validateData() (E05) so the data-collection bounds are clamped to safe defaults.

  function isNonEmptyString(v) { return typeof v === 'string' && v.trim() !== ''; }
  function isPosInt(v) { return typeof v === 'number' && isFinite(v) && v > 0 && Math.floor(v) === v; }
  function isValidUrl(v) {
    if (!isNonEmptyString(v)) return false;
    try { /* eslint-disable-next-line no-new */ new URL(v); return true; } catch (e) { return false; }
  }

  return {
    /**
     * Validate a config object (defaults to the shared config). Collects every problem
     * so the user sees all of them at once.
     * @returns {{ ok: boolean, errors: string[] }}
     */
    validate: function (cfg) {
      cfg = cfg || config;
      var errors = [];
      var api = cfg.API || {};

      // Each URL is optional but must be well-formed when set: BLANK MEANS "this backend
      // is switched off" and its models are withheld, which is how a local-only (or
      // Anthropic-only) deployment is configured. Only having neither is a real problem —
      // then there is nothing to talk to at all.
      var localUrl = api.LOCAL ? api.LOCAL.URL : '';
      if (api.PROXY_URL && !isValidUrl(api.PROXY_URL)) {
        errors.push('API.PROXY_URL is set but is not a valid URL');
      }
      if (localUrl && !isValidUrl(localUrl)) {
        errors.push('API.LOCAL.URL is set but is not a valid URL');
      }
      if (!api.PROXY_URL && !localUrl) {
        errors.push('No endpoint configured — set a Proxy URL (Claude), a Local model URL (Ollama), or both');
      }

      if (!isPosInt(api.MAX_TOKENS)) errors.push('API.MAX_TOKENS must be a positive integer');

      if (!Array.isArray(api.MODELS) || api.MODELS.length === 0) {
        errors.push('API.MODELS must be a non-empty array');
      } else {
        api.MODELS.forEach(function (m, i) {
          if (!m || !isNonEmptyString(m.id)) errors.push('API.MODELS[' + i + '].id is required');
          if (!m || !isNonEmptyString(m.label)) errors.push('API.MODELS[' + i + '].label is required');
          if (m && m.local && !isNonEmptyString(m.tag)) {
            errors.push('API.MODELS[' + i + '] is local but has no Ollama tag');
          }
        });
        if (isNonEmptyString(api.MODEL_DEFAULT) &&
            !api.MODELS.some(function (m) { return m && m.id === api.MODEL_DEFAULT; })) {
          errors.push('API.MODEL_DEFAULT (' + api.MODEL_DEFAULT + ') must match an id in API.MODELS');
        }
      }

      var chat = cfg.CHAT || {};
      if (!isPosInt(chat.HISTORY_MAX)) errors.push('CHAT.HISTORY_MAX must be a positive integer');

      // Log verbosity must be one of the known levels (js/log.js falls back to INFO,
      // but a typo'd level is worth surfacing).
      if (cfg.LOG_LEVEL !== undefined &&
          ['ERROR', 'WARN', 'INFO', 'DEBUG'].indexOf(String(cfg.LOG_LEVEL).toUpperCase()) === -1) {
        errors.push('LOG_LEVEL must be one of ERROR, WARN, INFO, DEBUG');
      }

      // Clamp/validate the data-collection bounds (E05); its own warnings cover DATA.*.
      if (typeof cfg.validateData === 'function') { cfg.validateData(); }

      return { ok: errors.length === 0, errors: errors };
    }
  };
});
