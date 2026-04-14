import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

function applyEnv(envValues) {
  for (const [key, value] of Object.entries(envValues)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function loadConfig(runId, envOverrides = {}) {
  const previous = {
    VH_DAEMON_FEED_RUN_ID: process.env.VH_DAEMON_FEED_RUN_ID,
    VH_DAEMON_FEED_QDRANT_PORT: process.env.VH_DAEMON_FEED_QDRANT_PORT,
    VH_DAEMON_FEED_MANAGED_RELAY: process.env.VH_DAEMON_FEED_MANAGED_RELAY,
    VH_DAEMON_FEED_SHARED_RELAY_URL: process.env.VH_DAEMON_FEED_SHARED_RELAY_URL,
    VH_STORYCLUSTER_QDRANT_URL: process.env.VH_STORYCLUSTER_QDRANT_URL,
    QDRANT_URL: process.env.QDRANT_URL,
    VH_STORYCLUSTER_VECTOR_BACKEND: process.env.VH_STORYCLUSTER_VECTOR_BACKEND,
    VH_DAEMON_FEED_USE_FIXTURE_FEED: process.env.VH_DAEMON_FEED_USE_FIXTURE_FEED,
    VH_LIVE_DEV_FEED_SOURCE_IDS: process.env.VH_LIVE_DEV_FEED_SOURCE_IDS,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANALYSIS_RELAY_MODEL: process.env.ANALYSIS_RELAY_MODEL,
    ANALYSIS_RELAY_UPSTREAM_TIMEOUT_MS: process.env.ANALYSIS_RELAY_UPSTREAM_TIMEOUT_MS,
  };
  applyEnv({
    VH_DAEMON_FEED_RUN_ID: runId,
    VH_DAEMON_FEED_QDRANT_PORT: undefined,
    VH_DAEMON_FEED_MANAGED_RELAY: undefined,
    VH_DAEMON_FEED_SHARED_RELAY_URL: undefined,
    VH_STORYCLUSTER_QDRANT_URL: undefined,
    QDRANT_URL: undefined,
    VH_STORYCLUSTER_VECTOR_BACKEND: undefined,
    VH_DAEMON_FEED_USE_FIXTURE_FEED: undefined,
    VH_LIVE_DEV_FEED_SOURCE_IDS: undefined,
    OPENAI_API_KEY: undefined,
    ANALYSIS_RELAY_MODEL: undefined,
    ANALYSIS_RELAY_UPSTREAM_TIMEOUT_MS: undefined,
    ...envOverrides,
  });
  const configUrl = `${pathToFileURL(path.resolve(process.cwd(), 'playwright.daemon-first-feed.config.ts')).href}?runId=${runId}`;
  const mod = await import(configUrl);
  applyEnv(previous);
  return mod.default;
}

describe('playwright.daemon-first-feed.config', () => {
  it('binds a local qdrant stub and exports its URL', async () => {
    const config = await loadConfig('run-qdrant-check');
    expect(config.webServer).toBeDefined();
    const entries = config.webServer;
    expect(entries[0]).toMatchObject({
      url: expect.stringMatching(/\/readyz$/),
    });
    expect(entries[0].command).toContain('daemon-feed-qdrant-stub.mjs');
    expect(entries[0].command).toContain('kill -TERM');
    expect(entries[0].command).toContain('kill -KILL');
    expect(entries[0].command).toContain('webserver-qdrant.log');
    expect(entries[entries.length - 1].url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  });

  it('skips the qdrant stub when the vector backend is memory', async () => {
    const config = await loadConfig('run-memory-backend-check', {
      VH_STORYCLUSTER_VECTOR_BACKEND: 'memory',
    });
    const entries = config.webServer;
    expect(entries[0].command).not.toContain('daemon-feed-qdrant-stub.mjs');
    expect(entries.some((entry) => entry.command.includes('daemon-feed-qdrant-stub.mjs'))).toBe(false);
  });

  it('keeps the qdrant stub entry when fixture feed mode is enabled', async () => {
    const config = await loadConfig('run-fixture-check', {
      VH_DAEMON_FEED_USE_FIXTURE_FEED: 'true',
      VH_STORYCLUSTER_VECTOR_BACKEND: 'qdrant',
    });
    const entries = config.webServer;
    expect(entries).toHaveLength(5);
    expect(entries[0].url).toMatch(/\/readyz$/);
    expect(entries[1].url).toMatch(/\/health$/);
    expect(entries[2].url).toMatch(/\/health$/);
  });

  it('passes custom source ids through to the web app env, including smoke-only sources', async () => {
    const config = await loadConfig('run-source-check', {
      VH_LIVE_DEV_FEED_SOURCE_IDS: 'guardian-us,nbc-politics,pbs-politics',
    });
    const entries = config.webServer;
    const appServer = entries[entries.length - 1];
    const sourceIds = JSON.parse(appServer.env.VITE_NEWS_FEED_SOURCES).map((source) => source.id);

    expect(sourceIds).toEqual(['guardian-us', 'nbc-politics', 'pbs-politics']);
  });

  it('propagates analysis relay model and timeout overrides when the live relay is enabled', async () => {
    const config = await loadConfig('run-analysis-relay-check', {
      OPENAI_API_KEY: 'test-openai-key',
      ANALYSIS_RELAY_MODEL: 'gpt-test',
      ANALYSIS_RELAY_UPSTREAM_TIMEOUT_MS: '32100',
    });
    const entries = config.webServer;
    const appServer = entries[entries.length - 1];

    expect(appServer.env.ANALYSIS_RELAY_UPSTREAM_URL).toBe(
      'https://api.openai.com/v1/chat/completions',
    );
    expect(appServer.env.ANALYSIS_RELAY_API_KEY).toBe('test-openai-key');
    expect(appServer.env.ANALYSIS_RELAY_MODEL).toBe('gpt-test');
    expect(appServer.env.ANALYSIS_RELAY_UPSTREAM_TIMEOUT_MS).toBe('32100');
  });

  it('writes per-service startup logs into the run artifact directory', async () => {
    const config = await loadConfig('run-webserver-log-check', {
      VH_DAEMON_FEED_USE_FIXTURE_FEED: 'true',
      VH_STORYCLUSTER_VECTOR_BACKEND: 'qdrant',
    });
    const entries = config.webServer;

    expect(entries[0].command).toContain('webserver-qdrant.log');
    expect(entries[1].command).toContain('webserver-fixture-feed.log');
    expect(entries[2].command).toContain('webserver-analysis-stub.log');
    expect(entries[3].command).toContain('webserver-relay.log');
    expect(entries[4].command).toContain('webserver-web-pwa.log');
  });

  it('writes startup logs without qdrant when the memory backend is selected', async () => {
    const config = await loadConfig('run-memory-log-check', {
      VH_STORYCLUSTER_VECTOR_BACKEND: 'memory',
    });
    const entries = config.webServer;

    expect(entries.some((entry) => entry.command.includes('webserver-qdrant.log'))).toBe(false);
    expect(entries[0].command).toContain('webserver-relay.log');
    expect(entries[0].command).toContain('GUN_HOST=127.0.0.1');
    expect(entries[1].command).toContain('webserver-web-pwa.log');
  });

  it('skips relay webServer startup when the soak wrapper manages relay lifecycle', async () => {
    const config = await loadConfig('run-managed-relay-check', {
      VH_DAEMON_FEED_MANAGED_RELAY: 'true',
      VH_STORYCLUSTER_VECTOR_BACKEND: 'memory',
    });
    const entries = config.webServer;

    expect(entries.some((entry) => entry.command.includes('webserver-relay.log'))).toBe(false);
    expect(entries).toHaveLength(1);
    expect(entries[0].command).toContain('webserver-web-pwa.log');
  });

  it('skips relay webServer startup and points the app at a shared relay when configured', async () => {
    const config = await loadConfig('run-shared-relay-check', {
      VH_DAEMON_FEED_SHARED_RELAY_URL: 'http://127.0.0.1:7711/gun',
      VH_STORYCLUSTER_VECTOR_BACKEND: 'memory',
    });
    const entries = config.webServer;
    const appServer = entries[entries.length - 1];

    expect(entries.some((entry) => entry.command.includes('webserver-relay.log'))).toBe(false);
    expect(appServer.env.VITE_GUN_PEERS).toBe('["http://127.0.0.1:7711/gun"]');
  });
});
