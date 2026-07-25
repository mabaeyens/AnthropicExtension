'use strict';

// P07 — integration tests over the REAL /api surface with a stubbed upstream + Qlik
// validator (helpers.js). Exercises the whole middleware chain end-to-end via fetch()
// against an ephemeral plain-HTTP server. No network to real services. Each prior spec
// contract (P01–P06) is asserted by at least one case here.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildApp, listen, makeUpstreamStub, validBody } = require('./helpers');
const { createLimiter } = require('../lib/limiter');

const ORIGIN = 'https://qlik.example';
const good = (extra = {}) => ({ 'content-type': 'application/json', 'x-qlik-session': 'alice', ...extra });

// ── P02: authentication ─────────────────────────────────────────────────────
test('401 when no Qlik session is presented', async () => {
  const { app } = buildApp();
  const s = await listen(app);
  try {
    const r = await fetch(`${s.url}/api/anthropic`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(validBody) });
    assert.equal(r.status, 401);
  } finally { await s.close(); }
});

test('401 when the Qlik session is invalid', async () => {
  const { app } = buildApp();
  const s = await listen(app);
  try {
    const r = await fetch(`${s.url}/api/anthropic`, { method: 'POST', headers: good({ 'x-qlik-session': 'bad' }), body: JSON.stringify(validBody) });
    assert.equal(r.status, 401);
  } finally { await s.close(); }
});

// ── P01: credential custody ─────────────────────────────────────────────────
test('a valid request reaches the upstream with the SERVER key; the client x-api-key is ignored', async () => {
  const upstream = makeUpstreamStub();
  const { app } = buildApp({ callUpstream: upstream });
  const s = await listen(app);
  try {
    const r = await fetch(`${s.url}/api/anthropic`, {
      method: 'POST', headers: good({ 'x-api-key': 'sk-CLIENT-attempt' }), body: JSON.stringify(validBody),
    });
    assert.equal(r.status, 200);
    assert.equal(upstream.calls.length, 1);
    const sent = upstream.calls[0].headers;
    assert.equal(sent['x-api-key'], 'sk-server-secret');       // server key injected
    assert.notEqual(sent['x-api-key'], 'sk-CLIENT-attempt');   // client value never used
  } finally { await s.close(); }
});

// ── P04: validation & limits ────────────────────────────────────────────────
test('403 when the model is not on the allowlist', async () => {
  const { app } = buildApp();
  const s = await listen(app);
  try {
    const r = await fetch(`${s.url}/api/anthropic`, { method: 'POST', headers: good(), body: JSON.stringify({ ...validBody, model: 'gpt-4' }) });
    assert.equal(r.status, 403);
  } finally { await s.close(); }
});

test('400 on a malformed body (empty messages, unknown key)', async () => {
  const { app } = buildApp();
  const s = await listen(app);
  try {
    const r = await fetch(`${s.url}/api/anthropic`, { method: 'POST', headers: good(), body: JSON.stringify({ model: 'claude-haiku-4-5', messages: [], evil: 1 }) });
    assert.equal(r.status, 400);
    const body = await r.json();
    assert.equal(JSON.stringify(body).includes('evil'), false); // body not echoed
  } finally { await s.close(); }
});

test('413 when the body exceeds the size cap', async () => {
  const { app } = buildApp({ bodyLimit: '1kb' });
  const s = await listen(app);
  try {
    const big = { ...validBody, messages: [{ role: 'user', content: 'x'.repeat(5000) }] };
    const r = await fetch(`${s.url}/api/anthropic`, { method: 'POST', headers: good(), body: JSON.stringify(big) });
    assert.equal(r.status, 413);
  } finally { await s.close(); }
});

test('an invalid request never reaches the upstream', async () => {
  const upstream = makeUpstreamStub();
  const { app } = buildApp({ callUpstream: upstream });
  const s = await listen(app);
  try {
    await fetch(`${s.url}/api/anthropic`, { method: 'POST', headers: good(), body: JSON.stringify({ ...validBody, model: 'gpt-4' }) });
    assert.equal(upstream.calls.length, 0);
  } finally { await s.close(); }
});

