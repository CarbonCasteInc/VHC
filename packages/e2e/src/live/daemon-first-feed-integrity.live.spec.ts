import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import {
  LIVE_BASE_URL,
  NAV_TIMEOUT_MS,
  SHOULD_RUN,
  addConsumerInitScript,
  attachRuntimeLogs,
  findBundledStory,
  headlineRows,
  logText,
  sleep,
  startDaemonFirstStack,
  stopDaemonFirstStack,
  waitForHeadlines,
  type DaemonFirstStack,
  type HeadlineRow,
} from './daemonFirstFeedHarness';

const ANALYSIS_READY_TIMEOUT_MS = 90_000;
const IDENTITY_BOOTSTRAP_TIMEOUT_MS = 120_000;
const SORT_SAMPLE_SIZE = 6;
const HOTTEST_WINDOW_SIZE = 8;
const ZERO_BASELINE_SETTLE_WINDOW_MS = 5_000;
const ZERO_BASELINE_SETTLE_STEP_MS = 500;

interface VisibleCard extends HeadlineRow {
  readonly hotness: number;
  readonly meta: string;
  readonly sourceBadgeCount: number;
}

interface VoteCounts { readonly agree: number; readonly disagree: number; }
async function attachJson(testInfo: { attach: (name: string, options: { body: string; contentType: string }) => Promise<void> }, name: string, value: unknown): Promise<void> {
  await testInfo.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' });
}

function waitFor(condition: () => Promise<boolean>, timeoutMs: number, stepMs = 300): Promise<boolean> {
  const startedAt = Date.now();
  return (async () => {
    while (Date.now() - startedAt < timeoutMs) {
      if (await condition()) return true;
      await sleep(stepMs);
    }
    return false;
  })();
}

function parseIso(meta: string, label: 'Created' | 'Updated'): number {
  const match = meta.match(new RegExp(`${label}\\s+([^•]+)`));
  const parsed = Date.parse((match?.[1] ?? '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 3 && !new Set(['with', 'from', 'that', 'this', 'after', 'about', 'amid', 'over', 'into', 'news']).has(token));
}

function overlapCount(left: string, right: string): number {
  const rightTerms = new Set(tokenize(right));
  return tokenize(left).filter((token) => rightTerms.has(token)).length;
}

function storylineKey(title: string): string {
  const terms = tokenize(title);
  return terms.slice(0, 2).join('+') || title.toLowerCase();
}

async function visibleCards(page: Page): Promise<VisibleCard[]> {
  return page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('article[data-testid^="news-card-"]'))
    .map((card) => {
      const headline = card.querySelector<HTMLElement>('[data-testid^="news-card-headline-"]');
      const hotness = card.querySelector<HTMLElement>('[data-testid^="news-card-hotness-"]');
      const meta = Array.from(card.querySelectorAll('p')).find((node) => (node.textContent ?? '').includes('Created '));
      if (!headline || !hotness || !meta) return null;
      return {
        topicId: (headline.getAttribute('data-testid') ?? '').replace('news-card-headline-', ''),
        storyId: headline.getAttribute('data-story-id') ?? '',
        headline: (headline.textContent ?? '').trim(),
        hotness: Number.parseFloat((hotness.textContent ?? '').replace('Hotness', '').trim()) || 0,
        meta: (meta.textContent ?? '').trim(),
        sourceBadgeCount: card.querySelectorAll('[data-testid^="source-badge-"]').length,
      };
    })
    .filter((row): row is VisibleCard => Boolean(row && row.topicId && row.storyId && row.headline)));
}

