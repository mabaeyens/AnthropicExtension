'use strict';

// E06/E07 — unit tests for config-validate.validate: a well-formed config passes; each
// malformed field is reported by name. No network, no DOM.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd-loader');

// Build a minimal valid config stub and load the validator against it.
function load(cfgOverrides) {
  const base = {
    API: {
      PROXY_URL: 'https://host:3000/api/anthropic',
      LOCAL: { URL: 'https://host:3000/api/ollama' },
      MAX_TOKENS: 4000,
      MODEL_DEFAULT: 'claude-haiku-4-5',
      MODELS: [
        { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
        { id: 'ministral-local', label: 'Ministral', local: true, tag: 'ministral-3-demo' }
      ]
    },
    CHAT: { HISTORY_MAX: 12 },
    DATA: { MAX_FETCH_CELLS: 50000, MAX_CELLS_PER_PAGE: 10000, FETCH_PAGE_CONCURRENCY: 4, MAX_FIELDS: 500, WARN_PAYLOAD_BYTES: 66560, MAX_PAYLOAD_BYTES: 1048576, MAX_ROWS: 1000 },
    validateData: function () { /* no-op for the test */ }
  };
  const cfg = Object.assign(base, cfgOverrides || {});
  return { validator: loadAmd('js/config-validate.js', { './config': cfg }), cfg };
}

test('a well-formed config validates OK', () => {
  const { validator, cfg } = load();
  const r = validator.validate(cfg);
  assert.equal(r.ok, true);
  // r.errors is created in the vm realm; check length rather than deepStrictEqual
  // (cross-realm arrays differ by prototype).
  assert.equal(r.errors.length, 0);
});

test('a malformed proxy URL is reported', () => {
  const { validator, cfg } = load();
  cfg.API.PROXY_URL = 'not a url';
  const r = validator.validate(cfg);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('PROXY_URL')));
});

test('a local model without a tag is reported', () => {
  const { validator, cfg } = load();
  cfg.API.MODELS.push({ id: 'x', label: 'X', local: true }); // no tag
  const r = validator.validate(cfg);
  assert.ok(r.errors.some((e) => e.includes('local but has no')));
});

test('MODEL_DEFAULT not matching any MODELS id is reported', () => {
  const { validator, cfg } = load();
  cfg.API.MODEL_DEFAULT = 'does-not-exist';
  const r = validator.validate(cfg);
  assert.ok(r.errors.some((e) => e.includes('API.MODEL_DEFAULT')));
});

// Blank means "this backend is switched off" — the supported way to run local-only (or
// Anthropic-only). Only having neither endpoint is an actual misconfiguration.
test('a blank Proxy URL is valid on its own', () => {
  const { validator, cfg } = load();
  cfg.API.PROXY_URL = '';
  const r = validator.validate(cfg);
  assert.equal(r.ok, true, r.errors.join('; '));
});

test('a blank Local model URL is valid on its own', () => {
  const { validator, cfg } = load();
  cfg.API.LOCAL.URL = '';
  const r = validator.validate(cfg);
  assert.equal(r.ok, true, r.errors.join('; '));
});

test('having NO endpoint at all is reported', () => {
  const { validator, cfg } = load();
  cfg.API.PROXY_URL = '';
  cfg.API.LOCAL.URL = '';
  const r = validator.validate(cfg);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('No endpoint configured')));
});

test('non-positive MAX_TOKENS / HISTORY_MAX are reported', () => {
  const { validator, cfg } = load();
  cfg.API.MAX_TOKENS = 0;
  cfg.CHAT.HISTORY_MAX = -1;
  const r = validator.validate(cfg);
  assert.ok(r.errors.some((e) => e.includes('MAX_TOKENS')));
  assert.ok(r.errors.some((e) => e.includes('HISTORY_MAX')));
});
