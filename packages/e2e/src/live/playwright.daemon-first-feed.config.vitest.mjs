import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

async function loadConfig(runId, envOverrides = {}) {
  const previous = {
    VH_DAEMON_FEED_RUN_ID: process.env.VH_DAEMON_FEED_RUN_ID,
    VH_DAEMON_FEED_QDRANT_PORT: process.env.VH_DAEMON_FEED_QDRANT_PORT,
    VH_STORYCLUSTER_QDRANT_URL: process.env.VH_STORYCLUSTER_QDRANT_URL,
    QDRANT_URL: process.env.QDRANT_URL,
    VH_DAEMON_FEED_USE_FIXTURE_FEED: process.env.VH_DAEMON_FEED_USE_FIXTURE_FEED,
    VH_LIVE_DEV_FEED_SOURCE_IDS: process.env.VH_LIVE_DEV_FEED_SOURCE_IDS,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANALYSIS_RELAY_MODEL: process.env.ANALYSIS_RELAY_MODEL,
    ANALYSIS_RELAY_UPSTREAM_TIMEOUT_MS: process.env.ANALYSIS_RELAY_UPSTREAM_TIMEOUT_MS,
  };
  Object.assign(process.env, {
    VH_DAEMON_FEED_RUN_ID: runId,
    ...envOverrides,
  });
  const configUrl = `${pathToFileURL(path.resolve(process.cwd(), 'playwright.daemon-first-feed.config.ts')).href}?runId=${runId}`;
  const mod = await import(configUrl);
  Object.assign(process.env, previous);
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
    expect(entries[entries.length - 1].url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  });

  it('keeps the qdrant stub entry when fixture feed mode is enabled', async () => {
    const config = await loadConfig('run-fixture-check', {
      VH_DAEMON_FEED_USE_FIXTURE_FEED: 'true',
    });
    const entries = config.webServer;
    expect(entries).toHaveLength(5);
    expect(entries[0].url).toMatch(/\/readyz$/);
    expect(entries[1].url).toMatch(/\/health$/);
    expect(entries[2].url).toMatch(/\/health$/);
  });

  it('passes custom source ids through to the web app env, including smoke-only sources', async () => {
    const config = await loadConfig('run-source-check', {
      VH_LIVE_DEV_FEED_SOURCE_IDS: 'guardian-us,cnn-politics,pbs-politics',
    });
    const entries = config.webServer;
    const appServer = entries[entries.length - 1];
    const sourceIds = JSON.parse(appServer.env.VITE_NEWS_FEED_SOURCES).map((source) => source.id);

    expect(sourceIds).toEqual(['guardian-us', 'cnn-politics', 'pbs-politics']);
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
});
