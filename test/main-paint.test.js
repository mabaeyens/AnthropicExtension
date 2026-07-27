'use strict';

// Regression tests for main.js paint() — how the "Default model" property interacts with
// the in-panel model picker. Two bugs are pinned here:
//   1. Once the in-panel picker set MODEL_LOCKED, a LATER change to the property was
//      ignored for the rest of the page load: the dropdown looked dead and the picker
//      stayed on the previously picked model.
//   2. The opposite failure it guards against — a plain repaint (Qlik calls paint() on
//      every selection event) must NOT revert a mid-conversation in-panel pick.
// No DOM: document.getElementById is stubbed to report the widget as already present, so
// paint() skips one-time init and only the property block runs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd-loader');

function setup() {
  const config = loadAmd('js/config.js', {});
  const rendered = [];   // one entry per renderModelPicker() call
  const uiController = {
    renderModelPicker() { rendered.push(config.API.MODEL); },
    renderApiKeyStatus() {},
    initUI() { throw new Error('initUI must not run — widget is stubbed as present'); },
  };
  const noop = () => {};
  const main = loadAmd('js/main.js', {
    jquery: () => ({}),
    qlik: { Promise, currApp: () => ({}) },
    './anthropic-api': {},
    './data-collector': { init: noop, setupSelectionTracking: noop },
    './ui-controller': uiController,
    './config': config,
    './config-validate': { validate: () => ({ ok: true }) },
    './log': { debug: noop, warn: noop, error: noop },
    'css!../css/style.css': {},
  }, {
    document: { getElementById: () => ({}) },   // widget already injected
  });

  const paint = (model) => main.paint({}, { props: { model }, qInfo: { qId: 'x' } });
  return { config, paint, rendered };
}

test('the Default model property seeds the model and repaints the picker', async () => {
  const { config, paint, rendered } = setup();
  await paint('ministral-local-3b');
  assert.equal(config.API.MODEL, 'ministral-local-3b');
  assert.deepEqual(rendered, ['ministral-local-3b']);
});

test('changing the property overrides an earlier in-panel pick (clears MODEL_LOCKED)', async () => {
  const { config, paint, rendered } = setup();
  await paint('claude-haiku-4-5');

  // User picks a model in the chat panel — this is what applyModelChange() does.
  config.API.MODEL = 'claude-opus-4-8';
  config.API.MODEL_LOCKED = true;

  // Now they change the properties dropdown. That is an explicit action and must win.
  await paint('ministral-local-3b');
  assert.equal(config.API.MODEL, 'ministral-local-3b');
  assert.equal(config.API.MODEL_LOCKED, false);
  assert.equal(rendered[rendered.length - 1], 'ministral-local-3b');
});

test('a repaint with an unchanged property does not revert an in-panel pick', async () => {
  const { config, paint } = setup();
  await paint('claude-haiku-4-5');

  config.API.MODEL = 'ministral-local-3b';
  config.API.MODEL_LOCKED = true;

  // Qlik repaints on every selection event, with the property value unchanged.
  await paint('claude-haiku-4-5');
  assert.equal(config.API.MODEL, 'ministral-local-3b');
});
