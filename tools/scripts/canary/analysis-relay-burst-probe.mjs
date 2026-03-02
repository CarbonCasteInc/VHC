#!/usr/bin/env node
import process from 'node:process';

const endpoint = process.argv[2] ?? 'http://127.0.0.1:2048/api/analyze';
const totalRequests = Number.parseInt(process.argv[3] ?? '20', 10);
const concurrency = Number.parseInt(process.argv[4] ?? '5', 10);
const requestTimeoutMs = Number.parseInt(process.argv[5] ?? '70000', 10);
const model = process.env.VITE_ANALYSIS_MODEL ?? process.env.ANALYSIS_RELAY_MODEL ?? 'gpt-5-nano';

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

function buildKnownGoodArticleText(topicId) {
  const body = [
    'Publisher: probe-source',
    `Topic ID: ${topicId}`,
    'Title: Probe article used for analysis relay baseline.',
    'ARTICLE BODY:',
    'This article describes a policy debate with clear competing narratives, source attribution, and timeline markers.',
    'Analysts discuss fiscal constraints, implementation risks, and likely public impact over a six month horizon.',
    'Supporters claim the plan improves efficiency and transparency.',
    'Critics argue the rollout assumptions are optimistic and understate transition costs.',
    'Independent experts provide mixed assessments and emphasize monitoring metrics after launch.',
  ].join('\n');

  return `${body}\n${'Additional context sentence. '.repeat(40)}`;
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

async function runOne(index) {
  const topicId = `probe-topic-${index}`;
  const payload = {
    articleText: buildKnownGoodArticleText(topicId),
    topicId,
    model,
  };
  const requestBody = JSON.stringify(payload);
  const requestBytes = byteLength(requestBody);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
      signal: controller.signal,
    });
    const raw = await response.text();
    const latencyMs = Date.now() - startedAt;
    const responseBytes = byteLength(raw);

    let body = {};
    try {
      body = JSON.parse(raw);
    } catch {
      body = { raw };
    }

    const content =
      (typeof body?.content === 'string' && body.content) ||
      (typeof body?.analysis === 'object' && body.analysis ? JSON.stringify(body.analysis) : '');
    const outputBytes = content ? byteLength(content) : 0;
    const error = typeof body?.error === 'string' ? body.error : null;

    return {
      index,
      status: response.status,
      latencyMs,
      requestBytes,
      responseBytes,
      outputBytes,
      error,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    return {
      index,
      status: 0,
      latencyMs,
      requestBytes,
      responseBytes: 0,
      outputBytes: 0,
      error: message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  if (!Number.isFinite(totalRequests) || totalRequests <= 0) {
    throw new Error(`invalid request count: ${process.argv[3]}`);
  }
  if (!Number.isFinite(concurrency) || concurrency <= 0) {
    throw new Error(`invalid concurrency: ${process.argv[4]}`);
  }

  // eslint-disable-next-line no-console
  console.log(`[analysis-relay-burst-probe] endpoint=${endpoint} model=${model} requests=${totalRequests} concurrency=${concurrency} timeout_ms=${requestTimeoutMs}`);

  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, totalRequests) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= totalRequests) return;
      const result = await runOne(index + 1);
      results.push(result);
      // eslint-disable-next-line no-console
      console.log(
        `[probe] #${result.index} status=${result.status} latency_ms=${result.latencyMs} `
        + `req_bytes=${result.requestBytes} res_bytes=${result.responseBytes} out_bytes=${result.outputBytes} `
        + `${result.error ? `error=${JSON.stringify(result.error)}` : 'ok'}`,
      );
    }
  });
  await Promise.all(workers);

  const successes = results.filter((result) => result.status === 200);
  const failures = results.filter((result) => result.status !== 200);
  const latencies = results.map((result) => result.latencyMs);
  const byStatus = results.reduce((acc, result) => {
    const key = String(result.status);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const successRate = totalRequests > 0 ? successes.length / totalRequests : 0;

  // eslint-disable-next-line no-console
  console.log('\n[analysis-relay-burst-probe] summary');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({
    endpoint,
    model,
    totalRequests,
    concurrency,
    success: successes.length,
    failure: failures.length,
    successRate: Number(successRate.toFixed(4)),
    statusCounts: byStatus,
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies.length > 0 ? Math.max(...latencies) : null,
    },
    bytes: {
      requestAvg: Math.round(results.reduce((sum, result) => sum + result.requestBytes, 0) / Math.max(1, results.length)),
      responseAvg: Math.round(results.reduce((sum, result) => sum + result.responseBytes, 0) / Math.max(1, results.length)),
      outputAvg: Math.round(results.reduce((sum, result) => sum + result.outputBytes, 0) / Math.max(1, results.length)),
    },
    sampleFailures: failures.slice(0, 5),
  }, null, 2));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[analysis-relay-burst-probe] fatal', error);
  process.exitCode = 1;
});
