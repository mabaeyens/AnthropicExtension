'use strict';

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const { buildUpstreamHeaders } = require('./lib/credentials');
const { callUpstream: realCallUpstream } = require('./lib/upstream');
const { authenticate } = require('./middleware/authenticate');
const { admission } = require('./middleware/admission');
const { validateBody } = require('./middleware/validate');
const { securityHeaders } = require('./lib/security-headers');
const { requestId } = require('./middleware/request-id');
const { requestLog } = require('./middleware/request-log');
const { createHealthRouter } = require('./routes/health');

// Build the configured express app WITHOUT binding a socket or reading certs, so it can
// be exercised end-to-end by integration tests (real middleware, only the network edge —
// upstream + Qlik validator — stubbed). server.js supplies the production dependencies.
//
// Middleware order (P05/P06/P02/P04/P03):
//   x-powered-by off → requestId → requestLog → securityHeaders → rateLimiter → cors
//   → json(bodyLimit) → body-parser error handler → health router
//   → /api authenticate → per-route validateBody → admission → handler
function createApp({
  anthropicKey,
  providers,
  validate,
  limiter,
  logger,
  audit,
  metrics,
  allowlist,
  maxTokensCap = 8192,
  corsOptions,
  rateLimiter,
  isReady = () => true,
  bodyLimit = '1mb',
  callUpstream = realCallUpstream,
}) {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestId());
  app.use(requestLog({ logger, metrics }));
  app.use(securityHeaders());
  if (rateLimiter) app.use(rateLimiter);
  app.use(cors(corsOptions));
  app.use(express.json({ limit: bodyLimit }));

  // Body-parser error handler (P04 §4.6): size/parse failures → 413/400, generic body.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const rid = req.requestId || crypto.randomUUID();
    if (err.type === 'entity.too.large') {
      logger.warn({ event: 'body_too_large', requestId: rid, limit: err.limit });
      return res.status(413).json({ error: 'Request body too large', requestId: rid });
    }
    if (err.type === 'entity.parse.failed') {
      logger.warn({ event: 'body_parse_failed', requestId: rid });
      return res.status(400).json({ error: 'Malformed JSON body', requestId: rid });
    }
    logger.error({ event: 'unhandled_error', requestId: rid, message: err.message });
    return res.status(500).json({ error: 'Internal error', requestId: rid });
  });

  // Health / readiness / metrics (open — no auth, no upstream).
  app.use(createHealthRouter({ isReady, limiter, metrics }));

  // Authenticate the Qlik session for every /api/* request (P02).
  app.use('/api', authenticate(validate));

  const validation = { allowlist, maxTokensCap, logger };

  function makeHandler(providerName) {
    const provider = providers[providerName];
    const route = `/api/${providerName}`;
    return async (req, res) => {
      const rid = req.requestId || crypto.randomUUID();
      const model = req.body && req.body.model;
      const wantsStream = req.body && req.body.stream === true;
      logger.debug({ event: 'upstream_request', provider: provider.name, requestId: rid, model, stream: wantsStream });
      let response;
      try {
        const headers = buildUpstreamHeaders(provider, anthropicKey);
        response = await callUpstream({
          url: provider.url, headers, data: req.body, stream: wantsStream, timeoutMs: provider.timeoutMs,
        });
      } catch (error) {
        const status = (error.response && error.response.status) || 502;
        logger.error({ event: 'upstream_failed', provider: provider.name, requestId: rid, status, message: error.message });
        audit.record({ user: req.qlikUser, route, model, status, requestId: rid });
        res.status(status).json({ error: 'Upstream request failed', provider: provider.name, requestId: rid });
        return;
      }

      if (wantsStream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        if (res.flushHeaders) res.flushHeaders();
        req.on('close', () => response.data.destroy());
        response.data.on('error', (err) => {
          logger.error({ event: 'stream_error', provider: provider.name, requestId: rid, message: err.message });
          res.end();
        });
        response.data.pipe(res);
        audit.record({ user: req.qlikUser, route, model, status: 200, requestId: rid });
        return;
      }

      audit.record({ user: req.qlikUser, route, model, status: 200, requestId: rid });
      res.json(response.data);
    };
  }

  // Per-route pipeline: validate BEFORE admission so an invalid/disallowed request
  // never consumes a concurrency slot.
  app.post('/api/anthropic',
    validateBody('anthropic', validation), admission(limiter), makeHandler('anthropic'));
  app.post('/api/ollama',
    validateBody('ollama', validation), admission(limiter), makeHandler('ollama'));

  return app;
}

module.exports = { createApp };
