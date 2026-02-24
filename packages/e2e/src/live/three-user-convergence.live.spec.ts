import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

const LIVE_BASE_URL = process.env.VH_LIVE_BASE_URL ?? 'https://ccibootstrap.tail6cc9b5.ts.net/';
const SHOULD_RUN_LIVE = process.env.VH_RUN_LIVE_MATRIX === 'true';
const NAV_TIMEOUT_MS = Number.isFinite(Number(process.env.VH_LIVE_NAV_TIMEOUT_MS))
  ? Math.max(10_000, Math.floor(Number(process.env.VH_LIVE_NAV_TIMEOUT_MS)))
  : 90_000;
const FEED_READY_TIMEOUT_MS = Number.isFinite(Number(process.env.VH_LIVE_FEED_READY_TIMEOUT_MS))
  ? Math.max(5_000, Math.floor(Number(process.env.VH_LIVE_FEED_READY_TIMEOUT_MS)))
  : 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs: number, stepMs = 250): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await condition()) return true;
    await sleep(stepMs);
  }
  return false;
}

function parseVoteText(text: string, symbol: '+' | '-'): number {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const regex = symbol === '+' ? /\+\s*(\d+)/ : /-\s*(\d+)/;
  const match = normalized.match(regex);
  if (!match) return 0;
  const value = Number.parseInt(match[1] ?? '0', 10);
  return Number.isFinite(value) ? value : 0;
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

  if (!ready) {
    throw new Error('feed-not-ready');
  }
}

