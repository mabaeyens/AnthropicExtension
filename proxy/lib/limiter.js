'use strict';

// Bounded concurrency limiter (P03 / X02). Enforces a global in-flight ceiling and a
// per-user ceiling; overflow waits in a bounded FIFO queue with a per-item timeout.
// A caller `acquire`s a slot (awaiting if queued) and calls the returned `release`
// exactly once when done. Timers/clock are injectable for deterministic tests.

class QueueFullError extends Error {}
class QueueTimeoutError extends Error {}
class RequestAbortedError extends Error {}
class ShuttingDownError extends Error {}

function createLimiter(opts = {}) {
  const maxGlobal = opts.maxGlobal ?? 24;
  const maxUser = opts.maxUser ?? 3;
  const maxQueue = opts.maxQueue ?? 100;
  const queueTimeoutMs = opts.queueTimeoutMs ?? 10000;
  const setTimer = opts.setTimeout || setTimeout;
  const clearTimer = opts.clearTimeout || clearTimeout;

  let globalInflight = 0;
  let peakUser = 0;
  let draining = false;
  const userInflight = new Map();
  const queue = []; // FIFO of waiters

  const userCount = (u) => userInflight.get(u) || 0;

  function startSlot(user) {
    globalInflight += 1;
    const c = userCount(user) + 1;
    userInflight.set(user, c);
    if (c > peakUser) peakUser = c;
  }
  function endSlot(user) {
    globalInflight -= 1;
    const c = userCount(user) - 1;
    if (c <= 0) userInflight.delete(user); else userInflight.set(user, c);
    pump();
  }
  function makeRelease(user) {
    let released = false;
    return () => { if (released) return; released = true; endSlot(user); };
  }
  function detach(waiter) {
    const i = queue.indexOf(waiter);
    if (i !== -1) queue.splice(i, 1);
    if (waiter.timer) clearTimer(waiter.timer);
    if (waiter.onAbort && waiter.signal) waiter.signal.removeEventListener('abort', waiter.onAbort);
  }
  function admit(waiter) {
    detach(waiter);
    startSlot(waiter.user);
    waiter.resolve(makeRelease(waiter.user));
  }
  // FIFO admission, but skip waiters whose user is at cap so a burst from one user
  // queues behind its OWN limit rather than ahead of others (fairness, X02 §5).
  function pump() {
    for (let i = 0; i < queue.length;) {
      if (globalInflight >= maxGlobal) break;
      const w = queue[i];
      if (userCount(w.user) >= maxUser) { i += 1; continue; }
      admit(w); // splices queue[i] out — do not advance i
    }
  }

  function acquire(user, { signal } = {}) {
    return new Promise((resolve, reject) => {
      if (draining) { reject(new ShuttingDownError('draining')); return; }
      if (signal && signal.aborted) { reject(new RequestAbortedError('aborted')); return; }
      if (globalInflight < maxGlobal && userCount(user) < maxUser) {
        startSlot(user); resolve(makeRelease(user)); return;
      }
      if (queue.length >= maxQueue) { reject(new QueueFullError('queue-full')); return; }
      const waiter = { user, resolve, reject, signal };
      waiter.timer = setTimer(() => {
        detach(waiter);
        reject(new QueueTimeoutError('queue-timeout'));
      }, queueTimeoutMs);
      if (signal) {
        waiter.onAbort = () => { detach(waiter); reject(new RequestAbortedError('aborted')); };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      queue.push(waiter);
    });
  }

  // Stop accepting and reject everything still queued (→ 503). In-flight slots are
  // untouched; they drain naturally as their releases fire.
  function drain() {
    draining = true;
    while (queue.length) {
      const w = queue.shift();
      if (w.timer) clearTimer(w.timer);
      if (w.onAbort && w.signal) w.signal.removeEventListener('abort', w.onAbort);
      w.reject(new ShuttingDownError('draining'));
    }
  }

  function stats() {
    return { globalInflight, queueDepth: queue.length, peakUser, maxGlobal, maxUser, maxQueue };
  }

  return {
    acquire, drain, stats,
    get draining() { return draining; },
    get inflight() { return globalInflight; },
  };
}

module.exports = {
  createLimiter, QueueFullError, QueueTimeoutError, RequestAbortedError, ShuttingDownError,
};
