import { test, expect, type Browser, type BrowserContext, type ConsoleMessage, type Locator, type Page } from '@playwright/test';

const LIVE_BASE_URL = process.env.VH_LIVE_BASE_URL ?? 'https://ccibootstrap.tail6cc9b5.ts.net/';
const SHOULD_RUN_LIVE = process.env.VH_RUN_LIVE_MATRIX === 'true';
const DEFAULT_TOPIC_LIMIT = 8;
const TOPIC_LIMIT = Number.isFinite(Number(process.env.VH_LIVE_MATRIX_TOPICS))
  ? Math.max(1, Math.floor(Number(process.env.VH_LIVE_MATRIX_TOPICS)))
  : DEFAULT_TOPIC_LIMIT;
const REQUIRE_FULL_CONVERGENCE = process.env.VH_LIVE_MATRIX_REQUIRE_FULL === 'true';
const MIN_CONVERGED = Number.isFinite(Number(process.env.VH_LIVE_MATRIX_MIN_CONVERGED))
  ? Math.max(0, Math.floor(Number(process.env.VH_LIVE_MATRIX_MIN_CONVERGED)))
  : (REQUIRE_FULL_CONVERGENCE ? TOPIC_LIMIT : 1);
const FEED_READY_ATTEMPTS = Number.isFinite(Number(process.env.VH_LIVE_FEED_READY_ATTEMPTS))
  ? Math.max(1, Math.floor(Number(process.env.VH_LIVE_FEED_READY_ATTEMPTS)))
  : 3;
const FEED_READY_TIMEOUT_MS = Number.isFinite(Number(process.env.VH_LIVE_FEED_READY_TIMEOUT_MS))
  ? Math.max(5_000, Math.floor(Number(process.env.VH_LIVE_FEED_READY_TIMEOUT_MS)))
  : 30_000;
const CANDIDATE_POOL_MULTIPLIER = Number.isFinite(Number(process.env.VH_LIVE_CANDIDATE_POOL_MULTIPLIER))
  ? Math.max(1, Math.floor(Number(process.env.VH_LIVE_CANDIDATE_POOL_MULTIPLIER)))
  : 4;
const PREFLIGHT_SETTLE_MS = Number.isFinite(Number(process.env.VH_LIVE_PREFLIGHT_SETTLE_MS))
  ? Math.max(0, Math.floor(Number(process.env.VH_LIVE_PREFLIGHT_SETTLE_MS)))
  : 2_000;
const MAX_SCAN_SIZE = Number.isFinite(Number(process.env.VH_LIVE_MAX_SCAN_SIZE))
  ? Math.max(1, Math.floor(Number(process.env.VH_LIVE_MAX_SCAN_SIZE)))
  : TOPIC_LIMIT * CANDIDATE_POOL_MULTIPLIER;
const SCROLL_PASSES = Number.isFinite(Number(process.env.VH_LIVE_SCROLL_PASSES))
  ? Math.max(0, Math.floor(Number(process.env.VH_LIVE_SCROLL_PASSES)))
  : 3;
const NAV_TIMEOUT_MS = Number.isFinite(Number(process.env.VH_LIVE_NAV_TIMEOUT_MS))
  ? Math.max(10_000, Math.floor(Number(process.env.VH_LIVE_NAV_TIMEOUT_MS)))
  : 90_000;
const READINESS_BUDGET_MS = Number.isFinite(Number(process.env.VH_LIVE_READINESS_BUDGET_MS))
  ? Math.max(30_000, Math.floor(Number(process.env.VH_LIVE_READINESS_BUDGET_MS)))
  : 5 * 60_000;
const PER_CANDIDATE_BUDGET_MS = Number.isFinite(Number(process.env.VH_LIVE_PER_CANDIDATE_BUDGET_MS))
  ? Math.max(5_000, Math.floor(Number(process.env.VH_LIVE_PER_CANDIDATE_BUDGET_MS)))
  : 30_000;

