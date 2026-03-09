import type { Page } from '@playwright/test';

const FEED_NUDGE_SCROLL_WAIT_MS = 1_500;
const FEED_NUDGE_REFRESH_WAIT_MS = 1_000;

export async function nudgeFeed(page: Page): Promise<void> {
  const sentinel = page.getByTestId('feed-load-sentinel');
  if (await sentinel.count().catch(() => 0)) {
    await sentinel.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(FEED_NUDGE_SCROLL_WAIT_MS);
  }

  const refresh = page.getByTestId('feed-refresh-button');
  if (await refresh.count().catch(() => 0)) {
    await refresh.first().click().catch(() => {});
  }

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
