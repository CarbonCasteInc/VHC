import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

const LIVE_BASE_URL = process.env.VH_LIVE_BASE_URL ?? 'http://127.0.0.1:2048/';
const SHOULD_RUN = process.env.VH_RUN_FULL_PRODUCT_MOCK_USERS === 'true';
const NAV_TIMEOUT_MS = 90_000;
const FEED_TIMEOUT_MS = 180_000;
const ANALYSIS_TIMEOUT_MS = 180_000;
const AGGREGATE_TIMEOUT_MS = 90_000;
const COMMENT_TIMEOUT_MS = 120_000;
const DEFAULT_LABELS = ['alice', 'bruno', 'chandra', 'devon', 'elena'];
const RUN_ID = process.env.VH_FULL_PRODUCT_MOCK_USERS_RUN_ID ?? `mock-users-${Date.now().toString(36)}`;

function readPositiveIntEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const USER_COUNT = readPositiveIntEnv('VH_FULL_PRODUCT_MOCK_USER_COUNT', 5);
const REQUIRED_SINGLETON_STORIES = readPositiveIntEnv('VH_FULL_PRODUCT_REQUIRED_SINGLETON_STORIES', 2);
const REQUIRED_BUNDLED_STORIES = readPositiveIntEnv('VH_FULL_PRODUCT_REQUIRED_BUNDLED_STORIES', 2);

type StoryKind = 'singleton' | 'bundle';

interface UserSession {
  readonly label: string;
  readonly context: BrowserContext;
  page: Page;
}

interface StoryTarget {
  readonly kind: StoryKind;
  readonly topicId: string;
  readonly storyId: string;
  readonly headline: string;
  readonly sourceBadgeCount: number;
  readonly pointId: string;
}

interface OpenedStory {
  readonly user: UserSession;
  readonly card: Locator;
  readonly pointId: string;
}

interface VoteCounts {
  readonly agree: number;
  readonly disagree: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs: number, stepMs = 500): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await condition()) return true;
    await sleep(stepMs);
  }
  return false;
}

async function gotoFeed(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(LIVE_BASE_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    const ready = await waitFor(
      async () => (await page.locator('[data-testid^="news-card-headline-"]').count()) >= 3,
      FEED_TIMEOUT_MS / 3,
    );
    if (ready) {
      return;
    }
    await nudgeFeed(page).catch(() => undefined);
  }
  throw new Error(`feed-not-ready:${await page.locator('[data-testid^="news-card-headline-"]').count()}`);
}

async function replaceUserPage(user: UserSession): Promise<Page> {
  await user.page.close().catch(() => undefined);
  user.page = await user.context.newPage();
  await gotoFeed(user.page);
  return user.page;
}

async function gotoUserFeed(user: UserSession): Promise<Page> {
  try {
    await gotoFeed(user.page);
    return user.page;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      !user.page.isClosed()
      && !message.includes('Page crashed')
      && !message.includes('Target crashed')
      && !message.includes('Target page')
      && !message.includes('feed-not-ready')
    ) {
      throw error;
    }
    return replaceUserPage(user);
  }
}

async function reloadUserPages(users: readonly UserSession[]): Promise<void> {
  await Promise.all(users.map((user) => replaceUserPage(user)));
}

