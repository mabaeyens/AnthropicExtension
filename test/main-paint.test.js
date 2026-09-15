'use strict';

// Regression tests for how the active model is decided.
//
// The active model is DERIVED, never stored: anthropicAPI.resolveActiveModel() returns
// API.MODEL_PICK (the in-panel choice) or else API.MODEL_DEFAULT (the object's "Default
// model" property), corrected for a backend that is switched off. Only explicit user
// actions write those two fields.
//
// The bug this pins: an earlier resolveActiveModel() ASSIGNED its correction and
// persisted it. With a blank Proxy URL the Claude models are unavailable, so it rewrote
// the stored choice to the first available entry — Ministral 3 8B — over the 3B the
// operator had configured, and no property edit could undo it.
//
// No DOM: document.getElementById reports the widget as present, so paint() skips
// one-time init and only the property block runs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd-loader');

const OLLAMA = 'https://host:3000/api/ollama';
const ANTHROPIC = 'https://host:3000/api/anthropic';

function setup() {
  const config = loadAmd('js/config.js', {});
  const rendered = [];   // one entry per renderModelPicker() call
  const anthropicAPI = loadAmd('js/anthropic-api.js', {
    jquery: () => ({}),
    './config': config,
    './data-format': {},
    './log': { debug() {}, warn() {}, error() {} },
  });
  const uiController = {
    // Stubbed as already initialised: paint() then skips one-time init and only the
    // property block runs (paint's guard is uiController's own state, not the DOM).
    isInitialized: () => true,
    renderModelPicker() { rendered.push(anthropicAPI.resolveActiveModel()); },
    renderApiKeyStatus() {},
    renderConfigStatus() {},
    initUI() { throw new Error('initUI must not run — this instance owns the widget'); },
  };
  const noop = () => {};
  const main = loadAmd('js/main.js', {
    jquery: () => ({}),
    qlik: { Promise, currApp: () => ({}) },
    './anthropic-api': anthropicAPI,
    './data-collector': { init: noop, setupSelectionTracking: noop },
    './ui-controller': uiController,
    './config': config,
    './config-validate': { validate: () => ({ ok: true }) },
    './log': { debug: noop, warn: noop, error: noop, info: noop },
    'css!../css/style.css': {},
  });

  const paint = (model, props) =>
    main.paint({}, { props: Object.assign({ model }, props), qInfo: { qId: 'x' } });
  const active = () => anthropicAPI.resolveActiveModel();
  return { config, anthropicAPI, paint, rendered, active };
}

test('the Default model property decides the active model', async () => {
  const { paint, rendered, active } = setup();
  await paint('ministral-local-3b', { localUrl: OLLAMA });
  assert.equal(active(), 'ministral-local-3b');
  assert.equal(rendered[rendered.length - 1], 'ministral-local-3b');
});

test('an in-panel pick overrides the property and survives repaints', async () => {
  const { config, paint, active } = setup();
  await paint('ministral-local-3b', { localUrl: OLLAMA, proxyUrl: ANTHROPIC });

  config.API.MODEL_PICK = 'claude-opus-5';        // what applyModelChange() does
  assert.equal(active(), 'claude-opus-5');

  // Qlik repaints on every selection event, property unchanged — must not revert.
  await paint('ministral-local-3b', { localUrl: OLLAMA, proxyUrl: ANTHROPIC });
  assert.equal(active(), 'claude-opus-5');
});

test('editing the property overrides an in-panel pick', async () => {
  const { config, paint, active } = setup();
  await paint('claude-haiku-4-5', { proxyUrl: ANTHROPIC, localUrl: OLLAMA });
  config.API.MODEL_PICK = 'claude-opus-5';

  await paint('ministral-local-3b', { proxyUrl: ANTHROPIC, localUrl: OLLAMA });
  assert.equal(config.API.MODEL_PICK, null, 'a property edit clears the pick');
  assert.equal(active(), 'ministral-local-3b');
});

test('a blank Proxy URL withholds the Claude models', async () => {
  const { config, anthropicAPI, paint } = setup();
  await paint('ministral-local-3b', { proxyUrl: '', localUrl: OLLAMA });

  assert.equal(config.API.PROXY_URL, '', 'blank property must not fall back to a default');
  // Joined, not deepEqual: the module runs in a vm realm, so its arrays are not
  // reference-equal to this realm's Array.prototype.
  const ids = anthropicAPI.availableModels().map((m) => m.id).join(',');
  assert.equal(ids, 'ministral-local,ministral-local-3b');
  assert.equal(anthropicAPI.isModelAvailable('claude-haiku-4-5'), false);
});

test('an unavailable model is substituted for display, NOT overwritten', async () => {
  const { config, paint, active } = setup();
  await paint('ministral-local-3b', { proxyUrl: '', localUrl: OLLAMA });
  config.API.MODEL_PICK = 'claude-opus-5';   // picked while the proxy was still set

  // Claude is off, so something reachable is shown instead...
  assert.notEqual(active(), 'claude-opus-5');
  // ...but the recorded choice is untouched, and returns the moment the proxy is back.
  assert.equal(config.API.MODEL_PICK, 'claude-opus-5');
  await paint('ministral-local-3b', { proxyUrl: ANTHROPIC, localUrl: OLLAMA });
  assert.equal(active(), 'claude-opus-5');
});

