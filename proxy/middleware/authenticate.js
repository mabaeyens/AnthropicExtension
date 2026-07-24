'use strict';

const { AuthError, UpstreamError } = require('../lib/auth-qlik');

// The Qlik session reference the client forwards. Carrier is finalised with E01; the
// default is the `x-qlik-session` header. (A raw Qlik session cookie is typically
// HttpOnly and unreadable by the extension's JS, so a header-borne ticket/reference is
// the pragmatic carrier — see the P02 spec note.) Never logged.
function extractSessionRef(req) {
  return req.headers['x-qlik-session'] || null;
}

// Express middleware: validate the caller's Qlik session BEFORE any upstream work
// (credential injection P01, admission P03). On success, attach the resolved user id to
// `req.qlikUser`. On failure, reject with the right status and a generic body — never
// echo the session reference or the error detail.
function authenticate(validate) {
  return async (req, res, next) => {
    try {
      req.qlikUser = await validate(extractSessionRef(req));
      next();
    } catch (err) {
      if (err instanceof AuthError) {
        res.status(401).json({ error: 'Unauthenticated' });
      } else if (err instanceof UpstreamError) {
        // Qlik validation API is down — a dependency failure, not the user's fault.
        res.status(503).json({ error: 'Authentication service unavailable' });
      } else {
        res.status(500).json({ error: 'Authentication error' });
      }
    }
  };
}

module.exports = { authenticate, extractSessionRef };
