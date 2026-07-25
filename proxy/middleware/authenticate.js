'use strict';

const { AuthError, UpstreamError } = require('../lib/auth-qlik');

// Default Qlik session cookie name for the DEFAULT virtual proxy on QSEoW. A named
// virtual proxy uses `X-Qlik-Session-<prefix>` — override via QLIK_SESSION_COOKIE.
const DEFAULT_COOKIE = 'X-Qlik-Session';

// Minimal Cookie-header parser. We only need one value, so we avoid pulling in the
// `cookie` / `cookie-parser` package (keeps the runtime lean). Returns a plain object of
// { name: value } with values URL-decoded. Cookie names are matched case-INSENSITIVELY on
// lookup because proxies/libraries occasionally reshape the casing of `X-Qlik-Session`.
function parseCookies(header) {
  const out = {};
  if (!header || typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    let value = part.slice(eq + 1).trim();
    // Strip one layer of surrounding double-quotes, then URL-decode.
    if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') {
      value = value.slice(1, -1);
    }
    try { value = decodeURIComponent(value); } catch (_) { /* keep raw on bad encoding */ }
    out[name] = value;
  }
  return out;
}

function cookieValue(header, cookieName) {
  const jar = parseCookies(header);
  if (Object.prototype.hasOwnProperty.call(jar, cookieName)) return jar[cookieName];
  const wanted = cookieName.toLowerCase();
  for (const k of Object.keys(jar)) {
    if (k.toLowerCase() === wanted) return jar[k];
  }
  return null;
}

// The Qlik session reference the proxy validates (P02). In the same-site deployment the
// browser sends the Qlik session COOKIE automatically (extension uses credentials:include),
// so the primary carrier is that cookie — its value is the session id QPS validates. The
// `x-qlik-session` HEADER remains an explicit override for deployments that mint a session
// ticket the extension can read, and for tests. Header wins when both are present. The
// reference itself is a secret and is NEVER logged.
function extractSessionRef(req, { cookieName = DEFAULT_COOKIE } = {}) {
  const header = req.headers['x-qlik-session'];
  if (header) return header;
  return cookieValue(req.headers.cookie, cookieName) || null;
}

// Express middleware: validate the caller's Qlik session BEFORE any upstream work
// (credential injection P01, admission P03). On success, attach the resolved user id to
// `req.qlikUser`. On failure, reject with the right status and a generic body — never
// echo the session reference or the error detail.
function authenticate(validate, { cookieName = DEFAULT_COOKIE } = {}) {
  return async (req, res, next) => {
    try {
      req.qlikUser = await validate(extractSessionRef(req, { cookieName }));
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

module.exports = { authenticate, extractSessionRef, parseCookies, DEFAULT_COOKIE };
