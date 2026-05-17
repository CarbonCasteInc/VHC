#!/usr/bin/env node

import { chromium } from '@playwright/test';
import { createClient, readNewsLatestIndex, readNewsStory, readTopicLatestSynthesis } from '@vh/gun-client';
import { readFileSync } from 'node:fs';
import { mkdir, rm, symlink, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const DEFAULT_BASE_URL = 'http://127.0.0.1:2048/';
const DEFAULT_GUN_PEER_URL = 'http://127.0.0.1:7777/gun';
const DEFAULT_MIN_HEADLINES = 4;
const DEFAULT_READY_TIMEOUT_MS = 12 * 60_000;
const DEFAULT_ANALYSIS_TIMEOUT_MS = 120_000;
const DEFAULT_REFRESH_TIMEOUT_MS = 15_000;

function normalizeUrl(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function normalizeGunPeer(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/gun') ? trimmed : `${trimmed.replace(/\/+$/, '')}/gun`;
}

function storyDetailUrl(baseUrl, storyId) {
  const url = new URL(baseUrl);
  url.searchParams.set('detail', `news:${storyId}`);
  return url.href;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveArtifactDir(env = process.env, repoRoot = DEFAULT_REPO_ROOT) {
  const explicit = env.VH_PUBLIC_FEED_SMOKE_ARTIFACT_DIR?.trim();
  if (explicit) return explicit;
  return path.join(repoRoot, '.tmp', 'release-evidence', 'public-feed-browser-smoke', String(Date.now()));
}

function cssAttr(value) {
  return JSON.stringify(String(value));
}

function parseVoteCount(text) {
  const match = String(text ?? '').match(/[+-]\s*(\d+)/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function readFixtureConst(source, name) {
  const match = source.match(new RegExp(`export const ${name} =\\n?\\s*'([^']+)';`));
  if (!match) throw new Error(`missing ${name}`);
  return match[1];
}

function loadE2eSystemWriterPin(repoRoot = DEFAULT_REPO_ROOT) {
  const explicit = process.env.VITE_E2E_SYSTEM_WRITER_PIN_JSON?.trim()
    || process.env.VH_E2E_SYSTEM_WRITER_PIN_JSON?.trim();
  if (explicit) return JSON.parse(explicit);

  const source = readFileSync(
    path.join(repoRoot, 'packages', 'e2e', 'src', 'live', 'lumaSystemWriterTestFixture.ts'),
    'utf8',
  );
  const writerId = readFixtureConst(source, 'E2E_SYSTEM_WRITER_ID');
  const publicKey = readFixtureConst(source, 'E2E_SYSTEM_WRITER_PUBLIC_KEY_SPKI_BASE64URL');
  return {
    pinVersion: 1,
    schemaEpoch: 'luma-public-v1',
    maxProtocolVersion: 'luma-public-v1',
    signatureSuite: 'jcs-ed25519-sha256-v1',
    writers: [
      {
        id: writerId,
        status: 'active',
        publicKey: {
          encoding: 'spki-base64url',
          material: publicKey,
        },
      },
    ],
  };
}

function trimText(value, max = 240) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function formatError(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function locatorTimeout(timeout = 1_500) {
  return { timeout };
}

async function writeAtomicJson(targetPath, value) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tempPath, targetPath);
}

async function updateLatestSymlink(artifactDir, repoRoot) {
  const latestPath = path.join(repoRoot, '.tmp', 'release-evidence', 'public-feed-browser-smoke', 'latest');
  await rm(latestPath, { recursive: true, force: true });
  try {
    await symlink(artifactDir, latestPath, 'dir');
  } catch {
    await mkdir(latestPath, { recursive: true });
    await writeAtomicJson(path.join(latestPath, 'latest-artifact.json'), { artifactDir });
  }
}

function viewportScreenshotOptions(path) {
  return {
    path,
    fullPage: false,
    animations: 'disabled',
  };
}

async function waitFor(label, predicate, { timeoutMs, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  const suffix = lastError ? `:${lastError instanceof Error ? lastError.message : String(lastError)}` : '';
  throw new Error(`${label}-timeout${suffix}`);
}

async function withTimeout(label, promise, timeoutMs) {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label}-timeout`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readGunLatestProof({ gunPeerUrl, minHeadlines, timeoutMs, systemWriterPin }) {
  const client = createClient({
    peers: [gunPeerUrl],
    requireSession: false,
    gunLocalStorage: false,
    gunRadisk: false,
    systemWriterPin,
  });
  client.markSessionReady();
  try {
    const indexReadTimeoutMs = Math.min(10_000, Math.max(2_000, Math.floor(timeoutMs / 12)));
    const storyReadTimeoutMs = Math.min(5_000, Math.max(1_500, Math.floor(timeoutMs / 24)));
    return await waitFor('gun-latest-index-readback', async () => {
      const latestIndex = await withTimeout('gun-latest-index-read', readNewsLatestIndex(client), indexReadTimeoutMs);
      const entries = Object.entries(latestIndex)
        .filter(([, timestamp]) => Number.isFinite(timestamp))
        .sort((left, right) => right[1] - left[1]);
      if (entries.length < minHeadlines) return null;
      const stories = [];
      for (const [storyId, updatedAt] of entries.slice(0, Math.max(minHeadlines, 16))) {
        const story = await withTimeout('gun-story-read', readNewsStory(client, storyId), storyReadTimeoutMs);
        if (story) {
          const synthesis = story.topic_id
            ? await withTimeout(
              'gun-topic-synthesis-read',
              readTopicLatestSynthesis(client, story.topic_id),
              storyReadTimeoutMs,
            ).catch(() => null)
            : null;
          stories.push({
            storyId,
            topicId: story.topic_id,
            updatedAt,
            headline: story.headline,
            sourceCount: story.sources?.length ?? 0,
            acceptedSynthesisReady: Boolean(synthesis?.facts_summary?.trim() && (synthesis.frames?.length ?? 0) > 0),
            synthesisId: synthesis?.synthesis_id ?? null,
          });
        }
      }
      if (stories.length < minHeadlines) return null;
      return {
        latestIndexCount: entries.length,
        storyReadbackCount: stories.length,
        topStories: stories.slice(0, 8),
      };
    }, { timeoutMs, intervalMs: 2_000 });
  } finally {
    await Promise.race([
      client.shutdown(),
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]).catch(() => {});
  }
}

async function addConsumerInitScript(context, gunPeerUrl) {
  await context.addInitScript({
    content: `
      window.__VH_NEWS_RUNTIME_ROLE = 'consumer';
      window.__VH_TEST_SESSION = false;
      window.__VH_EXPOSE_NEWS_STORE__ = true;
      window.__VH_GUN_PEERS__ = [${JSON.stringify(gunPeerUrl)}];
    `,
  });
}

async function refreshLatest(page, limit = 120, timeoutMs = DEFAULT_REFRESH_TIMEOUT_MS) {
  return page.evaluate(async ({ refreshLimit, refreshTimeoutMs }) => {
    const store = window.__VH_NEWS_STORE__;
    const refresh = store?.getState?.().refreshLatest;
    if (typeof refresh !== 'function') return { status: 'missing-refreshLatest' };

    let timeoutId;
    try {
      return await Promise.race([
        Promise.resolve(refresh(refreshLimit))
          .then(() => ({ status: 'ok' }))
          .catch((error) => ({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          })),
        new Promise((resolve) => {
          timeoutId = setTimeout(() => resolve({ status: 'timeout' }), refreshTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
  }, { refreshLimit: limit, refreshTimeoutMs: timeoutMs }).catch((error) => ({
    status: 'evaluate-error',
    message: error instanceof Error ? error.message : String(error),
  }));
}

async function visibleCards(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('article[data-testid^="news-card-"]'))
    .map((card) => {
      const headline = card.querySelector('[data-testid^="news-card-headline-"]');
      const hotness = card.querySelector('[data-testid^="news-card-hotness-"]');
      const meta = Array.from(card.querySelectorAll('p')).find((node) => (node.textContent ?? '').includes('Created '));
      if (!headline || !meta) return null;
      return {
        topicId: (headline.getAttribute('data-testid') ?? '').replace('news-card-headline-', ''),
        storyId: headline.getAttribute('data-story-id') ?? '',
        headline: (headline.textContent ?? '').replace(/\s+/g, ' ').trim(),
        meta: (meta.textContent ?? '').replace(/\s+/g, ' ').trim(),
        hotness: Number.parseFloat((hotness?.textContent ?? '').replace('Hotness', '').trim()) || 0,
        sourceLabels: Array.from(card.querySelectorAll('[data-testid^="source-badge-"]'))
          .map((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim())
          .filter(Boolean),
      };
    })
    .filter((row) => row && row.topicId && row.storyId && row.headline));
}

async function clickFeedRefresh(page) {
  const refreshButton = page.getByTestId('feed-refresh-button');
  if (!(await refreshButton.count().catch(() => 0))) return false;
  await refreshButton.click({ timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(500).catch(() => {});
  return true;
}

async function waitForHeadlines(page, minHeadlines, timeoutMs) {
  return waitFor('public-feed-headlines', async () => {
    const rows = await visibleCards(page);
    if (rows.length >= minHeadlines) return rows;
    await clickFeedRefresh(page);
    await page.evaluate(() => window.scrollBy(0, Math.max(400, window.innerHeight))).catch(() => {});
    await page.waitForTimeout(300).catch(() => {});
    return null;
  }, { timeoutMs, intervalMs: 1_000 });
}

async function gotoFeed(page, baseUrl, minHeadlines, timeoutMs) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.getByTestId('user-link').waitFor({ state: 'visible', timeout: 30_000 });
  return waitForHeadlines(page, minHeadlines, timeoutMs);
}

async function ensureIdentity(page, baseUrl, label) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.getByTestId('user-link').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('user-link').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  const welcome = page.getByTestId('welcome-msg');
  if (await welcome.isVisible().catch(() => false)) {
    return { created: false, label: trimText(await welcome.textContent()) };
  }
  const createButton = page.getByTestId('create-identity-btn');
  await createButton.waitFor({ state: 'visible', timeout: 30_000 });
  const suffix = `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 1000)}`;
  const username = `${label}${suffix}`.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24);
  const handle = username.toLowerCase().slice(0, 24);
  await page.fill('input[placeholder="Choose a username"]', username);
  await page.fill('input[placeholder="Choose a handle (letters, numbers, _)"]', handle);
  await createButton.click();
  await welcome.waitFor({ state: 'visible', timeout: 45_000 });
  return { created: true, username, handle, label: trimText(await welcome.textContent()) };
}

function headlineLocator(page, row) {
  return page.locator(
    `[data-testid=${cssAttr(`news-card-headline-${row.topicId}`)}][data-story-id=${cssAttr(row.storyId)}]`,
  ).first();
}

async function openStory(page, row) {
  const headline = headlineLocator(page, row);
  const card = headline.locator('xpath=ancestor::article[1]');
  const back = card.getByTestId(`news-card-back-${row.topicId}`);
  if (await back.isVisible().catch(() => false)) {
    return card;
  }
  await headline.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await headline.click().catch(async (error) => {
    if (await back.isVisible().catch(() => false)) return;
    await headline.evaluate((element) => {
      if (element instanceof HTMLElement) {
        element.click();
      }
    }).catch(() => {
      throw error;
    });
  });
  await card.getByTestId(`news-card-back-${row.topicId}`).waitFor({ state: 'visible', timeout: 30_000 });
  return card;
}

async function closeStory(card, row) {
  await card.getByTestId(`news-card-back-button-${row.topicId}`).click().catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 300));
}

async function waitForSynthesis(card, row, timeoutMs) {
  return waitFor('accepted-synthesis-visible', async () => {
    const summary = card.getByTestId(`news-card-summary-${row.topicId}`);
    const summaryText = trimText(await summary.textContent(locatorTimeout()).catch(() => ''), 2_000);
    const basis = trimText(await card.getByTestId(`news-card-summary-basis-${row.topicId}`).textContent(locatorTimeout()).catch(() => ''));
    const provenance = trimText(await card.getByTestId(`news-card-synthesis-provenance-${row.topicId}`).textContent(locatorTimeout()).catch(() => ''), 2_000);
    const voteButtons = await card.locator('[data-testid^="cell-vote-agree-"]').count().catch(() => 0);
    if (summaryText.length > 20 && !/pending/i.test(summaryText) && voteButtons > 0) {
      return { summaryText, basis, provenance, voteButtonCount: voteButtons };
    }
    return null;
  }, { timeoutMs, intervalMs: 750 });
}

async function openStoryWithAcceptedSynthesis(page, candidateRows, analysisTimeoutMs) {
  const candidates = [];
  const seenStoryIds = new Set();
  for (const row of [
    ...candidateRows.filter((candidate) => candidate.sourceLabels.length >= 2),
    ...candidateRows,
  ]) {
    if (seenStoryIds.has(row.storyId)) continue;
    seenStoryIds.add(row.storyId);
    candidates.push(row);
  }

  const rejectedCandidates = [];
  const perCandidateTimeoutMs = Math.min(45_000, analysisTimeoutMs);
  for (const row of candidates.slice(0, 16)) {
    let card;
    try {
      card = await openStory(page, row);
    } catch (error) {
      rejectedCandidates.push({
        storyId: row.storyId,
        headline: row.headline,
        reason: `open-story-failed:${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    try {
      const synthesis = await waitForSynthesis(card, row, perCandidateTimeoutMs);
      return { row, card, synthesis, rejectedCandidates };
    } catch (error) {
      rejectedCandidates.push({
        storyId: row.storyId,
        headline: row.headline,
        reason: error instanceof Error ? error.message : String(error),
      });
      await closeStory(card, row);
    }
  }

  throw new Error(
    `accepted-synthesis-visible-timeout:${rejectedCandidates.map((item) => `${item.storyId}:${item.reason}`).join('|')}`,
  );
}

async function firstVoteTarget(card) {
  const button = card.locator('[data-testid^="cell-vote-agree-"]').first();
  await button.waitFor({ state: 'visible', timeout: 30_000 });
  const testId = await button.getAttribute('data-testid');
  const canonicalPointId = await button.getAttribute('data-canonical-point-id');
  if (!testId) throw new Error('missing-vote-button-testid');
  const pointId = testId.replace('cell-vote-agree-', '');
  const disagree = card.getByTestId(`cell-vote-disagree-${pointId}`);
  return {
    pointId,
    canonicalPointId,
    agree: button,
    disagree,
    beforeAgree: parseVoteCount(await button.textContent(locatorTimeout(5_000))),
    beforeDisagree: parseVoteCount(await disagree.textContent(locatorTimeout()).catch(() => '')),
  };
}

async function voteAgree(card) {
  const target = await firstVoteTarget(card);
  await target.agree.click();
  await target.agree.waitFor({ state: 'visible', timeout: 10_000 });
  await waitFor('point-stance-write-readback', async () => {
    const pressed = await target.agree.getAttribute('aria-pressed', locatorTimeout()).catch(() => null);
    const count = parseVoteCount(await target.agree.textContent(locatorTimeout()).catch(() => ''));
    return pressed === 'true' && count >= target.beforeAgree + 1
      ? { ...target, afterAgree: count, afterDisagree: parseVoteCount(await target.disagree.textContent(locatorTimeout()).catch(() => '')) }
      : null;
  }, { timeoutMs: 45_000, intervalMs: 500 });
  return {
    pointId: target.pointId,
    canonicalPointId: target.canonicalPointId,
    beforeAgree: target.beforeAgree,
    beforeDisagree: target.beforeDisagree,
    afterAgree: parseVoteCount(await target.agree.textContent(locatorTimeout()).catch(() => '')),
    afterDisagree: parseVoteCount(await target.disagree.textContent(locatorTimeout()).catch(() => '')),
  };
}

async function findAgreeButtonByCanonical(card, canonicalPointId, fallbackPointId) {
  if (canonicalPointId) {
    const byCanonical = card.locator(
      `[data-testid^="cell-vote-agree-"][data-canonical-point-id=${cssAttr(canonicalPointId)}]`,
    ).first();
    if (await byCanonical.count().catch(() => 0)) return byCanonical;
  }
  return card.getByTestId(`cell-vote-agree-${fallbackPointId}`).first();
}

async function ensureStoryThread(page, row) {
  const sectionId = `news-card-${row.topicId}`;
  const section = page.getByTestId(`${sectionId}-discussion`);
  await section.waitFor({ state: 'visible', timeout: 30_000 });
  const composeToggle = page.getByTestId(`${sectionId}-discussion-compose-toggle`);
  if (await composeToggle.isVisible().catch(() => false)) {
    return { sectionId, createdThread: false };
  }
  const newThreadToggle = page.getByTestId(`${sectionId}-discussion-new-thread-toggle`);
  await newThreadToggle.waitFor({ state: 'visible', timeout: 30_000 });
  await newThreadToggle.click();
  const trustGate = page.getByTestId(`${sectionId}-discussion-new-thread-trust-gate`);
  const threadContent = page.getByTestId('thread-content');
  try {
    await waitFor('story-thread-form-unlocked', async () =>
      (await threadContent.isVisible().catch(() => false)) ? true : null,
    { timeoutMs: 30_000, intervalMs: 500 });
  } catch (error) {
    if (await trustGate.isVisible().catch(() => false)) {
      throw new Error('story-thread-create-blocked-by-trust-gate');
    }
    throw error;
  }
  const content = `Launch smoke thread for ${row.storyId} at ${new Date().toISOString()}`;
  await threadContent.fill(content);
  await page.getByTestId('submit-thread-btn').click();
  await page.getByTestId(`${sectionId}-thread-head`).waitFor({ state: 'visible', timeout: 45_000 });
  await composeToggle.waitFor({ state: 'visible', timeout: 30_000 });
  return { sectionId, createdThread: true, threadSeedContent: content };
}

async function postedCommentVisible(page, body) {
  return page.evaluate((expected) => {
    const nodes = Array.from(document.querySelectorAll('[data-testid^="comment-"]'));
    return nodes.some((node) => {
      const testId = node.getAttribute('data-testid') ?? '';
      if (
        testId.startsWith('comment-composer')
        || testId.startsWith('comment-stream')
        || testId.startsWith('comment-hidden')
      ) {
        return false;
      }
      if (!/^comment-[0-9a-f][0-9a-f-]{7,}/i.test(testId)) return false;
      return (node.textContent ?? '').includes(expected);
    });
  }, body).catch(() => false);
}

async function createStoryComment(page, row) {
  const thread = await ensureStoryThread(page, row);
  await page.getByTestId(`${thread.sectionId}-discussion-compose-toggle`).click();
  const body = `Launch smoke reply ${Date.now()} ${Math.floor(Math.random() * 1000)}`;
  await page.getByTestId('comment-composer').fill(body);
  await page.getByTestId('submit-comment-btn').click();
  await waitFor('story-comment-submit-complete', async () => {
    const composerError = page.getByTestId('comment-composer-error');
    if (await composerError.isVisible().catch(() => false)) {
      throw new Error(`story-comment-submit-error:${trimText(await composerError.textContent(locatorTimeout()), 1_000)}`);
    }
    if (await postedCommentVisible(page, body)) return true;
    const composerVisible = await page.getByTestId('comment-composer').isVisible().catch(() => false);
    return composerVisible ? null : true;
  }, { timeoutMs: 90_000, intervalMs: 500 });
  await waitFor('story-comment-visible', async () =>
    (await postedCommentVisible(page, body)) ? true : null,
  { timeoutMs: 45_000, intervalMs: 500 });
  const countText = trimText(await page.getByTestId(`${thread.sectionId}-discussion-count`).textContent().catch(() => ''));
  return { ...thread, body, countText };
}

async function verifyReloadPersistence(page, baseUrl, row, voteProof, commentBody, analysisTimeoutMs, progress = () => {}) {
  progress('reload-start', { storyId: row.storyId });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 });
  progress('reload-domcontentloaded', { url: page.url() || baseUrl });
  await waitForHeadlines(page, 1, 90_000);
  progress('reload-headlines-visible');
  const card = await openStory(page, row);
  progress('reload-story-open');
  await waitForSynthesis(card, row, analysisTimeoutMs);
  progress('reload-synthesis-visible');
  const agree = await findAgreeButtonByCanonical(card, voteProof.canonicalPointId, voteProof.pointId);
  await waitFor('reload-vote-persistence', async () =>
    (await agree.getAttribute('aria-pressed', locatorTimeout()).catch(() => null)) === 'true',
  { timeoutMs: 45_000, intervalMs: 500 });
  progress('reload-vote-visible');
  await waitFor('reload-comment-persistence', async () =>
    (await postedCommentVisible(page, commentBody)) ? true : null,
  { timeoutMs: 45_000, intervalMs: 500 });
  progress('reload-comment-visible');
  return {
    votePressed: await agree.getAttribute('aria-pressed', locatorTimeout()),
    commentVisible: true,
    url: page.url() || baseUrl,
  };
}

