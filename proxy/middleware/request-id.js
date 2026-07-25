'use strict';

const crypto = require('crypto');

// Per-request id (P06 §4.2): honour an inbound X-Request-Id if present and well-formed,
// else generate one. Attached to req.requestId, echoed on the response header, and used
// by the structured logger + error responses so a user-reported failure is traceable.
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

function requestId(genId = () => crypto.randomUUID()) {
  return (req, res, next) => {
    const inbound = req.headers && req.headers['x-request-id'];
    req.requestId = (typeof inbound === 'string' && SAFE_ID.test(inbound)) ? inbound : genId();
    res.setHeader('X-Request-Id', req.requestId);
    next();
  };
}

module.exports = { requestId };
