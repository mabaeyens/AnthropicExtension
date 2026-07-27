'use strict';

// Tests for the session state mirrored into sessionStorage (config.saveModelState /
// restoreModelState). Only USER-SET FACTS are stored — the property default, the in-panel
// pick, and the two endpoints — never a derived value. Storing a derived (availability-
// corrected) model is what let one bad correction outlive the tab and permanently override
// the object's property.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd-loader');

const OLLAMA = 'https://host:3000/api/ollama';

// Minimal sessionStorage stand-in — the real one is a DOM API the Node tests don't have.
function fakeStorage(seed) {
  const map = new Map(Object.entries(seed || {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

const freshConfig = (storage) => loadAmd('js/config.js', {}, { window: { sessionStorage: storage } });

test('the property default, the pick and both endpoints survive into a fresh instance', () => {
  const storage = fakeStorage();

  const first = freshConfig(storage);
  assert.equal(first.API.MODEL_DEFAULT, 'claude-haiku-4-5', 'shipped default');
  first.API.MODEL_DEFAULT = 'ministral-local-3b';
  first.API.MODEL_PICK = 'ministral-local';
  first.API.LOCAL.URL = OLLAMA;
  first.API.PROXY_URL = '';
  first.saveModelState();

  const second = freshConfig(storage);
  assert.equal(second.API.MODEL_DEFAULT, 'ministral-local-3b');
  assert.equal(second.API.MODEL_PICK, 'ministral-local');
  // The endpoints ride along so availability is judged against the user's configuration
  // and not against the blank literals, which would misjudge every model as unreachable.
  assert.equal(second.API.LOCAL.URL, OLLAMA);
  assert.equal(second.API.PROXY_URL, '');
});

test('no pick is stored as null, so the property default rules', () => {
  const storage = fakeStorage();
  const first = freshConfig(storage);
  first.API.MODEL_DEFAULT = 'ministral-local-3b';
  first.saveModelState();

  const second = freshConfig(storage);
  assert.equal(second.API.MODEL_PICK, null);
  assert.equal(second.API.MODEL_DEFAULT, 'ministral-local-3b');
});

test('state written by an older build is discarded, not reinterpreted', () => {
  // v1/v2 entries stored a derived {model, locked} pair. Reinterpreting one would revive
  // exactly the stuck state this redesign removes.
  const storage = fakeStorage({
    'anthropicExtension.model': JSON.stringify({ v: 2, model: 'claude-opus-4-8', locked: true }),
  });
  const config = freshConfig(storage);
  assert.equal(config.API.MODEL_DEFAULT, 'claude-haiku-4-5', 'ignored — back to the shipped default');
  assert.equal(config.API.MODEL_PICK, null);
  assert.equal(storage.getItem('anthropicExtension.model'), null, 'and the entry is cleared');
});

test('ids no longer in the registry are dropped', () => {
  const storage = fakeStorage({
    'anthropicExtension.model': JSON.stringify({
      v: 3, modelDefault: 'claude-retired-1', modelPick: 'also-retired',
    }),
  });
  const config = freshConfig(storage);
  assert.equal(config.API.MODEL_DEFAULT, 'claude-haiku-4-5');
  assert.equal(config.API.MODEL_PICK, null);
});

test('corrupt stored state does not break module load', () => {
  const config = freshConfig(fakeStorage({ 'anthropicExtension.model': '{not json' }));
  assert.equal(config.API.MODEL_DEFAULT, 'claude-haiku-4-5');
});

test('with no window (Node/tests) save and restore are inert no-ops', () => {
  const config = loadAmd('js/config.js', {});   // sandbox has no `window`
  assert.equal(config.restoreModelState(), false);
  assert.doesNotThrow(() => config.saveModelState());
});

test('the shipped endpoints are blank — an unconfigured object must look unconfigured', () => {
  const config = freshConfig(fakeStorage());
  assert.equal(config.API.PROXY_URL, '');
  assert.equal(config.API.LOCAL.URL, '');
});
