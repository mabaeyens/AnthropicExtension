'use strict';

const fs = require('fs');
const path = require('path');

// Structured JSON-line logger (P06 §4.1) with a redaction safety-net so a secret or
// body can never reach a log line even if a caller passes one by mistake (P01 §7,
// P02 §7). The sink and clock are injectable for tests; the default sink writes one
// JSON object per line to stdout.

// Keys whose values are replaced with '[redacted]' anywhere in a logged object.
const SENSITIVE = new Set([
  'apikey', 'api_key', 'x-api-key', 'authorization', 'cookie', 'set-cookie',
  'x-qlik-session', 'password', 'secret', 'key', 'token', 'body', 'messages',
  'content', 'system', 'prompt', 'data',
]);

function redact(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE.has(k.toLowerCase()) ? '[redacted]' : redact(v, seen);
  }
  return out;
}

// Severity order (P06). A message is emitted only when its level is at or below the
// configured threshold: ERROR < WARN < INFO < DEBUG. So LOG_LEVEL=ERROR shows only
// errors; DEBUG shows everything. Unknown/blank level falls back to INFO.
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function normalizeLevel(level) {
  const key = String(level || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVELS, key) ? key : 'info';
}

function createLogger({
  sink = (line) => process.stdout.write(`${line}\n`),
  now = () => new Date().toISOString(),
  base = {},
  level = 'info',
} = {}) {
  const threshold = LEVELS[normalizeLevel(level)];
  function emit(msgLevel, fields) {
    if (LEVELS[msgLevel] > threshold) return; // below the configured verbosity → skip
    const record = { ts: now(), level: msgLevel, ...base, ...redact(fields || {}) };
    sink(JSON.stringify(record));
  }
  return {
    level: normalizeLevel(level),
    error: (f) => emit('error', f),
    warn: (f) => emit('warn', f),
    info: (f) => emit('info', f),
    debug: (f) => emit('debug', f),
    child: (extra) => createLogger({ sink, now, level, base: { ...base, ...extra } }),
  };
}

// Size-bounded rotating file sink (P06 §4.8). When the active file would exceed
// maxBytes, it is rotated (app.log → app.log.1 → … up to maxFiles) so disk can't fill.
// fs is injectable so rotation logic is unit-tested without touching the real disk.
function createRotatingSink({
  filePath,
  maxBytes = 10 * 1024 * 1024,
  maxFiles = 5,
  fsImpl = fs,
} = {}) {
  if (!filePath) throw new Error('createRotatingSink: filePath is required');
  const dir = path.dirname(filePath);
  if (fsImpl.mkdirSync) fsImpl.mkdirSync(dir, { recursive: true });

  function currentSize() {
    try { return fsImpl.statSync(filePath).size; } catch { return 0; }
  }

  function rotate() {
    for (let i = maxFiles - 1; i >= 1; i -= 1) {
      const from = `${filePath}.${i}`;
      const to = `${filePath}.${i + 1}`;
      if (fsImpl.existsSync(from)) {
        if (i + 1 > maxFiles) { fsImpl.rmSync(from, { force: true }); } else { fsImpl.renameSync(from, to); }
      }
    }
    if (fsImpl.existsSync(filePath)) fsImpl.renameSync(filePath, `${filePath}.1`);
  }

  return function write(line) {
    const bytes = Buffer.byteLength(`${line}\n`);
    if (currentSize() + bytes > maxBytes) rotate();
    fsImpl.appendFileSync(filePath, `${line}\n`);
  };
}

module.exports = { createLogger, createRotatingSink, redact, SENSITIVE, LEVELS, normalizeLevel };
