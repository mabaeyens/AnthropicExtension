'use strict';

// Audit log (P06 §4.5): one record per answered request on a SEPARATE stream, sufficient
// to answer "who asked the assistant something, when, against which model" — and nothing
// more. Deliberately body-agnostic: no prompt, no completion, no tokens, ever. Sink and
// clock injectable; the default writes JSON lines to stdout tagged so a shipper can route
// them to a distinct audit file.
function createAudit({
  sink = (line) => process.stdout.write(`${line}\n`),
  now = () => new Date().toISOString(),
} = {}) {
  return {
    record({ user, route, model, status, requestId }) {
      sink(JSON.stringify({
        ts: now(),
        kind: 'audit',
        user: user || 'unknown',
        route,
        model: model || null,
        status,
        requestId,
      }));
    },
  };
}

module.exports = { createAudit };