const TELEMETRY_TAGS = [
  '[vh:aggregate:voter-write]',
  '[vh:vote:voter-node-readback]',
  '[vh:aggregate:point-snapshot-write]',
  '[vh:aggregate:read]',
  '[vh:vote:intent-replay]',
] as const;

type Actor = 'A' | 'B';

type TopicRow = {
  readonly topicId: string;
  readonly storyId: string;
  readonly headline: string;
};

type VoteCounts = {
  readonly agreeText: string;
  readonly disagreeText: string;
  readonly agree: number;
  readonly disagree: number;
};

type MatrixRow = {
  readonly topicId: string;
  readonly storyId: string;
  readonly headline: string;
  readonly startedAt: string;
  votedPointId: string | null;
  bPointId: string | null;
  bMatchedA: boolean | null;
  aAfterClick: VoteCounts | null;
  bObserved: VoteCounts | null;
  bObservedAfterReload: VoteCounts | null;
  converged: boolean;
  reason: string | null;
  failureClass: 'convergence' | 'harness' | null;
};

type TelemetryEvent = {
  readonly ts: string;
  readonly actor: Actor;
  readonly level: string;
  readonly text: string;
  readonly args: ReadonlyArray<unknown>;
};

type PreflightSummary = {
  readonly candidatesDiscovered: number;
  readonly candidatesScanned: number;
  readonly voteCapableFound: number;
  readonly voteCapableRequired: number;
  readonly exhaustedBudget: boolean;
  readonly budgetMs: number;
  readonly elapsedMs: number;
  readonly rejects: ReadonlyArray<PreflightReject>;
  readonly rejectReasonCounts: Record<string, number>;
};

type SummaryPacket = {
  readonly baseUrl: string;
  readonly verdict: 'pass' | 'fail' | 'blocked_setup_scarcity';
  readonly tested: number;
  readonly converged: number;
  readonly failed: number;
  readonly harnessFailed: number;
  readonly at: string;
  readonly preflight: PreflightSummary | null;
  readonly matrix: ReadonlyArray<MatrixRow>;
  readonly telemetry: Record<string, { count: number }>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseVoteText(text: string, symbol: '+' | '-'): number {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const regex = symbol === '+' ? /\+\s*(\d+)/ : /-\s*(\d+)/;
  const match = normalized.match(regex);
  if (!match) return 0;
  const value = Number.parseInt(match[1] ?? '0', 10);
  return Number.isFinite(value) ? value : 0;
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs: number, stepMs = 250): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await condition()) {
      return true;
    }
    await sleep(stepMs);
  }
  return false;
}

function isHarnessNoiseReason(reason: string): boolean {
  return (
    reason.startsWith('feed-not-ready:')
    || reason.startsWith('headline-not-found:')
    || reason.startsWith('identity-bootstrap-timeout')
    || reason.startsWith('vote-capable-preflight-failed:')
    || reason.startsWith('blocked-setup-scarcity:')
    || reason.startsWith('A:no-vote-buttons')
    || reason.startsWith('B:no-vote-buttons')
    || reason.startsWith('B-reload:no-vote-buttons')
    || reason.startsWith('locator.')
    || reason.includes('Target page, context or browser has been closed')
    || reason.includes('Test ended.')
  );
}

function classifyFailure(reason: string | null): MatrixRow['failureClass'] {
  if (!reason) {
    return null;
  }
  return isHarnessNoiseReason(reason) ? 'harness' : 'convergence';
}

async function createRuntimeRoleContext(
  browser: Browser,
  role: 'ingester' | 'consumer',
  testSession: boolean,
): Promise<BrowserContext> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.addInitScript(({ runtimeRole, isTestSession }) => {
    const testWindow = window as unknown as {
      __VH_NEWS_RUNTIME_ROLE?: string;
      __VH_TEST_SESSION?: boolean;
    };
    testWindow.__VH_NEWS_RUNTIME_ROLE = runtimeRole;
    testWindow.__VH_TEST_SESSION = isTestSession;
  }, { runtimeRole: role, isTestSession: testSession });
  return context;
}

