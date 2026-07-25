'use strict';

const crypto = require('crypto');
const { validateChatBody } = require('../lib/schemas');

// Body validation + model allowlist enforcement (P04 §4.1, §4.2, §4.6). Runs AFTER
// authenticate (P02) but BEFORE admission (P03) so an invalid request is rejected
// without ever consuming a concurrency slot or reaching the upstream. Rejections
// carry a generic message + request id — never an echo of the offending body.
function validateBody(providerName, { allowlist, maxTokensCap = 8192, logger } = {}) {
  const allowed = (allowlist && allowlist[providerName]) || new Set();
  // Route WARN-level rejections through the leveled logger when available (so LOG_LEVEL
  // controls them); fall back to console.warn if no logger was injected.
  const warn = logger ? (o) => logger.warn(o) : (o) => console.warn('[validate] rejected', o);

  return (req, res, next) => {
    const errors = validateChatBody(req.body, { maxTokensCap });
    if (errors.length > 0) {
      const requestId = crypto.randomUUID();
      // Log the (non-sensitive) validation reasons server-side; the client gets a
      // generic 400 so a probing caller learns nothing about the schema internals.
      warn({ event: 'rejected_invalid_body', provider: providerName, requestId, errors });
      res.status(400).json({ error: 'Invalid request body', requestId });
      return;
    }

    if (!allowed.has(req.body.model)) {
      const requestId = crypto.randomUUID();
      warn({ event: 'rejected_disallowed_model', provider: providerName, requestId, model: req.body.model });
      res.status(403).json({ error: 'Model not allowed', requestId });
      return;
    }

    next();
  };
}

module.exports = { validateBody };
