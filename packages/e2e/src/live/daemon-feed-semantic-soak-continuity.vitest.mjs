import { describe, expect, it } from 'vitest';
import {
  buildContinuityAnalysis,
  buildContinuityTrendIndex,
  readExecutionBundleSnapshot,
  readHistoricalExecutionBundleSnapshots,
} from './daemon-feed-semantic-soak-continuity.mjs';

function createFs(files, stats = new Map()) {
  return {
    exists: (filePath) => files.has(filePath),
    readFile: (filePath) => {
      if (!files.has(filePath)) {
        throw new Error(`missing file: ${filePath}`);
      }
      return files.get(filePath);
    },
    readdir: (dirPath, { withFileTypes } = {}) => {
      const prefix = `${dirPath}/`;
      const seen = new Set();
      const entries = [];
      for (const filePath of files.keys()) {
        if (!filePath.startsWith(prefix)) continue;
        const relative = filePath.slice(prefix.length);
        if (relative.includes('/')) continue;
        if (seen.has(relative)) continue;
        seen.add(relative);
        entries.push(withFileTypes ? {
          name: relative,
          isDirectory: () => false,
          isFile: () => true,
        } : relative);
      }
      for (const dirPathValue of stats.keys()) {
        if (!dirPathValue.startsWith(prefix)) continue;
        const relative = dirPathValue.slice(prefix.length);
        if (!relative || relative.includes('/')) continue;
        if (seen.has(relative)) continue;
        seen.add(relative);
        entries.push(withFileTypes ? {
          name: relative,
          isDirectory: () => true,
          isFile: () => false,
        } : relative);
      }
      return entries;
    },
    stat: (filePath) => ({ mtimeMs: stats.get(filePath) ?? Date.now() }),
  };
}

