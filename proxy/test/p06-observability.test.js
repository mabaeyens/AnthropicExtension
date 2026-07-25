'use strict';

// P06 — observability. Deterministic unit tests of the structured logger + redaction,
// rotating sink, request-id, boot config validation, audit stream, and health/ready/
// metrics handlers. No network, no real filesystem (fs injected), no real clock.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createLogger, createRotatingSink, redact } = require('../lib/logger');
const { createAudit } = require('../lib/audit');
const { createMetrics } = require('../lib/metrics');
const { requestId } = require('../middleware/request-id');
const config = require('../lib/config');
const { healthHandler, readyHandler, metricsHandler } = require('../routes/health');

// ── logger + redaction ────────────────────────────────────────────────────────
test('logger emits one JSON line per call with ts + level + fields', () => {
  const lines = [];
  const log = createLogger({ sink: (l) => lines.push(l), now: () => 'T0' });
  log.info({ event: 'hello', status: 200 });
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.ts, 'T0');
  assert.equal(rec.level, 'info');
  assert.equal(rec.event, 'hello');
  assert.equal(rec.status, 200);
});

test('redaction masks secrets/bodies anywhere in the object', () => {
  const out = redact({ 'x-api-key': 'sk-123', nested: { messages: [{ content: 'secret' }] }, ok: 1 });
  assert.equal(out['x-api-key'], '[redacted]');
  assert.equal(out.nested.messages, '[redacted]');
  assert.equal(out.ok, 1);
});

test('logger.child merges base fields', () => {
  const lines = [];
  const log = createLogger({ sink: (l) => lines.push(l), now: () => 'T' }).child({ svc: 'proxy' });
  log.warn({ a: 1 });
  assert.equal(JSON.parse(lines[0]).svc, 'proxy');
});

// ── rotating sink (fake fs) ─────────────────────────────────────────────────
test('rotating sink rotates when the file would exceed maxBytes', () => {
  const files = {}; // path → contents
  const fsImpl = {
    constants: {},
    mkdirSync() {},
    statSync(p) { if (files[p] === undefined) throw new Error('ENOENT'); return { size: Buffer.byteLength(files[p]) }; },
    existsSync(p) { return files[p] !== undefined; },
    renameSync(a, b) { files[b] = files[a]; delete files[a]; },
    rmSync(p) { delete files[p]; },
    appendFileSync(p, s) { files[p] = (files[p] || '') + s; },
  };
  const sink = createRotatingSink({ filePath: '/logs/app.log', maxBytes: 20, maxFiles: 3, fsImpl });
  sink('aaaaaaaaaa'); // 11 bytes with newline
  assert.ok(files['/logs/app.log']);
  sink('bbbbbbbbbb'); // would exceed 20 → rotate first
  assert.ok(files['/logs/app.log.1']);            // previous content rotated out
  assert.equal(files['/logs/app.log'], 'bbbbbbbbbb\n');
});

// ── request id ────────────────────────────────────────────────────────────────
test('request id honours a safe inbound header, else generates', () => {
  const mw = requestId(() => 'GENERATED');
  const set = {};
  const res = { setHeader: (k, v) => { set[k] = v; } };
  const req1 = { headers: { 'x-request-id': 'abc-123' } };
  mw(req1, res, () => {});
  assert.equal(req1.requestId, 'abc-123');
  const req2 = { headers: { 'x-request-id': 'bad id with spaces!' } };
  mw(req2, res, () => {});
  assert.equal(req2.requestId, 'GENERATED');       // rejected → generated
  assert.equal(set['X-Request-Id'], 'GENERATED');
});

// ── config validation ───────────────────────────────────────────────────────
const goodEnv = {
  ANTHROPIC_API_KEY: 'sk-x',
  QLIK_SESSION_URL: 'https://q/qps/session',
  QLIK_CERT: '/c/cert.pem', QLIK_KEY: '/c/key.pem',
  QLIK_ORIGINS: 'https://qlik',
};
const okFs = { constants: { R_OK: 4 }, accessSync() {} };

test('config.load passes with all required vars and returns a redacted summary', () => {
  const { summary } = config.load(goodEnv, { fsImpl: okFs });
  assert.equal(summary.anthropicKey, '[set]');
  assert.deepEqual(summary.corsOrigins, ['https://qlik']);
});

test('config.load aggregates every missing var into one message', () => {
  assert.throws(() => config.load({}, { fsImpl: okFs }), (e) => {
    assert.match(e.message, /ANTHROPIC_API_KEY/);
    assert.match(e.message, /QLIK_SESSION_URL/);
    assert.match(e.message, /QLIK_ORIGINS/);
    return true;
  });
});

test('config.load rejects a non-positive-integer numeric var', () => {
  assert.throws(() => config.load({ ...goodEnv, MAX_QUEUE: 'lots' }, { fsImpl: okFs }), /MAX_QUEUE/);
});

test('config.load rejects an unreadable cert path', () => {
  const badFs = { constants: { R_OK: 4 }, accessSync(p) { if (p === '/c/cert.pem') throw new Error('no'); } };
  assert.throws(() => config.load(goodEnv, { fsImpl: badFs }), /QLIK_CERT path is not readable/);
});

// ── audit ─────────────────────────────────────────────────────────────────────
test('audit records user/route/model/status and never a body', () => {
  const lines = [];
  const audit = createAudit({ sink: (l) => lines.push(l), now: () => 'T' });
  audit.record({ user: 'DIR\\u', route: '/api/anthropic', model: 'claude-haiku-4-5', status: 200, requestId: 'r1' });
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.kind, 'audit');
  assert.equal(rec.user, 'DIR\\u');
  assert.equal(rec.model, 'claude-haiku-4-5');
  assert.equal(rec.status, 200);
  assert.equal('content' in rec, false);
});

// ── health / ready / metrics ────────────────────────────────────────────────
function fakeRes() {
  return { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

test('health is 200 up; ready reflects the flag', () => {
  const h = fakeRes(); healthHandler({}, h);
  assert.equal(h.statusCode, 200);
  const up = fakeRes(); readyHandler(() => true)({}, up);
  assert.equal(up.statusCode, 200);
  const down = fakeRes(); readyHandler(() => false)({}, down);
  assert.equal(down.statusCode, 503);
});

test('metrics surfaces limiter gauges and counters', () => {
  const metrics = createMetrics();
  metrics.incRequest(); metrics.observeStatus(200); metrics.observeStatus(503);
  const limiter = { stats: () => ({ globalInflight: 2, queueDepth: 1 }) };
  const res = fakeRes();
  metricsHandler(limiter, metrics)({}, res);
  assert.equal(res.body.gauges.globalInflight, 2);
  assert.equal(res.body.counters.responses2xx, 1);
  assert.equal(res.body.counters.responses5xx, 1);
});