async function ensureIdentity(page: Page, label: string): Promise<void> {
  await page.goto(LIVE_BASE_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  const userLink = page.getByTestId('user-link');
  await userLink.waitFor({ state: 'visible', timeout: 30_000 });
  await userLink.click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });

  const welcome = page.getByTestId('welcome-msg');
  if (!(await welcome.isVisible().catch(() => false))) {
    const createButton = page.getByTestId('create-identity-btn');
    await createButton.waitFor({ state: 'visible', timeout: 30_000 });
    const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
    const username = `${label}-${suffix}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
    const handle = username.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 24);
    await page.fill('input[placeholder="Choose a username"]', username);
    await page.fill('input[placeholder="Choose a handle (letters, numbers, _)"]', handle);
    await createButton.click();
    await welcome.waitFor({ state: 'visible', timeout: 45_000 });
  }

  await page.waitForFunction(
    () => Boolean((window as Window & { __vh_identity_published?: unknown }).__vh_identity_published),
    undefined,
    { timeout: 30_000 },
  ).catch(() => undefined);
  await gotoFeed(page);
}

async function visibleStoryRows(page: Page): Promise<Array<Omit<StoryTarget, 'kind' | 'pointId'> & { kind: StoryKind }>> {
  return page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('article[data-testid^="news-card-"]'))
    .map((card) => {
      const headline = card.querySelector<HTMLElement>('[data-testid^="news-card-headline-"]');
      if (!headline) return null;
      const topicId = (headline.getAttribute('data-testid') ?? '').replace('news-card-headline-', '');
      const storyId = headline.getAttribute('data-story-id') ?? '';
      const sourceBadgeCount = card.querySelectorAll('a[data-testid^="source-badge-"]').length;
      const text = (headline.textContent ?? '').trim();
      if (!topicId || !storyId || !text || sourceBadgeCount < 1) return null;
      return {
        topicId,
        storyId,
        headline: text,
        sourceBadgeCount,
        kind: sourceBadgeCount > 1 ? 'bundle' : 'singleton',
      };
    })
    .filter((row): row is Omit<StoryTarget, 'pointId'> & { kind: StoryKind } => Boolean(row)));
}

async function nudgeFeed(page: Page): Promise<void> {
  await page.getByTestId('feed-refresh-button').click().catch(() => undefined);
  const sentinel = page.getByTestId('feed-load-sentinel');
  if (await sentinel.count().catch(() => 0)) {
    await sentinel.scrollIntoViewIfNeeded().catch(() => undefined);
  }
  await page.waitForTimeout(750);
}

async function openStory(page: Page, target: { topicId: string; storyId: string }): Promise<Locator> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const headline = page.locator(
      `[data-testid="news-card-headline-${target.topicId}"][data-story-id="${target.storyId}"]`,
    ).first();
    if (await headline.count()) {
      await headline.scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => undefined);
      const clicked = await headline.click({ timeout: 10_000 }).then(() => true).catch(() => false);
      if (!clicked) {
        await gotoFeed(page);
        await nudgeFeed(page);
        continue;
      }
      const card = headline.locator('xpath=ancestor::article[1]');
      const opened = await waitFor(
        async () => card.locator(`[data-testid="news-card-detail-${target.topicId}"]`).isVisible().catch(() => false),
        15_000,
        250,
      );
      if (opened) return card;
    }
    await gotoFeed(page);
    await nudgeFeed(page);
  }
  throw new Error(`story-open-failed:${target.storyId}`);
}

async function openStoryForUser(user: UserSession, target: StoryTarget): Promise<OpenedStory> {
  const page = await gotoUserFeed(user);
  const card = await openStory(page, target);
  const pointId = await waitForAnalysisReady(card, target.topicId);
  return { user, card, pointId };
}

async function closeStory(card: Locator, topicId: string): Promise<void> {
  const button = card.getByTestId(`news-card-back-button-${topicId}`);
  if (await button.isVisible().catch(() => false)) {
    await button.click().catch(() => undefined);
  }
}

async function firstVotePointId(card: Locator): Promise<string | null> {
  const button = card.locator('[data-testid^="cell-vote-agree-"]').first();
  if (!(await button.count())) return null;
  const testId = await button.getAttribute('data-testid');
  return testId?.replace('cell-vote-agree-', '') ?? null;
}

async function waitForAnalysisReady(card: Locator, topicId: string): Promise<string> {
  const ready = await waitFor(async () => {
    const basis = ((await card.getByTestId(`news-card-summary-basis-${topicId}`).textContent().catch(() => '')) ?? '').trim();
    const rows = await card.locator('[data-testid^="bias-table-row-"]').count().catch(() => 0);
    const votes = await card.locator('[data-testid^="cell-vote-agree-"]').count().catch(() => 0);
    const correction = await card.locator(`[data-testid="news-card-synthesis-correction-state-${topicId}"]`).count().catch(() => 0);
    return correction === 0 && basis.includes('Topic synthesis v2') && rows > 0 && votes > 0;
  }, ANALYSIS_TIMEOUT_MS);
  if (!ready) {
    const basis = ((await card.getByTestId(`news-card-summary-basis-${topicId}`).textContent().catch(() => '')) ?? '').trim();
    const rowCount = await card.locator('[data-testid^="bias-table-row-"]').count().catch(() => 0);
    const voteCount = await card.locator('[data-testid^="cell-vote-agree-"]').count().catch(() => 0);
    throw new Error(`analysis-not-ready:${topicId}:basis=${basis}:rows=${rowCount}:votes=${voteCount}`);
  }

  const pointId = await firstVotePointId(card);
  if (!pointId) {
    throw new Error(`analysis-ready-without-point:${topicId}`);
  }
  return pointId;
}

async function discoverTargets(page: Page): Promise<StoryTarget[]> {
  const targets: StoryTarget[] = [];
  const seen = new Set<string>();
  const enough = () =>
    targets.filter((target) => target.kind === 'singleton').length >= REQUIRED_SINGLETON_STORIES
    && targets.filter((target) => target.kind === 'bundle').length >= REQUIRED_BUNDLED_STORIES;

  const startedAt = Date.now();
  while (Date.now() - startedAt < ANALYSIS_TIMEOUT_MS && !enough()) {
    await gotoFeed(page);
    const rows = await visibleStoryRows(page);
    for (const row of rows) {
      if (seen.has(row.storyId)) continue;
      if (
        row.kind === 'singleton'
        && targets.filter((target) => target.kind === 'singleton').length >= REQUIRED_SINGLETON_STORIES
      ) {
        continue;
      }
      if (
        row.kind === 'bundle'
        && targets.filter((target) => target.kind === 'bundle').length >= REQUIRED_BUNDLED_STORIES
      ) {
        continue;
      }
      seen.add(row.storyId);
      const card = await openStory(page, row);
      try {
        const pointId = await waitForAnalysisReady(card, row.topicId);
        targets.push({ ...row, pointId });
        if (enough()) break;
      } catch {
        // Keep scanning until the daemon has enough accepted syntheses.
      } finally {
        await closeStory(card, row.topicId).catch(() => undefined);
      }
    }
    if (!enough()) {
      await nudgeFeed(page);
      await sleep(2_000);
    }
  }

  if (!enough()) {
    throw new Error(
      `insufficient-analysis-ready-targets:singletons=${targets.filter((target) => target.kind === 'singleton').length}:bundles=${targets.filter((target) => target.kind === 'bundle').length}`,
    );
  }
  return [
    ...targets.filter((target) => target.kind === 'singleton').slice(0, REQUIRED_SINGLETON_STORIES),
    ...targets.filter((target) => target.kind === 'bundle').slice(0, REQUIRED_BUNDLED_STORIES),
  ];
}

function parseVoteCount(text: string, symbol: '+' | '-'): number {
  return Number.parseInt((text.match(symbol === '+' ? /\+\s*(\d+)/ : /-\s*(\d+)/)?.[1] ?? '0'), 10);
}

async function voteCounts(card: Locator, pointId: string): Promise<VoteCounts> {
  const agreeText = (await card.getByTestId(`cell-vote-agree-${pointId}`).textContent()) ?? '';
  const disagreeText = (await card.getByTestId(`cell-vote-disagree-${pointId}`).textContent()) ?? '';
  return {
    agree: parseVoteCount(agreeText, '+'),
    disagree: parseVoteCount(disagreeText, '-'),
  };
}

async function waitForVoteCountsAtLeast(card: Locator, pointId: string, expected: VoteCounts): Promise<void> {
  await expect.poll(async () => {
    const current = await voteCounts(card, pointId);
    return current.agree >= expected.agree && current.disagree >= expected.disagree
      ? 'ready'
      : `agree=${current.agree};disagree=${current.disagree}`;
  }, { timeout: AGGREGATE_TIMEOUT_MS }).toBe('ready');
}

async function waitForVoteMeshWrite(
  page: Page,
  topicId: string,
  pointId: string,
  action: () => Promise<void>,
): Promise<void> {
  const startedAt = await page.evaluate(() => Date.now()).catch(() => Date.now());
  await action();
  try {
    await page.waitForFunction(
      ({ expectedTopicId, expectedPointId, notBefore }) => {
        const events = (window as Window & {
          __VH_MESH_WRITE_EVENTS__?: Array<{
            topic_id?: string;
            point_id?: string;
            success?: boolean;
            observed_at?: number;
          }>;
        }).__VH_MESH_WRITE_EVENTS__;
        return Array.isArray(events) && events.some((event) =>
          event.topic_id === expectedTopicId
          && event.point_id === expectedPointId
          && event.success === true
          && typeof event.observed_at === 'number'
          && event.observed_at >= notBefore
        );
      },
      { expectedTopicId: topicId, expectedPointId: pointId, notBefore: startedAt },
      { timeout: 45_000, polling: 250 },
    );
  } catch (error) {
    const recentEvents = await page.evaluate(() => {
      const events = (window as Window & {
        __VH_MESH_WRITE_EVENTS__?: unknown[];
      }).__VH_MESH_WRITE_EVENTS__;
      return Array.isArray(events) ? events.slice(-5) : [];
    }).catch(() => []);
    throw new Error(
      `vote-mesh-write-not-confirmed:${topicId}:${pointId}:recent=${JSON.stringify(recentEvents)}:error=${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function simulateRead(page: Page): Promise<void> {
  await page.mouse.wheel(0, 420).catch(() => undefined);
  await page.waitForTimeout(5_250);
}

async function ensureStoryThread(card: Locator, target: StoryTarget): Promise<void> {
  const discussion = card.getByTestId(`news-card-${target.topicId}-discussion`);
  await discussion.waitFor({ state: 'visible', timeout: 15_000 });
  const threadHead = card.getByTestId(`news-card-${target.topicId}-thread-head`);
  const startButton = card.getByTestId(`news-card-${target.topicId}-discussion-new-thread-toggle`);

  const threadOrCreateReady = await waitFor(async () =>
    (await threadHead.isVisible().catch(() => false))
    || (await startButton.isVisible().catch(() => false)), COMMENT_TIMEOUT_MS, 250);
  if (!threadOrCreateReady) {
    const text = ((await discussion.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
    throw new Error(`story-thread-controls-not-ready:${target.storyId}:${text.slice(0, 240)}`);
  }
  if (await threadHead.isVisible().catch(() => false)) {
    return;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await threadHead.isVisible().catch(() => false)) {
      return;
    }
    if (!(await startButton.isVisible().catch(() => false))) {
      await discussion.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
      continue;
    }

    await startButton.click({ timeout: 5_000 }).catch(() => undefined);
    const composer = card.getByTestId('thread-content');
    const composerOrThreadReady = await waitFor(async () =>
      (await threadHead.isVisible().catch(() => false))
      || (await composer.isVisible().catch(() => false)), 15_000, 250);
    if (!composerOrThreadReady) {
      continue;
    }
    if (await threadHead.isVisible().catch(() => false)) {
      return;
    }

    await composer.fill(`Opening the shared story thread for ${target.headline}. [${RUN_ID}]`);
    const tags = card.locator('input[placeholder="Tags (comma separated)"]');
    if (await tags.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await tags.fill('news, beta-test');
    }
    await card.getByTestId('submit-thread-btn').click();
    await threadHead.waitFor({ state: 'visible', timeout: 30_000 });
    return;
  }

  const text = ((await discussion.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
  throw new Error(`story-thread-create-failed:${target.storyId}:${text.slice(0, 240)}`);
}

async function postComment(card: Locator, topicId: string, body: string, replyToBody?: string): Promise<void> {
  await card.getByTestId(`news-card-${topicId}-thread-head`).waitFor({ state: 'visible', timeout: COMMENT_TIMEOUT_MS });
  let composerScope: Locator;
  if (replyToBody) {
    const replyTarget = renderedComment(card, replyToBody);
    await replyTarget.scrollIntoViewIfNeeded().catch(() => undefined);
    const replyButton = replyTarget.locator('[data-testid^="reply-btn-"]').first();
    if (await replyButton.isVisible().catch(() => false)) {
      await replyButton.click();
      composerScope = replyTarget.getByTestId('comment-composer-container');
    } else {
      await card.getByTestId(`news-card-${topicId}-discussion-compose-toggle`).click();
      composerScope = card.getByTestId('comment-composer-container').last();
    }
  } else {
    await card.getByTestId(`news-card-${topicId}-discussion-compose-toggle`).click();
    composerScope = card.getByTestId('comment-composer-container').last();
  }
  await composerScope.waitFor({ state: 'visible', timeout: 15_000 });
  await composerScope.getByTestId('comment-composer').fill(body);
  await composerScope.getByTestId('submit-comment-btn').click();

  const submitted = await waitFor(
    async () => !(await composerScope.isVisible().catch(() => false)),
    COMMENT_TIMEOUT_MS,
    500,
  );
  if (!submitted) {
    const error = ((await composerScope.getByTestId('comment-composer-error').textContent().catch(() => '')) ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    throw new Error(`comment-submit-not-durable:${topicId}:${error || 'composer stayed open without error'}`);
  }

  const posted = await waitFor(
    async () => renderedComment(card, body).isVisible().catch(() => false),
    COMMENT_TIMEOUT_MS,
    500,
  );
  if (!posted) {
    const error = ((await composerScope.getByTestId('comment-composer-error').textContent().catch(() => '')) ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    throw new Error(`comment-not-visible-after-submit:${topicId}:${error || 'no composer error'}`);
  }
}

function renderedComment(card: Locator, body: string): Locator {
  return card.locator('[data-testid^="comment-"][role="article"]').filter({ hasText: body }).first();
}

async function missingComments(card: Locator, comments: readonly string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const comment of comments) {
    const visible = await renderedComment(card, comment).isVisible().catch(() => false);
    if (!visible) missing.push(comment);
  }
  return missing;
}

async function waitForComments(opened: OpenedStory, target: StoryTarget, comments: readonly string[]): Promise<OpenedStory> {
  const startedAt = Date.now();
  let deadline = Date.now() + COMMENT_TIMEOUT_MS;
  let current = opened;
  let missing = await missingComments(current.card, comments);
  let reacquired = false;

  while (missing.length > 0 && Date.now() < deadline) {
    await current.user.page.waitForTimeout(1_000);
    if (!reacquired && Date.now() - startedAt > Math.floor(COMMENT_TIMEOUT_MS / 2)) {
      await replaceUserPage(current.user);
      current = await openStoryForUser(current.user, target);
      reacquired = true;
      deadline = Math.max(deadline, Date.now() + Math.floor(COMMENT_TIMEOUT_MS / 2));
    }
    missing = await missingComments(current.card, comments);
  }

  if (missing.length > 0) {
    throw new Error(
      `comments-not-visible:${target.storyId}:user=${current.user.label}:visible=${comments.length - missing.length}:missing=${missing.map((comment) => JSON.stringify(comment)).join(',')}`,
    );
  }

  return current;
}

async function readFeedMetric(page: Page, topicId: string, metric: 'eye' | 'lightbulb'): Promise<number> {
  await gotoFeed(page);
  const text = (await page.getByTestId(`news-card-${metric}-${topicId}`).textContent()) ?? '';
  const value = Number.parseFloat(text.replace(/[^\d.]+/g, ''));
  return Number.isFinite(value) ? value : 0;
}

function buildUserLabels(count: number): string[] {
  return Array.from({ length: count }, (_unused, index) => DEFAULT_LABELS[index] ?? `user${index + 1}`);
}

test.describe('full product mock-user news engagement', () => {
  test.skip(!SHOULD_RUN, 'Set VH_RUN_FULL_PRODUCT_MOCK_USERS=true to run the mock-user live engagement test');

  test(`${USER_COUNT} users read, vote, and discuss singleton and bundled news stories through the mesh`, async ({ browser }, testInfo) => {
    test.setTimeout(30 * 60_000);

    if (USER_COUNT < 2) {
      throw new Error(`mock-user-count-too-low:${USER_COUNT}`);
    }

    const labels = buildUserLabels(USER_COUNT);
    const users: UserSession[] = [];

    try {
      for (const label of labels) {
        const context = await browser.newContext({ ignoreHTTPSErrors: true });
        const page = await context.newPage();
        await ensureIdentity(page, label);
        users.push({ label, context, page });
      }

      const targets = await discoverTargets(users[0]!.page);
      const storyResults: Array<{
        target: StoryTarget;
        expectedMinimumVotes: VoteCounts;
        comments: string[];
      }> = [];

      for (const target of targets) {
        const opened = await Promise.all(users.map(async (user) => {
          const page = await gotoUserFeed(user);
          const card = await openStory(page, target);
          const pointId = await waitForAnalysisReady(card, target.topicId);
          return { user, card, pointId };
        }));

        await ensureStoryThread(opened[0]!.card, target);
        await Promise.all(opened.map(async ({ user }) => simulateRead(user.page)));
        await Promise.all(opened.map(async ({ card }) => closeStory(card, target.topicId).catch(() => undefined)));

        const reopened = await Promise.all(users.map(async (user) => {
          return openStoryForUser(user, target);
        }));

        const baseline = await voteCounts(reopened[0]!.card, reopened[0]!.pointId);
        const comments: string[] = [];
        let agreeAdds = 0;
        let disagreeAdds = 0;

        for (let index = 0; index < reopened.length; index += 1) {
          if (comments.length > 0) {
            reopened[index] = await openStoryForUser(reopened[index]!.user, target);
            reopened[index] = await waitForComments(reopened[index]!, target, comments);
          }

          const openedStory = reopened[index]!;
          const agree = index % 2 === 0;
          const button = openedStory.card.getByTestId(`${agree ? 'cell-vote-agree' : 'cell-vote-disagree'}-${openedStory.pointId}`);
          await waitForVoteMeshWrite(openedStory.user.page, target.topicId, openedStory.pointId, async () => {
            await button.click();
            await expect(button).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
          });
          if (agree) agreeAdds += 1;
          else disagreeAdds += 1;

          const body = `[${RUN_ID}] ${openedStory.user.label} read ${target.kind} story ${target.storyId} and ${agree ? 'supports' : 'questions'} the first frame.`;
          const replyToBody = comments.length > 0 ? comments[comments.length - 1] : undefined;
          comments.push(body);
          await postComment(openedStory.card, target.topicId, body, replyToBody);
        }

        const expectedMinimumVotes = {
          agree: baseline.agree + agreeAdds,
          disagree: baseline.disagree + disagreeAdds,
        };
        const observerIndex = reopened.length - 1;
        reopened[observerIndex] = await openStoryForUser(reopened[observerIndex]!.user, target);
        await waitForVoteCountsAtLeast(
          reopened[observerIndex]!.card,
          reopened[observerIndex]!.pointId,
          expectedMinimumVotes,
        );
        reopened[observerIndex] = await waitForComments(reopened[observerIndex]!, target, comments);

        for (let index = 0; index < reopened.length; index += 1) {
          reopened[index] = await openStoryForUser(reopened[index]!.user, target);
          reopened[index] = await waitForComments(reopened[index]!, target, comments);
          const { card } = reopened[index]!;
          await closeStory(card, target.topicId).catch(() => undefined);
        }

        storyResults.push({ target, expectedMinimumVotes, comments });
        await reloadUserPages(users);
      }

      for (const result of storyResults) {
        const observer = users[users.length - 1]!.page;
        await expect.poll(() => readFeedMetric(observer, result.target.topicId, 'eye'), { timeout: AGGREGATE_TIMEOUT_MS })
          .toBeGreaterThan(0);
        await expect.poll(() => readFeedMetric(observer, result.target.topicId, 'lightbulb'), { timeout: AGGREGATE_TIMEOUT_MS })
          .toBeGreaterThan(0);
      }

      await testInfo.attach('five-user-news-engagement-summary', {
        body: JSON.stringify({
          users: labels,
          runId: RUN_ID,
          stories: storyResults.map((result) => ({
            kind: result.target.kind,
            topicId: result.target.topicId,
            storyId: result.target.storyId,
            headline: result.target.headline,
            sourceBadgeCount: result.target.sourceBadgeCount,
            expectedMinimumVotes: result.expectedMinimumVotes,
            commentCount: result.comments.length,
          })),
        }, null, 2),
        contentType: 'application/json',
      });
    } finally {
      await Promise.all(users.map((user) => user.context.close().catch(() => undefined)));
    }
  });
});
