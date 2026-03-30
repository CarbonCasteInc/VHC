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
});
