'use strict';

// E06 — unit tests for data-format pure helpers (token estimation / size-report
// determinism). No deps to stub (define([])).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd-loader');

const dataFormat = loadAmd('js/data-format.js', {});

test('createSizeReport token math is ~chars/4 and reduction is exact', () => {
  const report = dataFormat.createSizeReport(4000, 1000);
  // optimizedTokens = ceil(1000/4)=250; originalTokens=1000; reduction=100-round(25)=75.
  // Thousands separators are locale-dependent (absent under a minimal ICU) — tolerate both.
  assert.match(report, /~250 tokens/);
  assert.match(report, /~1,?000 tokens/);
  assert.match(report, /75% reduction/);
});

test('createSizeReport is deterministic for identical input', () => {
  const a = dataFormat.createSizeReport(12345, 6789);
  const b = dataFormat.createSizeReport(12345, 6789);
  assert.equal(a, b);
});