async function gotoFeed(page: Page): Promise<void> {
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= FEED_READY_ATTEMPTS; attempt += 1) {
    await page.goto(LIVE_BASE_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await page.waitForTimeout(750);

    const vennLink = page.getByRole('link', { name: 'VENN' });
    if (await vennLink.count()) {
      const first = vennLink.first();
      if (await first.isVisible().catch(() => false)) {
        await first.click().catch(() => {});
        await page.waitForTimeout(500);
      }
    }

    const ready = await waitFor(
      async () => (await page.locator('[data-testid^="news-card-headline-"]').count()) > 0,
      FEED_READY_TIMEOUT_MS,
      400,
    );

    if (ready) {
      return;
    }

    lastError = `feed-not-ready: no news-card-headline nodes found (attempt ${attempt}/${FEED_READY_ATTEMPTS})`;
    await page.waitForTimeout(750);
  }

  throw new Error(lastError ?? 'feed-not-ready: unknown');
}

async function ensureIdentity(page: Page, label: string): Promise<void> {
  const openDashboard = async (): Promise<void> => {
    await page.goto(LIVE_BASE_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await page.waitForTimeout(1_000);

    const loading = page.getByText('Loading Mesh…');
    if (await loading.count()) {
      await loading.first().waitFor({ state: 'hidden', timeout: 35_000 }).catch(() => {});
    }

    const userLink = page.getByTestId('user-link');
    await userLink.waitFor({ state: 'visible', timeout: 35_000 });
    await userLink.click();
    await page.waitForURL('**/dashboard', { timeout: 35_000 });
    await page.waitForTimeout(400);
  };

  const waitForIdentityHydrated = async (timeoutMs: number): Promise<boolean> => {
    try {
      await page.waitForFunction(
        () => Boolean((window as Window & { __vh_identity_published?: unknown }).__vh_identity_published),
        undefined,
        { timeout: timeoutMs },
      );
      return true;
    } catch {
      return false;
    }
  };

  await openDashboard();

  const welcome = page.getByTestId('welcome-msg');
  const joinBtn = page.getByTestId('create-identity-btn');
  const deadline = Date.now() + 120_000;
  let attempts = 0;

  while (Date.now() < deadline) {
    const welcomeVisible = (await welcome.count()) > 0 && await welcome.isVisible().catch(() => false);
    if (welcomeVisible || await waitForIdentityHydrated(2_000)) {
      break;
    }

    const canJoin = (await joinBtn.count()) > 0 && await joinBtn.isVisible().catch(() => false);
    if (canJoin) {
      attempts += 1;
      const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`;
      const username = `${label}${suffix}`.slice(0, 24);
      const handle = username.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 24);

      await page.fill('input[placeholder="Choose a username"]', username);
      await page.fill('input[placeholder="Choose a handle (letters, numbers, _)"]', handle || `u${suffix}`);
      await joinBtn.click();

      const joined = await waitFor(async () => {
        const visible = (await welcome.count()) > 0 && await welcome.isVisible().catch(() => false);
        if (visible) return true;
        return waitForIdentityHydrated(250);
      }, 25_000, 500);

      if (joined || attempts >= 4) {
        break;
      }
    }

    await openDashboard();
  }

  const welcomeVisible = (await welcome.count()) > 0 && await welcome.isVisible().catch(() => false);
  const hydrated = await waitForIdentityHydrated(5_000);
  if (!welcomeVisible && !hydrated) {
    throw new Error('identity-bootstrap-timeout');
  }

  await gotoFeed(page);
}

async function getTopicRows(page: Page): Promise<ReadonlyArray<TopicRow>> {
  const rows = await page.evaluate<ReadonlyArray<TopicRow>>(() => {
    const out: TopicRow[] = [];
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="news-card-headline-"]'));
    for (const node of nodes) {
      const testId = node.getAttribute('data-testid') || '';
      const topicId = testId.replace('news-card-headline-', '');
      const storyId =
        node.getAttribute('data-story-id')
        ?? node.closest<HTMLElement>('[data-story-id]')?.getAttribute('data-story-id')
        ?? '';
      const headline = (node.textContent || '').trim();
      if (!topicId || !storyId || !headline) {
        continue;
      }
      out.push({ topicId, storyId, headline });
    }
    return out;
  });

  const dedup: TopicRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.storyId)) continue;
    seen.add(row.storyId);
    dedup.push(row);
  }
  return dedup;
}

async function discoverTopicsByScrolling(
  page: Page,
  maxCandidates: number,
): Promise<ReadonlyArray<TopicRow>> {
  const seen = new Set<string>();
  const all: TopicRow[] = [];

  const collect = async (): Promise<void> => {
    const rows = await getTopicRows(page);
    for (const row of rows) {
      if (seen.has(row.storyId)) continue;
      seen.add(row.storyId);
      all.push(row);
    }
  };

  // Collect from initial viewport
  await collect();

  // Scroll down in passes to reveal more topics
  for (let pass = 0; pass < SCROLL_PASSES && all.length < maxCandidates; pass += 1) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await page.waitForTimeout(1_200);
    await collect();
  }

  // Scroll back to top so the page is in a clean state
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);

  return all.slice(0, maxCandidates);
}

async function findHeadlineLocator(page: Page, row: TopicRow): Promise<Locator | null> {
  const escapedStoryId = row.storyId.replace(/"/g, '\\"');
  const byStoryId = page.locator(
    `[data-testid^="news-card-headline-"][data-story-id="${escapedStoryId}"]`,
  );
  if (await byStoryId.count()) {
    return byStoryId.first();
  }

  const candidates = page.locator(`[data-testid="news-card-headline-${row.topicId}"]`);
  const count = await candidates.count();

  for (let i = 0; i < count; i += 1) {
    const candidate = candidates.nth(i);
    const text = ((await candidate.textContent()) ?? '').trim();
    const candidateStoryId = (await candidate.getAttribute('data-story-id')) ?? '';
    if (candidateStoryId === row.storyId || text === row.headline) {
      return candidate;
    }
  }

  for (let i = 0; i < count; i += 1) {
    const candidate = candidates.nth(i);
    const text = ((await candidate.textContent()) ?? '').trim();
    if (text.includes(row.headline) || row.headline.includes(text)) {
      return candidate;
    }
  }

  return null;
}

async function openTopic(page: Page, row: TopicRow): Promise<Locator> {
  let headline = await findHeadlineLocator(page, row);

  // If the headline wasn't found in the current viewport, scroll down in
  // bounded passes to bring below-fold topics into the DOM before giving up.
  if (!headline) {
    for (let pass = 0; pass < SCROLL_PASSES; pass += 1) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await page.waitForTimeout(1_200);
      headline = await findHeadlineLocator(page, row);
      if (headline) break;
    }
  }

  if (!headline) {
    throw new Error(`headline-not-found:${row.storyId}`);
  }

  await headline.scrollIntoViewIfNeeded({ timeout: 10_000 });
  await headline.waitFor({ state: 'visible', timeout: 20_000 });
  const card = headline.locator('xpath=ancestor::article[1]');
  await headline.click();
  await card.locator('[data-testid^="news-card-back-"]').first().waitFor({ state: 'visible', timeout: 20_000 });
  return card;
}

async function closeTopic(page: Page, card: Locator): Promise<void> {
  const backButton = card.locator('[data-testid^="news-card-back-button-"]');
  if (await backButton.count()) {
    const first = backButton.first();
    if (await first.isVisible().catch(() => false)) {
      await first.click().catch(() => {});
      await page.waitForTimeout(250);
      return;
    }
  }

  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(250);
}

type ResolvedPoint =
  | { found: true; pointId: string; matchedPreferred: boolean }
  | { found: false; reason: string };

async function resolvePointInCard(card: Locator, preferredPointId: string | null = null): Promise<ResolvedPoint> {
  const buttons = card.locator('[data-testid^="cell-vote-agree-"]');
  const hasButtons = await waitFor(async () => (await buttons.count()) > 0, 20_000, 300);
  if (!hasButtons) {
    return { found: false, reason: 'no-vote-buttons' };
  }

  if (preferredPointId) {
    const preferred = card.getByTestId(`cell-vote-agree-${preferredPointId}`);
    if (await preferred.count()) {
      return { found: true, pointId: preferredPointId, matchedPreferred: true };
    }
  }

  const first = buttons.first();
  const testId = await first.getAttribute('data-testid');
  if (!testId) {
    return { found: false, reason: 'missing-point-testid' };
  }

  return {
    found: true,
    pointId: testId.replace('cell-vote-agree-', ''),
    matchedPreferred: false,
  };
}

type PreflightReject = {
  readonly storyId: string;
  readonly headline: string;
  readonly reason: string;
};

type PreflightResult = {
  readonly ready: ReadonlyArray<TopicRow>;
  readonly rejects: ReadonlyArray<PreflightReject>;
  readonly exhaustedBudget: boolean;
};

async function collectVoteCapableRows(
  page: Page,
  candidates: ReadonlyArray<TopicRow>,
  requiredCount: number,
  budgetMs: number,
): Promise<PreflightResult> {
  const ready: TopicRow[] = [];
  const rejects: PreflightReject[] = [];
  const seen = new Set<string>();
  const budgetDeadline = Date.now() + budgetMs;
  let exhaustedBudget = false;

  for (const row of candidates) {
    if (ready.length >= requiredCount) {
      break;
    }

    if (Date.now() >= budgetDeadline) {
      exhaustedBudget = true;
      break;
    }

    if (seen.has(row.storyId)) {
      continue;
    }
    seen.add(row.storyId);

    let card: Locator | null = null;

    try {
      const candidateDeadline = Math.min(Date.now() + PER_CANDIDATE_BUDGET_MS, budgetDeadline);
      card = await openTopic(page, row);
      if (PREFLIGHT_SETTLE_MS > 0) {
        await page.waitForTimeout(PREFLIGHT_SETTLE_MS);
      }

      if (Date.now() >= candidateDeadline) {
        rejects.push({ storyId: row.storyId, headline: row.headline, reason: 'per-candidate-timeout' });
        await closeTopic(page, card).catch(() => {});
        card = null;
        continue;
      }

      const point = await resolvePointInCard(card);
      if (point.found) {
        ready.push(row);
      } else {
        rejects.push({ storyId: row.storyId, headline: row.headline, reason: point.reason });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      rejects.push({ storyId: row.storyId, headline: row.headline, reason });
    } finally {
      if (card) {
        await closeTopic(page, card).catch(() => {});
      }
    }
  }

  return { ready, rejects, exhaustedBudget };
}

async function readCounts(card: Locator, pointId: string): Promise<VoteCounts> {
  const agreeText = (await card.getByTestId(`cell-vote-agree-${pointId}`).textContent())?.trim() ?? '';
  const disagreeText = (await card.getByTestId(`cell-vote-disagree-${pointId}`).textContent())?.trim() ?? '';

  return {
    agreeText,
    disagreeText,
    agree: parseVoteText(agreeText, '+'),
    disagree: parseVoteText(disagreeText, '-'),
  };
}

function attachTelemetry(page: Page, actor: Actor, sink: TelemetryEvent[]): void {
  page.on('console', async (msg: ConsoleMessage) => {
    const text = msg.text();
    if (!TELEMETRY_TAGS.some((tag) => text.includes(tag))) {
      return;
    }

    let args: unknown[] = [];
    try {
      args = await Promise.all(msg.args().map(async (arg) => {
        try {
          return await arg.jsonValue();
        } catch {
          return String(arg);
        }
      }));
    } catch {
      args = [];
    }

    sink.push({
      ts: new Date().toISOString(),
      actor,
      level: msg.type(),
      text,
      args,
    });
  });

  page.on('pageerror', (error: Error) => {
    sink.push({
      ts: new Date().toISOString(),
      actor,
      level: 'pageerror',
      text: String(error.message),
      args: [],
    });
  });
}

function summarizeTelemetry(events: ReadonlyArray<TelemetryEvent>): Record<string, { count: number }> {
  const summary: Record<string, { count: number }> = {};
  for (const tag of TELEMETRY_TAGS) {
    summary[tag] = {
      count: events.filter((event) => event.text.includes(tag)).length,
    };
  }
  return summary;
}

test.describe('live mesh convergence', () => {
  test.skip(!SHOULD_RUN_LIVE, 'Set VH_RUN_LIVE_MATRIX=true to run the live convergence matrix');

  test('A->B bias vote aggregate convergence across live matrix', async ({ browser }, testInfo) => {
    test.setTimeout(15 * 60_000);
    const ingesterContext = await createRuntimeRoleContext(browser, 'ingester', false);
    const contextA = await createRuntimeRoleContext(browser, 'consumer', true);
    const contextB = await createRuntimeRoleContext(browser, 'consumer', true);
    const ingesterPage = await ingesterContext.newPage();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    const telemetryEvents: TelemetryEvent[] = [];
    attachTelemetry(pageA, 'A', telemetryEvents);
    attachTelemetry(pageB, 'B', telemetryEvents);

    const matrix: MatrixRow[] = [];
    let preflightSummary: PreflightSummary | null = null;
    let verdict: SummaryPacket['verdict'] = 'fail';

    try {
      let setupFailureReason: string | null = null;

      try {
        // ── Phase 1: Readiness ──────────────────────────────────────────
        const readinessStart = Date.now();

        await gotoFeed(ingesterPage);
        await ensureIdentity(pageA, 'AliceLive');
        await ensureIdentity(pageB, 'BobLive');

        await gotoFeed(pageA);

        const candidatePool = await discoverTopicsByScrolling(pageA, MAX_SCAN_SIZE);

        const remainingReadinessBudget = Math.max(
          30_000,
          READINESS_BUDGET_MS - (Date.now() - readinessStart),
        );
        const preflight = await collectVoteCapableRows(
          pageA,
          candidatePool,
          TOPIC_LIMIT,
          remainingReadinessBudget,
        );

        const rejectReasonCounts: Record<string, number> = {};
        for (const reject of preflight.rejects) {
          rejectReasonCounts[reject.reason] = (rejectReasonCounts[reject.reason] ?? 0) + 1;
        }

        preflightSummary = {
          candidatesDiscovered: candidatePool.length,
          candidatesScanned: preflight.ready.length + preflight.rejects.length,
          voteCapableFound: preflight.ready.length,
          voteCapableRequired: TOPIC_LIMIT,
          exhaustedBudget: preflight.exhaustedBudget,
          budgetMs: remainingReadinessBudget,
          elapsedMs: Date.now() - readinessStart,
          rejects: preflight.rejects,
          rejectReasonCounts,
        };

        // Locked candidate set — frozen after readiness, used for all convergence checks
        const selected: ReadonlyArray<TopicRow> = preflight.ready;

        if (selected.length < TOPIC_LIMIT) {
          const tag = preflight.exhaustedBudget ? 'budget-exhausted' : 'insufficient-candidates';
          throw new Error(
            `blocked-setup-scarcity:${selected.length}/${TOPIC_LIMIT} (${tag}, `
            + `discovered=${candidatePool.length}, scanned=${preflightSummary.candidatesScanned}, `
            + `rejects=${preflight.rejects.length})`,
          );
        }

        // ── Phase 2: Convergence ────────────────────────────────────────
        // Navigate to feed once per page; topics are opened/closed in-place
        // against the locked candidate set without per-topic reloads.
        await gotoFeed(pageA);
        await gotoFeed(pageB);

        for (const row of selected) {
          const result: MatrixRow = {
            topicId: row.topicId,
            storyId: row.storyId,
            headline: row.headline,
            startedAt: new Date().toISOString(),
            votedPointId: null,
            bPointId: null,
            bMatchedA: null,
            aAfterClick: null,
            bObserved: null,
            bObservedAfterReload: null,
            converged: false,
            reason: null,
            failureClass: null,
          };

          try {
            const cardA = await openTopic(pageA, row);
            const pointA = await resolvePointInCard(cardA);
            if (!pointA.found) {
              result.reason = `A:${pointA.reason}`;
              await closeTopic(pageA, cardA);
              result.failureClass = classifyFailure(result.reason);
              matrix.push(result);
              continue;
            }

            result.votedPointId = pointA.pointId;
            await cardA.getByTestId(`cell-vote-agree-${pointA.pointId}`).click({ timeout: 10_000 });
            // Allow mesh projection (writeVoterNode, writeSentimentEvent) to
            // complete and begin replicating before B opens the topic.
            await pageA.waitForTimeout(3_000);
            result.aAfterClick = await readCounts(cardA, pointA.pointId);
            await closeTopic(pageA, cardA);

            const cardB = await openTopic(pageB, row);
            const pointB = await resolvePointInCard(cardB, pointA.pointId);
            if (!pointB.found) {
              result.reason = `B:${pointB.reason}`;
              await closeTopic(pageB, cardB);
              result.failureClass = classifyFailure(result.reason);
              matrix.push(result);
              continue;
            }

            result.bPointId = pointB.pointId;
            result.bMatchedA = pointB.matchedPreferred;
            result.bObserved = await readCounts(cardB, pointB.pointId);

            // Phase 2 convergence: close/re-open topic on each poll iteration
            // so usePointAggregate re-mounts with fresh Gun .once() reads.
            // Polling the same mounted component is unreliable because the hook
            // exhausts its retry budget once and never re-reads.
            const CONVERGENCE_POLLS = 4;
            const CONVERGENCE_SETTLE_MS = 2_000;
            let convergedLive = result.bObserved.agree > 0;
            await closeTopic(pageB, cardB);

            for (let poll = 0; poll < CONVERGENCE_POLLS && !convergedLive; poll += 1) {
              await pageB.waitForTimeout(CONVERGENCE_SETTLE_MS);
              const pollCard = await openTopic(pageB, row);
              const pollPoint = await resolvePointInCard(pollCard, pointA.pointId);
              if (pollPoint.found) {
                const counts = await readCounts(pollCard, pollPoint.pointId);
                result.bObserved = counts;
                convergedLive = counts.agree > 0;
              }
              await closeTopic(pageB, pollCard);
            }

            if (!convergedLive) {
              // Final attempt: full reload to force fresh Gun chain state.
              await pageB.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
              await gotoFeed(pageB);
              const cardReload = await openTopic(pageB, row);
              const pointReload = await resolvePointInCard(cardReload, pointA.pointId);
              if (pointReload.found) {
                result.bPointId = pointReload.pointId;
                result.bMatchedA = pointReload.pointId === pointA.pointId;
                result.bObservedAfterReload = await readCounts(cardReload, pointReload.pointId);
              } else {
                result.reason = `B-reload:${pointReload.reason}`;
              }
              await closeTopic(pageB, cardReload);
            }

            const finalAgree = result.bObservedAfterReload?.agree ?? result.bObserved?.agree ?? 0;
            result.converged = finalAgree > 0;
            if (!result.converged && !result.reason) {
              result.reason = 'b-aggregate-remained-zero';
            }
          } catch (error) {
            result.reason = error instanceof Error ? error.message : String(error);
          }

          result.failureClass = result.converged ? null : classifyFailure(result.reason);
          matrix.push(result);
        }
      } catch (error) {
        setupFailureReason = error instanceof Error ? error.message : String(error);
      }

      if (setupFailureReason) {
        const isScarcity = setupFailureReason.startsWith('blocked-setup-scarcity:');
        const failureClass = classifyFailure(setupFailureReason);
        matrix.push({
          topicId: '__setup__',
          storyId: '__setup__',
          headline: '__setup__',
          startedAt: new Date().toISOString(),
          votedPointId: null,
          bPointId: null,
          bMatchedA: null,
          aAfterClick: null,
          bObserved: null,
          bObservedAfterReload: null,
          converged: false,
          reason: setupFailureReason,
          failureClass,
        });
        if (isScarcity) {
          verdict = 'blocked_setup_scarcity';
        }
      }

      const harnessFailedRows = matrix.filter((row) => row.failureClass === 'harness');
      const convergenceRows = matrix.filter((row) => row.failureClass !== 'harness');
      const converged = convergenceRows.filter((row) => row.converged).length;

      if (verdict !== 'blocked_setup_scarcity') {
        const allPassed = convergenceRows.length > 0
          && converged >= MIN_CONVERGED
          && harnessFailedRows.length === 0
          && (!REQUIRE_FULL_CONVERGENCE || converged === convergenceRows.length);
        verdict = allPassed ? 'pass' : 'fail';
      }

      const summaryPacket: SummaryPacket = {
        baseUrl: LIVE_BASE_URL,
        verdict,
        tested: convergenceRows.length,
        converged,
        failed: convergenceRows.length - converged,
        harnessFailed: harnessFailedRows.length,
        at: new Date().toISOString(),
        preflight: preflightSummary,
        matrix,
        telemetry: summarizeTelemetry(telemetryEvents),
      };

      await testInfo.attach('live-bias-vote-convergence-summary', {
        body: Buffer.from(JSON.stringify(summaryPacket, null, 2), 'utf8'),
        contentType: 'application/json',
      });

      if (verdict === 'blocked_setup_scarcity') {
        const pf = preflightSummary;
        const rejectDetail = pf
          ? ` | rejects: ${JSON.stringify(pf.rejectReasonCounts)}`
          : '';
        throw new Error(
          `BLOCKED_SETUP_SCARCITY: found ${pf?.voteCapableFound ?? 0}/${TOPIC_LIMIT} vote-capable topics `
          + `(discovered=${pf?.candidatesDiscovered ?? 0}, scanned=${pf?.candidatesScanned ?? 0}, `
          + `budgetExhausted=${pf?.exhaustedBudget ?? false}${rejectDetail})`,
        );
      }

      expect(
        summaryPacket.harnessFailed,
        `Harness failures detected (${summaryPacket.harnessFailed}) — see matrix failureClass='harness' rows`,
      ).toBe(0);
      expect(summaryPacket.tested, 'Live matrix produced no testable convergence rows').toBeGreaterThan(0);
      expect(
        summaryPacket.converged,
        `Live convergence below threshold: converged=${summaryPacket.converged}, tested=${summaryPacket.tested}, minRequired=${MIN_CONVERGED}`,
      ).toBeGreaterThanOrEqual(MIN_CONVERGED);

      if (REQUIRE_FULL_CONVERGENCE) {
        expect(summaryPacket.failed, `Convergence failed for ${summaryPacket.failed}/${summaryPacket.tested} convergence rows`).toBe(0);
      }
    } finally {
      await Promise.all([
        ingesterContext.close().catch(() => {}),
        contextA.close().catch(() => {}),
        contextB.close().catch(() => {}),
      ]);
    }
  });
});
