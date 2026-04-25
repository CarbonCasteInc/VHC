#!/usr/bin/env node

import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolvePassingCanaryArtifacts,
  resolvePublisherCanaryArtifactRoot,
  summarizePublishedStoreSnapshot,
} from './daemon-feed-canary-shared.mjs';

const DEFAULT_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
const DEFAULT_SNAPSHOT_REFRESH_MS = 10_000;
const DEFAULT_ROLLING_ARTIFACT_LIMIT = 24;
const DEFAULT_ROLLING_STORY_LIMIT = 150;
const DEFAULT_CURATED_LAUNCH_CONTENT_SNAPSHOT_PATH = path.join(
  DEFAULT_REPO_ROOT,
  'packages/e2e/fixtures/launch-content/validated-snapshot.json',
);

function readJson(filePath, readFile = readFileSync) {
  return JSON.parse(readFile(filePath, 'utf8'));
}

function parseRefreshMs(raw, fallback = DEFAULT_SNAPSHOT_REFRESH_MS) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function parsePositiveInt(raw, fallback) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function readRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function readFiniteNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function readFiniteNonNegativeValue(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function readStoryId(story) {
  return typeof story?.story_id === 'string' && story.story_id.trim().length > 0
    ? story.story_id.trim()
    : null;
}

function readStorylineId(storyline) {
  return typeof storyline?.storyline_id === 'string' && storyline.storyline_id.trim().length > 0
    ? storyline.storyline_id.trim()
    : null;
}

function fallbackStoryKey(story) {
  const topicId = typeof story?.topic_id === 'string' ? story.topic_id.trim() : '';
  const headline = typeof story?.headline === 'string' ? story.headline.trim().toLowerCase() : '';
  const createdAt = readFiniteNonNegativeNumber(story?.created_at) ?? 0;
  return `fallback:${topicId}:${headline}:${createdAt}`;
}

function storyKey(story) {
  return readStoryId(story) ?? fallbackStoryKey(story);
}

function storyRank(story, latestIndex) {
  const storyId = readStoryId(story);
  if (storyId) {
    const indexed = readFiniteNonNegativeNumber(latestIndex[storyId]);
    if (indexed !== null) {
      return indexed;
    }
  }
  return (
    readFiniteNonNegativeNumber(story?.cluster_window_end)
    ?? readFiniteNonNegativeNumber(story?.latest_activity_at)
    ?? readFiniteNonNegativeNumber(story?.created_at)
    ?? 0
  );
}

function mergeIndexRecords(sources, storyIds, indexName, mergeMode) {
  const merged = {};
  for (const source of sources) {
    const index = readRecord(source.snapshot?.[indexName]);
    for (const [storyId, rawValue] of Object.entries(index)) {
      if (!storyIds.has(storyId)) {
        continue;
      }
      const value = indexName === 'hotIndex'
        ? readFiniteNonNegativeValue(rawValue)
        : readFiniteNonNegativeNumber(rawValue);
      if (value === null) {
        continue;
      }
      if (mergeMode === 'max') {
        merged[storyId] = Math.max(merged[storyId] ?? 0, value);
      } else if (!(storyId in merged)) {
        merged[storyId] = value;
      }
    }
  }
  return merged;
}

function mergePublishedStoreSnapshots(sources, { maxStories = DEFAULT_ROLLING_STORY_LIMIT } = {}) {
  const [latestSource] = sources;
  if (!latestSource) {
    throw new Error('cannot merge empty validated snapshot source set');
  }

  const storyByKey = new Map();
  const storylineById = new Map();
  for (const source of sources) {
    for (const storyline of Array.isArray(source.snapshot?.storylines) ? source.snapshot.storylines : []) {
      const storylineId = readStorylineId(storyline);
      if (storylineId && !storylineById.has(storylineId)) {
        storylineById.set(storylineId, storyline);
      }
    }

    for (const story of Array.isArray(source.snapshot?.stories) ? source.snapshot.stories : []) {
      const key = storyKey(story);
      if (!storyByKey.has(key)) {
        storyByKey.set(key, story);
      }
    }
  }

  const storyIds = new Set(
    [...storyByKey.values()]
      .map((story) => readStoryId(story))
      .filter((storyId) => typeof storyId === 'string'),
  );
  const latestIndex = mergeIndexRecords(sources, storyIds, 'latestIndex', 'max');
  const hotIndex = mergeIndexRecords(sources, storyIds, 'hotIndex', 'first');
  for (const story of storyByKey.values()) {
    const storyId = readStoryId(story);
    if (storyId && !(storyId in latestIndex)) {
      latestIndex[storyId] = storyRank(story, latestIndex);
    }
  }

  const stories = [...storyByKey.values()]
    .sort((left, right) =>
      storyRank(right, latestIndex) - storyRank(left, latestIndex)
      || (readStoryId(left) ?? fallbackStoryKey(left)).localeCompare(readStoryId(right) ?? fallbackStoryKey(right)),
    )
    .slice(0, maxStories);
  const retainedStoryIds = new Set(
    stories
      .map((story) => readStoryId(story))
      .filter((storyId) => typeof storyId === 'string'),
  );
  const retainedStorylineIds = new Set(
    stories
      .map((story) => (typeof story?.storyline_id === 'string' ? story.storyline_id.trim() : ''))
      .filter(Boolean),
  );

  const retainedLatestIndex = {};
  for (const [storyId, value] of Object.entries(latestIndex)) {
    if (retainedStoryIds.has(storyId)) {
      retainedLatestIndex[storyId] = value;
    }
  }

  const retainedHotIndex = {};
  for (const [storyId, value] of Object.entries(hotIndex)) {
    if (retainedStoryIds.has(storyId)) {
      retainedHotIndex[storyId] = value;
    }
  }

  return {
    ...latestSource.snapshot,
    schemaVersion: 'daemon-feed-validated-rolling-snapshot-v1',
    generatedAt: latestSource.snapshot?.generatedAt ?? latestSource.summary?.generatedAt ?? null,
    runId: latestSource.snapshot?.runId ?? latestSource.summary?.runId ?? null,
    latestIndex: retainedLatestIndex,
    hotIndex: retainedHotIndex,
    stories,
    storylines: [...storylineById.values()].filter((storyline) =>
      retainedStorylineIds.has(readStorylineId(storyline)),
    ),
    rollingWindow: {
      source: 'publisher-canary',
      artifactCount: sources.length,
      storyLimit: maxStories,
      latestArtifactDir: latestSource.artifactDir,
      oldestArtifactDir: sources[sources.length - 1]?.artifactDir ?? latestSource.artifactDir,
    },
  };
}

export function resolveValidatedSnapshotFixture({
  repoRoot = DEFAULT_REPO_ROOT,
  env = process.env,
  exists = existsSync,
  readdir = readdirSync,
  stat = statSync,
  readFile = readFileSync,
} = {}) {
  const explicitPath = env.VH_VALIDATED_SNAPSHOT_FIXTURE_PATH?.trim();
  if (explicitPath) {
    const snapshot = readJson(explicitPath, readFile);
    return {
      snapshotPath: explicitPath,
      snapshot,
      artifactDir: path.dirname(explicitPath),
      summaryPath: null,
      summary: null,
    };
  }

  const curatedFallbackPath = env.VH_VALIDATED_SNAPSHOT_CURATED_FALLBACK_PATH?.trim()
    || path.join(repoRoot, path.relative(DEFAULT_REPO_ROOT, DEFAULT_CURATED_LAUNCH_CONTENT_SNAPSHOT_PATH));

  const artifactRoot = resolvePublisherCanaryArtifactRoot(repoRoot, env);
  const maxArtifacts = parsePositiveInt(
    env.VH_VALIDATED_SNAPSHOT_ROLLING_ARTIFACT_LIMIT,
    DEFAULT_ROLLING_ARTIFACT_LIMIT,
  );
  const maxStories = parsePositiveInt(
    env.VH_VALIDATED_SNAPSHOT_MAX_STORIES,
    DEFAULT_ROLLING_STORY_LIMIT,
  );
  const artifacts = resolvePassingCanaryArtifacts(artifactRoot, {
    exists,
    readdir,
    stat,
    readFile,
    summaryFileName: 'publisher-canary-summary.json',
    requiredArtifactNames: ['published-store-snapshot.json'],
    passPredicate: (summary) => summary?.pass === true,
    maxArtifacts,
  });
  if (artifacts.length === 0) {
    if (exists(curatedFallbackPath)) {
      return {
        snapshotPath: curatedFallbackPath,
        snapshot: readJson(curatedFallbackPath, readFile),
        artifactDir: path.dirname(curatedFallbackPath),
        summaryPath: null,
        summary: {
          pass: true,
          source: 'curated-launch-content-fallback',
        },
        fallback: 'curated-launch-content',
      };
    }
    throw new Error(`no passing publisher-canary artifact found under ${artifactRoot}`);
  }

  const sources = [];
  for (const artifact of artifacts) {
    const snapshotPath = path.join(artifact.artifactDir, 'published-store-snapshot.json');
    try {
      sources.push({
        ...artifact,
        snapshotPath,
        snapshot: readJson(snapshotPath, readFile),
      });
    } catch {
      continue;
    }
  }
  if (sources.length === 0) {
    if (exists(curatedFallbackPath)) {
      return {
        snapshotPath: curatedFallbackPath,
        snapshot: readJson(curatedFallbackPath, readFile),
        artifactDir: path.dirname(curatedFallbackPath),
        summaryPath: null,
        summary: {
          pass: true,
          source: 'curated-launch-content-fallback',
        },
        fallback: 'curated-launch-content',
      };
    }
    throw new Error(`no readable publisher-canary snapshots found under ${artifactRoot}`);
  }

  const [latest] = sources;
  return {
    snapshotPath: latest.snapshotPath,
    snapshot: mergePublishedStoreSnapshots(sources, { maxStories }),
    artifactDir: latest.artifactDir,
    summaryPath: latest.summaryPath,
    summary: latest.summary,
    sourceArtifacts: sources.map((source) => ({
      artifactDir: source.artifactDir,
      summaryPath: source.summaryPath,
      snapshotPath: source.snapshotPath,
    })),
  };
}

export function createValidatedSnapshotResolver({
  repoRoot = DEFAULT_REPO_ROOT,
  env = process.env,
  exists = existsSync,
  readdir = readdirSync,
  stat = statSync,
  readFile = readFileSync,
  now = () => Date.now(),
} = {}) {
  const refreshMs = parseRefreshMs(env.VH_VALIDATED_SNAPSHOT_REFRESH_MS);
  let cached = null;
  let cachedAt = 0;

  function shouldRefresh(force) {
    if (force || !cached) {
      return true;
    }
    if (refreshMs === 0) {
      return false;
    }
    return now() - cachedAt >= refreshMs;
  }

  return {
    getFixture({ force = false } = {}) {
      if (!shouldRefresh(force)) {
        return cached;
      }

      try {
        cached = resolveValidatedSnapshotFixture({
          repoRoot,
          env,
          exists,
          readdir,
          stat,
          readFile,
        });
        cachedAt = now();
      } catch (error) {
        if (!cached) {
          throw error;
        }
      }

      return cached;
    },
    getRefreshMs() {
      return refreshMs;
    },
  };
}

export async function startValidatedSnapshotServer({
  repoRoot = DEFAULT_REPO_ROOT,
  env = process.env,
  log = console.log,
} = {}) {
  const port = Number.parseInt(env.VH_VALIDATED_SNAPSHOT_PORT ?? '8790', 10);
  const resolver = createValidatedSnapshotResolver({ repoRoot, env });
  const initialFixture = resolver.getFixture({ force: true });
  const initialSummary = summarizePublishedStoreSnapshot(initialFixture.snapshot);
  const corsHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };

  function resolveResponsePayload() {
    const fixture = resolver.getFixture();
    return {
      fixture,
      summary: summarizePublishedStoreSnapshot(fixture.snapshot),
    };
  }

  const server = createServer((req, res) => {
    const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }
    if (requestUrl.pathname === '/health') {
      const { fixture, summary } = resolveResponsePayload();
      res.writeHead(200, { ...corsHeaders, 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        fixture: {
          artifactDir: fixture.artifactDir,
          summaryPath: fixture.summaryPath,
          snapshotPath: fixture.snapshotPath,
          sourceArtifactCount: fixture.sourceArtifacts?.length ?? 1,
          fallback: fixture.fallback ?? null,
        },
        rollingWindow: fixture.snapshot?.rollingWindow ?? null,
        refreshMs: resolver.getRefreshMs(),
        snapshotSummary: summary,
      }));
      return;
    }
    if (requestUrl.pathname === '/snapshot.json') {
      const { fixture } = resolveResponsePayload();
      res.writeHead(200, { ...corsHeaders, 'content-type': 'application/json' });
      res.end(JSON.stringify(fixture.snapshot));
      return;
    }
    if (requestUrl.pathname === '/meta.json') {
      const { fixture, summary } = resolveResponsePayload();
      res.writeHead(200, { ...corsHeaders, 'content-type': 'application/json' });
      res.end(JSON.stringify({
        fixture: {
          artifactDir: fixture.artifactDir,
          summaryPath: fixture.summaryPath,
          snapshotPath: fixture.snapshotPath,
          sourceArtifactCount: fixture.sourceArtifacts?.length ?? 1,
          fallback: fixture.fallback ?? null,
        },
        rollingWindow: fixture.snapshot?.rollingWindow ?? null,
        refreshMs: resolver.getRefreshMs(),
        snapshotSummary: summary,
      }));
      return;
    }
    res.writeHead(404, { ...corsHeaders, 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  log(`[vh:validated-snapshot] listening on http://127.0.0.1:${port}`);
  log(`[vh:validated-snapshot] fixture ${initialFixture.snapshotPath}`);
  if (initialFixture.sourceArtifacts?.length > 1) {
    log(`[vh:validated-snapshot] rolling window ${initialFixture.sourceArtifacts.length} artifacts`);
  }
  return { server, port, fixture: initialFixture, summary: initialSummary, resolver };
}

export const validatedSnapshotServerInternal = {
  mergePublishedStoreSnapshots,
  parsePositiveInt,
};

async function main() {
  await startValidatedSnapshotServer();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('[vh:validated-snapshot] failed', error);
    process.exit(1);
  });
}
