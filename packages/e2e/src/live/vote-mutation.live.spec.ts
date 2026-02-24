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
  card: Locator;
  pointId: string;
}> {
  const headlines = page.locator('[data-testid^="news-card-headline-"]');
  const count = await headlines.count();

  for (let i = 0; i < Math.min(count, 15); i += 1) {
    const headline = headlines.nth(i);
    await headline.scrollIntoViewIfNeeded({ timeout: 5_000 });
    const card = headline.locator('xpath=ancestor::article[1]');
    await headline.click();

    // Wait for back button (card opened)
    const opened = await waitFor(
      async () => (await card.locator('[data-testid^="news-card-back-"]').count()) > 0,
      15_000,
      300,
    );
    if (!opened) continue;

    // Wait for vote buttons
    await page.waitForTimeout(2_000);
    const voteButtons = card.locator('[data-testid^="cell-vote-agree-"]');
    const hasButtons = await waitFor(async () => (await voteButtons.count()) > 0, 20_000, 300);
    if (!hasButtons) {
      // Close and try next
      const backButton = card.locator('[data-testid^="news-card-back-button-"]');
      if (await backButton.count()) await backButton.first().click().catch(() => {});
      await page.waitForTimeout(500);
      continue;
    }

    const first = voteButtons.first();
    const testId = await first.getAttribute('data-testid');
    if (!testId) continue;

    return {
      card,
      pointId: testId.replace('cell-vote-agree-', ''),
    };
  }

  throw new Error('no-vote-capable-topic-found');
}

function readAgreeCount(card: Locator, pointId: string): Promise<number> {
  return card.getByTestId(`cell-vote-agree-${pointId}`).textContent()
    .then((t) => parseVoteText(t?.trim() ?? '', '+'));
}

function readDisagreeCount(card: Locator, pointId: string): Promise<number> {
  return card.getByTestId(`cell-vote-disagree-${pointId}`).textContent()
    .then((t) => parseVoteText(t?.trim() ?? '', '-'));
}

async function readAriaPressedState(card: Locator, pointId: string): Promise<{ agreePressed: boolean; disagreePressed: boolean }> {
  const agreePressed = (await card.getByTestId(`cell-vote-agree-${pointId}`).getAttribute('aria-pressed')) === 'true';
  const disagreePressed = (await card.getByTestId(`cell-vote-disagree-${pointId}`).getAttribute('aria-pressed')) === 'true';
  return { agreePressed, disagreePressed };
}

type MutationStep = {
  readonly label: string;
  readonly action: 'click-agree' | 'click-disagree';
  readonly expectedState: { agreePressed: boolean; disagreePressed: boolean };
  readonly agreeDelta: number;
  readonly disagreeDelta: number;
};

const MUTATION_STEPS: ReadonlyArray<MutationStep> = [
  // 0 -> +1
  {
    label: '0 -> +1 (click agree)',
    action: 'click-agree',
    expectedState: { agreePressed: true, disagreePressed: false },
    agreeDelta: 1,
    disagreeDelta: 0,
  },
  // +1 -> 0 (toggle off)
  {
    label: '+1 -> 0 (click agree again)',
    action: 'click-agree',
    expectedState: { agreePressed: false, disagreePressed: false },
    agreeDelta: -1,
    disagreeDelta: 0,
  },
  // 0 -> -1
  {
    label: '0 -> -1 (click disagree)',
    action: 'click-disagree',
    expectedState: { agreePressed: false, disagreePressed: true },
    agreeDelta: 0,
    disagreeDelta: 1,
  },
  // -1 -> 0 (toggle off)
  {
    label: '-1 -> 0 (click disagree again)',
    action: 'click-disagree',
    expectedState: { agreePressed: false, disagreePressed: false },
    agreeDelta: 0,
    disagreeDelta: -1,
  },
  // 0 -> +1 (setup for switch test)
  {
    label: '0 -> +1 (setup for switch)',
    action: 'click-agree',
    expectedState: { agreePressed: true, disagreePressed: false },
    agreeDelta: 1,
    disagreeDelta: 0,
  },
  // +1 -> -1 (switch)
  {
    label: '+1 -> -1 (switch via disagree)',
    action: 'click-disagree',
    expectedState: { agreePressed: false, disagreePressed: true },
    agreeDelta: -1,
    disagreeDelta: 1,
  },
  // -1 -> +1 (switch back)
  {
    label: '-1 -> +1 (switch via agree)',
    action: 'click-agree',
    expectedState: { agreePressed: true, disagreePressed: false },
    agreeDelta: 1,
    disagreeDelta: -1,
  },
];

