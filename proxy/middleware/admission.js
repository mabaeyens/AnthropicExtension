'use strict';

const {
  QueueFullError, QueueTimeoutError, RequestAbortedError, ShuttingDownError,
} = require('../lib/limiter');

// Admission-control middleware (P03). Runs AFTER authentication (needs req.qlikUser).
// Acquires a concurrency slot before the route's upstream call; if the queue is full or
// the wait times out (or the server is draining) it returns 503 + Retry-After. If the
// client disconnects while queued, the wait is aborted and no response is sent. The slot
// is released exactly once when the response finishes or the connection closes — so a
// client that goes away mid-upstream never holds a slot.
function admission(limiter, { retryAfterSeconds = 5 } = {}) {
  return async (req, res, next) => {
    const user = req.qlikUser || 'anonymous';
    const ac = new AbortController();
    const onClose = () => ac.abort();
    req.on('close', onClose);

    let release;
    try {
      release = await limiter.acquire(user, { signal: ac.signal });
    } catch (err) {
      req.removeListener('close', onClose);
      if (err instanceof RequestAbortedError) return; // client already gone — nothing to send
      if (err instanceof QueueFullError || err instanceof QueueTimeoutError
          || err instanceof ShuttingDownError) {
        res.set('Retry-After', String(retryAfterSeconds));
        res.status(503).json({ error: 'Server busy, retry shortly' });
        return;
      }
      next(err);
      return;
    }

    // Slot held. The queue-abort listener is no longer needed; release on terminal events.
    req.removeListener('close', onClose);
    let released = false;
    const done = () => { if (!released) { released = true; release(); } };
    res.once('finish', done);
    res.once('close', done);
    next();
  };
}

module.exports = { admission };
