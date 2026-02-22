import { test, expect, type BrowserContext, type ConsoleMessage, type Locator, type Page } from '@playwright/test';

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
};

type TelemetryEvent = {
  readonly ts: string;
  readonly actor: Actor;
  readonly level: string;
  readonly text: string;
  readonly args: ReadonlyArray<unknown>;
};

type SummaryPacket = {
  readonly baseUrl: string;
  readonly tested: number;
  readonly converged: number;
  readonly failed: number;
  readonly at: string;
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

async function gotoFeed(page: Page): Promise<void> {
  await page.goto(LIVE_BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
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
    30_000,
    500,
  );

  if (!ready) {
    throw new Error('feed-not-ready: no news-card-headline nodes found');
  }
}

async function ensureIdentity(page: Page, label: string): Promise<void> {
  const openDashboard = async (): Promise<void> => {
    await page.goto(LIVE_BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
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
    const nodes = Array.from(document.querySelectorAll('[data-testid^="news-card-headline-"]'));
    for (const node of nodes) {
      const testId = node.getAttribute('data-testid') || '';
      const topicId = testId.replace('news-card-headline-', '');
      const headline = (node.textContent || '').trim();
      if (!topicId || !headline) {
        continue;
      }
      out.push({ topicId, headline });
    }
    return out;
  });

  const dedup: TopicRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.topicId}|${row.headline}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(row);
  }
  return dedup;
}

async function findHeadlineLocator(page: Page, row: TopicRow): Promise<Locator | null> {
  const candidates = page.locator(`[data-testid="news-card-headline-${row.topicId}"]`);
  const count = await candidates.count();

  for (let i = 0; i < count; i += 1) {
    const candidate = candidates.nth(i);
    const text = ((await candidate.textContent()) ?? '').trim();
    if (text === row.headline) {
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
  const headline = await findHeadlineLocator(page, row);
  if (!headline) {
    throw new Error(`headline-not-found:${row.topicId}`);
  }

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
    const contextA = await browser.newContext({ ignoreHTTPSErrors: true });
    const contextB = await browser.newContext({ ignoreHTTPSErrors: true });
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    const telemetryEvents: TelemetryEvent[] = [];
    attachTelemetry(pageA, 'A', telemetryEvents);
    attachTelemetry(pageB, 'B', telemetryEvents);

    const matrix: MatrixRow[] = [];

    try {
      await ensureIdentity(pageA, 'AliceLive');
      await ensureIdentity(pageB, 'BobLive');

      await gotoFeed(pageA);
      await gotoFeed(pageB);

      const topics = await getTopicRows(pageA);
      const selected = topics.slice(0, TOPIC_LIMIT);

      for (const row of selected) {
        const result: MatrixRow = {
          topicId: row.topicId,
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
        };

        try {
          await gotoFeed(pageA);
          const cardA = await openTopic(pageA, row);
          const pointA = await resolvePointInCard(cardA);
          if (!pointA.found) {
            result.reason = `A:${pointA.reason}`;
            await closeTopic(pageA, cardA);
            matrix.push(result);
            continue;
          }

          result.votedPointId = pointA.pointId;
          await cardA.getByTestId(`cell-vote-agree-${pointA.pointId}`).click({ timeout: 10_000 });
          await pageA.waitForTimeout(1_500);
          result.aAfterClick = await readCounts(cardA, pointA.pointId);
          await closeTopic(pageA, cardA);

          await gotoFeed(pageB);
          const cardB = await openTopic(pageB, row);
          const pointB = await resolvePointInCard(cardB, pointA.pointId);
          if (!pointB.found) {
            result.reason = `B:${pointB.reason}`;
            await closeTopic(pageB, cardB);
            matrix.push(result);
            continue;
          }

          result.bPointId = pointB.pointId;
          result.bMatchedA = pointB.matchedPreferred;
          result.bObserved = await readCounts(cardB, pointB.pointId);

          const convergedLive = await waitFor(async () => {
            const counts = await readCounts(cardB, pointB.pointId);
            result.bObserved = counts;
            return counts.agree > 0;
          }, 10_000, 1_000);

          if (!convergedLive) {
            await closeTopic(pageB, cardB);
            await pageB.reload({ waitUntil: 'domcontentloaded', timeout: 45_000 });
            await gotoFeed(pageB);
            const cardReload = await openTopic(pageB, row);
            const pointReload = await resolvePointInCard(cardReload, pointB.pointId);
            if (pointReload.found) {
              result.bPointId = pointReload.pointId;
              result.bMatchedA = pointReload.pointId === pointA.pointId;
              result.bObservedAfterReload = await readCounts(cardReload, pointReload.pointId);
            } else {
              result.reason = `B-reload:${pointReload.reason}`;
            }
            await closeTopic(pageB, cardReload);
          } else {
            await closeTopic(pageB, cardB);
          }

          const finalAgree = result.bObservedAfterReload?.agree ?? result.bObserved?.agree ?? 0;
          result.converged = finalAgree > 0;
          if (!result.converged && !result.reason) {
            result.reason = 'b-aggregate-remained-zero';
          }
        } catch (error) {
          result.reason = error instanceof Error ? error.message : String(error);
        }

        matrix.push(result);
      }

      const converged = matrix.filter((row) => row.converged).length;
      const summary: SummaryPacket = {
        baseUrl: LIVE_BASE_URL,
        tested: matrix.length,
        converged,
        failed: matrix.length - converged,
        at: new Date().toISOString(),
        matrix,
        telemetry: summarizeTelemetry(telemetryEvents),
      };

      await testInfo.attach('live-bias-vote-convergence-summary', {
        body: Buffer.from(JSON.stringify(summary, null, 2), 'utf8'),
        contentType: 'application/json',
      });

      expect(summary.tested, 'Live matrix produced no testable rows').toBeGreaterThan(0);
      expect(
        summary.converged,
        `Live convergence below threshold: converged=${summary.converged}, tested=${summary.tested}, minRequired=${MIN_CONVERGED}`,
      ).toBeGreaterThanOrEqual(MIN_CONVERGED);

      if (REQUIRE_FULL_CONVERGENCE) {
        expect(summary.failed, `Convergence failed for ${summary.failed}/${summary.tested} rows`).toBe(0);
      }
    } finally {
      await Promise.all([
        contextA.close().catch(() => {}),
        contextB.close().catch(() => {}),
      ]);
    }
  });
});
