'use strict';

const express = require('express');

// Health / readiness / metrics endpoints (P06 §4.3, §4.6). Pure handlers are exported
// for unit testing; createHealthRouter wires them onto an open (no-auth) router.
//
// - /health  = liveness: the process is up. The service manager restarts on failure.
// - /ready   = readiness: boot validation passed AND we're accepting requests. Flips to
//              503 during P03 graceful drain. Monitoring/load-balancers use this.
// - /metrics = P03 gauges (in-flight, queue depth) + P06 counters, for scraping.

function healthHandler(req, res) {
  res.status(200).json({ status: 'up' });
}

function readyHandler(isReady) {
  return (req, res) => {
    if (isReady()) return res.status(200).json({ status: 'ready' });
    return res.status(503).json({ status: 'not-ready' });
  };
}

function metricsHandler(limiter, metrics) {
  return (req, res) => {
    const gauges = (limiter && limiter.stats) ? limiter.stats() : {};
    const counters = (metrics && metrics.snapshot) ? metrics.snapshot() : {};
    res.status(200).json({ gauges, counters });
  };
}

function createHealthRouter({ isReady, limiter, metrics }) {
  const router = express.Router();
  router.get('/health', healthHandler);
  router.get('/ready', readyHandler(isReady));
  router.get('/metrics', metricsHandler(limiter, metrics));
  return router;
}

module.exports = { createHealthRouter, healthHandler, readyHandler, metricsHandler };
