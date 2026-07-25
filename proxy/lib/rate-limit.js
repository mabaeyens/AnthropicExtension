'use strict';

// IP-based rate limiting (P05 §4.4). A coarse fixed-window per-IP counter that runs
// BEFORE authentication, so an unauthenticated flood is shed before P02 does any
// mutual-TLS work. This is defence-in-depth beneath P03's per-user ceilings, not a
// replacement for them — tune the per-IP limit high (a shared-NAT office shares an IP).
//
// Deterministic + testable: the clock is injected (`now`), so tests advance time
// without real delays. State is an in-process Map (single-service deployment, P06);
// stale windows are pruned lazily on access plus opportunistically.

function createRateLimiter({
  windowMs = 60000,
  max = 120,
  now = Date.now,
  keyOf = (req) => req.ip || (req.socket && req.socket.remoteAddress) || 'unknown',
} = {}) {
  const windows = new Map(); // key → { count, resetAt }

  function take(key) {
    const t = now();
    let w = windows.get(key);
    if (!w || t >= w.resetAt) {
      w = { count: 0, resetAt: t + windowMs };
      windows.set(key, w);
    }
    w.count += 1;
    const allowed = w.count <= max;
    const retryAfterMs = Math.max(0, w.resetAt - t);
    return { allowed, retryAfterMs };
  }

  // Drop windows that have fully expired so the Map can't grow without bound.
  function prune() {
    const t = now();
    for (const [k, w] of windows) {
      if (t >= w.resetAt) windows.delete(k);
    }
  }

  const middleware = (req, res, next) => {
    const { allowed, retryAfterMs } = take(keyOf(req));
    if (allowed) return next();
    const retryAfter = Math.ceil(retryAfterMs / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Too many requests' });
  };

  middleware.take = take;
  middleware.prune = prune;
  middleware.size = () => windows.size;
  return middleware;
}

module.exports = { createRateLimiter };
