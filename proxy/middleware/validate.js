'use strict';

const crypto = require('crypto');
const { validateChatBody } = require('../lib/schemas');

// Body validation + model allowlist enforcement (P04 §4.1, §4.2, §4.6). Runs AFTER
// authenticate (P02) but BEFORE admission (P03) so an invalid request is rejected
// without ever consuming a concurrency slot or reaching the upstream. Rejections
// carry a generic message + request id — never an echo of the offending body.
function validateBody(providerName, { allowlist, maxTokensCap = 8192 } = {}) {
  const allowed = (allowlist && allowlist[providerName]) || new Set();

  return (req, res, next) => {
    const errors = validateChatBody(req.body, { maxTokensCap });
    if (errors.length > 0) {
      const requestId = crypto.randomUUID();
      // Log the (non-sensitive) validation reasons server-side; the client gets a
      // generic 400 so a probing caller learns nothing about the schema internals.
      console.warn(`[${providerName}] rejected invalid body`, { requestId, errors });
      res.status(400).json({ error: 'Invalid request body', requestId });
      return;
    }

    if (!allowed.has(req.body.model)) {
      const requestId = crypto.randomUUID();
      console.warn(`[${providerName}] rejected disallowed model`, { requestId, model: req.body.model });
      res.status(403).json({ error: 'Model not allowed', requestId });
      return;
    }

    next();
  };
}

module.exports = { validateBody };
