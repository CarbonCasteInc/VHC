import { afterEach, describe, expect, it, vi } from 'vitest';
import { daemonFirstFeedHarnessInternal } from './daemonFirstFeedHarness';

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
});
