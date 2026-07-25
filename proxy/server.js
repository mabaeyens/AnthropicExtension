require('dotenv').config();

const express = require('express');
const cors = require('cors');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const { providers } = require('./lib/providers');
const { loadAnthropicKey, buildUpstreamHeaders } = require('./lib/credentials');
const { callUpstream } = require('./lib/upstream');
const { createValidator } = require('./lib/auth-qlik');
const { authenticate } = require('./middleware/authenticate');
const { createLimiter } = require('./lib/limiter');
const { admission } = require('./middleware/admission');
const { modelAllowlist } = require('./lib/model-allowlist');
const { validateBody } = require('./middleware/validate');
const { corsOptions } = require('./lib/cors');
const { securityHeaders } = require('./lib/security-headers');
const { createRateLimiter } = require('./lib/rate-limit');
const { installGracefulShutdown } = require('./lib/shutdown');
const config = require('./lib/config');
const { createLogger, createRotatingSink } = require('./lib/logger');
const { createAudit } = require('./lib/audit');
const { createMetrics } = require('./lib/metrics');
const { requestId } = require('./middleware/request-id');
const { requestLog } = require('./middleware/request-log');
const { createHealthRouter } = require('./routes/health');

function readFileMaybe(p) { return p ? fs.readFileSync(p) : undefined; }

// A sink that writes JSON lines to a rotating file when LOG_DIR is set, else stdout.
function makeSink(fileName) {
  if (!process.env.LOG_DIR) return undefined; // logger default → stdout
  return createRotatingSink({
    filePath: `${process.env.LOG_DIR}/${fileName}`,
    maxBytes: Number(process.env.LOG_MAX_BYTES) || 10 * 1024 * 1024,
    maxFiles: Number(process.env.LOG_MAX_FILES) || 5,
  });
}

// ── Boot config validation (P06 §4.4) ───────────────────────────────────────
// Aggregate ALL required-env checks up front so a misconfigured deploy fails fast
// with a precise, complete message (which vars, what's wrong) — before any cert read
// or network setup, and before the per-loader checks below.
try {
  const { summary } = config.load(process.env);
  console.log('[boot] configuration validated', JSON.stringify(summary));
} catch (err) {
  console.error('[FATAL]', err.message);
  process.exit(1);
}

// ── Boot-time credential validation (P01 §2) ────────────────────────────────
// Validate config BEFORE touching the filesystem/network, so a missing key fails
// fast for the right reason (not a confusing cert-read error). The key lives only
// on the server, from here on (P01 §1).
let ANTHROPIC_API_KEY;
try {
  ANTHROPIC_API_KEY = loadAnthropicKey();
} catch (err) {
  console.error('[FATAL]', err.message);
  process.exit(1);
}

// Caller authentication validator (P02). Created here so ALL config is validated
// fail-fast before any cert read / network setup. Mounted on /api further down.
let validate;
try {
  validate = createValidator({
    sessionUrl: process.env.QLIK_SESSION_URL,
    cert: readFileMaybe(process.env.QLIK_CERT),
    key: readFileMaybe(process.env.QLIK_KEY),
    ca: readFileMaybe(process.env.QLIK_CA),
    cacheTtlMs: Number(process.env.QLIK_AUTH_CACHE_TTL_MS) || 60000,
  });
} catch (err) {
  console.error('[FATAL]', err.message);
  process.exit(1);
}

const PROVIDERS = providers();
const app = express();
const port = process.env.PORT || 3000;

// Input validation config (P04). The server-side allowlist is authoritative; the
// extension's client registry is advisory. maxTokensCap bounds a caller's max_tokens.
const ALLOWLIST = modelAllowlist();
const MAX_TOKENS_CAP = Number(process.env.MAX_TOKENS_CAP) || 8192;

// Observability (P06): structured app logger, a SEPARATE audit stream, and counters.
// Both logs rotate when LOG_DIR is configured, else go to stdout for a log shipper.
const logger = createLogger({ sink: makeSink('app.log') });
const audit = createAudit({ sink: makeSink('audit.log') });
const metrics = createMetrics();

// Concurrency admission control (P03 / X02). Limits are config-driven with the
// documented defaults.
const limiter = createLimiter({
  maxGlobal: Number(process.env.MAX_GLOBAL_INFLIGHT) || 24,
  maxUser: Number(process.env.MAX_USER_INFLIGHT) || 3,
  maxQueue: Number(process.env.MAX_QUEUE) || 100,
  queueTimeoutMs: Number(process.env.QUEUE_TIMEOUT_MS) || 10000,
});

// Readiness flag flipped by graceful shutdown; the P06 /ready endpoint reads it.
let ready = true;
const setReady = (v) => { ready = v; };
function isReady() { return ready; }

// TLS options (P05 §4.1): cert/key from config (production = CA-signed cert for the
// proxy hostname); the self-signed localhost pair remains the dev default. A modern
// TLS floor (default 1.2, prefer 1.3) is enforced on the handshake.
const options = {
  key: fs.readFileSync(process.env.TLS_KEY || './certs/localhost3000-key.pem'),
  cert: fs.readFileSync(process.env.TLS_CERT || './certs/localhost3000-cert.pem'),
  minVersion: process.env.TLS_MIN_VERSION || 'TLSv1.2',
};

// Don't advertise the framework (P05 §4.5).
app.disable('x-powered-by');