async function ensureIdentity(page: Page, label: string): Promise<void> {
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

  const welcome = page.getByTestId('welcome-msg');
  const joinBtn = page.getByTestId('create-identity-btn');
  const deadline = Date.now() + 60_000;

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

  while (Date.now() < deadline) {
    const welcomeVisible = (await welcome.count()) > 0 && await welcome.isVisible().catch(() => false);
    if (welcomeVisible || await waitForIdentityHydrated(2_000)) break;

    const canJoin = (await joinBtn.count()) > 0 && await joinBtn.isVisible().catch(() => false);
    if (canJoin) {
      const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`;
      const username = `${label}${suffix}`.slice(0, 24);
      const handle = username.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 24);
      await page.fill('input[placeholder="Choose a username"]', username);
      await page.fill('input[placeholder="Choose a handle (letters, numbers, _)"]', handle || `u${suffix}`);
      await joinBtn.click();
      const joined = await waitFor(async () => {
        const vis = (await welcome.count()) > 0 && await welcome.isVisible().catch(() => false);
        return vis || await waitForIdentityHydrated(250);
      }, 25_000, 500);
      if (joined) break;
    }
  }

  await gotoFeed(page);
}

async function findFirstVoteCapableTopic(page: Page): Promise<{
  headlineText: string;
  card: Locator;
  pointId: string;
}> {
  const headlines = page.locator('[data-testid^="news-card-headline-"]');
  const count = await headlines.count();

  for (let i = 0; i < Math.min(count, 15); i += 1) {
    const headline = headlines.nth(i);
    await headline.scrollIntoViewIfNeeded({ timeout: 5_000 });
    const headlineText = ((await headline.textContent()) ?? '').trim();
    const card = headline.locator('xpath=ancestor::article[1]');
    await headline.click();

    const opened = await waitFor(
      async () => (await card.locator('[data-testid^="news-card-back-"]').count()) > 0,
      15_000,
      300,
    );
    if (!opened) continue;

    await page.waitForTimeout(2_000);
    const voteButtons = card.locator('[data-testid^="cell-vote-agree-"]');
    const hasButtons = await waitFor(async () => (await voteButtons.count()) > 0, 20_000, 300);
    if (!hasButtons) {
      const backButton = card.locator('[data-testid^="news-card-back-button-"]');
      if (await backButton.count()) await backButton.first().click().catch(() => {});
      await page.waitForTimeout(500);
      continue;
    }

    const first = voteButtons.first();
    const testId = await first.getAttribute('data-testid');
    if (!testId) continue;

    return {
      headlineText,
      card,
      pointId: testId.replace('cell-vote-agree-', ''),
    };
  }

  throw new Error('no-vote-capable-topic-found');
}

async function openTopicByHeadlineText(page: Page, headlineText: string): Promise<Locator> {
  const headlines = page.locator('[data-testid^="news-card-headline-"]');
  const count = await headlines.count();

  for (let i = 0; i < count; i += 1) {
    const headline = headlines.nth(i);
    const text = ((await headline.textContent()) ?? '').trim();
    if (text === headlineText) {
      await headline.scrollIntoViewIfNeeded({ timeout: 5_000 });
      const card = headline.locator('xpath=ancestor::article[1]');
      await headline.click();
      await waitFor(
        async () => (await card.locator('[data-testid^="news-card-back-"]').count()) > 0,
        15_000,
        300,
      );
      await page.waitForTimeout(1_500);
      return card;
    }
  }

  throw new Error(`headline-not-found: ${headlineText}`);
}

function readAgreeCount(card: Locator, pointId: string): Promise<number> {
  return card.getByTestId(`cell-vote-agree-${pointId}`).textContent()
    .then((t) => parseVoteText(t?.trim() ?? '', '+'));
}

function readDisagreeCount(card: Locator, pointId: string): Promise<number> {
  return card.getByTestId(`cell-vote-disagree-${pointId}`).textContent()
    .then((t) => parseVoteText(t?.trim() ?? '', '-'));
}

async function waitForAgreeCount(card: Locator, pointId: string, expected: number, timeoutMs = 10_000): Promise<boolean> {
  return waitFor(async () => (await readAgreeCount(card, pointId)) === expected, timeoutMs, 500);
}

async function waitForDisagreeCount(card: Locator, pointId: string, expected: number, timeoutMs = 10_000): Promise<boolean> {
  return waitFor(async () => (await readDisagreeCount(card, pointId)) === expected, timeoutMs, 500);
}

type StepResult = {
  readonly step: string;
  readonly passed: boolean;
  readonly reason?: string;
  readonly agrees: number;
  readonly disagrees: number;
};

test.describe('live three-user convergence', () => {
  test.skip(!SHOULD_RUN_LIVE, 'Set VH_RUN_LIVE_MATRIX=true to run live three-user convergence tests');

  test('A/B/C concurrent votes converge correctly across all three clients', async ({ browser }, testInfo) => {
    test.setTimeout(8 * 60_000);

    const ingesterCtx = await createRuntimeRoleContext(browser, 'ingester', false);
    const ctxA = await createRuntimeRoleContext(browser, 'consumer', true);
    const ctxB = await createRuntimeRoleContext(browser, 'consumer', true);
    const ctxC = await createRuntimeRoleContext(browser, 'consumer', true);
    const ingesterPage = await ingesterCtx.newPage();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    const pageC = await ctxC.newPage();

    const results: StepResult[] = [];

    try {
      // Setup: create identities
      await gotoFeed(ingesterPage);
      await ensureIdentity(pageA, 'Alice3');
      await ensureIdentity(pageB, 'Bob3');
      await ensureIdentity(pageC, 'Carol3');

      // Find a vote-capable topic on A
      await gotoFeed(pageA);
      const { headlineText, card: cardA, pointId } = await findFirstVoteCapableTopic(pageA);

      // Open same topic on B and C
      await gotoFeed(pageB);
      const cardB = await openTopicByHeadlineText(pageB, headlineText);
      await waitFor(async () => (await cardB.locator(`[data-testid="cell-vote-agree-${pointId}"]`).count()) > 0, 20_000, 300);

      await gotoFeed(pageC);
      const cardC = await openTopicByHeadlineText(pageC, headlineText);
      await waitFor(async () => (await cardC.locator(`[data-testid="cell-vote-agree-${pointId}"]`).count()) > 0, 20_000, 300);

      // Read baseline counts
      const baseAgree = await readAgreeCount(cardA, pointId);
      const baseDisagree = await readDisagreeCount(cardA, pointId);

      // Step 1: A votes +1
      await cardA.getByTestId(`cell-vote-agree-${pointId}`).click({ timeout: 5_000 });
      await pageA.waitForTimeout(1_500);
      const s1bOk = await waitForAgreeCount(cardB, pointId, baseAgree + 1);
      const s1cOk = await waitForAgreeCount(cardC, pointId, baseAgree + 1);
      results.push({
        step: 'A votes +1, B and C see agree=' + (baseAgree + 1),
        passed: s1bOk && s1cOk,
        reason: !s1bOk ? 'B did not see A vote' : !s1cOk ? 'C did not see A vote' : undefined,
        agrees: baseAgree + 1,
        disagrees: baseDisagree,
      });

      // Step 2: B votes +1
      await cardB.getByTestId(`cell-vote-agree-${pointId}`).click({ timeout: 5_000 });
      await pageB.waitForTimeout(1_500);
      const s2aOk = await waitForAgreeCount(cardA, pointId, baseAgree + 2);
      const s2cOk = await waitForAgreeCount(cardC, pointId, baseAgree + 2);
      results.push({
        step: 'B votes +1, A and C see agree=' + (baseAgree + 2),
        passed: s2aOk && s2cOk,
        reason: !s2aOk ? 'A did not see B vote' : !s2cOk ? 'C did not see B vote' : undefined,
        agrees: baseAgree + 2,
        disagrees: baseDisagree,
      });

      // Step 3: C votes -1
      await cardC.getByTestId(`cell-vote-disagree-${pointId}`).click({ timeout: 5_000 });
      await pageC.waitForTimeout(1_500);
      const s3aAgree = await waitForAgreeCount(cardA, pointId, baseAgree + 2);
      const s3aDisagree = await waitForDisagreeCount(cardA, pointId, baseDisagree + 1);
      const s3bAgree = await waitForAgreeCount(cardB, pointId, baseAgree + 2);
      const s3bDisagree = await waitForDisagreeCount(cardB, pointId, baseDisagree + 1);
      results.push({
        step: 'C votes -1, A and B see disagree=' + (baseDisagree + 1),
        passed: s3aAgree && s3aDisagree && s3bAgree && s3bDisagree,
        reason: !(s3aAgree && s3aDisagree) ? 'A did not see C vote' : !(s3bAgree && s3bDisagree) ? 'B did not see C vote' : undefined,
        agrees: baseAgree + 2,
        disagrees: baseDisagree + 1,
      });

      // Step 4: A switches from +1 to -1 (mutation)
      await cardA.getByTestId(`cell-vote-disagree-${pointId}`).click({ timeout: 5_000 });
      await pageA.waitForTimeout(1_500);
      const s4bAgree = await waitForAgreeCount(cardB, pointId, baseAgree + 1);
      const s4bDisagree = await waitForDisagreeCount(cardB, pointId, baseDisagree + 2);
      const s4cAgree = await waitForAgreeCount(cardC, pointId, baseAgree + 1);
      const s4cDisagree = await waitForDisagreeCount(cardC, pointId, baseDisagree + 2);
      results.push({
        step: 'A switches +1 to -1, B and C see agree=' + (baseAgree + 1) + ' disagree=' + (baseDisagree + 2),
        passed: s4bAgree && s4bDisagree && s4cAgree && s4cDisagree,
        reason: !(s4bAgree && s4bDisagree) ? 'B did not see A mutation' : !(s4cAgree && s4cDisagree) ? 'C did not see A mutation' : undefined,
        agrees: baseAgree + 1,
        disagrees: baseDisagree + 2,
      });

      // Step 5: All three reload — state must persist
      const expectedAgree = baseAgree + 1;
      const expectedDisagree = baseDisagree + 2;

      for (const [label, pg] of [['A', pageA], ['B', pageB], ['C', pageC]] as const) {
        await pg.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        await gotoFeed(pg);
        const reloadCard = await openTopicByHeadlineText(pg, headlineText);
        await waitFor(async () => (await reloadCard.locator(`[data-testid="cell-vote-agree-${pointId}"]`).count()) > 0, 20_000, 300);

        const agree = await readAgreeCount(reloadCard, pointId);
        const disagree = await readDisagreeCount(reloadCard, pointId);
        results.push({
          step: `${label} reload durability`,
          passed: agree === expectedAgree && disagree === expectedDisagree,
          reason: agree !== expectedAgree || disagree !== expectedDisagree
            ? `${label}: agree=${agree} (expected ${expectedAgree}), disagree=${disagree} (expected ${expectedDisagree})`
            : undefined,
          agrees: agree,
          disagrees: disagree,
        });
      }

      await testInfo.attach('three-user-convergence-results', {
        body: Buffer.from(JSON.stringify({ headlineText, pointId, results }, null, 2), 'utf8'),
        contentType: 'application/json',
      });

      const failures = results.filter((r) => !r.passed);
      expect(failures.length, `Three-user convergence failures: ${failures.map((f) => `${f.step}: ${f.reason}`).join('; ')}`).toBe(0);
    } finally {
      await Promise.all([
        ingesterCtx.close().catch(() => {}),
        ctxA.close().catch(() => {}),
        ctxB.close().catch(() => {}),
        ctxC.close().catch(() => {}),
      ]);
    }
  });
});
