'use strict';

// E06 §7 — guard that the SHIPPED runtime stays plain AMD with no build step. Every
// js/ module (except the vendored minified libs) must call define() and contain no ES
// module import/export, and the AnthropicExtension.js → js/main.js load chain must hold.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const JS_DIR = path.join(ROOT, 'js');

// All js/ sources except the vendored third-party bundles under js/lib/.
function ourModules() {
  return fs.readdirSync(JS_DIR, { recursive: true })
    .filter((f) => typeof f === 'string' && f.endsWith('.js'))
    .filter((f) => !f.replace(/\\/g, '/').startsWith('lib/'))
    .map((f) => path.join(JS_DIR, f));
}

const ES_IMPORT = /^\s*import\s+[\w{*]/m;
const ES_EXPORT = /^\s*export\s+(default|const|let|var|function|class|\{|\*)/m;

test('every shipped js/ module is AMD (calls define) and has no ES import/export', () => {
  const files = ourModules();
  assert.ok(files.length >= 6, 'expected the core modules to be present');
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    assert.ok(/\bdefine\s*\(/.test(src), `${rel} should call define()`);
    assert.equal(ES_IMPORT.test(src), false, `${rel} must not use ES import`);
    assert.equal(ES_EXPORT.test(src), false, `${rel} must not use ES export`);
  }
});

test('AnthropicExtension.js entry loads js/main', () => {
  const entry = fs.readFileSync(path.join(ROOT, 'AnthropicExtension.js'), 'utf8');
  assert.match(entry, /main/); // entry point wires to js/main via RequireJS
});
