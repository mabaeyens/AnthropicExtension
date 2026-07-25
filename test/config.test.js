'use strict';

// E06 — unit tests for config.validateData (E05): invalid data-collection bounds fall
// back to safe defaults, never to unbounded behaviour.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd-loader');

function freshConfig() { return loadAmd('js/config.js', {}); }

test('valid config is left unchanged', () => {
  const config = freshConfig();
  config.validateData();
  assert.equal(config.DATA.MAX_FETCH_CELLS, 50000);
  assert.equal(config.DATA.FETCH_PAGE_CONCURRENCY, 4);
  assert.equal(config.DATA.MAX_FIELDS, 500);
});

test('a non-positive / non-integer bound falls back to its default', () => {
  const config = freshConfig();
  config.DATA.FETCH_PAGE_CONCURRENCY = 0;   // would mean unbounded/none
  config.DATA.MAX_FIELDS = -5;
  config.DATA.MAX_CELLS_PER_PAGE = 1.5;
  config.validateData();
  assert.equal(config.DATA.FETCH_PAGE_CONCURRENCY, 4);
  assert.equal(config.DATA.MAX_FIELDS, 500);
  assert.equal(config.DATA.MAX_CELLS_PER_PAGE, 10000);
});

test('an over-large concurrency is clamped', () => {
  const config = freshConfig();
  config.DATA.FETCH_PAGE_CONCURRENCY = 1000;
  config.validateData();
  assert.equal(config.DATA.FETCH_PAGE_CONCURRENCY, 16);
});

test('MAX_FETCH_CELLS below MAX_CELLS_PER_PAGE is raised', () => {
  const config = freshConfig();
  config.DATA.MAX_FETCH_CELLS = 100;
  config.DATA.MAX_CELLS_PER_PAGE = 10000;
  config.validateData();
  assert.ok(config.DATA.MAX_FETCH_CELLS >= config.DATA.MAX_CELLS_PER_PAGE);
});
