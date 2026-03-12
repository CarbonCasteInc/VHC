import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import {
  LIVE_BASE_URL,
  NAV_TIMEOUT_MS,
  SHOULD_RUN,
  FEED_READY_TIMEOUT_MS,
  MIN_HEADLINES,
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
  type BundledStory,
  type HeadlineRow,
} from './daemonFirstFeedHarness';
import { readAuditableBundles, refreshNewsStoreLatest } from './browserNewsStore';
import { waitForMinimumCount } from './feedReadiness';
import type { LiveSemanticAuditBundleLike } from './daemonFirstFeedSemanticAuditTypes';

const ANALYSIS_READY_TIMEOUT_MS = 90_000;
const IDENTITY_BOOTSTRAP_TIMEOUT_MS = 120_000;
const SORT_SAMPLE_SIZE = 6;
const HOTTEST_WINDOW_SIZE = 8;
const HOTTEST_AVERAGE_TOLERANCE = 0.005;
const ZERO_BASELINE_SETTLE_WINDOW_MS = 5_000;
const ZERO_BASELINE_SETTLE_STEP_MS = 500;
const REQUIRED_CARD_COUNT = MIN_HEADLINES;
const BUNDLED_CANDIDATE_LIMIT = 8;
const MAX_BUNDLED_ANALYSIS_CANDIDATES = 4;
const MAX_GENERAL_ANALYSIS_CANDIDATES = 3;
const FIXTURE_FEED_ENABLED = process.env.VH_DAEMON_FEED_USE_FIXTURE_FEED === 'true';
const BUNDLED_ANALYSIS_TIMEOUT_MS = FIXTURE_FEED_ENABLED ? 60_000 : 30_000;

interface VisibleCard extends HeadlineRow {
  readonly hotness: number;
  readonly meta: string;
  readonly sourceBadgeCount: number;
  readonly storylineId: string | null;
}
interface BundledStoryCandidate {
  readonly story: BundledStory;
  readonly bundle: LiveSemanticAuditBundleLike;
}

interface VoteCounts { readonly agree: number; readonly disagree: number; }
interface MeshWriteEvent {
  readonly topic_id: string;
  readonly point_id: string;
  readonly success: boolean;
  readonly timed_out?: boolean;
  readonly latency_ms: number;
  readonly error?: string;
  readonly event_write_ok?: boolean;
  readonly voter_node_ok?: boolean;
  readonly snapshot_ok?: boolean;
  readonly readback_recovered?: boolean;
  readonly observed_at: number;
}
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

function storylineKey(title: string, storylineId?: string | null): string {
  const normalizedStorylineId = storylineId?.trim();
  if (normalizedStorylineId) {
    return normalizedStorylineId;
  }
  const terms = tokenize(title);
  return terms.slice(0, 2).join('+') || title.toLowerCase();
}

function normalizedHeadlineKey(headline: string): string {
  return headline.trim().replace(/\s+/g, ' ').toLowerCase();
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
        storylineId: card.getAttribute('data-storyline-id'),
      };
    })
    .filter((row): row is VisibleCard => Boolean(row && row.topicId && row.storyId && row.headline)));
}

