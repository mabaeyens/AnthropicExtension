require('dotenv').config();

const https = require('https');
const fs = require('fs');

const { providers } = require('./lib/providers');
const { loadAnthropicKey } = require('./lib/credentials');
const { createValidator } = require('./lib/auth-qlik');
const { createLimiter } = require('./lib/limiter');
const { modelAllowlist } = require('./lib/model-allowlist');
const { corsOptions } = require('./lib/cors');
const { createRateLimiter } = require('./lib/rate-limit');
const { installGracefulShutdown } = require('./lib/shutdown');
const config = require('./lib/config');
const { createLogger, createRotatingSink } = require('./lib/logger');
const { createAudit } = require('./lib/audit');
const { createMetrics } = require('./lib/metrics');
const { createApp } = require('./app');

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
let bootSummary;
try {
  bootSummary = config.load(process.env).summary;
} catch (err) {
  console.error('[FATAL]', err.message); // pre-logger fatal — always print
  process.exit(1);
}

// Credential (P01) — key lives only on the server from here on.
let ANTHROPIC_API_KEY;
try {
  ANTHROPIC_API_KEY = loadAnthropicKey();
} catch (err) {
  console.error('[FATAL]', err.message);
  process.exit(1);
}

// Caller authentication validator (P02).
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

const port = process.env.PORT || 3000;

// Observability (P06): structured app logger, a SEPARATE audit stream, and counters.
// LOG_LEVEL (ERROR|WARN|INFO|DEBUG, default INFO) gates how verbose the app log is;
// the audit stream is unaffected (compliance record, always written).
const logger = createLogger({ sink: makeSink('app.log'), level: process.env.LOG_LEVEL });
const audit = createAudit({ sink: makeSink('audit.log') });
const metrics = createMetrics();
logger.info({ event: 'boot', config: bootSummary, logLevel: logger.level });

// Concurrency admission control (P03 / X02).
const limiter = createLimiter({
  maxGlobal: Number(process.env.MAX_GLOBAL_INFLIGHT) || 24,
  maxUser: Number(process.env.MAX_USER_INFLIGHT) || 3,
  maxQueue: Number(process.env.MAX_QUEUE) || 100,
  queueTimeoutMs: Number(process.env.QUEUE_TIMEOUT_MS) || 10000,
});

// Readiness flag flipped by graceful shutdown; the /ready endpoint reads it.
let ready = true;
const setReady = (v) => { ready = v; };
function isReady() { return ready; }

// TLS options (P05 §4.1): cert/key from config (production = CA-signed); the self-signed
// localhost pair remains the dev default. Modern TLS floor (default 1.2).
const options = {
  key: fs.readFileSync(process.env.TLS_KEY || './certs/localhost3000-key.pem'),
  cert: fs.readFileSync(process.env.TLS_CERT || './certs/localhost3000-cert.pem'),
  minVersion: process.env.TLS_MIN_VERSION || 'TLSv1.2',
};

const app = createApp({
  anthropicKey: ANTHROPIC_API_KEY,
  providers: providers(),
  validate,
  limiter,
  logger,
  audit,
  metrics,
  allowlist: modelAllowlist(),
  maxTokensCap: Number(process.env.MAX_TOKENS_CAP) || 8192,
  corsOptions: corsOptions(),
  rateLimiter: createRateLimiter({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
    max: Number(process.env.RATE_LIMIT_MAX) || 120,
  }),
  isReady,
  bodyLimit: process.env.BODY_LIMIT || '1mb',
});

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
