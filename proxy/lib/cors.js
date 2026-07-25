'use strict';

// CORS origin allowlist (P05 §4.2). Replaces the single QLIK_ORIGIN string with an
// exact-match allowlist (QLIK_ORIGINS, comma-separated). An origin not on the list
// gets no CORS headers and its preflight is denied. Methods/headers are kept minimal —
// only what the extension actually sends.

// Parse the allowlist once; returns a Set of exact origins.
function parseOrigins(env = process.env) {
  const raw = env.QLIK_ORIGINS || env.QLIK_ORIGIN || '';
  return new Set(String(raw).split(',').map((s) => s.trim()).filter(Boolean));
}

// Build a cors() options object. The origin callback allows non-browser requests
// (no Origin header, e.g. curl/health probes) and any exact-listed origin; everything
// else is denied WITHOUT throwing (cors() then simply omits the ACAO header, so the
// browser blocks the response and the preflight fails).
function corsOptions(env = process.env) {
  const allowed = parseOrigins(env);
  return {
    origin(origin, cb) {
      if (!origin || allowed.has(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-qlik-session', 'Accept'],
    optionsSuccessStatus: 204,
  };
}

module.exports = { corsOptions, parseOrigins };
