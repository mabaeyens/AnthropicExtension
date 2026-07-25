'use strict';

// Shared test scaffolding (P07): build the REAL app via createApp with the network edge
// (upstream + Qlik validator) stubbed, and start it on an ephemeral PLAIN-HTTP port so
// tests can fetch() it without certs. No dependency on supertest or any network service.

const http = require('http');
const { Readable } = require('stream');

const { createApp } = require('../app');
const { createLimiter } = require('../lib/limiter');
const { modelAllowlist } = require('../lib/model-allowlist');
const { corsOptions } = require('../lib/cors');
const { AuthError } = require('../lib/auth-qlik');

const noopLogger = { info() {}, warn() {}, error() {}, child() { return noopLogger; } };
const noopAudit = { record() {} };
const noopMetrics = { incRequest() {}, incRetry() {}, observeStatus() {}, snapshot() { return {}; } };

// Default Qlik validator stub: null/'bad' → AuthError(401); anything else → a user id.
async function defaultValidate(session) {
  if (!session || session === 'bad') throw new AuthError('invalid session');
  return `DIR\\${session}`;
}

// Default upstream stub: echoes a canned non-stream JSON body and captures the headers
// it was called with (so a test can assert the server key is present / client key absent).
function makeUpstreamStub(overrides = {}) {
  const calls = [];
  const fn = async (opts) => {
    calls.push(opts);
    if (overrides.impl) return overrides.impl(opts);
    if (opts.stream) {
      const data = Readable.from(['data: {"delta":"hi"}\n\n']);
      return { data };
    }
    return { data: { ok: true, echoedModel: opts.data && opts.data.model } };
  };
  fn.calls = calls;
  return fn;
}

function buildApp(overrides = {}) {
  const callUpstream = overrides.callUpstream || makeUpstreamStub(overrides.upstream);
  const app = createApp({
    anthropicKey: 'sk-server-secret',
    providers: {
      anthropic: { name: 'anthropic', url: 'https://upstream/anthropic', anthropicVersion: '2023-06-01', requiresKey: true, timeoutMs: 60000 },
      ollama: { name: 'ollama', url: 'http://upstream/ollama', requiresKey: false, timeoutMs: 300000 },
    },
    validate: overrides.validate || defaultValidate,
    limiter: overrides.limiter || createLimiter({ maxGlobal: 24, maxUser: 3, maxQueue: 100 }),
    logger: noopLogger,
    audit: overrides.audit || noopAudit,
    metrics: noopMetrics,
    allowlist: modelAllowlist({}),
    maxTokensCap: 8192,
    corsOptions: corsOptions({ QLIK_ORIGINS: 'https://qlik.example' }),
    rateLimiter: overrides.rateLimiter, // omitted → no IP limiting in tests unless asked
    isReady: overrides.isReady || (() => true),
    bodyLimit: overrides.bodyLimit || '1mb',
    callUpstream,
  });
  return { app, callUpstream };
}

// Start on an ephemeral port; returns { url, close }.
function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

const validBody = { model: 'claude-haiku-4-5', messages: [{ role: 'user', content: 'hi' }] };

module.exports = {
  buildApp, listen, makeUpstreamStub, defaultValidate, validBody,
  noopLogger, noopAudit, noopMetrics,
};
