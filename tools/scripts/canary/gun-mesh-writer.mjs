#!/usr/bin/env node
/**
 * gun-mesh-writer.mjs — Canary Gun relay mesh write exerciser.
 *
 * Usage:
 *   node gun-mesh-writer.mjs <relayUrl> <count> <concurrency> <timeoutMs>
 *
 * Connects to the Gun relay, writes <count> test nodes under
 * `canary-test/<runId>/`, then reads them back to verify mesh persistence.
 * Prints JSON results to stdout.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gunRequire = createRequire(
  path.resolve(__dirname, '../../../packages/gun-client/node_modules/gun/gun.js')
);

// Suppress Gun greeting that fires on require
const _origLog = console.log;
console.log = () => {};
const Gun = gunRequire('gun');
console.log = _origLog;

const [,, relayUrl, countStr = '10', concurrencyStr = '5', timeoutMsStr = '3000'] = process.argv;

if (!relayUrl) {
  console.error('Usage: node gun-mesh-writer.mjs <relayUrl> <count> <concurrency> <timeoutMs>');
  process.exit(1);
}

const count = parseInt(countStr, 10);
const concurrency = parseInt(concurrencyStr, 10);
const timeoutMs = parseInt(timeoutMsStr, 10);
const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Suppress Gun's console noise during init (including the greeting)
const origLog = console.log;
const origWarn = console.warn;
const origErr = console.error;
console.log = () => {};
console.warn = () => {};
console.error = () => {};

const gun = Gun({
  peers: [relayUrl],
  localStorage: false,
  radisk: false,
  file: false,
  axe: false,
});

// Restore console after brief init
setTimeout(() => {
  console.log = origLog;
  console.warn = origWarn;
  console.error = origErr;
}, 800);

const results = {
  total: count,
  success: 0,
  fail: 0,
  timeout: 0,
  latencies: [],
};

function writeAndVerify(index) {
  return new Promise((resolve) => {
    const nodeKey = `canary-test`;
    const subKey = `${runId}-${index}`;
    const payload = { test: true, ts: Date.now(), idx: index };
    const start = performance.now();
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        results.timeout++;
        results.fail++;
        resolve();
      }
    }, timeoutMs);

    // Write to the relay
    const ref = gun.get(nodeKey).get(subKey);
    ref.put(payload);

    // Immediately try to read back — this also exercises the relay roundtrip.
    // Use a small delay + .once() pattern for read-back.
    const readBack = () => {
      ref.once((data) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const elapsed = performance.now() - start;
        results.latencies.push(elapsed);

        if (data && data.test === true) {
          results.success++;
        } else {
          results.fail++;
        }
        resolve();
      });
    };

    // Small delay to let the write propagate to the relay
    setTimeout(readBack, 100);
  });
}

async function run() {
  // Wait for Gun peer connection
  await new Promise((r) => setTimeout(r, 1500));
  console.log = origLog;
  console.warn = origWarn;
  console.error = origErr;

  const queue = Array.from({ length: count }, (_, i) => i);
  const workers = [];

  for (let w = 0; w < concurrency; w++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const idx = queue.shift();
        if (idx !== undefined) await writeAndVerify(idx);
      }
    })());
  }

  await Promise.all(workers);

  // Compute percentiles
  const sorted = results.latencies.slice().sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;

  const output = {
    total: results.total,
    success: results.success,
    fail: results.fail,
    timeout: results.timeout,
    p50LatencyMs: Math.round(p50 * 100) / 100,
    p95LatencyMs: Math.round(p95 * 100) / 100,
  };

  process.stdout.write(JSON.stringify(output) + '\n');
  setTimeout(() => process.exit(0), 300);
}

run().catch((err) => {
  console.log = origLog;
  console.error('Fatal:', err.message);
  process.exit(1);
});
