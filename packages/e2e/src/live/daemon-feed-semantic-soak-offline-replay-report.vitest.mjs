import { describe, expect, it, vi } from 'vitest';
import { runOfflineClusterReplayReport } from './daemon-feed-semantic-soak-offline-replay-report.mjs';

function makeDirEntries(entriesByDir) {
  return (dirPath, options = {}) => {
    const entries = entriesByDir.get(dirPath) ?? [];
    if (options.withFileTypes) {
      return entries.map((entry) => ({
        name: entry.name,
        isDirectory: () => entry.type === 'dir',
        isFile: () => entry.type === 'file',
      }));
    }
    return entries.map((entry) => entry.name);
  };
}

describe('daemon-feed-semantic-soak offline replay report wrapper', () => {
  it('rebuilds the report and trend from the latest complete soak artifact dir', async () => {
    const artifactRoot = '/repo/.tmp/daemon-feed-semantic-soak';
    const artifactDir = `${artifactRoot}/200`;
    const writes = new Map();
    const files = new Map([
      [`${artifactDir}/semantic-soak-summary.json`, JSON.stringify({ generatedAt: '2026-03-24T14:00:00.000Z' })],
      [`${artifactDir}/semantic-soak-trend.json`, JSON.stringify({})],
      [`${artifactDir}/release-artifact-index.json`, JSON.stringify({})],
      [`${artifactDir}/run-1.cluster-capture.json`, JSON.stringify({
        schemaVersion: 'daemon-feed-cluster-capture-v1',
        generatedAt: '2026-03-24T14:00:00.000Z',
        runId: 'semantic-soak-200-1',
        ticks: [{
          tickSequence: 1,
          generatedAt: '2026-03-24T14:00:00.000Z',
          normalizedItems: [{
            sourceId: 'guardian-us',
            publisher: 'guardian-us',
            url: 'https://example.com/guardian',
            canonicalUrl: 'https://example.com/guardian',
            title: 'Guardian headline',
            publishedAt: 1,
            url_hash: 'guardian-1',
            entity_keys: ['guardian'],
            cluster_text: 'Guardian headline',
          }],
          topicCaptures: [{
            topicId: 'topic-news',
            items: [{
              sourceId: 'guardian-us',
              publisher: 'guardian-us',
              url: 'https://example.com/guardian',
              canonicalUrl: 'https://example.com/guardian',
              title: 'Guardian headline',
              publishedAt: 1,
              url_hash: 'guardian-1',
              entity_keys: ['guardian'],
              cluster_text: 'Guardian headline',
            }],
            result: {
              bundles: [{
                provenance_hash: 'guardian-prov',
                sources: [{
                  source_id: 'guardian-us',
                  publisher: 'guardian-us',
                  url: 'https://example.com/guardian',
                  url_hash: 'guardian-1',
                  title: 'Guardian headline',
                }],
              }],
              storylines: [],
            },
          }],
        }],
      })],
    ]);
    const dirEntries = new Map([
      [artifactRoot, [{ name: '200', type: 'dir' }]],
      [artifactDir, [
        { name: 'semantic-soak-summary.json', type: 'file' },
        { name: 'semantic-soak-trend.json', type: 'file' },
        { name: 'release-artifact-index.json', type: 'file' },
        { name: 'run-1.cluster-capture.json', type: 'file' },
      ]],
    ]);
    const log = vi.fn();

    const result = await runOfflineClusterReplayReport({
      env: {
        VH_DAEMON_FEED_SOAK_ARTIFACT_ROOT: artifactRoot,
      },
      exists: (filePath) => (
        filePath === artifactRoot
        || filePath === artifactDir
        || files.has(filePath)
      ),
      readFile: (filePath) => files.get(filePath),
      writeFile: (filePath, content) => {
        writes.set(filePath, String(content));
      },
      rename: (fromPath, toPath) => {
        const content = writes.get(fromPath);
        writes.delete(fromPath);
        writes.set(toPath, content ?? '');
      },
      readdir: makeDirEntries(dirEntries),
      stat: (filePath) => ({
        mtimeMs: filePath === artifactDir ? Date.parse('2026-03-24T14:00:00.000Z') : Date.now(),
      }),
      clusterItemsImpl: async (items, topicId) => items.map((item) => ({
        topic_id: topicId,
        provenance_hash: `${item.sourceId}-prov`,
        sources: [{
          source_id: item.sourceId,
          publisher: item.publisher,
          url: item.canonicalUrl,
          url_hash: item.url_hash,
          title: item.title,
        }],
      })),
      log,
    });

    expect(result.artifactDir).toBe(artifactDir);
    expect(result.reportPath).toBe(`${artifactDir}/offline-cluster-replay-report.json`);
    expect(result.trendIndexPath).toBe(`${artifactDir}/offline-cluster-replay-trend-index.json`);
    expect(result.latestTrendIndexPath).toBe(`${artifactRoot}/offline-cluster-replay-trend-index.json`);
    expect(result.calibration).toEqual({
      remoteBundleCount: 1,
      offlineBundleCount: 1,
      exactBundleMatchRate: 1,
      provenanceHashExactBundleMatchRate: 0,
      sourceAssignmentAgreementRate: 1,
      averageBestRemoteBundleJaccard: 1,
      averageBestOfflineBundleJaccard: 1,
    });
    expect(writes.get(`${artifactDir}/offline-cluster-replay-report.json`)).toContain('"schemaVersion": "daemon-feed-offline-cluster-replay-report-v2"');
    expect(writes.get(`${artifactDir}/offline-cluster-replay-trend-index.json`)).toContain('"schemaVersion": "daemon-feed-offline-cluster-replay-trend-index-v2"');
    expect(writes.get(`${artifactRoot}/offline-cluster-replay-trend-index.json`)).toContain(`"latestArtifactDir": "${artifactDir}"`);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"artifactDir": "/repo/.tmp/daemon-feed-semantic-soak/200"'));
  });

  it('throws when no cluster capture exists in the requested artifact dir', async () => {
    await expect(runOfflineClusterReplayReport({
      env: {
        VH_DAEMON_FEED_SOAK_ARTIFACT_DIR: '/repo/.tmp/daemon-feed-semantic-soak/999',
      },
      exists: () => false,
      readdir: () => [],
    })).rejects.toThrow('no cluster-capture snapshot found under /repo/.tmp/daemon-feed-semantic-soak/999');
  });

  it('throws a clear default-root error when no complete cluster-capture artifact exists', async () => {
    await expect(runOfflineClusterReplayReport({
      env: {
        VH_DAEMON_FEED_SOAK_ARTIFACT_ROOT: '/repo/.tmp/daemon-feed-semantic-soak',
      },
      exists: () => false,
      readdir: () => [],
    })).rejects.toThrow(
      'no complete semantic-soak artifact with cluster capture found under /repo/.tmp/daemon-feed-semantic-soak; run a fresh soak or set VH_DAEMON_FEED_SOAK_ARTIFACT_DIR',
    );
  });

  it('defaults to the latest complete artifact dir that actually has cluster capture', async () => {
    const artifactRoot = '/repo/.tmp/daemon-feed-semantic-soak';
    const latestWithoutCapture = `${artifactRoot}/300`;
    const latestWithCapture = `${artifactRoot}/200`;
    const writes = new Map();
    const files = new Map([
      [`${latestWithoutCapture}/semantic-soak-summary.json`, JSON.stringify({ generatedAt: '2026-03-24T18:00:00.000Z' })],
      [`${latestWithoutCapture}/semantic-soak-trend.json`, JSON.stringify({})],
      [`${latestWithoutCapture}/release-artifact-index.json`, JSON.stringify({})],
      [`${latestWithCapture}/semantic-soak-summary.json`, JSON.stringify({ generatedAt: '2026-03-24T14:00:00.000Z' })],
      [`${latestWithCapture}/semantic-soak-trend.json`, JSON.stringify({})],
      [`${latestWithCapture}/release-artifact-index.json`, JSON.stringify({})],
      [`${latestWithCapture}/run-1.cluster-capture.json`, JSON.stringify({
        schemaVersion: 'daemon-feed-cluster-capture-v1',
        generatedAt: '2026-03-24T14:00:00.000Z',
        runId: 'semantic-soak-200-1',
        ticks: [{
          tickSequence: 1,
          generatedAt: '2026-03-24T14:00:00.000Z',
          normalizedItems: [{
            sourceId: 'guardian-us',
            publisher: 'guardian-us',
            url: 'https://example.com/guardian',
            canonicalUrl: 'https://example.com/guardian',
            title: 'Guardian headline',
            publishedAt: 1,
            url_hash: 'guardian-1',
            entity_keys: ['guardian'],
            cluster_text: 'Guardian headline',
          }],
          topicCaptures: [{
            topicId: 'topic-news',
            items: [{
              sourceId: 'guardian-us',
              publisher: 'guardian-us',
              url: 'https://example.com/guardian',
              canonicalUrl: 'https://example.com/guardian',
              title: 'Guardian headline',
              publishedAt: 1,
              url_hash: 'guardian-1',
              entity_keys: ['guardian'],
              cluster_text: 'Guardian headline',
            }],
            result: { bundles: [], storylines: [] },
          }],
        }],
      })],
    ]);
    const dirEntries = new Map([
      [artifactRoot, [
        { name: '300', type: 'dir' },
        { name: '200', type: 'dir' },
      ]],
      [latestWithoutCapture, [
        { name: 'semantic-soak-summary.json', type: 'file' },
        { name: 'semantic-soak-trend.json', type: 'file' },
        { name: 'release-artifact-index.json', type: 'file' },
      ]],
      [latestWithCapture, [
        { name: 'semantic-soak-summary.json', type: 'file' },
        { name: 'semantic-soak-trend.json', type: 'file' },
        { name: 'release-artifact-index.json', type: 'file' },
        { name: 'run-1.cluster-capture.json', type: 'file' },
      ]],
    ]);

    const result = await runOfflineClusterReplayReport({
      env: {
        VH_DAEMON_FEED_SOAK_ARTIFACT_ROOT: artifactRoot,
      },
      exists: (filePath) => (
        filePath === artifactRoot
        || filePath === latestWithoutCapture
        || filePath === latestWithCapture
        || files.has(filePath)
      ),
      readFile: (filePath) => files.get(filePath),
      writeFile: (filePath, content) => {
        writes.set(filePath, String(content));
      },
      rename: (fromPath, toPath) => {
        const content = writes.get(fromPath);
        writes.delete(fromPath);
        writes.set(toPath, content ?? '');
      },
      readdir: makeDirEntries(dirEntries),
      stat: (filePath) => ({
        mtimeMs:
          filePath === latestWithoutCapture
            ? Date.parse('2026-03-24T18:00:00.000Z')
            : filePath === latestWithCapture
              ? Date.parse('2026-03-24T14:00:00.000Z')
              : Date.now(),
      }),
      clusterItemsImpl: async () => [],
      log: vi.fn(),
    });

    expect(result.artifactDir).toBe(latestWithCapture);
  });
});
