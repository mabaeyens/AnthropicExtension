'use strict';

// Graceful shutdown (P03 §8). On SIGTERM/SIGINT: flip readiness to not-ready (so a load
// balancer / P06 `/ready` stops routing), stop accepting new connections, drain the
// limiter queue (queued requests get 503), let in-flight requests finish up to
// drainTimeoutMs, then force-exit. Signals, timers and exit are injectable for tests.
function installGracefulShutdown(config = {}) {
  const {
    server, limiter, setReady,
    drainTimeoutMs = 25000,
    exit = process.exit,
    on = process.on.bind(process),
    setTimer = setTimeout,
  } = config;

  let started = false;
  function shutdown() {
    if (started) return; started = true;
    if (setReady) setReady(false);
    if (limiter) limiter.drain();
    if (server) server.close(() => exit(0));
    const t = setTimer(() => exit(0), drainTimeoutMs);
    if (t && t.unref) t.unref();
  }

  on('SIGTERM', shutdown);
  on('SIGINT', shutdown);
  return shutdown;
}

module.exports = { installGracefulShutdown };
