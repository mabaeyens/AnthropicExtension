'use strict';

const axios = require('axios');

// Transient upstream failures worth retrying (P01 §6).
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE']);

function isRetryable(err) {
  if (!err) return false;
  if (err.response && RETRYABLE_STATUS.has(err.response.status)) return true;
  if (err.code && RETRYABLE_CODES.has(err.code)) return true;
  return false;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Call an upstream provider. NON-streaming requests are retried on transient failures
// (429/502/503/504 + connection resets) with capped exponential backoff + jitter.
// STREAMING requests are never retried — a partially consumed stream cannot be safely
// replayed — so their errors surface to the caller immediately (P01 §6).
//
// `deps` allows tests to inject a fake axios / sleep / rng without real network or delay.
async function callUpstream(opts, deps = {}) {
  const {
    url, headers, data, stream = false, timeoutMs = 60000,
    maxRetries = 2, baseDelayMs = 300, maxDelayMs = 4000,
  } = opts;
  const client = deps.axios || axios;
  const sleep = deps.sleep || defaultSleep;
  const rand = deps.rand || Math.random;

  let attempt = 0;
  for (;;) {
    try {
      return await client({
        method: 'post',
        url,
        headers,
        data,
        responseType: stream ? 'stream' : 'json',
        timeout: timeoutMs,
        maxRedirects: 0,
      });
    } catch (err) {
      const canRetry = !stream && attempt < maxRetries && isRetryable(err);
      if (!canRetry) throw err;
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const jitter = backoff * 0.25 * rand();
      await sleep(backoff + jitter);
      attempt += 1;
    }
  }
}

module.exports = { callUpstream, isRetryable };