async function gotoFeed(page: Page): Promise<void> {
  await page.goto(LIVE_BASE_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  await waitForHeadlines(page);
}

function attachBrowserLogCapture(page: Page, browserLogs: string[]): void {
  page.on('console', (message) => browserLogs.push(logText(message)));
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
  const relayConfigUrl = new URL('/api/analyze/config', LIVE_BASE_URL).toString();
  const routeReady = await waitFor(async () => {
    const response = await page.request.get(relayConfigUrl, {
      timeout: 5_000,
      failOnStatusCode: false,
    }).catch(() => null);
    if (!response?.ok()) {
      return false;
    }
    const payload = (await response.json().catch(() => null)) as { configured?: boolean } | null;
    return payload?.configured === true;
  }, 15_000, 500);
  if (routeReady) {
    return;
  }

  const healthDot = page.getByTestId('health-indicator-dot');
  await healthDot.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
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

async function bundledStoryCandidates(page: Page, limit = 12): Promise<BundledStoryCandidate[]> {
  const collectVisibleCandidates = async (): Promise<Map<string, BundledStoryCandidate>> => {
    const discovered = new Map<string, BundledStoryCandidate>();
    const auditableBundles = (await readAuditableBundles(page)).slice(0, limit);
    for (const bundle of auditableBundles) {
      const headline = page
        .locator(`[data-testid="news-card-headline-${bundle.topic_id}"][data-story-id="${bundle.story_id}"]`)
        .first();
      if (!(await headline.count())) continue;
      await headline.scrollIntoViewIfNeeded().catch(() => {});
      const headlineText = ((await headline.textContent()) ?? '').trim();
      if (!headlineText) continue;
      const card = headline.locator('xpath=ancestor::article[1]');
      const badgeCount = await card.locator('[data-testid^="source-badge-"]').count();
      if (badgeCount < 2) continue;
      const badgeIds = await card.locator('[data-testid^="source-badge-"]').evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-testid') ?? '').filter(Boolean));
      discovered.set(bundle.story_id, {
        story: {
          storyId: bundle.story_id,
          topicId: bundle.topic_id,
          headline: headlineText,
          sourceBadgeCount: badgeCount,
          sourceBadgeIds: badgeIds,
        },
        bundle,
      });
    }
    return discovered;
  };

  let discovered = await collectVisibleCandidates();
  if (discovered.size === 0) {
    await refreshNewsStoreLatest(page, 120).catch(() => {});
    await page.getByTestId('feed-refresh-button').click().catch(() => {});
    const sentinel = page.getByTestId('feed-load-sentinel');
    if (await sentinel.count().catch(() => 0)) {
      await sentinel.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(1_500);
    }
    await page.waitForTimeout(1_000);
    await waitForHeadlines(page);
    discovered = await collectVisibleCandidates();
  }

  const ordered = [...discovered.values()];
  if (!FIXTURE_FEED_ENABLED) {
    return ordered.slice(0, limit);
  }

  const deduped = new Map<string, BundledStoryCandidate>();
  for (const candidate of ordered) {
    const headlineKey = normalizedHeadlineKey(candidate.story.headline);
    if (!deduped.has(headlineKey)) {
      deduped.set(headlineKey, candidate);
    }
  }

  return [...deduped.values()].slice(0, limit);
}

type PrimarySourcePreflight = {
  readonly ok: boolean;
  readonly detail: string;
};

async function preflightPrimarySources(
  page: Page,
  bundle: LiveSemanticAuditBundleLike,
): Promise<PrimarySourcePreflight> {
  const primarySources = [...(bundle.primary_sources ?? bundle.sources)].slice(0, 2);
  const details: string[] = [];
  for (const source of primarySources) {
    const response = await page.request.get(`${LIVE_BASE_URL}article-text`, {
      params: { url: source.url },
      failOnStatusCode: false,
      timeout: 20_000,
    }).catch((error) => {
      details.push(`${source.source_id}:request-error:${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    if (response?.ok()) {
      return { ok: true, detail: `${source.source_id}:ok` };
    }
    if (!response) {
      continue;
    }
    const body = await response.text().catch(() => '');
    details.push(
      `${source.source_id}:${response.status()}:${body.trim().slice(0, 200) || 'no-body'}`,
    );
  }
  return {
    ok: false,
    detail: details.length > 0 ? details.join('||') : 'no-primary-sources',
  };
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

async function waitForAnalysisReady(card: Locator, row: HeadlineRow, timeoutMs = ANALYSIS_READY_TIMEOUT_MS): Promise<string> {
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
  }, timeoutMs, 500);
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

async function canonicalPointId(card: Locator, pointId: string): Promise<string> {
  const button = card.getByTestId(`cell-vote-agree-${pointId}`).first();
  const canonical = await button.getAttribute('data-canonical-point-id');
  if (!canonical) {
    throw new Error(`missing-canonical-point-id:${pointId}`);
  }
  return canonical;
}

async function displayPointIdForCanonical(
  card: Locator,
  canonicalId: string,
  preferredDisplayPointId?: string,
): Promise<string> {
  if (preferredDisplayPointId) {
    const preferred = card.getByTestId(`cell-vote-agree-${preferredDisplayPointId}`).first();
    if (
      await preferred.count()
      && (await preferred.getAttribute('data-canonical-point-id')) === canonicalId
    ) {
      return preferredDisplayPointId;
    }
  }

  const button = card.locator(
    `[data-testid^="cell-vote-agree-"][data-canonical-point-id="${canonicalId}"]`,
  ).first();
  if (!await button.count()) {
    const availableCanonicalIds = await card.locator('[data-testid^="cell-vote-agree-"]').evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute('data-canonical-point-id') ?? '')
        .filter((value) => value.length > 0));
    throw new Error(
      `missing-display-point-id:${canonicalId}:available=${availableCanonicalIds.join(',')}`,
    );
  }
  const testId = await button.getAttribute('data-testid');
  if (!testId) {
    throw new Error(`missing-display-point-id:${canonicalId}`);
  }
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

async function latestMeshWriteEvent(
  page: Page,
  topicId: string,
  pointId: string,
): Promise<MeshWriteEvent | null> {
  return page.evaluate(({ topicId: expectedTopicId, pointId: expectedPointId }) => {
    const root = window as typeof window & {
      __VH_MESH_WRITE_EVENTS__?: Array<Record<string, unknown>>;
    };
    const events = root.__VH_MESH_WRITE_EVENTS__ ?? [];
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event?.topic_id === expectedTopicId && event?.point_id === expectedPointId) {
        return event as unknown as MeshWriteEvent;
      }
    }
    return null;
  }, { topicId, pointId });
}

async function meshWriteEventsForTopic(
  page: Page,
  topicId: string,
): Promise<MeshWriteEvent[]> {
  return page.evaluate(({ topicId: expectedTopicId }) => {
    const root = window as typeof window & {
      __VH_MESH_WRITE_EVENTS__?: Array<Record<string, unknown>>;
    };
    const events = root.__VH_MESH_WRITE_EVENTS__ ?? [];
    return events.filter((event) => event?.topic_id === expectedTopicId) as unknown as MeshWriteEvent[];
  }, { topicId });
}

async function waitForMeshWriteCompletion(
  page: Page,
  topicId: string,
  pointId: string,
  timeoutMs = 60_000,
): Promise<MeshWriteEvent> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const event = await latestMeshWriteEvent(page, topicId, pointId);
    if (event) {
      return event;
    }
    await page.waitForTimeout(500);
  }
  const topicEvents = await meshWriteEventsForTopic(page, topicId);
  throw new Error(
    `mesh-write-event-missing:${topicId}:${pointId}:events=${JSON.stringify(topicEvents)}`,
  );
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
      let pageA = await contextA.newPage();
      attachBrowserLogCapture(pageA, browserLogs);

      await ensureIdentity(pageA, 'alpha');
      await requireAnalysisRelay(pageA);
      await pageA.evaluate(() => window.scrollTo(0, 0));
      const { latestCards, hottestCards } = await test.step('validate latest and hottest ordering', async () => {
        await waitForMinimumCount({
          page: pageA,
          minCount: REQUIRED_CARD_COUNT,
          timeoutMs: FEED_READY_TIMEOUT_MS,
          readCount: async () => (await visibleCards(pageA)).length,
        });
        const latest = (await visibleCards(pageA)).slice(0, SORT_SAMPLE_SIZE);
        expect(latest.length).toBeGreaterThanOrEqual(REQUIRED_CARD_COUNT);
        for (let i = 1; i < latest.length; i += 1) {
          expect(parseIso(latest[i - 1]!.meta, 'Updated')).toBeGreaterThanOrEqual(parseIso(latest[i]!.meta, 'Updated'));
        }

        await pageA.getByTestId('sort-mode-HOTTEST').click();
        await sleep(750);
        await waitForMinimumCount({
          page: pageA,
          minCount: REQUIRED_CARD_COUNT,
          timeoutMs: FEED_READY_TIMEOUT_MS,
          readCount: async () => (await visibleCards(pageA)).length,
        });
        const hottest = (await visibleCards(pageA)).slice(0, HOTTEST_WINDOW_SIZE);
        expect(hottest.length).toBeGreaterThanOrEqual(REQUIRED_CARD_COUNT);
        const firstHalf = hottest.slice(0, Math.ceil(hottest.length / 2));
        const secondHalf = hottest.slice(Math.ceil(hottest.length / 2));
        const avg = (items: VisibleCard[]) => items.reduce((sum, item) => sum + item.hotness, 0) / Math.max(1, items.length);
        const orderingSummary = {
          latest,
          hottest,
          hottestFirstHalfAverage: avg(firstHalf),
          hottestSecondHalfAverage: avg(secondHalf),
        };
        const storylineCounts = hottest.reduce<Record<string, number>>((acc, card) => {
          const key = storylineKey(card.headline, card.storylineId);
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {});
        console.log(
          '[vh:test:ordering]',
          JSON.stringify({
            hottest: hottest.map((card) => ({
              storyId: card.storyId,
              headline: card.headline,
              storylineId: card.storylineId,
              hotness: card.hotness,
              storylineKey: storylineKey(card.headline, card.storylineId),
            })),
            storylineCounts,
            hottestFirstHalfAverage: orderingSummary.hottestFirstHalfAverage,
            hottestSecondHalfAverage: orderingSummary.hottestSecondHalfAverage,
          }),
        );
        await attachJson(testInfo, 'daemon-first-feed-ordering', orderingSummary);
        expect(
          orderingSummary.hottestFirstHalfAverage + HOTTEST_AVERAGE_TOLERANCE,
        ).toBeGreaterThanOrEqual(orderingSummary.hottestSecondHalfAverage);
        expect(Math.max(...Object.values(storylineCounts))).toBeLessThanOrEqual(2);
        await pageA.getByTestId('sort-mode-LATEST').click();
        await sleep(500);
        return { latestCards: latest, hottestCards: hottest };
      });

      const { bundledStory, row, cardA, providerA, pointId, canonicalPointId: pointCanonicalId, sourceSummaryTexts } = await test.step('open bundled story and verify analysis readiness', async () => {
        const seedStory = await findBundledStory(pageA, BUNDLED_CANDIDATE_LIMIT);
        expect(seedStory.sourceBadgeCount).toBeGreaterThanOrEqual(2);
        const seen = new Set<string>();
        const discoveredCandidates = await bundledStoryCandidates(pageA, BUNDLED_CANDIDATE_LIMIT);
        const seedCandidate = discoveredCandidates.find((candidate) => candidate.story.storyId === seedStory.storyId);
        const candidates = seedCandidate
          ? [...discoveredCandidates].sort((left, right) =>
              left.story.storyId === seedStory.storyId ? -1 : right.story.storyId === seedStory.storyId ? 1 : 0)
          : [{
              story: seedStory,
              bundle: {
                story_id: seedStory.storyId,
                topic_id: seedStory.topicId,
                headline: seedStory.headline,
                sources: [],
                primary_sources: [],
                secondary_assets: [],
              },
            }, ...discoveredCandidates]
          .slice(0, MAX_BUNDLED_ANALYSIS_CANDIDATES);
        const failures: Array<{ storyId: string; headline: string; error: string }> = [];

        for (const candidate of candidates) {
          if (seen.has(candidate.story.storyId)) {
            continue;
          }
          seen.add(candidate.story.storyId);
          const primarySourcePreflight = await preflightPrimarySources(pageA, candidate.bundle);
          if (!primarySourcePreflight.ok) {
            failures.push({
              storyId: candidate.story.storyId,
              headline: candidate.story.headline,
              error: `article-text-preflight-failed:${primarySourcePreflight.detail}`,
            });
            continue;
          }
          const candidateRow = (await headlineRows(pageA)).find((item) => item.storyId === candidate.story.storyId) ?? candidate.story;
          const card = await openStory(pageA, candidateRow);
          try {
            const provider = await waitForAnalysisReady(card, candidateRow, BUNDLED_ANALYSIS_TIMEOUT_MS);
            const sourceSummaries = card.locator(`[data-testid="news-card-analysis-source-summaries-${candidateRow.topicId}"] li`);
            await expect.poll(() => sourceSummaries.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
            const summaries = (await sourceSummaries.allTextContents()).map((value) => value.trim()).filter(Boolean);
            const cardSummaryText = ((await card.getByTestId(`news-card-summary-${candidateRow.topicId}`).textContent()) ?? '').trim();
            expect(summaries.length).toBeGreaterThanOrEqual(1);
            expect(summaries.length).toBeLessThanOrEqual(candidate.story.sourceBadgeCount);
            const semanticallyAnchored = summaries.filter((value) =>
              overlapCount(value, candidateRow.headline) > 0 || overlapCount(value, cardSummaryText) > 0,
            );
            expect(semanticallyAnchored.length).toBeGreaterThanOrEqual(1);
            if (summaries.length >= 2) {
              expect(new Set(summaries.map((value) => value.split(':', 1)[0]?.trim() ?? '')).size).toBeGreaterThanOrEqual(2);
            }
            const selectedPointId = await zeroBaselinePointId(card);
            await attachJson(testInfo, 'daemon-first-feed-analysis-a', {
              bundledStory: candidate.story,
              provider,
              sourceSummaryTexts: summaries,
              sourceBadgeIds: candidate.story.sourceBadgeIds,
              pointId: selectedPointId,
              canonicalPointId: await canonicalPointId(card, selectedPointId),
              rejectedCandidates: failures,
            });
            return {
              bundledStory: candidate.story,
              row: candidateRow,
              cardA: card,
              providerA: provider,
              pointId: selectedPointId,
              canonicalPointId: await canonicalPointId(card, selectedPointId),
              sourceSummaryTexts: summaries,
            };
          } catch (error) {
            failures.push({
              storyId: candidate.story.storyId,
              headline: candidate.story.headline,
              error: error instanceof Error ? error.message : String(error),
            });
            await closeStory(pageA, candidateRow, card).catch(() => {});
          }
        }

        const generalCandidates = process.env.VH_DAEMON_FEED_USE_FIXTURE_FEED === 'true'
          ? []
          : (await headlineRows(pageA))
          .filter((candidate) => !seen.has(candidate.storyId))
          .slice(0, MAX_GENERAL_ANALYSIS_CANDIDATES);

        for (const candidateRow of generalCandidates) {
          seen.add(candidateRow.storyId);
          const card = await openStory(pageA, candidateRow);
          try {
            const provider = await waitForAnalysisReady(card, candidateRow, BUNDLED_ANALYSIS_TIMEOUT_MS);
            const sourceSummaries = card.locator(`[data-testid="news-card-analysis-source-summaries-${candidateRow.topicId}"] li`);
            await expect.poll(() => sourceSummaries.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
            const summaries = (await sourceSummaries.allTextContents()).map((value) => value.trim()).filter(Boolean);
            const cardSummaryText = ((await card.getByTestId(`news-card-summary-${candidateRow.topicId}`).textContent()) ?? '').trim();
            const badgeCount = await card.locator('[data-testid^="source-badge-"]').count();
            expect(summaries.length).toBeGreaterThanOrEqual(1);
            expect(summaries.length).toBeLessThanOrEqual(Math.max(1, badgeCount));
            const semanticallyAnchored = summaries.filter((value) =>
              overlapCount(value, candidateRow.headline) > 0 || overlapCount(value, cardSummaryText) > 0,
            );
            expect(semanticallyAnchored.length).toBeGreaterThanOrEqual(1);
            const selectedPointId = await zeroBaselinePointId(card);
            const fallbackStory: BundledStory = {
              storyId: candidateRow.storyId,
              topicId: candidateRow.topicId,
              headline: candidateRow.headline,
              sourceBadgeCount: badgeCount,
              sourceBadgeIds: await card.locator('[data-testid^="source-badge-"]').evaluateAll((nodes) =>
                nodes.map((node) => node.getAttribute('data-testid') ?? '').filter(Boolean)),
            };
            await attachJson(testInfo, 'daemon-first-feed-analysis-a', {
              bundledStory: fallbackStory,
              provider,
              sourceSummaryTexts: summaries,
              sourceBadgeIds: fallbackStory.sourceBadgeIds,
              pointId: selectedPointId,
              canonicalPointId: await canonicalPointId(card, selectedPointId),
              rejectedCandidates: failures,
              fallbackMode: 'general-story',
            });
            return {
              bundledStory: fallbackStory,
              row: candidateRow,
              cardA: card,
              providerA: provider,
              pointId: selectedPointId,
              canonicalPointId: await canonicalPointId(card, selectedPointId),
              sourceSummaryTexts: summaries,
            };
          } catch (error) {
            failures.push({
              storyId: candidateRow.storyId,
              headline: candidateRow.headline,
              error: error instanceof Error ? error.message : String(error),
            });
            await closeStory(pageA, candidateRow, card).catch(() => {});
          }
        }

        await attachJson(testInfo, 'daemon-first-feed-analysis-a-failures', { candidates, failures });
        throw new Error(`no-analysis-ready-bundled-story:${failures.map((failure) => `${failure.storyId}:${failure.error}`).join('|')}`);
      });

      const beforeA = await voteCounts(cardA, pointId);
      await cardA.getByTestId(`cell-vote-agree-${pointId}`).click();
      await expect(cardA.getByTestId(`cell-vote-agree-${pointId}`)).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => voteCounts(cardA, pointId).then((value) => value.agree), { timeout: 30_000 }).toBeGreaterThan(beforeA.agree);
      const afterA = await voteCounts(cardA, pointId);
      const meshWriteA = await waitForMeshWriteCompletion(pageA, row.topicId, pointCanonicalId);
      expect(meshWriteA.success).toBe(true);
      expect(meshWriteA.voter_node_ok).toBe(true);
      expect(meshWriteA.snapshot_ok).toBe(true);
      await attachJson(testInfo, 'daemon-first-feed-vote-a', {
        pointId,
        canonicalPointId: pointCanonicalId,
        beforeA,
        afterA,
        meshWriteA,
      });

      contextB = await browser.newContext({ ignoreHTTPSErrors: true });
      await addConsumerInitScript(contextB);
      const pageB = await contextB.newPage();
      attachBrowserLogCapture(pageB, browserLogs);
      await ensureIdentity(pageB, 'beta');
      await requireAnalysisRelay(pageB);
      const cardB = await openStory(pageB, row);
      const providerB = await waitForAnalysisReady(cardB, row);
      expect(providerB).toBe(providerA);
      const pointIdB = await displayPointIdForCanonical(cardB, pointCanonicalId, pointId);
      expect(await canonicalPointId(cardB, pointIdB)).toBe(pointCanonicalId);
      await expect.poll(() => voteCounts(cardB, pointIdB).then((value) => value.agree), { timeout: 30_000 }).toBeGreaterThanOrEqual(afterA.agree);
      const beforeB = await voteCounts(cardB, pointIdB);
      await cardB.getByTestId(`cell-vote-disagree-${pointIdB}`).click();
      await expect(cardB.getByTestId(`cell-vote-disagree-${pointIdB}`)).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => voteCounts(cardB, pointIdB).then((value) => value.disagree), { timeout: 30_000 }).toBeGreaterThan(beforeB.disagree);
      const afterB = await voteCounts(cardB, pointIdB);
      await attachJson(testInfo, 'daemon-first-feed-vote-b', {
        pointId: pointIdB,
        canonicalPointId: pointCanonicalId,
        beforeB,
        afterB,
      });

      await pageA.close().catch(() => {});
      pageA = await contextA.newPage();
      attachBrowserLogCapture(pageA, browserLogs);
      await gotoFeed(pageA);
      const cardAReloaded = await openStory(pageA, row);
      const providerAReloaded = await waitForAnalysisReady(cardAReloaded, row);
      expect(providerAReloaded).toBe(providerA);
      const pointIdAReloaded = await displayPointIdForCanonical(cardAReloaded, pointCanonicalId, pointId);
      await expect(cardAReloaded.getByTestId(`cell-vote-agree-${pointIdAReloaded}`)).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => voteCounts(cardAReloaded, pointIdAReloaded), { timeout: 30_000 }).toEqual({
        agree: afterA.agree,
        disagree: afterB.disagree,
      });

      await attachJson(testInfo, 'daemon-first-feed-integrity-summary', {
        latestCards: latestCards.map((card) => ({ storyId: card.storyId, updatedAt: parseIso(card.meta, 'Updated') })),
        hottestCards: hottestCards.map((card) => ({
          storyId: card.storyId,
          hotness: card.hotness,
          storyline: storylineKey(card.headline, card.storylineId),
        })),
        bundledStory: {
          storyId: row.storyId,
          topicId: row.topicId,
          providerA,
          pointId,
          canonicalPointId: pointCanonicalId,
          pointIdB,
          pointIdAReloaded,
          sourceSummaryTexts,
        },
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