// Request id first (P06 §4.2) so even a rate-limited/denied request is traceable, then
// the per-request structured log (fires on completion). Security headers on every
// response — buffered and streamed (P05 §4.3).
app.use(requestId());
app.use(requestLog({ logger, metrics }));
app.use(securityHeaders());

// IP-based rate limiting as a coarse backstop BEFORE auth, so an unauthenticated flood
// is shed before any mutual-TLS work (P05 §4.4). Per-user limits (P03) remain primary.
app.use(createRateLimiter({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  max: Number(process.env.RATE_LIMIT_MAX) || 120,
}));

// CORS: strict exact-match origin allowlist (QLIK_ORIGINS, comma-separated) — an
// unlisted origin gets no CORS headers and its preflight is denied (P05 §4.2).
app.use(cors(corsOptions()));

// Parse JSON request bodies, capped at a per-request size limit (P04 §4.3). Sufficient
// for chart data + context but not open-ended; oversize bodies are rejected 413 below.
app.use(express.json({ limit: process.env.BODY_LIMIT || '1mb' }));

// Body-parser error handler (P04 §4.6): map size/parse failures to 413/400 with a
// generic message + request id — never an echo of the offending body.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const requestId = req.requestId || crypto.randomUUID();
  if (err.type === 'entity.too.large') {
    logger.warn({ event: 'body_too_large', requestId, limit: err.limit });
    return res.status(413).json({ error: 'Request body too large', requestId });
  }
  if (err.type === 'entity.parse.failed') {
    logger.warn({ event: 'body_parse_failed', requestId });
    return res.status(400).json({ error: 'Malformed JSON body', requestId });
  }
  logger.error({ event: 'unhandled_error', requestId, message: err.message });
  return res.status(500).json({ error: 'Internal error', requestId });
});

// Health / readiness / metrics (P06 §4.3, §4.6) — open, no auth, no upstream.
// /health = liveness (service-manager restart), /ready = accepting requests (flips
// during drain), /metrics = P03 gauges + P06 counters.
app.use(createHealthRouter({ isReady, limiter, metrics }));

// Validate the Qlik session for every /api/* request before any credential
// injection or upstream call (P02). The validator was created + config-checked at boot.
app.use('/api', authenticate(validate));

// Shared handler for both upstreams. The credential is injected server-side per
// request; the client's body is forwarded, but NONE of its auth headers are — the
// outbound headers are built fresh (P01 §3, §4). Errors return a generic body plus a
// request id; the detail is logged server-side only, never echoed to the client, and
// the key never appears anywhere (P01 §7).
function makeHandler(providerName) {
  const provider = PROVIDERS[providerName];
  return async (req, res) => {
    const requestId = req.requestId || crypto.randomUUID();
    const model = req.body && req.body.model;
    const route = `/api/${providerName}`;
    const wantsStream = req.body && req.body.stream === true;
    let response;
    try {
      const headers = buildUpstreamHeaders(provider, ANTHROPIC_API_KEY);
      response = await callUpstream({
        url: provider.url,
        headers,
        data: req.body,
        stream: wantsStream,
        timeoutMs: provider.timeoutMs,
      });
    } catch (error) {
      const status = (error.response && error.response.status) || 502;
      // Log detail server-side (never the key/body); return a generic body to the client.
      logger.error({ event: 'upstream_failed', provider: provider.name, requestId, status, message: error.message });
      audit.record({ user: req.qlikUser, route, model, status, requestId });
      res.status(status).json({ error: 'Upstream request failed', provider: provider.name, requestId });
      return;
    }

    if (wantsStream) {
      // Streamed replies are piped through untouched so the client renders tokens as
      // they land. If the browser goes away, stop the upstream stream.
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // in case another proxy sits in front
      if (res.flushHeaders) res.flushHeaders();

      req.on('close', () => response.data.destroy());
      response.data.on('error', (err) => {
        logger.error({ event: 'stream_error', provider: provider.name, requestId, message: err.message });
        res.end();
      });
      // .pipe() natively honours backpressure — it pauses the upstream when res's write
      // buffer fills and resumes on 'drain' — so a slow client can't balloon proxy
      // memory (P03 §6).
      response.data.pipe(res);
      audit.record({ user: req.qlikUser, route, model, status: 200, requestId });
      return;
    }

    audit.record({ user: req.qlikUser, route, model, status: 200, requestId });
    res.json(response.data);
  };
}

// Per-route pipeline: authenticate (above) → validate body + model allowlist (P04) →
// admission slot (P03) → handler. Validation runs BEFORE admission so an invalid or
// disallowed request is rejected without ever consuming a concurrency slot.
const validation = { allowlist: ALLOWLIST, maxTokensCap: MAX_TOKENS_CAP };

// Anthropic (hosted) — key injected server-side.
app.post('/api/anthropic',
  validateBody('anthropic', validation), admission(limiter), makeHandler('anthropic'));
// Local model (Ollama) — no key; lets the HTTPS Qlik page reach a plain-HTTP local model.
app.post('/api/ollama',
  validateBody('ollama', validation), admission(limiter), makeHandler('ollama'));

// Start the server
const server = https.createServer(options, app);
server.listen(port, () => {
  logger.info({ event: 'listening', port, endpoints: ['/health', '/ready', '/metrics', '/api/anthropic', '/api/ollama'] });
});

// Graceful shutdown (P03 §8): stop accepting, drain the queue, let in-flight finish.
installGracefulShutdown({
  server,
  limiter,
  setReady,
  drainTimeoutMs: Number(process.env.DRAIN_TIMEOUT_MS) || 25000,
});
