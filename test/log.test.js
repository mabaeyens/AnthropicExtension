'use strict';

// E06 — unit tests for js/log.js level gating. A fake console is injected via the AMD
// sandbox so nothing is printed and calls can be counted. The threshold is read from
// config.LOG_LEVEL on each call, so a live change takes effect immediately.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd-loader');

function make(level) {
  const cfg = { LOG_LEVEL: level };
  const calls = [];
  const fakeConsole = {
    error: () => calls.push('error'),
    warn: () => calls.push('warn'),
    info: () => calls.push('info'),
    log: () => calls.push('log'),
    debug: () => calls.push('debug')
  };
  const log = loadAmd('js/log.js', { './config': cfg }, { console: fakeConsole });
  return { log, calls, cfg };
}

test('gates by level (ERROR<WARN<INFO<DEBUG)', () => {
  const at = (level) => {
    const { log, calls } = make(level);
    log.error('e'); log.warn('w'); log.info('i'); log.debug('d');
    return calls.length;
  };
  assert.equal(at('ERROR'), 1);
  assert.equal(at('WARN'), 2);
  assert.equal(at('INFO'), 3);
  assert.equal(at('DEBUG'), 4);
});

test('unknown / blank level falls back to INFO', () => {
  const { log, calls } = make('chatty');
  log.info('i'); log.debug('d');
  assert.deepEqual(calls, ['info']); // debug suppressed at info
});

test('level is case-insensitive', () => {
  const { log, calls } = make('warn');
  log.info('i');
  assert.equal(calls.length, 0);
});

test('a live LOG_LEVEL change takes effect on the next call', () => {
  const { log, calls, cfg } = make('ERROR');
  log.debug('d1'); // suppressed
  cfg.LOG_LEVEL = 'DEBUG';
  log.debug('d2'); // now shown
  assert.deepEqual(calls, ['debug']);
});
