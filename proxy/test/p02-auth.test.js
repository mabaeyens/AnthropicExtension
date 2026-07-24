'use strict';

// P02 — caller authentication. Unit-level proof with a stubbed Qlik validator; the
// full HTTP-surface integration lives in P07.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  createValidator, extractUser, AuthError, UpstreamError,
} = require('../lib/auth-qlik');
const { authenticate, extractSessionRef } = require('../middleware/authenticate');

// A controllable fake QPS fetcher: returns a scripted { status, body } and counts calls.
function fakeFetch(script) {
  const calls = [];
  const fn = async (ref) => { calls.push(ref); return typeof script === 'function' ? script(ref) : script; };
  fn.calls = calls;
  return fn;
}

// ── extractUser ─────────────────────────────────────────────────────────────
test('extractUser resolves UserDirectory\\UserId, null when incomplete', () => {
  assert.equal(extractUser({ UserDirectory: 'DIR', UserId: 'alice' }), 'DIR\\alice');
  assert.equal(extractUser({ userDirectory: 'd', userId: 'u' }), 'd\\u');
  assert.equal(extractUser({ UserId: 'alice' }), null);
  assert.equal(extractUser(null), null);
});

// ── validator: identity resolution & status mapping ─────────────────────────
test('valid session (200 + user) resolves the user id', async () => {
  const validate = createValidator({}, {
    fetchSession: fakeFetch({ status: 200, body: { UserDirectory: 'DIR', UserId: 'alice' } }),
  });
  assert.equal(await validate('sess-1'), 'DIR\\alice');
});

test('absent session ref → AuthError (never calls Qlik)', async () => {
  const fetch = fakeFetch({ status: 200, body: {} });
  const validate = createValidator({}, { fetchSession: fetch });
  await assert.rejects(validate(null), AuthError);
  await assert.rejects(validate(''), AuthError);
  assert.equal(fetch.calls.length, 0);
});

test('invalid session (401/403/404) → AuthError', async () => {
  for (const status of [401, 403, 404]) {
    const validate = createValidator({}, { fetchSession: fakeFetch({ status, body: null }) });
    await assert.rejects(validate('x'), AuthError);
  }
});

test('200 but no user in body → AuthError', async () => {
  const validate = createValidator({}, { fetchSession: fakeFetch({ status: 200, body: { foo: 1 } }) });
  await assert.rejects(validate('x'), AuthError);
});

test('Qlik API unreachable (fetch throws) → UpstreamError, not AuthError', async () => {
  const validate = createValidator({}, {
    fetchSession: async () => { throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' }); },
  });
  await assert.rejects(validate('x'), UpstreamError);
});

test('Qlik 500 → UpstreamError (dependency fault, not 401)', async () => {
  const validate = createValidator({}, { fetchSession: fakeFetch({ status: 500, body: null }) });
  await assert.rejects(validate('x'), UpstreamError);
});

// ── cache: positive TTL, no negative caching ────────────────────────────────
test('positive result is cached within TTL (one Qlik call)', async () => {
  const fetch = fakeFetch({ status: 200, body: { UserDirectory: 'D', UserId: 'u' } });
  const validate = createValidator({ cacheTtlMs: 1000 }, { fetchSession: fetch, now: () => 1000 });
  assert.equal(await validate('s'), 'D\\u');
  assert.equal(await validate('s'), 'D\\u');
  assert.equal(fetch.calls.length, 1); // second served from cache
});

test('cache entry expires after TTL', async () => {
  let t = 1000;
  const fetch = fakeFetch({ status: 200, body: { UserDirectory: 'D', UserId: 'u' } });
  const validate = createValidator({ cacheTtlMs: 100 }, { fetchSession: fetch, now: () => t });
  await validate('s');
  t = 1201; // past TTL
  await validate('s');
  assert.equal(fetch.calls.length, 2); // re-validated after expiry
});

test('negatives are NOT cached (revoked session not accepted for the TTL window)', async () => {
  const fetch = fakeFetch({ status: 401, body: null });
  const validate = createValidator({ cacheTtlMs: 10000 }, { fetchSession: fetch, now: () => 0 });
  await assert.rejects(validate('s'), AuthError);
  await assert.rejects(validate('s'), AuthError);
  assert.equal(fetch.calls.length, 2); // each invalid attempt re-hits Qlik
});

test('cache is size-capped (oldest evicted)', async () => {
  const fetch = fakeFetch((ref) => ({ status: 200, body: { UserDirectory: 'D', UserId: ref } }));
  const validate = createValidator({ cacheMax: 2, cacheTtlMs: 100000 }, { fetchSession: fetch, now: () => 1 });
  await validate('a'); await validate('b'); await validate('c'); // evicts 'a'
  assert.equal(validate.cache.size, 2);
});

// ── boot posture: real fetcher requires config ──────────────────────────────
test('createValidator (no injected fetcher) fails fast when config missing', () => {
  assert.throws(() => createValidator({ sessionUrl: 'https://x' }), /Qlik auth config missing: cert/);
  assert.throws(() => createValidator({}), /Qlik auth config missing: sessionUrl/);
});

// ── middleware: status mapping & req.qlikUser ───────────────────────────────
function fakeRes() {
  return {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

test('middleware sets req.qlikUser and calls next on success', async () => {
  const mw = authenticate(async () => 'DIR\\alice');
  const req = { headers: { 'x-qlik-session': 's' } };
  const res = fakeRes();
  let nexted = false;
  await mw(req, res, () => { nexted = true; });
  assert.equal(nexted, true);
  assert.equal(req.qlikUser, 'DIR\\alice');
});

test('middleware → 401 on AuthError, 503 on UpstreamError', async () => {
  const res401 = fakeRes();
  await authenticate(async () => { throw new AuthError('x'); })({ headers: {} }, res401, () => {});
  assert.equal(res401.statusCode, 401);

  const res503 = fakeRes();
  await authenticate(async () => { throw new UpstreamError('x'); })({ headers: {} }, res503, () => {});
  assert.equal(res503.statusCode, 503);
});

test('extractSessionRef reads the x-qlik-session header', () => {
  assert.equal(extractSessionRef({ headers: { 'x-qlik-session': 'abc' } }), 'abc');
  assert.equal(extractSessionRef({ headers: {} }), null);
});