test.describe('live vote mutation', () => {
  test.skip(!SHOULD_RUN_LIVE, 'Set VH_RUN_LIVE_MATRIX=true to run live vote mutation tests');

  test('vote toggle and switch transitions update state and survive reload', async ({ browser }, testInfo) => {
    test.setTimeout(5 * 60_000);

    const ingesterContext = await createRuntimeRoleContext(browser, 'ingester', false);
    const voterContext = await createRuntimeRoleContext(browser, 'consumer', true);
    const ingesterPage = await ingesterContext.newPage();
    const page = await voterContext.newPage();

    const results: Array<{
      step: string;
      passed: boolean;
      reason?: string;
      agreeCount: number;
      disagreeCount: number;
      ariaState: { agreePressed: boolean; disagreePressed: boolean };
    }> = [];

    try {
      await gotoFeed(ingesterPage);
      await ensureIdentity(page, 'VoteMut');
      await gotoFeed(page);

      const { card, pointId } = await findFirstVoteCapableTopic(page);

      let runningAgree = await readAgreeCount(card, pointId);
      let runningDisagree = await readDisagreeCount(card, pointId);

      for (const step of MUTATION_STEPS) {
        const btn = step.action === 'click-agree'
          ? card.getByTestId(`cell-vote-agree-${pointId}`)
          : card.getByTestId(`cell-vote-disagree-${pointId}`);

        await btn.click({ timeout: 5_000 });
        await page.waitForTimeout(1_500);

        const expectedAgree = runningAgree + step.agreeDelta;
        const expectedDisagree = runningDisagree + step.disagreeDelta;

        const agree = await readAgreeCount(card, pointId);
        const disagree = await readDisagreeCount(card, pointId);
        const ariaState = await readAriaPressedState(card, pointId);

        const countCorrect = agree === expectedAgree && disagree === expectedDisagree;
        const stateCorrect =
          ariaState.agreePressed === step.expectedState.agreePressed &&
          ariaState.disagreePressed === step.expectedState.disagreePressed;

        results.push({
          step: step.label,
          passed: countCorrect && stateCorrect,
          reason: !countCorrect
            ? `counts: agree=${agree} (expected ${expectedAgree}), disagree=${disagree} (expected ${expectedDisagree})`
            : !stateCorrect
              ? `aria-pressed: agree=${ariaState.agreePressed} (expected ${step.expectedState.agreePressed}), disagree=${ariaState.disagreePressed} (expected ${step.expectedState.disagreePressed})`
              : undefined,
          agreeCount: agree,
          disagreeCount: disagree,
          ariaState,
        });

        runningAgree = agree;
        runningDisagree = disagree;
      }

      // Reload durability: state should survive page reload
      await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      await gotoFeed(page);

      // Re-open the same topic — find by looking for the same pointId
      const headlines = page.locator('[data-testid^="news-card-headline-"]');
      const headlineCount = await headlines.count();
      let reloadCard: Locator | null = null;

      for (let i = 0; i < Math.min(headlineCount, 15); i += 1) {
        const headline = headlines.nth(i);
        const candidateCard = headline.locator('xpath=ancestor::article[1]');
        await headline.scrollIntoViewIfNeeded({ timeout: 5_000 });
        await headline.click();
        await waitFor(
          async () => (await candidateCard.locator('[data-testid^="news-card-back-"]').count()) > 0,
          10_000,
          300,
        );
        await page.waitForTimeout(1_500);

        const matchBtn = candidateCard.getByTestId(`cell-vote-agree-${pointId}`);
        if (await matchBtn.count()) {
          reloadCard = candidateCard;
          break;
        }

        const backButton = candidateCard.locator('[data-testid^="news-card-back-button-"]');
        if (await backButton.count()) await backButton.first().click().catch(() => {});
        await page.waitForTimeout(300);
      }

      if (reloadCard) {
        await waitFor(async () => (await reloadCard!.locator('[data-testid^="cell-vote-agree-"]').count()) > 0, 20_000, 300);
        const reloadAgree = await readAgreeCount(reloadCard, pointId);
        const reloadDisagree = await readDisagreeCount(reloadCard, pointId);
        const reloadAria = await readAriaPressedState(reloadCard, pointId);

        results.push({
          step: 'reload-durability',
          passed: reloadAgree === runningAgree && reloadDisagree === runningDisagree,
          reason: reloadAgree !== runningAgree || reloadDisagree !== runningDisagree
            ? `post-reload: agree=${reloadAgree} (expected ${runningAgree}), disagree=${reloadDisagree} (expected ${runningDisagree})`
            : undefined,
          agreeCount: reloadAgree,
          disagreeCount: reloadDisagree,
          ariaState: reloadAria,
        });
      } else {
        results.push({
          step: 'reload-durability',
          passed: false,
          reason: 'could not re-find topic after reload',
          agreeCount: 0,
          disagreeCount: 0,
          ariaState: { agreePressed: false, disagreePressed: false },
        });
      }

      await testInfo.attach('vote-mutation-results', {
        body: Buffer.from(JSON.stringify({ pointId, results }, null, 2), 'utf8'),
        contentType: 'application/json',
      });

      const failures = results.filter((r) => !r.passed);
      expect(failures.length, `Vote mutation failures: ${failures.map((f) => `${f.step}: ${f.reason}`).join('; ')}`).toBe(0);
    } finally {
      await Promise.all([
        ingesterContext.close().catch(() => {}),
        voterContext.close().catch(() => {}),
      ]);
    }
  });
});
