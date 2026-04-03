import { afterEach, describe, expect, it, vi } from 'vitest';
import { publisherCanaryInternal } from './daemon-feed-publisher-canary.mjs';

describe('publisher canary defaults', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults the canary max item budget to 15 total items', () => {
    vi.stubEnv('VH_DAEMON_FEED_MAX_ITEMS_TOTAL', '');
    expect(publisherCanaryInternal.resolvePublisherCanaryMaxItemsTotal()).toBe('15');
  });

  it('honors an explicit canary max item budget override', () => {
    vi.stubEnv('VH_DAEMON_FEED_MAX_ITEMS_TOTAL', '12');
    expect(publisherCanaryInternal.resolvePublisherCanaryMaxItemsTotal()).toBe('12');
  });

  it('defaults the canary storycluster openai timeout to 120000ms', () => {
    vi.stubEnv('VH_DAEMON_FEED_STORYCLUSTER_OPENAI_TIMEOUT_MS', '');
    expect(publisherCanaryInternal.resolvePublisherCanaryOpenAITimeoutMs()).toBe(120000);
  });

  it('honors an explicit canary storycluster openai timeout override', () => {
    vi.stubEnv('VH_DAEMON_FEED_STORYCLUSTER_OPENAI_TIMEOUT_MS', '180000');
    expect(publisherCanaryInternal.resolvePublisherCanaryOpenAITimeoutMs()).toBe(180000);
  });

  it('prefers a healthy automation-stack storycluster endpoint', () => {
    const remote = publisherCanaryInternal.resolvePublisherCanaryRemoteConfig('/repo', {}, {
      exists: (filePath) => filePath === '/repo/.tmp/automation-stack/state.json',
      readFile: () => JSON.stringify({
        services: {
          storycluster: { healthy: true },
        },
        storyclusterClusterUrl: 'http://127.0.0.1:4310/cluster',
        storyclusterReadyUrl: 'http://127.0.0.1:4310/ready',
        storyclusterAuthToken: 'stack-token',
      }),
    });

    expect(remote).toMatchObject({
      mode: 'automation-stack',
      clusterEndpoint: 'http://127.0.0.1:4310/cluster',
      readyUrl: 'http://127.0.0.1:4310/ready',
      authToken: 'stack-token',
    });
  });

  it('falls back to an explicit storycluster endpoint override', () => {
    const remote = publisherCanaryInternal.resolvePublisherCanaryRemoteConfig('/repo', {
      VH_DAEMON_FEED_STORYCLUSTER_ENDPOINT: 'http://127.0.0.1:9000/cluster',
      VH_DAEMON_FEED_STORYCLUSTER_READY_URL: 'http://127.0.0.1:9000/ready',
      VH_DAEMON_FEED_STORYCLUSTER_TOKEN: 'explicit-token',
    });

    expect(remote).toMatchObject({
      mode: 'explicit',
      clusterEndpoint: 'http://127.0.0.1:9000/cluster',
      readyUrl: 'http://127.0.0.1:9000/ready',
      authToken: 'explicit-token',
    });
  });
});
