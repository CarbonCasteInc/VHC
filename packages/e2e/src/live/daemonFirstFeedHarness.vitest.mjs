import { afterEach, describe, expect, it, vi } from 'vitest';
import { GUN_PEER_URL, daemonFirstFeedHarnessInternal } from './daemonFirstFeedHarness';

describe('daemonFirstFeedHarnessInternal.resolveNewsPollIntervalMs', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prefers an explicit poll interval override', () => {
    vi.stubEnv('VH_DAEMON_FEED_USE_FIXTURE_FEED', 'true');
    vi.stubEnv('VITE_NEWS_POLL_INTERVAL_MS', '45000');
    expect(daemonFirstFeedHarnessInternal.resolveNewsPollIntervalMs()).toBe('45000');
  });

  it('uses a long poll interval for fixture-backed runs', () => {
    vi.stubEnv('VH_DAEMON_FEED_USE_FIXTURE_FEED', 'true');
    vi.stubEnv('VITE_NEWS_POLL_INTERVAL_MS', '');
    expect(daemonFirstFeedHarnessInternal.resolveNewsPollIntervalMs()).toBe(String(30 * 60 * 1000));
  });

  it('falls back to the short poll interval for non-fixture runs', () => {
    vi.stubEnv('VH_DAEMON_FEED_USE_FIXTURE_FEED', 'false');
    vi.stubEnv('VITE_NEWS_POLL_INTERVAL_MS', '');
    expect(daemonFirstFeedHarnessInternal.resolveNewsPollIntervalMs()).toBe('15000');
  });
});

describe('daemonFirstFeedHarness loopback relay wiring', () => {
  it('uses a loopback gun peer url', () => {
    expect(GUN_PEER_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/gun$/);
  });
});

