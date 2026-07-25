'use strict';

// Basic counters (P06 §4.6) to sit alongside the P03 gauges. Plain in-process integers
// (single-service deployment); surfaced by the /metrics handler together with the
// limiter's live gauges. No labels beyond the coarse buckets below — this is an
// ops signal, not per-user analytics.
function createMetrics() {
  const counters = { requests: 0, responses2xx: 0, responses4xx: 0, responses5xx: 0, upstreamRetries: 0 };
  return {
    incRequest() { counters.requests += 1; },
    incRetry() { counters.upstreamRetries += 1; },
    observeStatus(status) {
      if (status >= 500) counters.responses5xx += 1;
      else if (status >= 400) counters.responses4xx += 1;
      else if (status >= 200) counters.responses2xx += 1;
    },
    snapshot() { return { ...counters }; },
  };
}

module.exports = { createMetrics };
