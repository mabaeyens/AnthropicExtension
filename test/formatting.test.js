'use strict';

// E06 — unit tests for formatting sanitize (supports E04). The security-critical
// property is FAIL-CLOSED: with DOMPurify unavailable, model output is escaped, never
// injected raw. Also assert the sanitized path routes model output through DOMPurify.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd-loader');

// marked stub: pass text through as if it were already HTML, so the test exercises the
// sanitize step specifically.
const markedStub = { setOptions() {}, parse: (t) => t };

test('FAIL-CLOSED: with DOMPurify absent, a <script> in model output is escaped', () => {
  // DOMPurify stub has no .sanitize → formatting falls back to esc().
  const formatting = loadAmd('js/formatting.js', {
    './lib/marked.min': markedStub,
    './lib/dompurify.min': {},
  });
  const out = formatting.formatResponseText('<script>window.__xss=1</script>');
  assert.equal(out.includes('<script>'), false);      // no raw tag
  assert.match(out, /&lt;script&gt;/);                 // escaped instead
});

test('with DOMPurify present, output is routed through sanitize (script stripped)', () => {
  const purifyStub = { sanitize: (h) => String(h).replace(/<script[\s\S]*?<\/script>/gi, '') };
  const formatting = loadAmd('js/formatting.js', {
    './lib/marked.min': markedStub,
    './lib/dompurify.min': purifyStub,
  });
  const out = formatting.formatResponseText('hello <script>evil()</script> world');
  assert.equal(out.includes('<script>'), false);
  assert.match(out, /hello/);
});

test('esc() escapes all five HTML metacharacters', () => {
  const formatting = loadAmd('js/formatting.js', {
    './lib/marked.min': markedStub,
    './lib/dompurify.min': {},
  });
  assert.equal(formatting.esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

test('formatErrorMessage escapes interpolated error fields', () => {
  const formatting = loadAmd('js/formatting.js', {
    './lib/marked.min': markedStub,
    './lib/dompurify.min': {},
  });
  const out = formatting.formatErrorMessage({ message: '<img src=x onerror=alert(1)>' });
  assert.equal(out.includes('<img'), false);
  assert.match(out, /&lt;img/);
});
