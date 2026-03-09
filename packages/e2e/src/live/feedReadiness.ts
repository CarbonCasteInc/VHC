import type { Page } from '@playwright/test';

const FEED_NUDGE_SCROLL_WAIT_MS = 1_500;
const FEED_NUDGE_REFRESH_WAIT_MS = 1_000;
const FEED_NUDGE_TOP_WAIT_MS = 300;

async function applyDeferredFeed(page: Page): Promise<void> {
  const prompt = page.getByTestId('feed-refresh-prompt');
  if (!await prompt.count().catch(() => 0)) {
    return;
  }
  const loadNow = prompt.getByRole('button', { name: 'Load now' });
  if (!await loadNow.count().catch(() => 0)) {
    return;
  }
  await loadNow.click().catch(() => {});
}

async function scrollFeedToTop(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(FEED_NUDGE_TOP_WAIT_MS);
}

export async function nudgeFeed(page: Page): Promise<void> {
  await scrollFeedToTop(page);
  await applyDeferredFeed(page);

  const refresh = page.getByTestId('feed-refresh-button');
  if (await refresh.count().catch(() => 0)) {
    await refresh.first().click().catch(() => {});
  }

  await page.waitForTimeout(FEED_NUDGE_REFRESH_WAIT_MS);
  await applyDeferredFeed(page);

  const sentinel = page.getByTestId('feed-load-sentinel');
  if (await sentinel.count().catch(() => 0)) {
    await sentinel.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(FEED_NUDGE_SCROLL_WAIT_MS);
  }

  await scrollFeedToTop(page);
  await applyDeferredFeed(page);
  await page.waitForTimeout(FEED_NUDGE_REFRESH_WAIT_MS);
}

export async function waitForMinimumCount(params: {
  readonly page: Page;
  readonly minCount: number;
  readonly timeoutMs: number;
  readonly readCount: () => Promise<number>;
}): Promise<number> {
  const deadline = Date.now() + params.timeoutMs;
  let lastCount = 0;

  while (Date.now() < deadline) {
    lastCount = await params.readCount();
    if (lastCount >= params.minCount) {
      return lastCount;
    }

    await nudgeFeed(params.page);
  }

  throw new Error(`feed-count-timeout:${lastCount}/${params.minCount}`);
}
