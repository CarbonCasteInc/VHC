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
