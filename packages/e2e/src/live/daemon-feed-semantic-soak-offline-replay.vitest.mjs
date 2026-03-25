import { describe, expect, it } from 'vitest';
import {
  buildOfflineClusterReplayReport,
  buildOfflineClusterReplayTrendIndex,
  offlineClusterReplayInternal,
  readExecutionClusterCaptureSnapshot,
  readHistoricalExecutionClusterCaptureSnapshots,
} from './daemon-feed-semantic-soak-offline-replay.mjs';

function makeClusterCapture({
  tickSequence = 1,
  topicId = 'topic-news',
  sourceId = 'source-a',
  storyId = 'story-a',
  urlHash = 'hash-a',
} = {}) {
  return {
    schemaVersion: 'daemon-feed-cluster-capture-v1',
    generatedAt: '2026-03-24T10:00:00.000Z',
    runId: 'semantic-soak-1-1',
    ticks: [
      {
        tickSequence,
        schemaVersion: 'news-orchestrator-cluster-artifacts-v1',
        generatedAt: '2026-03-24T10:00:00.000Z',
        normalizedItems: [
          {
            sourceId,
            publisher: sourceId,
            url: `https://example.com/${sourceId}`,
            canonicalUrl: `https://example.com/${sourceId}`,
            title: `${sourceId} headline`,
            publishedAt: 1,
            url_hash: urlHash,
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
                url_hash: urlHash,
                entity_keys: ['entity'],
                cluster_text: `${sourceId} headline`,
              },
            ],
            result: {
              bundles: [
                {
                  schemaVersion: 'story-bundle-v0',
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
                      url_hash: urlHash,
                      title: `${sourceId} headline`,
                    },
                  ],
                  cluster_features: {
                    entity_keys: ['entity'],
                    time_bucket: '2026-03-24T10',
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
      },
    ],
  };
}

describe('daemon-feed-semantic-soak offline replay', () => {
  it('reads current and historical execution cluster capture snapshots', () => {
    const artifactRoot = '/repo/.tmp/daemon-feed-semantic-soak';
    const writes = new Map([
      [`${artifactRoot}/100/semantic-soak-summary.json`, JSON.stringify({ generatedAt: '2026-03-24T10:00:00.000Z' })],
      [`${artifactRoot}/100/run-1.cluster-capture.json`, JSON.stringify(makeClusterCapture())],
      [`${artifactRoot}/200/semantic-soak-summary.json`, JSON.stringify({ generatedAt: '2026-03-24T14:00:00.000Z' })],
      [`${artifactRoot}/200/run-1.cluster-capture.json`, JSON.stringify(makeClusterCapture({
        sourceId: 'source-b',
        storyId: 'story-b',
        urlHash: 'hash-b',
      }))],
    ]);
    const fs = {
      exists: (target) => writes.has(target),
      readFile: (target) => writes.get(target),
      stat: (target) => ({ mtimeMs: target.includes('/200/') ? 2 : 1 }),
      readdir: (dirPath) => {
        if (dirPath === artifactRoot) {
          return [
            { name: '100', isDirectory: () => true },
            { name: '200', isDirectory: () => true },
          ];
        }
        const prefix = `${dirPath}/`;
        return [...writes.keys()]
          .filter((target) => target.startsWith(prefix))
          .map((target) => target.slice(prefix.length))
          .filter((name) => name.length > 0 && !name.includes('/'))
          .map((name) => ({ name, isFile: () => true }));
      },
    };

    const current = readExecutionClusterCaptureSnapshot(`${artifactRoot}/200`, fs);
    expect(current.runCaptures).toHaveLength(1);
    expect(current.runCaptures[0].topicCaptures[0].topicId).toBe('topic-news');

    const historical = readHistoricalExecutionClusterCaptureSnapshots(artifactRoot, {
      ...fs,
      currentArtifactDir: `${artifactRoot}/200`,
      currentTimestampMs: current.timestampMs,
      lookbackHours: 24,
      lookbackExecutionCount: 5,
    });

    expect(historical).toHaveLength(1);
    expect(historical[0].artifactDir).toBe(`${artifactRoot}/100`);
  });

  it('builds calibration and retained-union uplift from captured inputs', async () => {
    const current = {
      artifactDir: '/repo/.tmp/daemon-feed-semantic-soak/200',
      generatedAt: '2026-03-24T14:00:00.000Z',
      timestampMs: Date.parse('2026-03-24T14:00:00.000Z'),
      runCaptures: [
        {
          run: 1,
          tickSequence: 1,
          generatedAt: '2026-03-24T14:00:00.000Z',
          normalizedItemCount: 1,
          normalizedItems: [],
          topicCaptures: makeClusterCapture().ticks[0].topicCaptures,
        },
      ],
    };
    const historical = [
      {
        artifactDir: '/repo/.tmp/daemon-feed-semantic-soak/100',
        generatedAt: '2026-03-24T10:00:00.000Z',
        timestampMs: Date.parse('2026-03-24T10:00:00.000Z'),
        runCaptures: [
          {
            run: 1,
            tickSequence: 1,
            generatedAt: '2026-03-24T10:00:00.000Z',
            normalizedItemCount: 1,
            normalizedItems: [],
            topicCaptures: makeClusterCapture({
              sourceId: 'source-b',
              storyId: 'story-b',
              urlHash: 'hash-b',
            }).ticks[0].topicCaptures,
          },
        ],
      },
    ];

    const clusterItemsImpl = async (items, topicId) => [{
      schemaVersion: 'story-bundle-v0',
      story_id: `offline-${topicId}-${items.length}`,
      topic_id: topicId,
      headline: 'Offline merged headline',
      cluster_window_start: 1,
      cluster_window_end: 1,
      sources: items.map((item) => ({
        source_id: item.sourceId,
        publisher: item.publisher,
        url: item.canonicalUrl,
        url_hash: item.url_hash,
        title: item.title,
      })),
      cluster_features: {
        entity_keys: ['entity'],
        time_bucket: '2026-03-24T10',
        semantic_signature: `offline-${items.length}`,
      },
      provenance_hash: items.length > 1 ? 'merged-prov' : `offline-${items[0].sourceId}-prov`,
      created_at: 1,
    }];

    const report = await buildOfflineClusterReplayReport(current, historical, {
      lookbackHours: 24,
      clusterItemsImpl,
    });

    expect(report.schemaVersion).toBe('daemon-feed-offline-cluster-replay-report-v2');
    expect(report.currentExecution.remote.bundleSummary.corroboratedBundleCount).toBe(0);
    expect(report.currentExecution.offlineHeuristic.bundleSummary.corroboratedBundleCount).toBe(0);
    expect(report.retainedUnion.heuristic.bundleSummary.corroboratedBundleCount).toBe(1);
    expect(report.retainedUnion.uplift.corroboratedBundleCountDelta).toBe(1);
    expect(report.currentExecution.calibration.exactSourceSetMatchRate).toBe(1);
    expect(report.currentExecution.calibration.provenanceHashExactBundleMatchRate).toBe(0);
    expect(report.currentExecution.calibration.sourceAssignmentAgreementRate).toBe(1);
    expect(report.currentExecution.calibration.averageBestRemoteBundleJaccard).toBe(1);

    const trend = buildOfflineClusterReplayTrendIndex([report], {
      artifactRoot: '/repo/.tmp/daemon-feed-semantic-soak',
      latestArtifactDir: current.artifactDir,
      lookbackExecutionCount: 5,
      lookbackHours: 24,
    });

    expect(trend.schemaVersion).toBe('daemon-feed-offline-cluster-replay-trend-index-v2');
    expect(trend.executionCount).toBe(1);
    expect(trend.latestReport.artifactDir).toBe(current.artifactDir);
    expect(trend.calibration.averageRetainedUnionCorroboratedBundleCountDelta).toBe(1);
    expect(trend.calibration.averageProvenanceHashExactBundleMatchRate).toBe(0);
    expect(trend.calibration.averageSourceAssignmentAgreementRate).toBe(1);
  });

  it('distinguishes bundle-assignment disagreement from identifier mismatch', () => {
    const remoteBundles = [
      {
        story_id: 'story-remote-merged',
        headline: 'Merged remote',
        sources: [
          { source_id: 'source-a', url_hash: 'hash-a' },
          { source_id: 'source-b', url_hash: 'hash-b' },
        ],
        provenance_hash: 'remote-merged',
      },
    ];
    const offlineBundles = [
      {
        story_id: 'story-offline-a',
        headline: 'Offline A',
        sources: [{ source_id: 'source-a', url_hash: 'hash-a' }],
        provenance_hash: 'offline-a',
      },
      {
        story_id: 'story-offline-b',
        headline: 'Offline B',
        sources: [{ source_id: 'source-b', url_hash: 'hash-b' }],
        provenance_hash: 'offline-b',
      },
    ];

    const calibration = offlineClusterReplayInternal.compareBundleSets(remoteBundles, offlineBundles);

    expect(calibration.exactSourceSetMatchRate).toBe(0);
    expect(calibration.provenanceHashExactBundleMatchRate).toBe(0);
    expect(calibration.sourceAssignmentAgreementRate).toBe(0);
    expect(calibration.averageBestRemoteBundleJaccard).toBe(0.5);
    expect(calibration.remoteBundlesWithStrongOverlapRate).toBe(1);
    expect(calibration.remoteMismatchSamples[0].bestMatchSourceEventKeys).toEqual(['source-a::hash-a']);
  });
});
