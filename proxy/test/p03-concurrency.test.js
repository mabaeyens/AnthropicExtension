'use strict';

// P03 — concurrency & resilience. Deterministic unit tests of the limiter, admission
// middleware, and graceful shutdown. Timers/signals injected; no real delays/network.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  createLimiter, QueueFullError, QueueTimeoutError, RequestAbortedError, ShuttingDownError,
} = require('../lib/limiter');
const { admission } = require('../middleware/admission');
const { installGracefulShutdown } = require('../lib/shutdown');

// A manual timer harness so queue-timeout is deterministic.
function fakeTimers() {
  let seq = 1;
  const timers = new Map();
  return {
    setTimeout: (fn) => { const id = seq++; timers.set(id, fn); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    fire: (id) => { const fn = timers.get(id); timers.delete(id); if (fn) fn(); },
    fireAll: () => { for (const [, fn] of timers) fn(); timers.clear(); },
    get pending() { return timers.size; },
  };
}

// ── global & per-user ceilings ──────────────────────────────────────────────
test('admits up to the global ceiling, queues the rest', async () => {
  const t = fakeTimers();
  const lim = createLimiter({ maxGlobal: 2, maxUser: 99, maxQueue: 10, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout });
  const r1 = await lim.acquire('a');
  const r2 = await lim.acquire('b');
  assert.equal(lim.stats().globalInflight, 2);
  let admitted3 = false;
  lim.acquire('c').then(() => { admitted3 = true; });
  await Promise.resolve();
  assert.equal(admitted3, false);          // queued (global full)
  assert.equal(lim.stats().queueDepth, 1);
  r1();                                     // free a slot → pump admits c
  await Promise.resolve();
  assert.equal(admitted3, true);
  r2();
});

test('per-user ceiling queues a burst behind the user’s own cap', async () => {
  const t = fakeTimers();
  const lim = createLimiter({ maxGlobal: 10, maxUser: 2, maxQueue: 10, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout });
  await lim.acquire('u');
  await lim.acquire('u');
  let third = false;
  lim.acquire('u').then(() => { third = true; });
  // another user is unaffected
  const other = await lim.acquire('v');
  await Promise.resolve();
  assert.equal(third, false);              // u is at its cap
  assert.ok(other);                        // v proceeds
  assert.equal(lim.stats().queueDepth, 1);
});

// ── queue bounds & timeout ──────────────────────────────────────────────────
test('queue full → QueueFullError', async () => {
  const t = fakeTimers();
  const lim = createLimiter({ maxGlobal: 1, maxUser: 9, maxQueue: 1, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout });
  await lim.acquire('a');        // fills the one slot
  lim.acquire('b').catch(() => {}); // fills the one queue spot
  await assert.rejects(lim.acquire('c'), QueueFullError);
});

test('queued longer than the timeout → QueueTimeoutError', async () => {
  const t = fakeTimers();
  const lim = createLimiter({ maxGlobal: 1, maxUser: 9, maxQueue: 5, queueTimeoutMs: 10, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout });
  await lim.acquire('a');
  const p = lim.acquire('b');
  t.fireAll();                   // trip the queue timer
  await assert.rejects(p, QueueTimeoutError);
});

// ── cancellation ────────────────────────────────────────────────────────────
test('aborting a queued waiter removes it and rejects', async () => {
  const t = fakeTimers();
  const lim = createLimiter({ maxGlobal: 1, maxUser: 9, maxQueue: 5, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout });
  await lim.acquire('a');
  const ac = new AbortController();
  const p = lim.acquire('b', { signal: ac.signal });
  assert.equal(lim.stats().queueDepth, 1);
  ac.abort();
  await assert.rejects(p, RequestAbortedError);
  assert.equal(lim.stats().queueDepth, 0);
  assert.equal(t.pending, 0);    // timer cleared on abort
});

test('release is idempotent (frees exactly one slot)', async () => {
  const lim = createLimiter({ maxGlobal: 2, maxUser: 9 });
  const r = await lim.acquire('a');
  await lim.acquire('b');
  assert.equal(lim.stats().globalInflight, 2);
  r(); r(); r();                 // called 3×
  assert.equal(lim.stats().globalInflight, 1); // only one slot freed
});

// ── drain (graceful shutdown) ───────────────────────────────────────────────
test('drain rejects queued items with ShuttingDownError and blocks new acquires', async () => {
  const t = fakeTimers();
  const lim = createLimiter({ maxGlobal: 1, maxUser: 9, maxQueue: 5, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout });
  await lim.acquire('a');
  const p = lim.acquire('b');
  lim.drain();
  await assert.rejects(p, ShuttingDownError);
  await assert.rejects(lim.acquire('c'), ShuttingDownError);
});

// ── admission middleware ────────────────────────────────────────────────────
function fakeReqRes() {
  const listeners = {};
  const req = {
    qlikUser: 'DIR\\u', headers: {},
    on: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    removeListener: (ev, fn) => { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); },
    emit: (ev) => (listeners[ev] || []).forEach((f) => f()),
  };
  const res = {
    statusCode: null, headers: {}, body: null, _l: {},
    set(k, v) { this.headers[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    once(ev, fn) { (this._l[ev] = this._l[ev] || []).push(fn); },
    emit(ev) { (this._l[ev] || []).forEach((f) => f()); },
  };
  return { req, res };
}

test('admission passes through and releases the slot on res finish', async () => {
  const lim = createLimiter({ maxGlobal: 1, maxUser: 9 });
  const mw = admission(lim);
  const { req, res } = fakeReqRes();
  let nexted = false;
  await mw(req, res, () => { nexted = true; });
  assert.equal(nexted, true);
  assert.equal(lim.stats().globalInflight, 1);
  res.emit('finish');                     // response done → release
  assert.equal(lim.stats().globalInflight, 0);
});

test('admission returns 503 + Retry-After when the queue is full', async () => {
  const t = fakeTimers();
  const lim = createLimiter({ maxGlobal: 1, maxUser: 9, maxQueue: 0, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout });
  await lim.acquire('DIR\\u');            // fill the only slot; queue size 0
  const mw = admission(lim, { retryAfterSeconds: 7 });
  const { req, res } = fakeReqRes();
  await mw(req, res, () => { throw new Error('should not call next'); });
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers['Retry-After'], '7');
});

// ── graceful shutdown wiring ────────────────────────────────────────────────
test('installGracefulShutdown flips readiness, drains, closes and exits', () => {
  const handlers = {};
  let readied = null; let closed = false; let exited = null;
  const limiter = { drain() { this.drained = true; }, drained: false };
  installGracefulShutdown({
    limiter,
    setReady: (v) => { readied = v; },
    server: { close: (cb) => { closed = true; cb(); } },
    exit: (code) => { exited = code; },
    on: (sig, fn) => { handlers[sig] = fn; },
    setTimer: () => ({ unref() {} }),
  });
  handlers.SIGTERM();
  assert.equal(readied, false);
  assert.equal(limiter.drained, true);
  assert.equal(closed, true);
  assert.equal(exited, 0);
});
