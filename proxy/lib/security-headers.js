'use strict';

// Security response headers (P05 §4.3, §4.5). A small helmet-equivalent: sets the
// headers on EVERY response (buffered and streamed alike) before the route handler
// writes, so it composes with the SSE headers set later. Applied as early middleware.
function securityHeaders(opts = {}) {
  const { hsts = true } = opts;
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    // API responses must never be cached (they carry per-user model output).
    res.setHeader('Cache-Control', 'no-store');
    // Served over HTTPS → advertise HSTS. Guarded so a dev HTTP run doesn't send it.
    if (hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    // Remove the framework fingerprint (also disabled at app level).
    res.removeHeader('X-Powered-By');
    next();
  };
}

module.exports = { securityHeaders };
