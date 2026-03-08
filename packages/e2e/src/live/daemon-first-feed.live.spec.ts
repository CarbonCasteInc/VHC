import { test, expect, type BrowserContext } from '@playwright/test';
import {
  SHOULD_RUN,
  LIVE_BASE_URL,
  NAV_TIMEOUT_MS,
  addConsumerInitScript,
  attachRuntimeLogs,
  findBundledStory,
  headlineRows,
  logText,
  startDaemonFirstStack,
  stopDaemonFirstStack,
  waitForHeadlines,
  type DaemonFirstStack,
} from './daemonFirstFeedHarness';

type Summary = {
  readonly baseUrl: string;
  readonly feedReadyMs: number;
  readonly headlineCount: number;
  readonly headlineSamples: ReadonlyArray<{ storyId: string; topicId: string; headline: string }>;
  readonly bundledStory: {
    readonly storyId: string;
    readonly topicId: string;
    readonly headline: string;
    readonly sourceBadgeCount: number;
    readonly sourceBadgeIds: ReadonlyArray<string>;
  };
  readonly reloadedStory: {
    readonly storyId: string;
    readonly topicId: string;
    readonly headline: string;
    readonly sourceBadgeCount: number;
  };
  readonly browserConsumerOnly: boolean;
  readonly browserLogs: readonly string[];
  readonly storyclusterLogs: readonly string[];
  readonly daemonLogs: readonly string[];
};

test.describe('daemon-first StoryCluster feed', () => {
  test.skip(!SHOULD_RUN, 'VH_RUN_DAEMON_FIRST_FEED is not enabled');

  test('serves a daemon-written, StoryCluster-bundled feed to a consumer-only browser', async ({ browser }, testInfo) => {
    test.setTimeout(7 * 60_000);

    let stack: DaemonFirstStack | null = null;
    let context: BrowserContext | null = null;
    const browserLogs: string[] = [];

    try {
      stack = await startDaemonFirstStack();
      context = await browser.newContext({ ignoreHTTPSErrors: true });
      await addConsumerInitScript(context);
      const page = await context.newPage();
      page.on('console', (message) => browserLogs.push(logText(message)));

      await page.goto(LIVE_BASE_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      const feedReadyMs = await waitForHeadlines(page);
      const initialRows = await headlineRows(page);
      expect(initialRows.length).toBeGreaterThanOrEqual(3);

      const bundledStory = await findBundledStory(page);
      const browserConsumerOnly = browserLogs.every((line) => !line.includes('[vh:news-runtime] started'));
      expect(browserConsumerOnly).toBe(true);

      await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      await waitForHeadlines(page);
      const reloadedHeadline = page
        .locator(`[data-testid="news-card-headline-${bundledStory.topicId}"][data-story-id="${bundledStory.storyId}"]`)
        .first();
      await expect(reloadedHeadline).toBeVisible({ timeout: 30_000 });
      const reloadedCard = reloadedHeadline.locator('xpath=ancestor::article[1]');
      const reloadedSourceBadgeCount = await reloadedCard.locator('[data-testid^="source-badge-"]').count();
      expect(reloadedSourceBadgeCount).toBeGreaterThanOrEqual(2);

      const summary: Summary = {
        baseUrl: LIVE_BASE_URL,
        feedReadyMs,
        headlineCount: initialRows.length,
        headlineSamples: initialRows.slice(0, 6),
        bundledStory,
        reloadedStory: {
          storyId: bundledStory.storyId,
          topicId: bundledStory.topicId,
          headline: ((await reloadedHeadline.textContent()) ?? '').trim(),
          sourceBadgeCount: reloadedSourceBadgeCount,
        },
        browserConsumerOnly,
        browserLogs,
        storyclusterLogs: [...stack.storycluster.output],
        daemonLogs: [...stack.daemon.output],
      };

      await testInfo.attach('daemon-first-feed-summary', {
        body: JSON.stringify(summary, null, 2),
        contentType: 'application/json',
      });
    } catch (error) {
      if (stack) {
        await attachRuntimeLogs(testInfo, browserLogs, stack);
      }
      throw error;
    } finally {
      await context?.close().catch(() => {});
      await stopDaemonFirstStack(stack);
    }
  });
});
