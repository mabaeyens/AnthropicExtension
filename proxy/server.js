require('dotenv').config();

const express = require('express');
const cors = require('cors');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

const { providers } = require('./lib/providers');
const { loadAnthropicKey, buildUpstreamHeaders } = require('./lib/credentials');
const { callUpstream } = require('./lib/upstream');

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

const PROVIDERS = providers();
const app = express();
const port = process.env.PORT || 3000;

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

// Parse JSON request bodies
app.use(express.json({ limit: '10mb' })); // Increase limit if you send large data

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('Proxy server is running');
});

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
      response.data.pipe(res);
      return;
    }

    res.json(response.data);
  };
}

// Anthropic (hosted) — key injected server-side.
app.post('/api/anthropic', makeHandler('anthropic'));
// Local model (Ollama) — no key; lets the HTTPS Qlik page reach a plain-HTTP local model.
app.post('/api/ollama', makeHandler('ollama'));

// Start the server
https.createServer(options, app).listen(port, () => {
  console.log(`Proxy server running at https://localhost:${port}`);
  console.log(`Health check: https://localhost:${port}/health`);
  console.log(`Anthropic endpoint: https://localhost:${port}/api/anthropic`);
  console.log(`Local model endpoint: https://localhost:${port}/api/ollama`);
});
