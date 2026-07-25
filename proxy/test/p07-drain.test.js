'use strict';

// P07 §4.4 — graceful drain, integration-flavoured. An in-flight request must finish
// while, once draining begins, readiness flips to not-ready and NEW requests are shed
// with 503. (The signal→drain→close→exit wiring itself is unit-tested in
// p03-concurrency.test.js via installGracefulShutdown; here we prove the request-path
// behaviour during a drain.)

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildApp, listen, validBody } = require('./helpers');
const { createLimiter } = require('../lib/limiter');

test('in-flight finishes during drain while new requests are shed and /ready flips', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const upstream = async () => { await gate; return { data: { ok: true } }; };
  upstream.calls = [];
  // wrap so we can observe that the upstream was entered
  let entered = 0;
  const countingUpstream = async (opts) => { entered += 1; return upstream(opts); };

  let readyFlag = true;
  const limiter = createLimiter({ maxGlobal: 2, maxUser: 9, maxQueue: 5, queueTimeoutMs: 5000 });
  const { app } = buildApp({ callUpstream: countingUpstream, limiter, isReady: () => readyFlag });
  const s = await listen(app);

  try {
    const headers = { 'content-type': 'application/json', 'x-qlik-session': 'alice' };
    // 1) Start an in-flight request that occupies a slot and blocks on the gate.
    const inflight = fetch(`${s.url}/api/anthropic`, { method: 'POST', headers, body: JSON.stringify(validBody) });
    for (let i = 0; i < 100 && entered === 0; i += 1) await new Promise((r) => setTimeout(r, 5));
    assert.equal(entered, 1);

    // 2) Begin draining: readiness flips, the limiter stops admitting new work.
    readyFlag = false;
    limiter.drain();

    // 3) /ready now reports not-ready.
    assert.equal((await fetch(`${s.url}/ready`)).status, 503);
    // /health stays up (liveness).
    assert.equal((await fetch(`${s.url}/health`)).status, 200);

    // 4) A NEW API request during drain is shed (admission → 503 on ShuttingDown).
    const shed = await fetch(`${s.url}/api/anthropic`, { method: 'POST', headers, body: JSON.stringify(validBody) });
    assert.equal(shed.status, 503);
    assert.equal(entered, 1); // the shed request never reached the upstream

    // 5) The in-flight request completes once released.
    release();
    const done = await inflight;
    assert.equal(done.status, 200);
  } finally {
    release();
    await s.close();
  }
});