async function verifySecondBrowser({ browser, baseUrl, gunPeerUrl, row, voteProof, commentBody, analysisTimeoutMs, progress = () => {} }) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await addConsumerInitScript(context, gunPeerUrl);
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  try {
    progress('second-browser-start', { storyId: row.storyId });
    await gotoFeed(page, baseUrl, 1, 120_000);
    progress('second-browser-feed-visible');
    await page.goto(storyDetailUrl(baseUrl, row.storyId), { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.getByTestId('user-link').waitFor({ state: 'visible', timeout: 30_000 });
    await waitForHeadlines(page, 1, 120_000);
    progress('second-browser-detail-route-visible');
    const card = await openStory(page, row);
    progress('second-browser-story-open');
    await waitForSynthesis(card, row, analysisTimeoutMs);
    progress('second-browser-synthesis-visible');
    const agree = await findAgreeButtonByCanonical(card, voteProof.canonicalPointId, voteProof.pointId);
    const voteCount = await waitFor('second-browser-vote-visibility', async () => {
    const count = parseVoteCount(await agree.textContent(locatorTimeout()).catch(() => ''));
    return count >= voteProof.afterAgree ? count : null;
  }, { timeoutMs: 45_000, intervalMs: 500 });
    progress('second-browser-vote-visible', { voteCount });
    await waitFor('second-browser-comment-visibility', async () =>
      (await postedCommentVisible(page, commentBody)) ? true : null,
    { timeoutMs: 45_000, intervalMs: 500 });
    progress('second-browser-comment-visible');
    return {
      voteCount,
      commentVisible: true,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function runPublicFeedBrowserSmoke({
  repoRoot = DEFAULT_REPO_ROOT,
  env = process.env,
  launchBrowser = () => chromium.launch({ headless: env.VH_PUBLIC_FEED_SMOKE_HEADLESS !== 'false' }),
} = {}) {
  const baseUrl = normalizeUrl(env.VH_PUBLIC_FEED_APP_URL || env.VH_LIVE_BASE_URL || DEFAULT_BASE_URL);
  const gunPeerUrl = normalizeGunPeer(env.VH_PUBLIC_FEED_GUN_PEER_URL || env.VITE_GUN_PEERS?.replace(/^\[?"?|"?\]?$/g, '') || DEFAULT_GUN_PEER_URL);
  const minHeadlines = parsePositiveInt(env.VH_PUBLIC_FEED_SMOKE_MIN_HEADLINES, DEFAULT_MIN_HEADLINES);
  const readyTimeoutMs = parsePositiveInt(env.VH_PUBLIC_FEED_SMOKE_READY_TIMEOUT_MS, DEFAULT_READY_TIMEOUT_MS);
  const analysisTimeoutMs = parsePositiveInt(env.VH_PUBLIC_FEED_SMOKE_ANALYSIS_TIMEOUT_MS, DEFAULT_ANALYSIS_TIMEOUT_MS);
  const artifactDir = resolveArtifactDir(env, repoRoot);
  const logs = [];
  const progress = (step, details = {}) => {
    logs.push({ type: 'progress', text: step, details });
    const suffix = Object.keys(details).length ? ` ${JSON.stringify(details)}` : '';
    console.error(`[vh:public-feed-smoke] ${step}${suffix}`);
  };
  const summaryPath = path.join(artifactDir, 'public-feed-browser-smoke-summary.json');
  const logsPath = path.join(artifactDir, 'public-feed-browser-smoke-browser-logs.json');
  const screenshots = {
    initialFeed: path.join(artifactDir, '01-feed-initial.png'),
    afterRefresh: path.join(artifactDir, '02-feed-after-refresh.png'),
    afterScroll: path.join(artifactDir, '03-feed-after-scroll.png'),
    storyDetail: path.join(artifactDir, '04-story-detail-synthesis.png'),
    afterComment: path.join(artifactDir, '05-story-comment.png'),
    reloadPersistence: path.join(artifactDir, '06-reload-persistence.png'),
  };
  await mkdir(artifactDir, { recursive: true });

  let browser;
  let context;
  let summary = {
    schemaVersion: 'public-feed-browser-smoke-summary-v1',
    generatedAt: new Date().toISOString(),
    artifactDir,
    artifactPaths: { summaryPath, logsPath, screenshots },
    config: { baseUrl, gunPeerUrl, minHeadlines, readyTimeoutMs, analysisTimeoutMs },
    status: 'fail',
    checks: {},
  };

  try {
    const gunReadback = await readGunLatestProof({
      gunPeerUrl,
      minHeadlines,
      timeoutMs: readyTimeoutMs,
      systemWriterPin: loadE2eSystemWriterPin(repoRoot),
    });
    browser = await launchBrowser();
    context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1200 } });
    await addConsumerInitScript(context, gunPeerUrl);
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on('console', (message) => logs.push({ type: message.type(), text: message.text() }));
    page.on('pageerror', (error) => logs.push({ type: 'pageerror', text: formatError(error) }));

    progress('identity-start');
    const identity = await ensureIdentity(page, baseUrl, 'launchsmoke');
    progress('identity-complete', identity);
    const initialCards = await gotoFeed(page, baseUrl, minHeadlines, readyTimeoutMs);
    await page.screenshot(viewportScreenshotOptions(screenshots.initialFeed));
    progress('initial-feed-screenshot', { count: initialCards.length });
    const cardsWithSources = initialCards.filter((card) => card.sourceLabels.length > 0);
    const cardsWithTimestamps = initialCards.filter((card) => /Created .+Updated /i.test(card.meta));
    if (cardsWithSources.length < minHeadlines) throw new Error(`source-labels-missing:${cardsWithSources.length}/${minHeadlines}`);
    if (cardsWithTimestamps.length < minHeadlines) throw new Error(`timestamps-missing:${cardsWithTimestamps.length}/${minHeadlines}`);

    await clickFeedRefresh(page);
    const afterRefreshCards = await waitForHeadlines(page, minHeadlines, 60_000);
    await page.screenshot(viewportScreenshotOptions(screenshots.afterRefresh));
    progress('refresh-screenshot', { count: afterRefreshCards.length });

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1_500);
    const afterScrollCards = await visibleCards(page);
    await page.screenshot(viewportScreenshotOptions(screenshots.afterScroll));
    progress('scroll-screenshot', { count: afterScrollCards.length });
    if (afterScrollCards.length < minHeadlines) throw new Error(`scroll-feed-lost-headlines:${afterScrollCards.length}/${minHeadlines}`);

    await page.evaluate(() => window.scrollTo(0, 0));
    const topCards = await waitForHeadlines(page, minHeadlines, 60_000);
    const synthesisReadyStoryIds = new Set(
      gunReadback.topStories
        .filter((story) => story.acceptedSynthesisReady)
        .map((story) => story.storyId),
    );
    const detailCandidates = [
      ...topCards.filter((card) => synthesisReadyStoryIds.has(card.storyId)),
      ...topCards.filter((card) => !synthesisReadyStoryIds.has(card.storyId)),
    ];
    progress('detail-candidates', {
      ready: detailCandidates.filter((card) => synthesisReadyStoryIds.has(card.storyId)).length,
      total: detailCandidates.length,
    });
    const detail = await openStoryWithAcceptedSynthesis(page, detailCandidates, analysisTimeoutMs);
    const target = detail.row;
    const card = detail.card;
    const synthesis = detail.synthesis;
    await page.screenshot(viewportScreenshotOptions(screenshots.storyDetail));
    progress('story-detail-screenshot', { storyId: target.storyId, topicId: target.topicId });
    const voteProof = await voteAgree(card);
    progress('vote-readback', { pointId: voteProof.pointId, afterAgree: voteProof.afterAgree });
    const comment = await createStoryComment(page, target);
    await page.screenshot(viewportScreenshotOptions(screenshots.afterComment));
    progress('comment-screenshot', { threadId: comment.sectionId, body: comment.body });
    const reload = await withTimeout(
      'reload-persistence-overall',
      verifyReloadPersistence(page, baseUrl, target, voteProof, comment.body, analysisTimeoutMs, progress),
      Math.max(180_000, Math.min(300_000, analysisTimeoutMs + 120_000)),
    );
    await page.screenshot(viewportScreenshotOptions(screenshots.reloadPersistence));
    progress('reload-persistence-screenshot');
    const secondBrowser = await withTimeout(
      'second-browser-overall',
      verifySecondBrowser({
        browser,
        baseUrl,
        gunPeerUrl,
        row: target,
        voteProof,
        commentBody: comment.body,
        analysisTimeoutMs,
        progress,
      }),
      Math.max(180_000, Math.min(300_000, analysisTimeoutMs + 120_000)),
    );
    progress('second-browser-complete');

    summary = {
      ...summary,
      generatedAt: new Date().toISOString(),
      status: 'pass',
      checks: {
        daemonGunLatestIndexReadback: gunReadback,
        identityCreation: identity,
        currentPublicHeadlinesVisible: {
          count: initialCards.length,
          topCards: initialCards.slice(0, 8),
        },
        sourceLabelsVisible: {
          count: cardsWithSources.length,
        },
        timestampsVisible: {
          count: cardsWithTimestamps.length,
        },
        refreshWorks: {
          count: afterRefreshCards.length,
          topStoryIds: afterRefreshCards.slice(0, 8).map((card) => card.storyId),
        },
        scrollWorks: {
          count: afterScrollCards.length,
        },
        storyDetailOpens: {
          storyId: target.storyId,
          topicId: target.topicId,
          headline: target.headline,
          rejectedPendingCandidates: detail.rejectedCandidates,
        },
        acceptedAnalysisSynthesisVisible: synthesis,
        pointStanceWriteReadback: voteProof,
        storyThreadCreateComment: comment,
        reloadPersistence: reload,
        secondBrowserVisibility: secondBrowser,
      },
    };
  } catch (error) {
    summary = {
      ...summary,
      generatedAt: new Date().toISOString(),
      status: 'fail',
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: formatError(error),
    };
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await writeAtomicJson(logsPath, {
      schemaVersion: 'public-feed-browser-smoke-browser-logs-v1',
      generatedAt: new Date().toISOString(),
      logs,
    });
    await writeAtomicJson(summaryPath, summary);
    await updateLatestSymlink(artifactDir, repoRoot);
  }

  console.log(JSON.stringify({
    status: summary.status,
    artifactDir,
    summaryPath,
    checks: Object.keys(summary.checks ?? {}),
  }, null, 2));
  if (summary.status !== 'pass') {
    throw new Error(summary.errorMessage || 'public-feed-browser-smoke-failed');
  }
  return summary;
}

async function main() {
  await runPublicFeedBrowserSmoke();
}

export const publicFeedBrowserSmokeInternal = {
  cssAttr,
  normalizeGunPeer,
  normalizeUrl,
  parsePositiveInt,
  parseVoteCount,
  postedCommentVisible,
  readFixtureConst,
  refreshLatest,
  resolveArtifactDir,
  storyDetailUrl,
  viewportScreenshotOptions,
  withTimeout,
};

export { runPublicFeedBrowserSmoke };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[vh:public-feed-smoke] failed', error);
    process.exit(1);
  });
}
