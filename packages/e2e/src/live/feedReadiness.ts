import type { Page } from '@playwright/test';

const FEED_NUDGE_SCROLL_WAIT_MS = 1_500;
const FEED_NUDGE_REFRESH_WAIT_MS = 1_000;
const FEED_NUDGE_TOP_WAIT_MS = 300;
const FEED_NUDGE_FINAL_SETTLE_MS = 0;
const FEED_READY_SETTLE_MS = 500;
const FEED_READY_STABLE_SAMPLE_COUNT = 3;

export interface FeedNudgeOptions {
  readonly scrollWaitMs?: number;
  readonly refreshWaitMs?: number;
  readonly topWaitMs?: number;
  readonly finalSettleMs?: number;
}

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

async function scrollFeedToTop(page: Page, topWaitMs: number): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(topWaitMs);
}

export async function nudgeFeed(page: Page, options: FeedNudgeOptions = {}): Promise<void> {
  const scrollWaitMs = options.scrollWaitMs ?? FEED_NUDGE_SCROLL_WAIT_MS;
  const refreshWaitMs = options.refreshWaitMs ?? FEED_NUDGE_REFRESH_WAIT_MS;
  const topWaitMs = options.topWaitMs ?? FEED_NUDGE_TOP_WAIT_MS;
  const finalSettleMs = options.finalSettleMs ?? FEED_NUDGE_FINAL_SETTLE_MS;

  await scrollFeedToTop(page, topWaitMs);
  await applyDeferredFeed(page);

  const refresh = page.getByTestId('feed-refresh-button');
  if (await refresh.count().catch(() => 0)) {
    await refresh.first().click().catch(() => {});
  }

  await page.waitForTimeout(refreshWaitMs);
  await applyDeferredFeed(page);

  const sentinel = page.getByTestId('feed-load-sentinel');
  if (await sentinel.count().catch(() => 0)) {
    await sentinel.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(scrollWaitMs);
  }

  await scrollFeedToTop(page, topWaitMs);
  await applyDeferredFeed(page);
  await page.waitForTimeout(refreshWaitMs);

  if (finalSettleMs > 0) {
    await page.waitForTimeout(finalSettleMs);
  }
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
    if (await confirmStableMinimumCount(params.readCount, params.minCount, params.page.waitForTimeout.bind(params.page))) {
      return lastCount;
    }

    await nudgeFeed(params.page);
  }

  throw new Error(`feed-count-timeout:${lastCount}/${params.minCount}`);
}

export async function confirmStableMinimumCount(
  readCount: () => Promise<number>,
  minCount: number,
  waitForTimeout: (timeoutMs: number) => Promise<unknown>,
): Promise<boolean> {
  for (let sample = 0; sample < FEED_READY_STABLE_SAMPLE_COUNT; sample += 1) {
    const count = await readCount();
    if (count < minCount) {
      return false;
    }
    if (sample < FEED_READY_STABLE_SAMPLE_COUNT - 1) {
      await waitForTimeout(FEED_READY_SETTLE_MS);
    }
  }
  return true;
}
