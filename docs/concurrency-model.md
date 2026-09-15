# Concurrency model

> **Status: implemented.** This describes the end-to-end concurrency contract as shipped
> (client request-lifecycle work in the extension, concurrency/resilience work in the
> proxy, both released as of extension v0.5.0 / proxy v2.0.0).

This is the single source of truth for the shared limits. Both ends, the browser
client and the proxy, implement against the names and defaults here so they cannot
drift apart.

## The contract, end to end

```
Browser (<=1 in-flight per widget)  -->  Proxy (admission: global + per-user ceiling,
                                        bounded FIFO queue, queue timeout)  -->  Upstream
        ^                                        |
        +-------- abort on disconnect -----------+  (queued: dropped; in-flight: upstream destroyed)
```

## 1. Client: one in-flight request per widget

- While a request (buffered or streamed) is in flight, **Submit** and **Suggest a
  chart** are disabled; a second trigger is **ignored** (not queued).
- A single `AbortController` per in-flight request, aborted on: **New chat**, **model
  switch**, and **widget teardown**. Starting a new request is blocked until the
  previous completes or aborts.
- `getAppContextCached` memoizes the **in-flight promise**, not the resolved value:
  concurrent early callers share one context build; a rejection clears the memo so a
  retry can rebuild, closing the result-memoization race that a resolved-value cache
  would otherwise have.

## 2. Proxy: admission control

Requests acquire a slot before any upstream call; a slot is released **exactly once**
on completion, disconnect, or error, never leaked.

| Limit | Name | Default | Meaning |
|---|---|---|---|
| Global in-flight | `MAX_GLOBAL_INFLIGHT` | 24 | Max simultaneous upstream calls across all users. |
| Per-user in-flight | `MAX_USER_INFLIGHT` | 3 | Max concurrent calls per authenticated user; further requests queue. |
| Queue depth | `MAX_QUEUE` | 100 | Bounded FIFO for overflow. Full → immediate `503` + `Retry-After`. |
| Queue wait | `QUEUE_TIMEOUT_MS` | 10 000 | A request waiting longer is dequeued → `503` + `Retry-After`. |
| Drain window | `DRAIN_TIMEOUT_MS` | 25 000 | On shutdown, let in-flight finish this long, then abort. |

All limits are config/env-driven and validated on boot. The defaults assume adequate
hardware and are the documented starting point; the load test calibrates them on the
target node.

## 3. Cancellation propagation

- A browser abort closes the HTTP connection.
- The proxy detects `req`/`res` close and either **removes a still-queued request** from
  the queue (slot never acquired) or **destroys the in-flight upstream call/stream** and
  releases its slot at once.
- No slot is held by a client that has gone away; no upstream call outlives its client.

## 4. Streaming backpressure

When piping an upstream stream to a slow client, honour `res.write()` backpressure
(pause the upstream on `false`, resume on `drain`) so a slow reader cannot grow proxy
memory unbounded.

## 5. Fairness & ordering

The queue is FIFO within the global limit; per-user limits are enforced **at
admission**, so a burst from one user queues behind its own cap rather than ahead of
other users.

## Verification

- **Client:** overlapping Submit clicks result in exactly one network request; New chat
  / model switch during a buffered request aborts it.
- **Proxy:** a load run issuing more than `MAX_GLOBAL_INFLIGHT + MAX_QUEUE` requests
  shows peak concurrent upstream == `MAX_GLOBAL_INFLIGHT`, overflow rejected `503` with
  `Retry-After`, aborting clients free slots immediately, and the final in-flight gauge
  returns to 0 (no leaked slots). Covered by the proxy's `node:test` suite under
  `proxy/test/`.

## See also

- [`security-model.md`](./security-model.md): identity, trust boundaries, and what the
  hardening removes.
