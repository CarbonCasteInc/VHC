import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clusterCaptureArtifactPath,
  createDaemonFeedClusterCaptureRecorder,
  persistDaemonFeedClusterCapture,
} from './clusterCapturePersistence';

function makeArtifacts(overrides: Partial<{
  topicId: string;
  storyId: string;
  sourceId: string;
}> = {}) {
  const topicId = overrides.topicId ?? 'topic-news';
  const storyId = overrides.storyId ?? 'story-a';
  const sourceId = overrides.sourceId ?? 'source-a';
  return {
    schemaVersion: 'news-orchestrator-cluster-artifacts-v1' as const,
    generatedAt: '2026-03-24T00:00:00.000Z',
    normalizedItems: [
      {
        sourceId,
        publisher: sourceId,
        url: `https://example.com/${sourceId}`,
        canonicalUrl: `https://example.com/${sourceId}`,
        title: `${sourceId} headline`,
        publishedAt: 1,
        url_hash: `${sourceId}-hash`,
        entity_keys: ['entity'],
        cluster_text: `${sourceId} headline`,
      },
    ],
    topicCaptures: [
      {
        topicId,
        items: [
          {
            sourceId,
            publisher: sourceId,
            url: `https://example.com/${sourceId}`,
            canonicalUrl: `https://example.com/${sourceId}`,
            title: `${sourceId} headline`,
            publishedAt: 1,
            url_hash: `${sourceId}-hash`,
            entity_keys: ['entity'],
            cluster_text: `${sourceId} headline`,
          },
        ],
        result: {
          bundles: [
            {
              schemaVersion: 'story-bundle-v0' as const,
              story_id: storyId,
              topic_id: topicId,
              headline: `${sourceId} headline`,
              cluster_window_start: 1,
              cluster_window_end: 1,
              sources: [
                {
                  source_id: sourceId,
                  publisher: sourceId,
                  url: `https://example.com/${sourceId}`,
                  url_hash: `${sourceId}-hash`,
                  title: `${sourceId} headline`,
                },
              ],
              cluster_features: {
                entity_keys: ['entity'],
                time_bucket: '2026-03-24T00',
                semantic_signature: `${sourceId}-sig`,
              },
              provenance_hash: `${sourceId}-prov`,
              created_at: 1,
            },
          ],
          storylines: [],
        },
      },
    ],
  };
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('clusterCapturePersistence', () => {
  it('persists and updates tick captures for a run', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'vh-cluster-capture-'));
    tempDirs.push(cwd);

    await persistDaemonFeedClusterCapture('run-1', 1, makeArtifacts(), { cwd });
    await persistDaemonFeedClusterCapture('run-1', 2, makeArtifacts({
      topicId: 'topic-politics',
      storyId: 'story-b',
      sourceId: 'source-b',
    }), { cwd });

    const stored = JSON.parse(
      await readFile(clusterCaptureArtifactPath('run-1', cwd), 'utf8'),
    );

    expect(stored.schemaVersion).toBe('daemon-feed-cluster-capture-v1');
    expect(stored.runId).toBe('run-1');
    expect(stored.ticks).toHaveLength(2);
    expect(stored.ticks.map((tick: { tickSequence: number }) => tick.tickSequence)).toEqual([1, 2]);
    expect(stored.ticks[1].topicCaptures[0].topicId).toBe('topic-politics');
  });

  it('returns null recorder when run id is missing', () => {
    expect(createDaemonFeedClusterCaptureRecorder(undefined)).toBeNull();
    expect(createDaemonFeedClusterCaptureRecorder('   ')).toBeNull();
  });

  it('creates sequential tick captures through the recorder helper', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'vh-cluster-capture-'));
    tempDirs.push(cwd);

    const recorder = createDaemonFeedClusterCaptureRecorder('run-2', { cwd });
    expect(recorder).not.toBeNull();

    await recorder!(makeArtifacts());
    await recorder!(makeArtifacts({
      topicId: 'topic-economy',
      storyId: 'story-c',
      sourceId: 'source-c',
    }));

    const stored = JSON.parse(
      await readFile(clusterCaptureArtifactPath('run-2', cwd), 'utf8'),
    );

    expect(stored.ticks.map((tick: { tickSequence: number }) => tick.tickSequence)).toEqual([1, 2]);
    expect(stored.ticks[0].topicCaptures[0].result.bundles[0].story_id).toBe('story-a');
    expect(stored.ticks[1].topicCaptures[0].result.bundles[0].story_id).toBe('story-c');
  });

  it('writes snapshots atomically through a temp file and rename', async () => {
    const writes = new Map<string, string>();
    const writeTextFile = vi.fn(async (filePath: string, content: string) => {
      writes.set(filePath, content);
    });
    const renameFile = vi.fn(async (fromPath: string, toPath: string) => {
      const content = writes.get(fromPath);
      writes.delete(fromPath);
      writes.set(toPath, content ?? '');
    });

    await persistDaemonFeedClusterCapture('run-atomic', 1, makeArtifacts(), {
      cwd: '/repo',
      mkdirFn: vi.fn(async () => undefined) as typeof import('node:fs/promises').mkdir,
      readTextFile: vi.fn(async () => {
        throw new Error('missing');
      }) as typeof import('node:fs/promises').readFile,
      writeTextFile: writeTextFile as typeof import('node:fs/promises').writeFile,
      renameFile: renameFile as typeof import('node:fs/promises').rename,
    });

    expect(writeTextFile).toHaveBeenCalledOnce();
    expect(renameFile).toHaveBeenCalledOnce();
    const [tempPath] = writeTextFile.mock.calls[0];
    const [fromPath, targetPath] = renameFile.mock.calls[0];
    expect(String(tempPath)).toContain('.cluster-capture.json.tmp-');
    expect(fromPath).toBe(tempPath);
    expect(targetPath).toBe('/repo/.tmp/e2e-daemon-feed/run-atomic/cluster-capture.json');
    expect(writes.get(targetPath)).toContain('"schemaVersion": "daemon-feed-cluster-capture-v1"');
    expect(writes.has(String(tempPath))).toBe(false);
  });
});
