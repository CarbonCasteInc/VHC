import { describe, expect, it } from 'vitest';
import { consumerSmokeInternal } from './daemon-feed-consumer-smoke.mjs';

describe('consumer smoke automation-stack integration', () => {
  it('prefers the automation-stack web base url when present', () => {
    const resolved = consumerSmokeInternal.resolveConsumerSmokeBaseUrl('/repo', {}, {
      exists: (filePath) => filePath === '/repo/.tmp/automation-stack/state.json',
      readFile: () => JSON.stringify({
        services: {
          web: { healthy: true },
        },
        webBaseUrl: 'http://127.0.0.1:2099',
      }),
    });

    expect(resolved).toEqual({
      mode: 'automation-stack',
      baseUrl: 'http://127.0.0.1:2099/',
      statePath: '/repo/.tmp/automation-stack/state.json',
    });
  });

  it('falls back to an explicit base url override before stack state', () => {
    const resolved = consumerSmokeInternal.resolveConsumerSmokeBaseUrl('/repo', {
      VH_DAEMON_FEED_CONSUMER_SMOKE_BASE_URL: 'http://127.0.0.1:3000/app',
    });

    expect(resolved).toEqual({
      mode: 'explicit',
      baseUrl: 'http://127.0.0.1:3000/app',
      statePath: null,
    });
  });

  it('hydrates fixture data in-browser only for ephemeral mode', () => {
    expect(consumerSmokeInternal.shouldHydrateFixtureInBrowser('ephemeral')).toBe(true);
    expect(consumerSmokeInternal.shouldHydrateFixtureInBrowser('automation-stack')).toBe(false);
    expect(consumerSmokeInternal.shouldHydrateFixtureInBrowser('explicit')).toBe(false);
  });
});
