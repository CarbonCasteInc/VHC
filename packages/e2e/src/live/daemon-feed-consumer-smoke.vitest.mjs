import { describe, expect, it } from 'vitest';
import { loadPlaywrightChromium } from './daemon-feed-consumer-smoke.mjs';

describe('daemon-feed-consumer-smoke', () => {
  it('loads chromium from the Playwright module', async () => {
    const chromium = { launch: async () => ({}) };
    await expect(loadPlaywrightChromium(async () => ({ chromium }))).resolves.toBe(chromium);
  });

  it('fails clearly when the Playwright module has no chromium export', async () => {
    await expect(loadPlaywrightChromium(async () => ({ chromium: null })))
      .rejects
      .toThrow('consumer-smoke-playwright-chromium-unavailable');
  });
});