describe('daemonFirstFeedHarnessInternal live feed limits', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses higher feed item limits for fixture-backed runs', () => {
    vi.stubEnv('VH_DAEMON_FEED_USE_FIXTURE_FEED', 'true');
    vi.stubEnv('VH_DAEMON_FEED_MAX_ITEMS_PER_SOURCE', '');
    vi.stubEnv('VH_DAEMON_FEED_MAX_ITEMS_TOTAL', '');
    expect(daemonFirstFeedHarnessInternal.resolveNewsFeedMaxItemsPerSource()).toBe('5');
    expect(daemonFirstFeedHarnessInternal.resolveNewsFeedMaxItemsTotal()).toBe('30');
  });

  it('uses lower feed item limits for live public smoke runs', () => {
    vi.stubEnv('VH_DAEMON_FEED_USE_FIXTURE_FEED', 'false');
    vi.stubEnv('VH_DAEMON_FEED_MAX_ITEMS_PER_SOURCE', '');
    vi.stubEnv('VH_DAEMON_FEED_MAX_ITEMS_TOTAL', '');
    expect(daemonFirstFeedHarnessInternal.resolveNewsFeedMaxItemsPerSource()).toBe('3');
    expect(daemonFirstFeedHarnessInternal.resolveNewsFeedMaxItemsTotal()).toBe('15');
  });

  it('prefers explicit feed item limit overrides', () => {
    vi.stubEnv('VH_DAEMON_FEED_USE_FIXTURE_FEED', 'false');
    vi.stubEnv('VH_DAEMON_FEED_MAX_ITEMS_PER_SOURCE', '7');
    vi.stubEnv('VH_DAEMON_FEED_MAX_ITEMS_TOTAL', '21');
    expect(daemonFirstFeedHarnessInternal.resolveNewsFeedMaxItemsPerSource()).toBe('7');
    expect(daemonFirstFeedHarnessInternal.resolveNewsFeedMaxItemsTotal()).toBe('21');
  });

  it('defaults auditable-bundle waiting to fixture-only unless explicitly overridden', () => {
    vi.stubEnv('VH_DAEMON_FEED_USE_FIXTURE_FEED', 'true');
    vi.stubEnv('VH_DAEMON_FEED_MIN_AUDITABLE_STORIES', '');
    expect(daemonFirstFeedHarnessInternal.resolveMinimumAuditableStories()).toBe(1);

    vi.stubEnv('VH_DAEMON_FEED_USE_FIXTURE_FEED', 'false');
    vi.stubEnv('VH_DAEMON_FEED_MIN_AUDITABLE_STORIES', '');
    expect(daemonFirstFeedHarnessInternal.resolveMinimumAuditableStories()).toBe(0);
  });

  it('prefers an explicit auditable-bundle minimum when provided', () => {
    vi.stubEnv('VH_DAEMON_FEED_USE_FIXTURE_FEED', 'false');
    vi.stubEnv('VH_DAEMON_FEED_MIN_AUDITABLE_STORIES', '2');
    expect(daemonFirstFeedHarnessInternal.resolveMinimumAuditableStories()).toBe(2);
  });

  it('defaults the soak storycluster remote timeout to 300000ms', () => {
    vi.stubEnv('VH_DAEMON_FEED_STORYCLUSTER_REMOTE_TIMEOUT_MS', '');
    expect(daemonFirstFeedHarnessInternal.resolveStoryClusterRemoteTimeoutMs()).toBe('300000');
  });

  it('prefers an explicit soak storycluster remote timeout override when provided', () => {
    vi.stubEnv('VH_DAEMON_FEED_STORYCLUSTER_REMOTE_TIMEOUT_MS', '420000');
    expect(daemonFirstFeedHarnessInternal.resolveStoryClusterRemoteTimeoutMs()).toBe('420000');
  });

  it('defaults the soak storycluster OpenAI timeout to 120000ms', () => {
    vi.stubEnv('VH_DAEMON_FEED_STORYCLUSTER_OPENAI_TIMEOUT_MS', '');
    expect(daemonFirstFeedHarnessInternal.resolveStoryClusterOpenAITimeoutMs()).toBe('120000');
  });

  it('prefers an explicit soak storycluster OpenAI timeout override when provided', () => {
    vi.stubEnv('VH_DAEMON_FEED_STORYCLUSTER_OPENAI_TIMEOUT_MS', '180000');
    expect(daemonFirstFeedHarnessInternal.resolveStoryClusterOpenAITimeoutMs()).toBe('180000');
  });

  it('defaults the feed-ready timeout to the remote timeout plus slack', () => {
    vi.stubEnv('VH_DAEMON_FEED_READY_TIMEOUT_MS', '');
    vi.stubEnv('VH_LIVE_FEED_READY_TIMEOUT_MS', '');
    vi.stubEnv('VH_DAEMON_FEED_STORYCLUSTER_REMOTE_TIMEOUT_MS', '');
    expect(daemonFirstFeedHarnessInternal.resolveFeedReadyTimeoutMs()).toBe(360000);
  });

  it('prefers an explicit daemon feed-ready timeout override when provided', () => {
    vi.stubEnv('VH_DAEMON_FEED_READY_TIMEOUT_MS', '420000');
    vi.stubEnv('VH_LIVE_FEED_READY_TIMEOUT_MS', '');
    expect(daemonFirstFeedHarnessInternal.resolveFeedReadyTimeoutMs()).toBe(420000);
  });

  it('falls back to the shared live feed-ready timeout override when the daemon-specific override is absent', () => {
    vi.stubEnv('VH_DAEMON_FEED_READY_TIMEOUT_MS', '');
    vi.stubEnv('VH_LIVE_FEED_READY_TIMEOUT_MS', '390000');
    expect(daemonFirstFeedHarnessInternal.resolveFeedReadyTimeoutMs()).toBe(390000);
  });

  it('prefers the shared storycluster endpoint and auth when configured', () => {
    vi.stubEnv('VH_DAEMON_FEED_SHARED_STORYCLUSTER_URL', 'http://127.0.0.1:4310/cluster');
    vi.stubEnv('VH_DAEMON_FEED_SHARED_STORYCLUSTER_HEALTH_URL', 'http://127.0.0.1:4310/ready');
    vi.stubEnv('VH_DAEMON_FEED_SHARED_STORYCLUSTER_AUTH_TOKEN', 'stack-token');
    vi.stubEnv('VH_STORYCLUSTER_REMOTE_AUTH_HEADER', 'x-storycluster-auth');
    vi.stubEnv('VH_STORYCLUSTER_REMOTE_AUTH_SCHEME', 'Token');

    expect(daemonFirstFeedHarnessInternal.resolveStoryclusterRemoteConfig()).toEqual({
      usesSharedStorycluster: true,
      endpointUrl: 'http://127.0.0.1:4310/cluster',
      healthUrl: 'http://127.0.0.1:4310/ready',
      authToken: 'stack-token',
      authHeader: 'x-storycluster-auth',
      authScheme: 'Token',
      headers: {
        'x-storycluster-auth': 'Token stack-token',
      },
    });
  });
});
