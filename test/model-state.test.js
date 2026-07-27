'use strict';

// Regression tests for the session-sticky model choice (config.saveModelState /
// restoreModelState). Navigating to a sheet where the extension object is NOT placed can
// leave the body-global widget standing while a fresh AMD module set is instantiated —
// API.MODEL then reverted to the shipped default (Haiku) and the picker redrew from it.
// The choice is mirrored into sessionStorage so a fresh instance restores it instead.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd-loader');

// Minimal sessionStorage stand-in — the real one is a DOM API the Node tests don't have.
function fakeStorage(seed) {
  const map = new Map(Object.entries(seed || {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

// A fresh config module instance sharing one storage — i.e. what a sheet change produces.
const freshConfig = (storage) => loadAmd('js/config.js', {}, { window: { sessionStorage: storage } });

test('a saved model choice is restored by a fresh module instance', () => {
  const storage = fakeStorage();

  const first = freshConfig(storage);
  assert.equal(first.API.MODEL, 'claude-haiku-4-5', 'shipped default');
  first.API.MODEL = 'ministral-local-3b';
  first.API.MODEL_LOCKED = true;
  first.API.MODEL_FROM_PROPS = 'claude-haiku-4-5';
  first.saveModelState();

  const second = freshConfig(storage);
  assert.equal(second.API.MODEL, 'ministral-local-3b');
  assert.equal(second.API.MODEL_LOCKED, true);
  // Carried over so paint() doesn't mistake the unchanged property for an explicit edit
  // and overwrite the pick.
  assert.equal(second.API.MODEL_FROM_PROPS, 'claude-haiku-4-5');
});

test('a model id no longer in the registry is ignored', () => {
  const storage = fakeStorage({
    'anthropicExtension.model': JSON.stringify({ model: 'claude-retired-1', locked: true }),
  });
  const config = freshConfig(storage);
  assert.equal(config.API.MODEL, 'claude-haiku-4-5', 'falls back to the shipped default');
  assert.equal(config.API.MODEL_LOCKED, false);
});

test('corrupt stored state does not break module load', () => {
  const storage = fakeStorage({ 'anthropicExtension.model': '{not json' });
  const config = freshConfig(storage);
  assert.equal(config.API.MODEL, 'claude-haiku-4-5');
});

test('with no window (Node/tests) save and restore are inert no-ops', () => {
  const config = loadAmd('js/config.js', {});   // sandbox has no `window`
  assert.equal(config.restoreModelState(), false);
  assert.doesNotThrow(() => config.saveModelState());
});

test('an empty session starts from the shipped default, not a previous tab', () => {
  const config = freshConfig(fakeStorage());
  assert.equal(config.API.MODEL, 'claude-haiku-4-5');
  assert.equal(config.API.MODEL_FROM_PROPS, null);
});
