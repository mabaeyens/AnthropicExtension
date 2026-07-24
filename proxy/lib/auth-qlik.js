'use strict';

const https = require('https');
const { URL } = require('url');

// Caller authentication against Qlik (P02). The proxy independently validates the
// browser's Qlik session — it never trusts a client-asserted identity — and resolves
// the real user id used by rate limiting (P03) and audit (P06).
//
// Typed errors let the middleware map failures to the right HTTP status:
//   AuthError     → 401  the session is absent/invalid/expired (the caller's fault)
//   UpstreamError → 503  the Qlik validation API is unreachable/erroring (a dependency
//                        failure — NOT reported as "you're unauthorised")
class AuthError extends Error {}
class UpstreamError extends Error {}

// Positive-only TTL cache (P02 §5): bounds load on the Qlik API without ever caching a
// negative, so a revoked/expired session is not accepted for the TTL window. Capped
// size with oldest-out eviction. `now` is injectable for deterministic tests.
function createTtlCache({ ttlMs, max, now }) {
  const map = new Map(); // ref -> { user, expires }
  return {
    get(ref) {
      const hit = map.get(ref);
      if (!hit) return null;
      if (hit.expires <= now()) { map.delete(ref); return null; }
      return hit.user;
    },
    set(ref, user) {
      if (map.size >= max) map.delete(map.keys().next().value); // evict oldest
      map.set(ref, { user, expires: now() + ttlMs });
    },
    get size() { return map.size; },
  };
}

// Resolve "UserDirectory\\UserId" from a QPS session-payload object. Returns null when
// the payload has no usable identity (treated as an invalid session by the caller).
function extractUser(body) {
  if (!body || typeof body !== 'object') return null;
  const dir = body.UserDirectory || body.userDirectory;
  const id = body.UserId || body.userId;
  if (!dir || !id) return null;
  return `${dir}\\${id}`;
}

// Default network validator: a mutual-TLS GET to the Qlik Proxy Service (QPS) session
// endpoint. The exact QPS path / xrfkey convention is environment-specific and is
// finalised on the Qlik node; tests inject `deps.fetchSession` instead of exercising
// this. Returns { status, body } and never throws for HTTP status (only for transport).
function defaultFetchSession(config, deps) {
  const agent = deps.agent || new https.Agent({
    cert: config.cert, key: config.key, ca: config.ca, keepAlive: true,
  });
  const base = config.sessionUrl.replace(/\/+$/, '');
  return (sessionRef) => new Promise((resolve, reject) => {
    const u = new URL(`${base}/${encodeURIComponent(sessionRef)}`);
    const req = https.request(u, { method: 'GET', agent, timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let body = null;
        try { body = data ? JSON.parse(data) : null; } catch (_) { body = null; }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end();
  });
}

// Build the validator. `deps.fetchSession` (tests) and `deps.now` (clock) are
// injectable. Fails fast at creation when the real fetcher would be used but its
// required config is missing (boot posture, consistent with P01).
function createValidator(config = {}, deps = {}) {
  const { cacheTtlMs = 60000, cacheMax = 5000 } = config;
  const now = deps.now || (() => Date.now());
  let fetchSession = deps.fetchSession;
  if (!fetchSession) {
    for (const k of ['sessionUrl', 'cert', 'key']) {
      if (!config[k]) throw new Error(`Qlik auth config missing: ${k}`);
    }
    fetchSession = defaultFetchSession(config, deps);
  }
  const cache = createTtlCache({ ttlMs: cacheTtlMs, max: cacheMax, now });

  async function validate(sessionRef) {
    if (!sessionRef) throw new AuthError('no-session');
    const cached = cache.get(sessionRef);
    if (cached) return cached;

    let res;
    try {
      res = await fetchSession(sessionRef);
    } catch (e) {
      throw new UpstreamError('qlik-unreachable:' + (e.code || 'error'));
    }
    // 401/403/404 → the session is not valid. Anything else non-200 is a dependency fault.
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      throw new AuthError('invalid-session');
    }
    if (res.status !== 200) throw new UpstreamError('qlik-status-' + res.status);

    const user = extractUser(res.body);
    if (!user) throw new AuthError('no-user');
    cache.set(sessionRef, user);
    return user;
  }

  validate.cache = cache; // exposed for tests/metrics
  return validate;
}

module.exports = { createValidator, extractUser, createTtlCache, AuthError, UpstreamError };
