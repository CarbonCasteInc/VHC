import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {
  createValidatedSnapshotResolver,
  resolveValidatedSnapshotFixture,
  startValidatedSnapshotServer,
  validatedSnapshotServerInternal,
} from './daemon-feed-validated-snapshot-server.mjs';

async function findAvailablePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

describe('validated snapshot server', () => {
  const tempRoots = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('resolves the latest passing publisher canary snapshot', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'vh-validated-snapshot-'));
    tempRoots.push(repoRoot);
    const canaryDir = path.join(repoRoot, '.tmp', 'daemon-feed-publisher-canary', '100');
    mkdirSync(canaryDir, { recursive: true });
    writeFileSync(path.join(canaryDir, 'publisher-canary-summary.json'), JSON.stringify({ pass: true }), 'utf8');
    writeFileSync(path.join(canaryDir, 'published-store-snapshot.json'), JSON.stringify({ stories: [] }), 'utf8');

    const fixture = resolveValidatedSnapshotFixture({ repoRoot });
    expect(fixture.snapshotPath).toBe(path.join(canaryDir, 'published-store-snapshot.json'));
    expect(fixture.summaryPath).toBe(path.join(canaryDir, 'publisher-canary-summary.json'));
    expect(fixture.snapshot).toMatchObject({
      schemaVersion: 'daemon-feed-validated-rolling-snapshot-v1',
      stories: [],
      latestIndex: {},
      hotIndex: {},
      rollingWindow: {
        source: 'publisher-canary',
        artifactCount: 1,
      },
    });
  });

  it('merges recent passing canary snapshots into a newest-first rolling stream', () => {
    const first = {
      generatedAt: '2026-04-15T10:00:00.000Z',
      runId: 'run-1',
      stories: [
        {
          story_id: 'story-old',
          topic_id: 'topic-news-old',
          headline: 'Older story',
          created_at: 100,
          cluster_window_end: 110,
        },
        {
          story_id: 'story-duplicate',
          topic_id: 'topic-news-duplicate',
          headline: 'Older duplicate',
          created_at: 120,
          cluster_window_end: 130,
        },
      ],
      storylines: [{ storyline_id: 'storyline-old' }],
      latestIndex: { 'story-old': 110, 'story-duplicate': 130 },
      hotIndex: { 'story-old': 0.4, 'story-duplicate': 0.2 },
    };
    const second = {
      generatedAt: '2026-04-16T10:00:00.000Z',
      runId: 'run-2',
      stories: [
        {
          story_id: 'story-new',
          topic_id: 'topic-news-new',
          headline: 'Newer story',
          created_at: 200,
          cluster_window_end: 220,
          storyline_id: 'storyline-new',
        },
        {
          story_id: 'story-duplicate',
          topic_id: 'topic-news-duplicate',
          headline: 'Newer duplicate',
          created_at: 120,
          cluster_window_end: 230,
        },
      ],
      storylines: [{ storyline_id: 'storyline-new' }],
      latestIndex: { 'story-new': 220, 'story-duplicate': 230 },
      hotIndex: { 'story-new': 0.7, 'story-duplicate': 0.9 },
    };

    const merged = validatedSnapshotServerInternal.mergePublishedStoreSnapshots([
      { artifactDir: '/artifacts/200', summary: { generatedAt: second.generatedAt }, snapshot: second },
      { artifactDir: '/artifacts/100', summary: { generatedAt: first.generatedAt }, snapshot: first },
    ]);

    expect(merged.generatedAt).toBe(second.generatedAt);
    expect(merged.runId).toBe('run-2');
    expect(merged.stories.map((story) => story.story_id)).toEqual([
      'story-duplicate',
      'story-new',
      'story-old',
    ]);
    expect(merged.stories.find((story) => story.story_id === 'story-duplicate')?.headline)
      .toBe('Newer duplicate');
    expect(merged.latestIndex).toMatchObject({
      'story-duplicate': 230,
      'story-new': 220,
      'story-old': 110,
    });
    expect(merged.hotIndex).toMatchObject({
      'story-duplicate': 0.9,
      'story-new': 0.7,
      'story-old': 0.4,
    });
    expect(merged.storylines).toEqual([{ storyline_id: 'storyline-new' }]);
    expect(merged.rollingWindow).toMatchObject({
      artifactCount: 2,
      latestArtifactDir: '/artifacts/200',
      oldestArtifactDir: '/artifacts/100',
    });
  });

  it('caps the rolling stream by story limit after sorting newest first', () => {
    const merged = validatedSnapshotServerInternal.mergePublishedStoreSnapshots([
      {
        artifactDir: '/artifacts/300',
        summary: {},
        snapshot: {
          stories: [
            { story_id: 'story-3', topic_id: 'topic-news-3', headline: 'Third', cluster_window_end: 300 },
          ],
          latestIndex: { 'story-3': 300 },
        },
      },
      {
        artifactDir: '/artifacts/200',
        summary: {},
        snapshot: {
          stories: [
            { story_id: 'story-2', topic_id: 'topic-news-2', headline: 'Second', cluster_window_end: 200 },
          ],
          latestIndex: { 'story-2': 200 },
        },
      },
      {
        artifactDir: '/artifacts/100',
        summary: {},
        snapshot: {
          stories: [
            { story_id: 'story-1', topic_id: 'topic-news-1', headline: 'First', cluster_window_end: 100 },
          ],
          latestIndex: { 'story-1': 100 },
        },
      },
    ], { maxStories: 2 });

    expect(merged.stories.map((story) => story.story_id)).toEqual(['story-3', 'story-2']);
    expect(merged.latestIndex).toEqual({ 'story-3': 300, 'story-2': 200 });
  });

  it('refreshes the latest passing publisher canary snapshot after startup', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'vh-validated-snapshot-'));
    tempRoots.push(repoRoot);
    const artifactRoot = path.join(repoRoot, '.tmp', 'daemon-feed-publisher-canary');
    const firstDir = path.join(artifactRoot, '100');
    const secondDir = path.join(artifactRoot, '200');
    const stats = new Map([
      [firstDir, { mtimeMs: 100 }],
      [secondDir, { mtimeMs: 200 }],
    ]);
    const files = new Map([
      [path.join(firstDir, 'publisher-canary-summary.json'), JSON.stringify({ pass: true })],
      [path.join(firstDir, 'published-store-snapshot.json'), JSON.stringify({
        stories: [{ story_id: 'story-1', cluster_window_end: 100 }],
        latestIndex: { 'story-1': 100 },
      })],
    ]);
    let currentTime = 0;
    const resolver = createValidatedSnapshotResolver({
      repoRoot,
      env: { VH_VALIDATED_SNAPSHOT_REFRESH_MS: '10' },
      exists: (filePath) => files.has(filePath) || stats.has(filePath) || filePath === artifactRoot,
      readdir: (dirPath, { withFileTypes } = {}) => {
        if (dirPath !== artifactRoot) {
          return [];
        }
        return ['100', '200']
          .filter((name) => stats.has(path.join(artifactRoot, name)))
          .map((name) => withFileTypes
            ? { name, isDirectory: () => true }
            : name);
      },
      stat: (filePath) => stats.get(filePath),
      readFile: (filePath) => {
        const value = files.get(filePath);
        if (typeof value !== 'string') {
          throw new Error(`missing ${filePath}`);
        }
        return value;
      },
      now: () => currentTime,
    });

    expect(resolver.getFixture().snapshot.stories.map((story) => story.story_id)).toEqual(['story-1']);
    files.set(path.join(secondDir, 'publisher-canary-summary.json'), JSON.stringify({ pass: true }));
    files.set(path.join(secondDir, 'published-store-snapshot.json'), JSON.stringify({
      stories: [{ story_id: 'story-2', cluster_window_end: 200 }],
      latestIndex: { 'story-2': 200 },
    }));
    expect(resolver.getFixture().snapshot.stories.map((story) => story.story_id)).toEqual(['story-1']);
    currentTime = 11;
    expect(resolver.getFixture().snapshot.stories.map((story) => story.story_id)).toEqual([
      'story-2',
      'story-1',
    ]);
  });

  it('continues serving the cached snapshot when a later refresh cannot resolve an artifact', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'vh-validated-snapshot-'));
    tempRoots.push(repoRoot);
    const artifactRoot = path.join(repoRoot, '.tmp', 'daemon-feed-publisher-canary');
    const runDir = path.join(artifactRoot, '100');
    const files = new Map([
      [path.join(runDir, 'publisher-canary-summary.json'), JSON.stringify({ pass: true })],
      [path.join(runDir, 'published-store-snapshot.json'), JSON.stringify({ stories: [{ story_id: 'story-1' }] })],
    ]);
    let currentTime = 0;
    const resolver = createValidatedSnapshotResolver({
      repoRoot,
      env: { VH_VALIDATED_SNAPSHOT_REFRESH_MS: '10' },
      exists: (filePath) => filePath === artifactRoot || filePath === runDir || files.has(filePath),
      readdir: (dirPath, { withFileTypes } = {}) => {
        if (dirPath !== artifactRoot) {
          return [];
        }
        return withFileTypes ? [{ name: '100', isDirectory: () => true }] : ['100'];
      },
      stat: () => ({ mtimeMs: 100 }),
      readFile: (filePath) => {
        const value = files.get(filePath);
        if (typeof value !== 'string') {
          throw new Error(`missing ${filePath}`);
        }
        return value;
      },
      now: () => currentTime,
    });

    expect(resolver.getFixture().snapshot.stories[0].story_id).toBe('story-1');
    files.clear();
    currentTime = 11;

    expect(resolver.getFixture().snapshot.stories[0].story_id).toBe('story-1');
  });

  it('falls back to the committed curated launch-content snapshot when canary artifacts are absent', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'vh-validated-snapshot-'));
    tempRoots.push(repoRoot);
    const curatedFixturePath = path.join(repoRoot, 'fixtures', 'launch-content.json');
    mkdirSync(path.dirname(curatedFixturePath), { recursive: true });
    writeFileSync(curatedFixturePath, JSON.stringify({
      schemaVersion: 'vh-launch-content-validated-snapshot-v1',
      stories: [{ story_id: 'curated-story' }],
    }), 'utf8');

    const fixture = resolveValidatedSnapshotFixture({
      repoRoot,
      env: {
        VH_VALIDATED_SNAPSHOT_CURATED_FALLBACK_PATH: curatedFixturePath,
      },
    });

    expect(fixture.snapshotPath).toBe(curatedFixturePath);
    expect(fixture.fallback).toBe('curated-launch-content');
    expect(fixture.summary).toMatchObject({
      pass: true,
      source: 'curated-launch-content-fallback',
    });
    expect(fixture.snapshot.stories[0].story_id).toBe('curated-story');
  });

  it('serves health and snapshot payloads from an explicit fixture path', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'vh-validated-snapshot-'));
    tempRoots.push(repoRoot);
    const fixturePath = path.join(repoRoot, 'snapshot.json');
    writeFileSync(fixturePath, JSON.stringify({
      stories: [{ story_id: 'story-1', sources: [{ source_id: 'guardian-us' }, { source_id: 'ap-topnews' }] }],
      storylines: [{ storyline_id: 'storyline-1' }],
      latestIndex: { 'story-1': 123 },
      hotIndex: { 'story-1': 0.8 },
    }), 'utf8');
    const port = await findAvailablePort();
    const { server } = await startValidatedSnapshotServer({
      repoRoot,
      env: {
        ...process.env,
        VH_VALIDATED_SNAPSHOT_PORT: String(port),
        VH_VALIDATED_SNAPSHOT_FIXTURE_PATH: fixturePath,
      },
      log: () => {},
    });

    try {
      const healthResponse = await fetch(`http://127.0.0.1:${port}/health`);
      const snapshotResponse = await fetch(`http://127.0.0.1:${port}/snapshot.json`);
      const health = await healthResponse.json();
      const snapshot = await snapshotResponse.json();
      expect(health.ok).toBe(true);
      expect(health.refreshMs).toBe(10_000);
      expect(health.snapshotSummary).toMatchObject({ storyCount: 1, uniqueSourceCount: 2 });
      expect(snapshot.stories).toHaveLength(1);
      expect(healthResponse.headers.get('access-control-allow-origin')).toBe('*');
      expect(snapshotResponse.headers.get('access-control-allow-origin')).toBe('*');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
