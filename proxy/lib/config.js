'use strict';

// Boot-time config validation (P06 §4.4). Aggregates EVERY required-env check into one
// pass so a misconfigured deploy fails fast with a precise, complete message (which vars,
// what's wrong) instead of a confusing runtime 500 or a partial first-error abort. The
// individual loaders (credentials.js, auth-qlik.js) remain the actual consumers; this is
// the fail-fast gate in front of them. The returned summary is safe to log (no secrets).

const fs = require('fs');

function isBlank(v) { return v === undefined || v === null || String(v).trim() === ''; }

function fileReadable(p, fsImpl) {
  try { fsImpl.accessSync(p, fsImpl.constants.R_OK); return true; } catch { return false; }
}

function posInt(v) {
  if (v === undefined || v === '') return { ok: true }; // optional → use default elsewhere
  const n = Number(v);
  return (Number.isInteger(n) && n > 0) ? { ok: true, n } : { ok: false };
}

// Returns { summary } on success; throws Error listing all problems on failure.
function load(env = process.env, { fsImpl = fs } = {}) {
  const errors = [];

  // Credential (P01)
  if (isBlank(env.ANTHROPIC_API_KEY)) errors.push('ANTHROPIC_API_KEY is required (P01)');

  // Caller auth (P02)
  if (isBlank(env.QLIK_SESSION_URL)) errors.push('QLIK_SESSION_URL is required (P02)');
  for (const v of ['QLIK_CERT', 'QLIK_KEY']) {
    if (isBlank(env[v])) errors.push(`${v} is required (P02)`);
    else if (!fileReadable(env[v], fsImpl)) errors.push(`${v} path is not readable: ${env[v]}`);
  }
  if (!isBlank(env.QLIK_CA) && !fileReadable(env.QLIK_CA, fsImpl)) {
    errors.push(`QLIK_CA path is not readable: ${env.QLIK_CA}`);
  }

  // TLS (P05) — paths have dev defaults, but if set they must be readable.
  for (const v of ['TLS_CERT', 'TLS_KEY']) {
    if (!isBlank(env[v]) && !fileReadable(env[v], fsImpl)) {
      errors.push(`${v} path is not readable: ${env[v]}`);
    }
  }

  // CORS (P05)
  if (isBlank(env.QLIK_ORIGINS) && isBlank(env.QLIK_ORIGIN)) {
    errors.push('QLIK_ORIGINS is required (P05) — no CORS origin allowlist configured');
  }

  // Numeric limits (P03/P04/P05) — if present, must be positive integers.
  const numeric = [
    'MAX_GLOBAL_INFLIGHT', 'MAX_USER_INFLIGHT', 'MAX_QUEUE', 'QUEUE_TIMEOUT_MS',
    'DRAIN_TIMEOUT_MS', 'MAX_TOKENS_CAP', 'RATE_LIMIT_WINDOW_MS', 'RATE_LIMIT_MAX', 'PORT',
  ];
  for (const v of numeric) {
    if (!posInt(env[v]).ok) errors.push(`${v} must be a positive integer (got: ${env[v]})`);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n  - ${errors.join('\n  - ')}`);
  }

  // A redacted, log-safe summary of what was validated.
  return {
    summary: {
      port: Number(env.PORT) || 3000,
      anthropicKey: '[set]',
      qlikSessionUrl: env.QLIK_SESSION_URL,
      corsOrigins: (env.QLIK_ORIGINS || env.QLIK_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean),
      tlsMinVersion: env.TLS_MIN_VERSION || 'TLSv1.2',
      limits: {
        maxGlobal: Number(env.MAX_GLOBAL_INFLIGHT) || 24,
        maxUser: Number(env.MAX_USER_INFLIGHT) || 3,
        maxQueue: Number(env.MAX_QUEUE) || 100,
      },
    },
  };
}

module.exports = { load };
