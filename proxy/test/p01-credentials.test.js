'use strict';

// P01 — credential custody. Unit-level proof of the contract, no network/TLS.
// (The full HTTP-surface integration lives in P07.)

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const { loadAnthropicKey, buildUpstreamHeaders } = require('../lib/credentials');
const { providers } = require('../lib/providers');
const { callUpstream, isRetryable } = require('../lib/upstream');

const P = providers({});

// ── Requirement 1 & 2: key from env, validated at boot ──────────────────────
test('loadAnthropicKey throws when the key is absent/blank', () => {
  assert.throws(() => loadAnthropicKey({}), /ANTHROPIC_API_KEY is not set/);
  assert.throws(() => loadAnthropicKey({ ANTHROPIC_API_KEY: '   ' }), /ANTHROPIC_API_KEY/);
});

test('loadAnthropicKey returns the trimmed key when set', () => {
  assert.equal(loadAnthropicKey({ ANTHROPIC_API_KEY: '  sk-abc  ' }), 'sk-abc');
});

// ── Requirement 3 & 4: server key injected, client headers never forwarded ──
test('buildUpstreamHeaders injects the server key for anthropic and NEVER reads inbound', () => {
  const headers = buildUpstreamHeaders(P.anthropic, 'sk-server');
  assert.equal(headers['x-api-key'], 'sk-server');
  assert.equal(headers['anthropic-version'], '2023-06-01');
  // Built fresh from (provider, key) only — there is no inbound-header parameter, so a
  // client-supplied x-api-key/authorization is structurally unable to reach upstream.
  assert.equal(buildUpstreamHeaders.length, 2);
});

test('buildUpstreamHeaders adds NO key for the local (ollama) provider', () => {
  const headers = buildUpstreamHeaders(P.ollama, 'sk-server');
  assert.equal(headers['x-api-key'], undefined);
  assert.equal(headers['authorization'], undefined);
});

// ── Requirement 6: retry transient failures (non-stream), never for streams ─
function mockAxios(script) {
  // script: array of () => (throw | return). One entry consumed per attempt.
  let i = 0;
  const calls = [];
  const fn = async (cfg) => {
    calls.push(cfg);
    const step = script[Math.min(i, script.length - 1)];
    i += 1;
    return step();
  };
  fn.calls = calls;
  return fn;
}

const noSleep = () => Promise.resolve();

test('callUpstream retries a transient 503 then succeeds (non-streaming)', async () => {
  const err503 = Object.assign(new Error('boom'), { response: { status: 503 } });
  const axios = mockAxios([
    () => { throw err503; },
    () => { throw err503; },
    () => ({ data: { ok: true } }),
  ]);
  const res = await callUpstream(
    { url: 'x', headers: {}, data: {}, stream: false, maxRetries: 2 },
    { axios, sleep: noSleep, rand: () => 0 },
  );
  assert.deepEqual(res.data, { ok: true });
  assert.equal(axios.calls.length, 3); // 1 try + 2 retries
});

test('callUpstream gives up after maxRetries and throws the last error', async () => {
  const err500 = Object.assign(new Error('down'), { response: { status: 503 } });
  const axios = mockAxios([() => { throw err500; }]);
  await assert.rejects(
    callUpstream({ url: 'x', headers: {}, data: {}, stream: false, maxRetries: 2 },
      { axios, sleep: noSleep, rand: () => 0 }),
    /down/,
  );
  assert.equal(axios.calls.length, 3); // 1 + 2 retries, then throw
});

test('callUpstream NEVER retries a streaming request', async () => {
  const err503 = Object.assign(new Error('stream-boom'), { response: { status: 503 } });
  const axios = mockAxios([() => { throw err503; }]);
  await assert.rejects(
    callUpstream({ url: 'x', headers: {}, data: {}, stream: true, maxRetries: 5 },
      { axios, sleep: noSleep, rand: () => 0 }),
    /stream-boom/,
  );
  assert.equal(axios.calls.length, 1); // single attempt, no retry
});

test('callUpstream does not retry a non-transient 400', async () => {
  const err400 = Object.assign(new Error('bad'), { response: { status: 400 } });
  const axios = mockAxios([() => { throw err400; }]);
  await assert.rejects(
    callUpstream({ url: 'x', headers: {}, data: {}, stream: false, maxRetries: 3 },
      { axios, sleep: noSleep, rand: () => 0 }),
    /bad/,
  );
  assert.equal(axios.calls.length, 1);
});

test('isRetryable classifies statuses and codes', () => {
  assert.equal(isRetryable({ response: { status: 503 } }), true);
  assert.equal(isRetryable({ response: { status: 429 } }), true);
  assert.equal(isRetryable({ response: { status: 400 } }), false);
  assert.equal(isRetryable({ code: 'ECONNRESET' }), true);
  assert.equal(isRetryable({ code: 'NOPE' }), false);
  assert.equal(isRetryable(null), false);
});

// ── Requirement 2 (boot): the process fails fast when the key is missing ─────
test('server.js exits non-zero with a clear message when ANTHROPIC_API_KEY is unset', () => {
  const serverPath = path.join(__dirname, '..', 'server.js');
  let threw = false;
  try {
    execFileSync(process.execPath, [serverPath], {
      env: { ...process.env, ANTHROPIC_API_KEY: '' },
      stdio: 'pipe',
      timeout: 8000,
    });
  } catch (e) {
    threw = true;
    assert.notEqual(e.status, 0);
    const out = String(e.stderr || '') + String(e.stdout || '');
    // Boot config validation (P06) now fires first and aggregates the required-var
    // checks; it still names ANTHROPIC_API_KEY, so the fail-fast contract holds.
    assert.match(out, /ANTHROPIC_API_KEY/);
  }
  assert.ok(threw, 'expected the process to exit non-zero');
});
