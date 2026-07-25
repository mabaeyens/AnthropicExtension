'use strict';

// P05 — transport & CORS hardening. Deterministic unit tests of the CORS allowlist
// matcher, the security-header middleware, and the per-IP rate limiter. No network.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { corsOptions, parseOrigins } = require('../lib/cors');
const { securityHeaders } = require('../lib/security-headers');
const { createRateLimiter } = require('../lib/rate-limit');

// ── CORS allowlist ──────────────────────────────────────────────────────────
test('parseOrigins splits QLIK_ORIGINS and falls back to QLIK_ORIGIN', () => {
  const a = parseOrigins({ QLIK_ORIGINS: 'https://a.example, https://b.example' });
  assert.ok(a.has('https://a.example') && a.has('https://b.example'));
  const b = parseOrigins({ QLIK_ORIGIN: 'https://legacy.example' });
  assert.ok(b.has('https://legacy.example'));
});

test('a listed origin is allowed, an unlisted one is denied (no throw)', () => {
  const { origin } = corsOptions({ QLIK_ORIGINS: 'https://good.example' });
  origin('https://good.example', (err, ok) => { assert.equal(err, null); assert.equal(ok, true); });
  origin('https://evil.example', (err, ok) => { assert.equal(err, null); assert.equal(ok, false); });
});

test('a request with no Origin (curl/health) is allowed', () => {
  const { origin } = corsOptions({ QLIK_ORIGINS: 'https://good.example' });
  origin(undefined, (err, ok) => { assert.equal(err, null); assert.equal(ok, true); });
});

test('CORS exposes only the minimal methods/headers', () => {
  const opts = corsOptions({ QLIK_ORIGINS: 'https://good.example' });
  assert.deepEqual(opts.methods, ['POST', 'OPTIONS']);
  assert.ok(opts.allowedHeaders.includes('x-qlik-session'));
  assert.ok(!opts.allowedHeaders.includes('x-api-key')); // key path removed (P01/E01)
});

// ── security headers ──────────────────────────────────────────────────────────
function fakeRes() {
  return {
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    removeHeader(k) { delete this.headers[k]; },
  };
}

test('security headers are set on the response', () => {
  const res = fakeRes();
  let nexted = false;
  securityHeaders()({}, res, () => { nexted = true; });
  assert.equal(nexted, true);
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer');
  assert.equal(res.headers['X-Frame-Options'], 'DENY');
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.ok(res.headers['Strict-Transport-Security'].includes('max-age='));
});

test('HSTS can be disabled for a dev HTTP run', () => {
  const res = fakeRes();
  securityHeaders({ hsts: false })({}, res, () => {});
  assert.equal(res.headers['Strict-Transport-Security'], undefined);
});

// ── rate limiter ──────────────────────────────────────────────────────────────
function fakeReqRes(ip) {
  const req = { ip };
  const res = {
    statusCode: null, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  return { req, res };
}

test('under the limit calls next(); over the limit → 429 + Retry-After', () => {
  let t = 1000;
  const mw = createRateLimiter({ windowMs: 60000, max: 2, now: () => t });
  const hits = [];
  for (let i = 0; i < 3; i += 1) {
    const { req, res } = fakeReqRes('1.2.3.4');
    mw(req, res, () => hits.push('next'));
    if (res.statusCode) hits.push(res.statusCode);
  }
  assert.deepEqual(hits, ['next', 'next', 429]);
});

test('the window resets after windowMs and Retry-After counts down', () => {
  let t = 0;
  const mw = createRateLimiter({ windowMs: 1000, max: 1, now: () => t });
  const first = fakeReqRes('9.9.9.9');
  mw(first.req, first.res, () => {});             // count 1, allowed
  t = 400;
  const blocked = fakeReqRes('9.9.9.9');
  let nexted = false;
  mw(blocked.req, blocked.res, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.equal(blocked.res.statusCode, 429);
  assert.equal(blocked.res.headers['Retry-After'], '1'); // ceil((1000-400)/1000)
  t = 1000;                                        // window rolled over
  const after = fakeReqRes('9.9.9.9');
  let nexted2 = false;
  mw(after.req, after.res, () => { nexted2 = true; });
  assert.equal(nexted2, true);
});

test('different IPs have independent windows', () => {
  let t = 0;
  const mw = createRateLimiter({ windowMs: 1000, max: 1, now: () => t });
  const a = fakeReqRes('1.1.1.1'); const b = fakeReqRes('2.2.2.2');
  let aNext = false; let bNext = false;
  mw(a.req, a.res, () => { aNext = true; });
  mw(b.req, b.res, () => { bNext = true; });
  assert.ok(aNext && bNext);                       // neither blocks the other
});

test('prune drops expired windows', () => {
  let t = 0;
  const mw = createRateLimiter({ windowMs: 1000, max: 5, now: () => t });
  mw.take('k1'); mw.take('k2');
  assert.equal(mw.size(), 2);
  t = 2000;
  mw.prune();
  assert.equal(mw.size(), 0);
});
