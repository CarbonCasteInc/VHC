import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  ANALYZE_FAIL_CLOSED_STATUS,
  createAnalysisBackendServer,
} = require('./vh-analysis-backend-3001.js');

async function withServer(fn) {
  const server = createAnalysisBackendServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  assert.equal(typeof address, 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function readJson(response) {
  return JSON.parse(await response.text());
}

test('analysis backend health routes satisfy the canary ok:true contract', async () => {
  await withServer(async (baseUrl) => {
    for (const route of ['/api/analyze/health', '/api/analysis/health?pipeline=true', '/health']) {
      const response = await fetch(`${baseUrl}${route}`);
      assert.equal(response.status, 200, route);
      const payload = await readJson(response);
      assert.equal(payload.ok, true, route);
      assert.equal(payload.contract, 'analysis-backend-health-v1', route);
    }
  });
});

test('analysis backend config route is secret-free product health metadata', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/analyze/config`);
    assert.equal(response.status, 200);
    const payload = await readJson(response);
    assert.equal(payload.configured, true);
    assert.equal(payload.contract, 'analysis-backend-config-v1');
    assert.equal(payload.analyze_post.status, 'fail_closed');

    const serialized = JSON.stringify(payload);
    assert.equal(serialized.includes('OPENAI_API_KEY'), false);
    assert.equal(serialized.includes('sk-'), false);
  });
});

test('POST /api/analyze fails closed explicitly without a 502 or fake success', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'analyze this' }),
    });
    assert.equal(response.status, ANALYZE_FAIL_CLOSED_STATUS);
    assert.notEqual(response.status, 200);
    assert.notEqual(response.status, 502);
    const payload = await readJson(response);
    assert.equal(payload.ok, false);
    assert.equal(payload.error_class, 'full_analysis_out_of_beta_scope');
    assert.equal(payload.release_ready, false);
  });
});

test('legacy article-text routes remain present and guarded', async () => {
  await withServer(async (baseUrl) => {
    for (const route of ['/api/article-text', '/article-text']) {
      const response = await fetch(`${baseUrl}${route}`);
      assert.equal(response.status, 400, route);
      const payload = await readJson(response);
      assert.equal(payload.error, 'Missing url query parameter');
    }
  });
});
