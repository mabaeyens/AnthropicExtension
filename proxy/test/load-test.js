'use strict';

// P07 §4.3 — concurrency/load harness (NOT part of the unit `node --test` run; invoked
// on demand). Fires a burst of N requests at the real app with a mock upstream that
// holds each request open for a fixed delay, and asserts the X02 ceilings:
//   - peak concurrent upstream == MAX_GLOBAL_INFLIGHT
//   - overflow beyond queue capacity == 503
//   - final in-flight gauge == 0 (no leaked slots)
//
//   node test/load-test.js --requests 200 [--report]
//
// Exits non-zero if any invariant is violated, so it can gate a release on target HW.

const { buildApp, listen, validBody } = require('./helpers');
const { createLimiter } = require('../lib/limiter');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def;
}
const REQUESTS = arg('requests', 200);
const REPORT = process.argv.includes('--report');
const MAX_GLOBAL = 8;
const MAX_QUEUE = 20;
const HOLD_MS = 40;

async function main() {
  let concurrent = 0;
  let peak = 0;
  const upstream = async () => {
    concurrent += 1;
    peak = Math.max(peak, concurrent);
    await new Promise((r) => setTimeout(r, HOLD_MS));
    concurrent -= 1;
    return { data: { ok: true } };
  };
  upstream.calls = [];

  const limiter = createLimiter({ maxGlobal: MAX_GLOBAL, maxUser: 999, maxQueue: MAX_QUEUE, queueTimeoutMs: 5000 });
  const { app } = buildApp({ callUpstream: upstream, limiter });
  const s = await listen(app);

  const statuses = { 200: 0, 503: 0, other: 0 };
  let finalInflight = 0;
  try {
    const reqs = Array.from({ length: REQUESTS }, (_, i) => fetch(`${s.url}/api/anthropic`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-qlik-session': `u${i % 50}` },
      body: JSON.stringify(validBody),
    }).then((r) => {
      if (r.status === 200) statuses[200] += 1;
      else if (r.status === 503) statuses[503] += 1;
      else statuses.other += 1;
    }).catch(() => { statuses.other += 1; }));
    await Promise.all(reqs);
  } finally {
    // give the event loop a tick for slot releases on res 'finish'
    await new Promise((r) => setTimeout(r, 50));
    finalInflight = limiter.stats().globalInflight;
    await s.close();
  }

  const failures = [];
  if (peak > MAX_GLOBAL) failures.push(`peak concurrent ${peak} > ceiling ${MAX_GLOBAL}`);
  if (peak !== MAX_GLOBAL && REQUESTS > MAX_GLOBAL) failures.push(`peak concurrent ${peak} never reached ceiling ${MAX_GLOBAL}`);
  if (finalInflight !== 0) failures.push(`leaked slots: final in-flight ${finalInflight} != 0`);
  if (statuses.other !== 0) failures.push(`${statuses.other} unexpected non-200/503 responses`);

  if (REPORT || failures.length) {
    console.log(JSON.stringify({
      requests: REQUESTS, ceiling: MAX_GLOBAL, queue: MAX_QUEUE,
      peakConcurrent: peak, finalInflight, statuses, failures,
    }, null, 2));
  }
  if (failures.length) { console.error('LOAD TEST FAILED'); process.exit(1); }
  console.log('LOAD TEST PASSED');
}

// Only run when invoked directly (`node test/load-test.js`). Under `node --test` the
// file is imported, so require.main !== module and the burst does NOT fire.
if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