// ── P03: concurrency — queue overflow ────────────────────────────────────────
test('503 + Retry-After when the concurrency queue is full', async () => {
  // Gate the upstream so the first request occupies the only slot indefinitely.
  let release;
  const gate = new Promise((r) => { release = r; });
  const upstream = makeUpstreamStub({ impl: async () => { await gate; return { data: { ok: true } }; } });
  const limiter = createLimiter({ maxGlobal: 1, maxUser: 9, maxQueue: 0 });
  const { app } = buildApp({ callUpstream: upstream, limiter });
  const s = await listen(app);
  try {
    const first = fetch(`${s.url}/api/anthropic`, { method: 'POST', headers: good(), body: JSON.stringify(validBody) });
    // Wait until the first request has actually acquired the slot + hit the upstream.
    for (let i = 0; i < 50 && upstream.calls.length === 0; i += 1) await new Promise((r) => setTimeout(r, 5));
    const second = await fetch(`${s.url}/api/anthropic`, { method: 'POST', headers: good({ 'x-qlik-session': 'bob' }), body: JSON.stringify(validBody) });
    assert.equal(second.status, 503);
    assert.ok(second.headers.get('retry-after'));
    release();
    await first;
  } finally { await s.close(); }
});

// ── P05: transport — security headers + CORS ────────────────────────────────
test('security headers are present on API responses', async () => {
  const { app } = buildApp();
  const s = await listen(app);
  try {
    const r = await fetch(`${s.url}/api/anthropic`, { method: 'POST', headers: good(), body: JSON.stringify(validBody) });
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('x-powered-by'), null); // framework fingerprint removed
  } finally { await s.close(); }
});

test('CORS denies an unlisted origin (no ACAO header)', async () => {
  const { app } = buildApp();
  const s = await listen(app);
  try {
    const r = await fetch(`${s.url}/api/anthropic`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  } finally { await s.close(); }
});

test('CORS allows the listed origin', async () => {
  const { app } = buildApp();
  const s = await listen(app);
  try {
    const r = await fetch(`${s.url}/api/anthropic`, {
      method: 'OPTIONS',
      headers: { origin: ORIGIN, 'access-control-request-method': 'POST' },
    });
    assert.equal(r.headers.get('access-control-allow-origin'), ORIGIN);
  } finally { await s.close(); }
});

// ── P06: health vs readiness ────────────────────────────────────────────────
test('/health is always 200; /ready reflects readiness', async () => {
  let isReadyFlag = true;
  const { app } = buildApp({ isReady: () => isReadyFlag });
  const s = await listen(app);
  try {
    assert.equal((await fetch(`${s.url}/health`)).status, 200);
    assert.equal((await fetch(`${s.url}/ready`)).status, 200);
    isReadyFlag = false;
    assert.equal((await fetch(`${s.url}/ready`)).status, 503);
  } finally { await s.close(); }
});

// ── streaming happy path ────────────────────────────────────────────────────
test('a streaming request is piped through as text/event-stream', async () => {
  const { app } = buildApp();
  const s = await listen(app);
  try {
    const r = await fetch(`${s.url}/api/anthropic`, { method: 'POST', headers: good(), body: JSON.stringify({ ...validBody, stream: true }) });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') || '', /text\/event-stream/);
    const text = await r.text();
    assert.match(text, /delta/);
  } finally { await s.close(); }
});

// ── client disconnect cancels the buffered upstream (Stop button) ────────────
// When the browser aborts the fetch (the Stop button), the proxy must cancel the
// in-flight upstream call so the model stops generating instead of finishing an
// unread response. We hang the upstream, abort the client, and assert the signal
// the proxy passed to callUpstream becomes aborted.
test('aborting the client cancels the in-flight buffered upstream call', async () => {
  let releaseHang;
  const hang = new Promise((r) => { releaseHang = r; });
  let capturedSignal = null;
  const upstream = makeUpstreamStub({ impl: async (opts) => {
    capturedSignal = opts.signal;
    await hang;                       // stay in-flight until the test lets go
    return { data: { ok: true } };
  } });
  const { app } = buildApp({ callUpstream: upstream });
  const s = await listen(app);
  const waitFor = async (cond) => {
    for (let i = 0; i < 200; i += 1) {
      if (cond()) return;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('condition not met in time');
  };
  try {
    // Use a raw http client (not fetch) so we can destroy the socket deterministically —
    // the browser's Stop aborts the connection, which is exactly `clientReq.destroy()`.
    const http = require('http');
    const u = new URL(`${s.url}/api/anthropic`);
    const clientReq = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: good(),
    });
    clientReq.on('error', () => {});                 // swallow the abort ECONNRESET
    clientReq.end(JSON.stringify(validBody));         // send the full body so the handler runs
    await waitFor(() => capturedSignal !== null);     // upstream call is in-flight
    assert.equal(capturedSignal.aborted, false);
    clientReq.destroy();                              // simulate the Stop button (disconnect)
    await waitFor(() => capturedSignal.aborted);      // proxy propagated the disconnect
    assert.equal(capturedSignal.aborted, true);
  } finally {
    releaseHang();
    await s.close();
  }
});
