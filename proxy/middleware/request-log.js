'use strict';

// Per-request structured log (P06 §4.1). Emits exactly one line per request on response
// completion, carrying request-id, user (P02), route, method, status and latency — never
// a body or secret (the logger redacts as a safety-net regardless). Clock injectable.
function requestLog({ logger, metrics, now = () => Date.now() }) {
  return (req, res, next) => {
    const start = now();
    if (metrics) metrics.incRequest();
    let logged = false;
    const done = () => {
      if (logged) return;
      logged = true;
      if (metrics) metrics.observeStatus(res.statusCode);
      logger.info({
        requestId: req.requestId,
        user: req.qlikUser || null,
        route: req.path,
        method: req.method,
        status: res.statusCode,
        latencyMs: now() - start,
      });
    };
    res.on('finish', done);
    res.on('close', done);
    next();
  };
}

module.exports = { requestLog };