async function gotoFeed(page: Page): Promise<void> {
  await page.goto(LIVE_BASE_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  await waitForHeadlines(page);
}

async function ensureIdentity(page: Page, label: string): Promise<void> {
  const deadline = Date.now() + IDENTITY_BOOTSTRAP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await page.goto(LIVE_BASE_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    const userLink = page.getByTestId('user-link');
    await userLink.waitFor({ state: 'visible', timeout: 20_000 });
    await userLink.click();
    await page.waitForURL('**/dashboard', { timeout: 20_000 });

    const welcome = page.getByTestId('welcome-msg');
    if (await welcome.isVisible().catch(() => false)) break;

    const createButton = page.getByTestId('create-identity-btn');
    if (await createButton.isVisible().catch(() => false)) {
      const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`;
      const username = `${label}${suffix}`.slice(0, 24);
      const handle = username.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 24);
      await page.fill('input[placeholder="Choose a username"]', username);
      await page.fill('input[placeholder="Choose a handle (letters, numbers, _)"]', handle || `u${suffix}`);
      await createButton.click();
      const joined = await waitFor(async () => welcome.isVisible().catch(() => false), 30_000, 500);
      if (joined) break;
    }

    await sleep(1_000);
  }

  await gotoFeed(page);
}

async function requireAnalysisRelay(page: Page): Promise<void> {
  const healthDot = page.getByTestId('health-indicator-dot');
  await healthDot.waitFor({ state: 'visible', timeout: 15_000 });
  const ready = await waitFor(async () => {
    const label = await healthDot.getAttribute('aria-label');
    return !!label && !label.includes('Relay Unavailable') && !label.includes('Disconnected');
  }, 15_000, 500);
  if (ready) {
    return;
  }
  const label = (await healthDot.getAttribute('aria-label')) ?? 'Health: Unknown';
  throw new Error(`blocked-setup-analysis-relay-unavailable:${label}`);
}

async function openStory(page: Page, row: HeadlineRow): Promise<Locator> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const headline = page.locator(`[data-testid="news-card-headline-${row.topicId}"][data-story-id="${row.storyId}"]`).first();
    if (!await headline.isVisible().catch(() => false)) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.getByTestId('feed-refresh-button').click().catch(() => {});
      await waitForHeadlines(page);
    }
    await headline.scrollIntoViewIfNeeded();
    await headline.click();
    const card = headline.locator('xpath=ancestor::article[1]');
    const back = card.locator(`[data-testid="news-card-back-${row.topicId}"]`).first();
    if (await waitFor(async () => back.isVisible().catch(() => false), 8_000, 250)) {
      return card;
    }
  }
  throw new Error(`story-open-timeout:${row.storyId}`);
}

async function closeStory(page: Page, row: HeadlineRow, card: Locator): Promise<void> {
  const backButton = card.locator(`[data-testid="news-card-back-button-${row.topicId}"]`).first();
  if (await backButton.isVisible().catch(() => false)) {
    await backButton.click().catch(() => {});
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }
  await sleep(250);
}

async function waitForAnalysisReady(card: Locator, row: HeadlineRow): Promise<string> {
  const provider = card.locator(`[data-testid="news-card-analysis-provider-${row.topicId}"]`).first();
  const summary = card.locator(`[data-testid="news-card-summary-${row.topicId}"]`).first();
  const voteButtons = card.locator('[data-testid^="cell-vote-agree-"]');
  const analysisError = card.locator(`[data-testid="news-card-analysis-error-${row.topicId}"]`).first();
  const analysisStatus = card.getByTestId('analysis-status-message').first();
  const ready = await waitFor(async () => {
    if (await analysisError.isVisible().catch(() => false)) {
      throw new Error(`analysis-error:${row.storyId}`);
    }
    const statusText = (await analysisStatus.evaluateAll((nodes) => (nodes[0]?.textContent ?? '')).catch(() => '')).trim().toLowerCase();
    if (statusText.includes('pipeline unavailable') || statusText.includes('relay unavailable')) {
      throw new Error(`analysis-relay-unavailable:${row.storyId}`);
    }
    if (statusText.includes('daily analysis limit reached')) {
      throw new Error(`analysis-budget-exceeded:${row.storyId}`);
    }
    const providerVisible = await provider.isVisible().catch(() => false);
    const summaryText = (await summary.evaluateAll((nodes) => (nodes[0]?.textContent ?? '')).catch(() => '')).trim();
    const buttons = await voteButtons.count().catch(() => 0);
    return providerVisible && summaryText.length > 0 && !summaryText.includes('Summary pending') && buttons > 0;
  }, ANALYSIS_READY_TIMEOUT_MS, 500);
  if (!ready) throw new Error(`analysis-timeout:${row.storyId}`);
  return ((await provider.textContent()) ?? '').trim();
}

async function firstPointId(card: Locator, preferredPointId?: string): Promise<string> {
  if (preferredPointId) {
    const preferred = card.getByTestId(`cell-vote-agree-${preferredPointId}`);
    if (await preferred.count()) return preferredPointId;
  }
  const button = card.locator('[data-testid^="cell-vote-agree-"]').first();
  const testId = await button.getAttribute('data-testid');
  if (!testId) throw new Error('missing-point-id');
  return testId.replace('cell-vote-agree-', '');
}

async function zeroBaselinePointId(card: Locator, preferredPointId?: string): Promise<string> {
  if (preferredPointId) {
    const preferred = card.getByTestId(`cell-vote-agree-${preferredPointId}`);
    if (await preferred.count()) {
      const counts = await stableZeroBaselineCounts(card, preferredPointId);
      if (counts) {
        return preferredPointId;
      }
    }
  }

  const buttons = card.locator('[data-testid^="cell-vote-agree-"]');
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const testId = await buttons.nth(index).getAttribute('data-testid');
    if (!testId) {
      continue;
    }
    const pointId = testId.replace('cell-vote-agree-', '');
    const counts = await stableZeroBaselineCounts(card, pointId);
    if (counts) {
      return pointId;
    }
  }

  throw new Error('no-zero-baseline-point-found');
}

async function stableZeroBaselineCounts(card: Locator, pointId: string): Promise<VoteCounts | null> {
  const deadline = Date.now() + ZERO_BASELINE_SETTLE_WINDOW_MS;
  let lastCounts: VoteCounts | null = null;

  while (Date.now() < deadline) {
    const counts = await voteCounts(card, pointId);
    if (counts.agree !== 0 || counts.disagree !== 0) {
      return null;
    }
    lastCounts = counts;
    await sleep(ZERO_BASELINE_SETTLE_STEP_MS);
  }

  return lastCounts;
}

async function voteCounts(card: Locator, pointId: string): Promise<VoteCounts> {
  const agreeText = (await card.getByTestId(`cell-vote-agree-${pointId}`).textContent()) ?? '';
  const disagreeText = (await card.getByTestId(`cell-vote-disagree-${pointId}`).textContent()) ?? '';
  return {
    agree: Number.parseInt((agreeText.match(/\+\s*(\d+)/)?.[1] ?? '0'), 10),
    disagree: Number.parseInt((disagreeText.match(/-\s*(\d+)/)?.[1] ?? '0'), 10),
  };
}

test.describe('daemon-first StoryCluster feed integrity', () => {
  test.skip(!SHOULD_RUN, 'VH_RUN_DAEMON_FIRST_FEED is not enabled');

  test('keeps ordering coherent and persists analysis plus votes across consumer contexts', async ({ browser }, testInfo) => {
    test.setTimeout(10 * 60_000);

    let stack: DaemonFirstStack | null = null;
    let contextA: BrowserContext | null = null;
    let contextB: BrowserContext | null = null;
    const browserLogs: string[] = [];

    try {
      stack = await startDaemonFirstStack();
      contextA = await browser.newContext({ ignoreHTTPSErrors: true });
      await addConsumerInitScript(contextA);
      const pageA = await contextA.newPage();
      pageA.on('console', (message) => browserLogs.push(logText(message)));

      await ensureIdentity(pageA, 'alpha');
      await requireAnalysisRelay(pageA);
      await pageA.evaluate(() => window.scrollTo(0, 0));
      const { latestCards, hottestCards } = await test.step('validate latest and hottest ordering', async () => {
        const latest = (await visibleCards(pageA)).slice(0, SORT_SAMPLE_SIZE);
        expect(latest.length).toBeGreaterThanOrEqual(4);
        for (let i = 1; i < latest.length; i += 1) {
          expect(parseIso(latest[i - 1]!.meta, 'Updated')).toBeGreaterThanOrEqual(parseIso(latest[i]!.meta, 'Updated'));
        }

        await pageA.getByTestId('sort-mode-HOTTEST').click();
        await sleep(750);
        const hottest = (await visibleCards(pageA)).slice(0, HOTTEST_WINDOW_SIZE);
        expect(hottest.length).toBeGreaterThanOrEqual(4);
        const firstHalf = hottest.slice(0, Math.ceil(hottest.length / 2));
        const secondHalf = hottest.slice(Math.ceil(hottest.length / 2));
        const avg = (items: VisibleCard[]) => items.reduce((sum, item) => sum + item.hotness, 0) / Math.max(1, items.length);
        expect(avg(firstHalf)).toBeGreaterThanOrEqual(avg(secondHalf));
        const storylineCounts = hottest.reduce<Record<string, number>>((acc, card) => {
          const key = storylineKey(card.headline);
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {});
        expect(Math.max(...Object.values(storylineCounts))).toBeLessThanOrEqual(2);
        await attachJson(testInfo, 'daemon-first-feed-ordering', { latest, hottest });
        await pageA.getByTestId('sort-mode-LATEST').click();
        await sleep(500);
        return { latestCards: latest, hottestCards: hottest };
      });

      const bundledStory = await findBundledStory(pageA);
      expect(bundledStory.sourceBadgeCount).toBeGreaterThanOrEqual(2);

      const row = (await headlineRows(pageA)).find((candidate) => candidate.storyId === bundledStory.storyId) ?? bundledStory;
      const { cardA, providerA, pointId, sourceSummaryTexts } = await test.step('open bundled story and verify analysis readiness', async () => {
        const card = await openStory(pageA, row);
        const provider = await waitForAnalysisReady(card, row);
        const sourceSummaries = card.locator(`[data-testid="news-card-analysis-source-summaries-${row.topicId}"] li`);
        await expect.poll(() => sourceSummaries.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
        const summaries = (await sourceSummaries.allTextContents()).map((value) => value.trim()).filter(Boolean);
        const cardSummaryText = ((await card.getByTestId(`news-card-summary-${row.topicId}`).textContent()) ?? '').trim();
        expect(summaries.length).toBeGreaterThanOrEqual(1);
        expect(summaries.length).toBeLessThanOrEqual(bundledStory.sourceBadgeCount);
        const semanticallyAnchored = summaries.filter((value) =>
          overlapCount(value, row.headline) > 0 || overlapCount(value, cardSummaryText) > 0,
        );
        expect(semanticallyAnchored.length).toBeGreaterThanOrEqual(1);
        if (summaries.length >= 2) {
          expect(new Set(summaries.map((value) => value.split(':', 1)[0]?.trim() ?? '')).size).toBeGreaterThanOrEqual(2);
        }
        const selectedPointId = await zeroBaselinePointId(card);
        await attachJson(testInfo, 'daemon-first-feed-analysis-a', {
          bundledStory,
          provider,
          sourceSummaryTexts: summaries,
          sourceBadgeIds: bundledStory.sourceBadgeIds,
          pointId: selectedPointId,
        });
        return { cardA: card, providerA: provider, pointId: selectedPointId, sourceSummaryTexts: summaries };
      });

      const beforeA = await voteCounts(cardA, pointId);
      await cardA.getByTestId(`cell-vote-agree-${pointId}`).click();
      await expect(cardA.getByTestId(`cell-vote-agree-${pointId}`)).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => voteCounts(cardA, pointId).then((value) => value.agree), { timeout: 30_000 }).toBeGreaterThan(beforeA.agree);
      const afterA = await voteCounts(cardA, pointId);
      await attachJson(testInfo, 'daemon-first-feed-vote-a', { pointId, beforeA, afterA });

      contextB = await browser.newContext({ ignoreHTTPSErrors: true });
      await addConsumerInitScript(contextB);
      const pageB = await contextB.newPage();
      pageB.on('console', (message) => browserLogs.push(logText(message)));
      await ensureIdentity(pageB, 'beta');
      await requireAnalysisRelay(pageB);
      const cardB = await openStory(pageB, row);
      const providerB = await waitForAnalysisReady(cardB, row);
      expect(providerB).toBe(providerA);
      const pointIdB = await firstPointId(cardB, pointId);
      expect(pointIdB).toBe(pointId);
      await expect.poll(() => voteCounts(cardB, pointId).then((value) => value.agree), { timeout: 30_000 }).toBeGreaterThanOrEqual(afterA.agree);
      const beforeB = await voteCounts(cardB, pointId);
      await cardB.getByTestId(`cell-vote-disagree-${pointId}`).click();
      await expect(cardB.getByTestId(`cell-vote-disagree-${pointId}`)).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => voteCounts(cardB, pointId).then((value) => value.disagree), { timeout: 30_000 }).toBeGreaterThan(beforeB.disagree);
      const afterB = await voteCounts(cardB, pointId);
      await attachJson(testInfo, 'daemon-first-feed-vote-b', { pointId, beforeB, afterB });

      await pageA.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      await waitForHeadlines(pageA);
      const cardAReloaded = await openStory(pageA, row);
      const providerAReloaded = await waitForAnalysisReady(cardAReloaded, row);
      expect(providerAReloaded).toBe(providerA);
      await expect(cardAReloaded.getByTestId(`cell-vote-agree-${pointId}`)).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => voteCounts(cardAReloaded, pointId), { timeout: 30_000 }).toEqual({
        agree: afterA.agree,
        disagree: afterB.disagree,
      });

      await attachJson(testInfo, 'daemon-first-feed-integrity-summary', {
        latestCards: latestCards.map((card) => ({ storyId: card.storyId, updatedAt: parseIso(card.meta, 'Updated') })),
        hottestCards: hottestCards.map((card) => ({ storyId: card.storyId, hotness: card.hotness, storyline: storylineKey(card.headline) })),
        bundledStory: { storyId: row.storyId, topicId: row.topicId, providerA, pointId, sourceSummaryTexts },
        votes: { beforeA, afterA, beforeB, afterB },
      });

      await closeStory(pageA, row, cardAReloaded).catch(() => {});
      await closeStory(pageB, row, cardB).catch(() => {});
    } catch (error) {
      if (stack) {
        await attachRuntimeLogs(testInfo, browserLogs, stack);
      }
      throw error;
    } finally {
      await contextB?.close().catch(() => {});
      await contextA?.close().catch(() => {});
      await stopDaemonFirstStack(stack);
    }
  });
});