test('an unreachable pick falls back to the property, not to registry order', async () => {
  const { config, paint, active } = setup();
  // The object is configured for the 3B; a pick made earlier points at unreachable Claude.
  await paint('ministral-local-3b', { proxyUrl: '', localUrl: OLLAMA });
  config.API.MODEL_PICK = 'claude-opus-5';
  assert.equal(active(), 'ministral-local-3b',
    'the operator’s 3B — NOT Ministral 3 8B, which merely sorts first in the registry');

  config.API.MODEL_PICK = null;
  assert.equal(active(), 'ministral-local-3b');
});

test('registry order decides only when the property is unreachable too', async () => {
  const { config, paint, active } = setup();
  await paint('claude-haiku-4-5', { proxyUrl: '', localUrl: OLLAMA });
  assert.equal(config.API.MODEL_DEFAULT, 'claude-haiku-4-5');
  assert.equal(active(), 'ministral-local', 'nothing configured is reachable — first available');
});

test('with nothing configured the full registry is still offered', async () => {
  const { anthropicAPI, paint } = setup();
  await paint('claude-haiku-4-5', { proxyUrl: '', localUrl: '' });
  assert.equal(anthropicAPI.availableModels().length, 5,
    'fail-safe: an empty picker would leave a fresh install with no way forward');
});

// ── Config ownership ────────────────────────────────────────────────────────────────
// `config` is one singleton shared by EVERY object of this extension, while the
// properties are per object. Without a gate, painting a second, never-configured object
// (its dropdown default committed as props.model = 'claude-haiku-4-5', no URL keys)
// overwrote the configured model — the sheet-change bug the user hit: def flipped to
// 'claude-haiku-4-5' and, with a blank Proxy URL, resolved to Ministral 3 8B.

// Like setup(), but exposes `main` so several objects (distinct qIds) can paint through
// the one shared config, and records what renderConfigStatus was last given.
function setupOwnership() {
  const config = loadAmd('js/config.js', {});
  const status = [];
  const anthropicAPI = loadAmd('js/anthropic-api.js', {
    jquery: () => ({}),
    './config': config,
    './data-format': {},
    './log': { debug() {}, warn() {}, error() {} },
  });
  const uiController = {
    isInitialized: () => true,
    renderModelPicker() {},
    renderApiKeyStatus() {},
    renderConfigStatus(errors) { status.push(errors || []); },
    initUI() { throw new Error('initUI must not run'); },
  };
  const noop = () => {};
  const configValidate = loadAmd('js/config-validate.js', { './config': config });
  const main = loadAmd('js/main.js', {
    jquery: () => ({}),
    qlik: { Promise, currApp: () => ({}) },
    './anthropic-api': anthropicAPI,
    './data-collector': { init: noop, setupSelectionTracking: noop },
    './ui-controller': uiController,
    './config': config,
    './config-validate': configValidate,
    './log': { debug: noop, warn: noop, error: noop, info: noop },
    'css!../css/style.css': {},
  }, { Date });
  return { config, main, status, active: () => anthropicAPI.resolveActiveModel() };
}

function paintObj(main, qId, props) {
  return main.paint({}, { props, qInfo: { qId } });
}

test('a second, unconfigured object cannot overwrite the configured one', async () => {
  const { config, main, active } = setupOwnership();

  await paintObj(main, 'CONFIGURED', {
    model: 'ministral-local-3b', proxyUrl: '', localUrl: OLLAMA,
  });
  assert.equal(active(), 'ministral-local-3b');

  // Navigating to a sheet holding an untouched second object: its dropdown default is
  // committed, and it carries no URL keys at all.
  await paintObj(main, 'STRAY', { model: 'claude-haiku-4-5' });

  assert.equal(config.API.MODEL_DEFAULT, 'ministral-local-3b', 'the stray must be ignored');
  assert.equal(active(), 'ministral-local-3b', 'and Ministral 3 8B must not appear');
  assert.equal(config.API.LOCAL.URL, OLLAMA);
});

test('a configured object takes ownership from an unconfigured incumbent', async () => {
  const { config, main, active } = setupOwnership();

  // The unconfigured object paints first (its sheet is the landing sheet).
  await paintObj(main, 'STRAY', { model: 'claude-haiku-4-5' });
  assert.equal(config.API.MODEL_DEFAULT, 'claude-haiku-4-5');

  // The real object then paints and must win — first-painted must not be decisive.
  await paintObj(main, 'CONFIGURED', {
    model: 'ministral-local-3b', proxyUrl: '', localUrl: OLLAMA,
  });
  assert.equal(active(), 'ministral-local-3b');

  // ...and keeps winning on every later visit to the stray's sheet.
  await paintObj(main, 'STRAY', { model: 'claude-haiku-4-5' });
  assert.equal(active(), 'ministral-local-3b');
});

test('the owner keeps applying its own property edits', async () => {
  const { main, active } = setupOwnership();
  await paintObj(main, 'CONFIGURED', { model: 'ministral-local-3b', localUrl: OLLAMA });
  await paintObj(main, 'CONFIGURED', { model: 'ministral-local', localUrl: OLLAMA });
  assert.equal(active(), 'ministral-local', 'the owner is never gated against itself');
});

test('the config banner clears once the configuration becomes valid', async () => {
  const { main, status } = setupOwnership();

  // An object with no endpoint at all — the banner must appear.
  await paintObj(main, 'CONFIGURED', { model: 'ministral-local-3b' });
  assert.ok(status.at(-1).length > 0, 'banner raised');
  assert.ok(status.at(-1).some((e) => e.includes('No endpoint configured')));

  // The moment a URL is set it must clear itself — the old once-at-init validation left
  // the message on screen for the whole session.
  await paintObj(main, 'CONFIGURED', { model: 'ministral-local-3b', localUrl: OLLAMA });
  assert.deepEqual(status.at(-1).length, 0, 'banner cleared');
});