describe('daemon-feed-semantic-soak continuity', () => {
  it('normalizes audited bundle snapshots with exact source identity', () => {
    const artifactDir = '/repo/.tmp/daemon-feed-semantic-soak/100';
    const files = new Map([
      [`${artifactDir}/semantic-soak-summary.json`, JSON.stringify({ generatedAt: '2026-03-19T10:00:00.000Z' })],
      [`${artifactDir}/run-1.semantic-audit.json`, JSON.stringify({
        bundles: [{
          story_id: 'story-1',
          topic_id: 'topic-1',
          headline: 'Aid convoy reaches flooded county',
          canonical_source_count: 2,
          canonical_sources: [
            { source_id: 'guardian-us' },
            { source_id: 'cbs-politics' },
          ],
        }],
      })],
    ]);

    const snapshot = readExecutionBundleSnapshot(artifactDir, createFs(files));

    expect(snapshot).toMatchObject({
      artifactDir,
      generatedAt: '2026-03-19T10:00:00.000Z',
      coverageScope: 'audited_sample',
      topicCount: 1,
      auditableTopicCount: 1,
      sourceIdentityFidelityCounts: { exact: 1, count_only: 0, mixed: 0 },
    });
    expect(snapshot.topics[0]).toMatchObject({
      topic_id: 'topic-1',
      story_ids: ['story-1'],
      source_ids: ['cbs-politics', 'guardian-us'],
      source_count: 2,
      sourceIdentityFidelity: 'exact',
      coverageScope: 'audited_sample',
    });
  });

  it('normalizes failure snapshots as count-only store snapshots', () => {
    const artifactDir = '/repo/.tmp/daemon-feed-semantic-soak/200';
    const files = new Map([
      [`${artifactDir}/run-1.semantic-audit-failure-snapshot.json`, JSON.stringify({
        stories: [{
          story_id: 'story-2',
          topic_id: 'topic-2',
          headline: 'Crews reopen bridge lane after storm damage',
          source_count: 1,
          primary_source_count: 1,
          secondary_asset_count: 0,
          is_auditable: false,
          is_dom_visible: true,
        }],
      })],
    ]);
    const stats = new Map([[artifactDir, Date.parse('2026-03-19T11:00:00.000Z')]]);

    const snapshot = readExecutionBundleSnapshot(artifactDir, createFs(files, stats));

    expect(snapshot).toMatchObject({
      coverageScope: 'store_snapshot',
      topicCount: 1,
      sourceIdentityFidelityCounts: { exact: 0, count_only: 1, mixed: 0 },
    });
    expect(snapshot.topics[0]).toMatchObject({
      topic_id: 'topic-2',
      source_ids: [],
      source_count: 1,
      sourceIdentityFidelity: 'count_only',
      coverageScope: 'store_snapshot',
    });
  });

  it('marks mixed fidelity when audit and failure snapshots both contribute to a topic', () => {
    const artifactDir = '/repo/.tmp/daemon-feed-semantic-soak/300';
    const files = new Map([
      [`${artifactDir}/run-1.semantic-audit.json`, JSON.stringify({
        bundles: [{
          story_id: 'story-3',
          topic_id: 'topic-3',
          headline: 'Power restored to downtown blocks',
          canonical_source_count: 2,
          canonical_sources: [
            { source_id: 'bbc-general' },
            { source_id: 'guardian-us' },
          ],
        }],
      })],
      [`${artifactDir}/run-2.semantic-audit-failure-snapshot.json`, JSON.stringify({
        stories: [{
          story_id: 'story-4',
          topic_id: 'topic-3',
          headline: 'Power restored to downtown blocks',
          source_count: 3,
          primary_source_count: 3,
          secondary_asset_count: 0,
          is_auditable: true,
          is_dom_visible: true,
        }],
      })],
    ]);

    const snapshot = readExecutionBundleSnapshot(artifactDir, createFs(files));

    expect(snapshot.coverageScope).toBe('mixed');
    expect(snapshot.sourceIdentityFidelityCounts).toEqual({ exact: 0, count_only: 0, mixed: 1 });
    expect(snapshot.topics[0]).toMatchObject({
      topic_id: 'topic-3',
      source_ids: ['bbc-general', 'guardian-us'],
      source_count: 3,
      sourceIdentityFidelity: 'mixed',
      coverageScope: 'mixed',
    });
  });

  it('computes continuity metrics while keeping exact later-attachment limited to exact topics', () => {
    const priorSnapshots = [
      {
        artifactDir: '/repo/.tmp/daemon-feed-semantic-soak/100',
        generatedAt: '2026-03-19T09:00:00.000Z',
        timestampMs: Date.parse('2026-03-19T09:00:00.000Z'),
        coverageScope: 'mixed',
        topicCount: 2,
        auditableTopicCount: 1,
        sourceIdentityFidelityCounts: { exact: 1, count_only: 1, mixed: 0 },
        coverageScopeCounts: { audited_sample: 0, store_snapshot: 1, mixed: 1 },
        topics: [
          {
            topic_id: 'topic-1',
            story_ids: ['story-1'],
            headline: 'Flood response begins',
            source_ids: ['guardian-us'],
            source_count: 1,
            is_auditable: false,
            coverageScope: 'audited_sample',
            sourceIdentityFidelity: 'exact',
            observationKinds: ['audit'],
          },
          {
            topic_id: 'topic-2',
            story_ids: ['story-2'],
            headline: 'Bridge closure snarls traffic',
            source_ids: [],
            source_count: 2,
            is_auditable: true,
            coverageScope: 'store_snapshot',
            sourceIdentityFidelity: 'count_only',
            observationKinds: ['failure_snapshot'],
          },
        ],
      },
    ];
    const currentSnapshot = {
      artifactDir: '/repo/.tmp/daemon-feed-semantic-soak/200',
      generatedAt: '2026-03-19T12:00:00.000Z',
      timestampMs: Date.parse('2026-03-19T12:00:00.000Z'),
      coverageScope: 'mixed',
      topicCount: 3,
      auditableTopicCount: 3,
      sourceIdentityFidelityCounts: { exact: 2, count_only: 1, mixed: 0 },
      coverageScopeCounts: { audited_sample: 2, store_snapshot: 1, mixed: 0 },
      topics: [
        {
          topic_id: 'topic-1',
          story_ids: ['story-9'],
          headline: 'Flood response expands',
          source_ids: ['cbs-politics', 'guardian-us'],
          source_count: 2,
          is_auditable: true,
          coverageScope: 'audited_sample',
          sourceIdentityFidelity: 'exact',
          observationKinds: ['audit'],
        },
        {
          topic_id: 'topic-2',
          story_ids: ['story-10'],
          headline: 'Bridge closure snarls traffic',
          source_ids: [],
          source_count: 3,
          is_auditable: true,
          coverageScope: 'store_snapshot',
          sourceIdentityFidelity: 'count_only',
          observationKinds: ['failure_snapshot'],
        },
        {
          topic_id: 'topic-3',
          story_ids: ['story-11'],
          headline: 'Hospital opens temporary ward',
          source_ids: ['bbc-general', 'npr-politics'],
          source_count: 2,
          is_auditable: true,
          coverageScope: 'audited_sample',
          sourceIdentityFidelity: 'exact',
          observationKinds: ['audit'],
        },
      ],
    };

    const analysis = buildContinuityAnalysis(currentSnapshot, priorSnapshots, { lookbackHours: 24 });

    expect(analysis.metrics).toMatchObject({
      currentTopicCount: 3,
      priorTopicCount: 2,
      retainedTopicCount: 2,
      newTopicCount: 1,
      lostTopicCount: 0,
      topicRetentionRate: 1,
      priorSingletonTopicCount: 1,
      singletonToCorroboratedCount: 1,
      singletonToCorroboratedRate: 1,
      bundleGrowthCount: 2,
      bundleGrowthRate: 1,
      laterAttachmentCount: 1,
      laterAttachmentComparableTopicCount: 1,
      laterAttachmentUnknownTopicCount: 1,
      crossRunSourceDiversityGain: 1,
    });
    expect(analysis.transitions).toMatchObject({
      retainedTopicIds: ['topic-1', 'topic-2'],
      newTopicIds: ['topic-3'],
      lostTopicIds: [],
      singletonToCorroboratedTopicIds: ['topic-1'],
      bundleGrowthTopicIds: ['topic-1', 'topic-2'],
    });
    expect(analysis.transitions.exactLaterAttachmentTopics).toEqual([
      {
        topic_id: 'topic-1',
        attached_source_ids: ['cbs-politics'],
        attached_source_count: 1,
      },
    ]);
  });

  it('filters historical snapshots by lookback window and summarizes trend analyses', () => {
    const artifactRoot = '/repo/.tmp/daemon-feed-semantic-soak';
    const currentArtifactDir = `${artifactRoot}/300`;
    const files = new Map([
      [`${artifactRoot}/100/run-1.semantic-audit-failure-snapshot.json`, JSON.stringify({
        stories: [{ topic_id: 'topic-1', story_id: 'story-1', headline: 'A', source_count: 1, primary_source_count: 1, secondary_asset_count: 0, is_auditable: false, is_dom_visible: true }],
      })],
      [`${artifactRoot}/200/run-1.semantic-audit-failure-snapshot.json`, JSON.stringify({
        stories: [{ topic_id: 'topic-2', story_id: 'story-2', headline: 'B', source_count: 2, primary_source_count: 2, secondary_asset_count: 0, is_auditable: true, is_dom_visible: true }],
      })],
      [`${artifactRoot}/300/run-1.semantic-audit-failure-snapshot.json`, JSON.stringify({
        stories: [{ topic_id: 'topic-3', story_id: 'story-3', headline: 'C', source_count: 2, primary_source_count: 2, secondary_asset_count: 0, is_auditable: true, is_dom_visible: true }],
      })],
      [`${artifactRoot}/100/continuity-analysis.json`, JSON.stringify({
        artifactDir: `${artifactRoot}/100`,
        generatedAt: '2026-03-19T08:00:00.000Z',
        currentSnapshot: { coverageScope: 'store_snapshot' },
        priorBaseline: { coverageScope: 'store_snapshot', snapshotCount: 1 },
        metrics: { topicRetentionRate: 0.5, singletonToCorroboratedRate: 0, bundleGrowthRate: 0, crossRunSourceDiversityGain: 0, retainedTopicCount: 1, newTopicCount: 1, lostTopicCount: 0, singletonToCorroboratedCount: 0, bundleGrowthCount: 0, laterAttachmentCount: 0, laterAttachmentComparableTopicCount: 0 },
        transitions: { retainedTopicIds: ['topic-1'], newTopicIds: ['topic-2'], lostTopicIds: [], exactLaterAttachmentTopics: [] },
      })],
      [`${artifactRoot}/200/continuity-analysis.json`, JSON.stringify({
        artifactDir: `${artifactRoot}/200`,
        generatedAt: '2026-03-19T11:00:00.000Z',
        currentSnapshot: { coverageScope: 'mixed' },
        priorBaseline: { coverageScope: 'store_snapshot', snapshotCount: 1 },
        metrics: { topicRetentionRate: 1, singletonToCorroboratedRate: 1, bundleGrowthRate: 1, crossRunSourceDiversityGain: 1, retainedTopicCount: 2, newTopicCount: 0, lostTopicCount: 0, singletonToCorroboratedCount: 1, bundleGrowthCount: 1, laterAttachmentCount: 2, laterAttachmentComparableTopicCount: 1 },
        transitions: { retainedTopicIds: ['topic-1', 'topic-2'], newTopicIds: [], lostTopicIds: [], exactLaterAttachmentTopics: [{ topic_id: 'topic-2' }] },
      })],
    ]);
    const stats = new Map([
      [`${artifactRoot}/100`, Date.parse('2026-03-19T08:00:00.000Z')],
      [`${artifactRoot}/200`, Date.parse('2026-03-19T11:00:00.000Z')],
      [`${artifactRoot}/300`, Date.parse('2026-03-19T12:00:00.000Z')],
    ]);
    const fs = createFs(files, stats);

    const snapshots = readHistoricalExecutionBundleSnapshots(artifactRoot, {
      currentArtifactDir,
      currentTimestampMs: Date.parse('2026-03-19T12:00:00.000Z'),
      lookbackHours: 2,
      lookbackExecutionCount: 10,
      ...fs,
    });
    expect(snapshots.map((snapshot) => snapshot.artifactDir)).toEqual([`${artifactRoot}/200`]);

    const trend = buildContinuityTrendIndex([
      JSON.parse(files.get(`${artifactRoot}/100/continuity-analysis.json`)),
      JSON.parse(files.get(`${artifactRoot}/200/continuity-analysis.json`)),
    ], {
      artifactRoot,
      latestArtifactDir: currentArtifactDir,
      lookbackExecutionCount: 10,
      lookbackHours: 24,
    });

    expect(trend).toMatchObject({
      analysisCount: 2,
      averages: {
        topicRetentionRate: 0.75,
        singletonToCorroboratedRate: 0.5,
        bundleGrowthRate: 0.5,
        crossRunSourceDiversityGain: 0.5,
      },
      totals: {
        retainedTopicCount: 3,
        newTopicCount: 1,
        laterAttachmentCount: 2,
      },
      coverage: {
        currentCoverageScopes: ['store_snapshot', 'mixed'],
        exactLaterAttachmentComparableAnalysisCount: 1,
      },
    });
  });
});
