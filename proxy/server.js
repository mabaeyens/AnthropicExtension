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
const { installGracefulShutdown } = require('./lib/shutdown');

function readFileMaybe(p) { return p ? fs.readFileSync(p) : undefined; }

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

// Concurrency admission control (P03 / X02). Limits are config-driven with the
// documented defaults.
const limiter = createLimiter({
  maxGlobal: Number(process.env.MAX_GLOBAL_INFLIGHT) || 24,
  maxUser: Number(process.env.MAX_USER_INFLIGHT) || 3,
  maxQueue: Number(process.env.MAX_QUEUE) || 100,
  queueTimeoutMs: Number(process.env.QUEUE_TIMEOUT_MS) || 10000,
});

// Readiness flag flipped by graceful shutdown; the P06 /ready endpoint will read it.
let ready = true;
const setReady = (v) => { ready = v; };
// eslint-disable-next-line no-unused-vars
function isReady() { return ready; }

const options = {
  key: fs.readFileSync('./certs/localhost3000-key.pem'), // Path to your private key
  cert: fs.readFileSync('./certs/localhost3000-cert.pem'), // Path to your certificate
};

// Configure CORS - in production, restrict this to your Qlik Sense domain
app.use(cors({
  origin: process.env.QLIK_ORIGIN || 'https://your-qlik-server', // Set QLIK_ORIGIN in .env
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-api-key', 'Origin', 'X-Requested-With', 'Accept', 'anthropic-version'],
}));

// Parse JSON request bodies, capped at a per-request size limit (P04 §4.3). Sufficient
// for chart data + context but not open-ended; oversize bodies are rejected 413 below.
app.use(express.json({ limit: process.env.BODY_LIMIT || '1mb' }));

// Body-parser error handler (P04 §4.6): map size/parse failures to 413/400 with a
// generic message + request id — never an echo of the offending body.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const requestId = crypto.randomUUID();
  if (err.type === 'entity.too.large') {
    console.warn('rejected oversize body', { requestId, limit: err.limit });
    return res.status(413).json({ error: 'Request body too large', requestId });
  }
  if (err.type === 'entity.parse.failed') {
    console.warn('rejected malformed JSON body', { requestId });
    return res.status(400).json({ error: 'Malformed JSON body', requestId });
  }
  console.error('unhandled request error', { requestId, message: err.message });
  return res.status(500).json({ error: 'Internal error', requestId });
});

// Health check endpoint (open — no auth, no upstream)
app.get('/health', (req, res) => {
  res.status(200).send('Proxy server is running');
});

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
      const requestId = crypto.randomUUID();
      const status = (error.response && error.response.status) || 502;
      // Log detail server-side (never the key/body); return a generic body to the client.
      console.error(`[${provider.name}] upstream request failed`,
        { requestId, status, message: error.message });
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
        console.error(`[${provider.name}] stream error:`, err.message);
        res.end();
      });
      // .pipe() natively honours backpressure — it pauses the upstream when res's write
      // buffer fills and resumes on 'drain' — so a slow client can't balloon proxy
      // memory (P03 §6).
      response.data.pipe(res);
      return;
    }

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
  console.log(`Proxy server running at https://localhost:${port}`);
  console.log(`Health check: https://localhost:${port}/health`);
  console.log(`Anthropic endpoint: https://localhost:${port}/api/anthropic`);
  console.log(`Local model endpoint: https://localhost:${port}/api/ollama`);
});

// Graceful shutdown (P03 §8): stop accepting, drain the queue, let in-flight finish.
installGracefulShutdown({
  server,
  limiter,
  setReady,
  drainTimeoutMs: Number(process.env.DRAIN_TIMEOUT_MS) || 25000,
});
