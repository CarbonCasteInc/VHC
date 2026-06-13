import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPublicFeedFreshnessMonitor } from '../../../../tools/scripts/public-feed-freshness-monitor.mjs';

const cleanup = [];

afterEach(async () => {
  while (cleanup.length > 0) {
    const item = cleanup.pop();
    if (typeof item === 'function') await item();
  }
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function makeRepoRoot() {
  const root = await mkdtemp(join(tmpdir(), 'vh-freshness-monitor-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function startOrigin({
  timestamp,
  service = 'vh-public-beta-origin',
  readyStatus = 200,
  requests = [],
} = {}) {
  const server = createServer((req, res) => {
    requests.push(req.url ?? '');
    if (req.url?.startsWith('/healthz')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        service,
        relay_id: service === 'vh-relay' ? 'relay-test' : undefined,
        route_surface: service === 'vh-relay' ? 'vh-relay-http-v1' : undefined,
        public_http_routes: service === 'vh-relay'
          ? ['/vh/news/latest-index', '/vh/news/hot-index', '/vh/news/story', '/vh/topics/synthesis']
          : undefined,
      }));
      return;
    }
    if (req.url?.startsWith('/readyz')) {
      res.writeHead(readyStatus, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: readyStatus >= 200 && readyStatus < 300,
        service: 'vh-relay',
        route_surface: 'vh-relay-http-v1',
      }));
      return;
    }
    if (req.url?.startsWith('/vh/news/latest-index')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        records: {
          'story-fresh': {
            story_id: 'story-fresh',
            latest_activity_at: timestamp,
            source_count: 2,
          },
        },
      }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not_found' }));
  });
  const origin = await listen(server);
  cleanup.push(() => new Promise((resolve) => server.close(resolve)));
  return origin;
}

describe('public feed freshness monitor', () => {
  it('passes when configured origins are healthy and latest-index rows are fresh', async () => {
    const now = Date.UTC(2026, 5, 12, 12, 0, 0);
    const repoRoot = await makeRepoRoot();
    const appRequests = [];
    const relayRequests = [];
    const appOrigin = await startOrigin({ timestamp: now - 5_000, requests: appRequests });
    const relayOrigin = await startOrigin({ timestamp: now - 10_000, service: 'vh-relay', requests: relayRequests });

    const summary = await runPublicFeedFreshnessMonitor({
      repoRoot,
      now,
      env: {
        VH_PUBLIC_FEED_FRESHNESS_ORIGINS: `${appOrigin},${relayOrigin}`,
        VH_PUBLIC_FEED_FRESHNESS_MAX_AGE_MS: String(60_000),
      },
    });

    expect(summary.status).toBe('pass');
    expect(summary.blockers).toEqual([]);
    expect(summary.healthReadbacks).toHaveLength(2);
    expect(summary.latestIndexReadbacks.map((readback) => readback.newestStoryId)).toEqual([
      'story-fresh',
      'story-fresh',
    ]);
    for (const requestUrl of [...appRequests, ...relayRequests].filter((url) => url.startsWith('/vh/news/latest-index'))) {
      expect(new URL(requestUrl, 'http://127.0.0.1').searchParams.get('persist')).toBe('false');
    }
  });

  it('fails closed when threshold zero makes the latest-index window stale', async () => {
    const now = Date.UTC(2026, 5, 12, 12, 0, 0);
    const repoRoot = await makeRepoRoot();
    const origin = await startOrigin({ timestamp: now - 1 });

    const summary = await runPublicFeedFreshnessMonitor({
      repoRoot,
      now,
      env: {
        VH_PUBLIC_FEED_FRESHNESS_ORIGINS: origin,
        VH_PUBLIC_FEED_FRESHNESS_MAX_AGE_MS: '0',
      },
    });

    expect(summary.status).toBe('fail');
    expect(summary.blockers.join('\n')).toContain('latest_index_stale:1/0');
  });

  it('fails when the optional StoryCluster OpenAI preflight is required and not passing', async () => {
    const now = Date.UTC(2026, 5, 12, 12, 0, 0);
    const repoRoot = await makeRepoRoot();
    const origin = await startOrigin({ timestamp: now - 1_000 });

    const summary = await runPublicFeedFreshnessMonitor({
      repoRoot,
      now,
      env: {
        VH_PUBLIC_FEED_FRESHNESS_ORIGINS: origin,
        VH_PUBLIC_FEED_FRESHNESS_CHECK_OPENAI_PREFLIGHT: 'true',
      },
      preflightImpl: async () => ({
        status: 'fail',
        code: 'storycluster-openai-auth-invalid',
        checks: { textModelAuth: 'fail' },
      }),
    });

    expect(summary.status).toBe('fail');
    expect(summary.openAIPreflight).toMatchObject({
      required: true,
      status: 'fail',
      failure: 'openai_preflight_not_passing:storycluster-openai-auth-invalid',
    });
  });
});
