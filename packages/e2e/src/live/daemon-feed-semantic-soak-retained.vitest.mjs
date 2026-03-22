import { describe, expect, it } from 'vitest';
import {
  buildGhostRetainedMeshReport,
  buildGhostRetainedMeshTrendIndex,
  readExecutionRetainedSourceEvidenceSnapshot,
  readHistoricalExecutionRetainedSourceEvidenceSnapshots,
  readHistoricalGhostRetainedMeshReports,
} from './daemon-feed-semantic-soak-retained.mjs';

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

function makeSource({
  sourceId,
  urlHash,
  title,
  topicId,
  storyId,
  sourceRoles = ['source'],
  sourceCount = 1,
  primarySourceCount = sourceCount,
  secondaryAssetCount = 0,
  isAuditable = primarySourceCount >= 2,
}) {
  return {
    source_id: sourceId,
    publisher: sourceId,
    url: `https://example.com/${urlHash}`,
    url_hash: urlHash,
    title,
    observations: [{
      story_id: storyId,
      topic_id: topicId,
      headline: title,
      source_count: sourceCount,
      primary_source_count: primarySourceCount,
      secondary_asset_count: secondaryAssetCount,
      is_auditable: isAuditable,
      is_dom_visible: true,
      source_roles: sourceRoles,
    }],
  };
}

describe('daemon-feed-semantic-soak retained mesh', () => {
  it('reads and dedupes retained source evidence within an execution', () => {
    const artifactDir = '/repo/.tmp/daemon-feed-semantic-soak/200';
    const files = new Map([
      [`${artifactDir}/semantic-soak-summary.json`, JSON.stringify({
        generatedAt: '2026-03-22T12:00:00.000Z',
      })],
      [`${artifactDir}/run-1.retained-source-evidence.json`, JSON.stringify({
        generatedAt: '2026-03-22T11:00:00.000Z',
        story_count: 2,
        auditable_count: 1,
        visible_story_ids: ['story-1'],
        top_story_ids: ['story-1'],
        top_auditable_story_ids: ['story-1'],
        source_count: 2,
        sources: [
          makeSource({
            sourceId: 'guardian-us',
            urlHash: 'guardian-1',
            title: 'Bridge closure snarls traffic',
            topicId: 'topic-1',
            storyId: 'story-1',
            sourceCount: 1,
            primarySourceCount: 1,
          }),
          makeSource({
            sourceId: 'today-video',
            urlHash: 'video-1',
            title: 'Explainer video',
            topicId: 'topic-2',
            storyId: 'story-2',
            sourceRoles: ['secondary_asset'],
            sourceCount: 1,
            primarySourceCount: 1,
            secondaryAssetCount: 1,
            isAuditable: false,
          }),
        ],
      })],
      [`${artifactDir}/run-2.retained-source-evidence.json`, JSON.stringify({
        generatedAt: '2026-03-22T12:00:00.000Z',
        story_count: 2,
        auditable_count: 1,
        visible_story_ids: ['story-9'],
        top_story_ids: ['story-9'],
        top_auditable_story_ids: ['story-9'],
        source_count: 2,
        sources: [
          makeSource({
            sourceId: 'guardian-us',
            urlHash: 'guardian-1',
            title: 'Bridge closure snarls traffic',
            topicId: 'topic-1',
            storyId: 'story-9',
            sourceCount: 2,
            primarySourceCount: 2,
            isAuditable: true,
          }),
          makeSource({
            sourceId: 'cbs-politics',
            urlHash: 'cbs-1',
            title: 'Bridge closure snarls traffic',
            topicId: 'topic-1',
            storyId: 'story-9',
            sourceCount: 2,
            primarySourceCount: 2,
            isAuditable: true,
          }),
        ],
      })],
    ]);

    const snapshot = readExecutionRetainedSourceEvidenceSnapshot(artifactDir, createFs(files));

    expect(snapshot).toMatchObject({
      artifactDir,
      generatedAt: '2026-03-22T12:00:00.000Z',
      runCount: 2,
      sourceCount: 3,
      topicCount: 2,
      auditableTopicCount: 1,
      visibleStoryIds: ['story-1', 'story-9'],
    });
    expect(snapshot.topics).toEqual([
      expect.objectContaining({
        topic_id: 'topic-1',
        canonical_source_count: 2,
        is_auditable: true,
      }),
      expect.objectContaining({
        topic_id: 'topic-2',
        canonical_source_count: 0,
        secondary_only_source_count: 1,
        is_auditable: false,
      }),
    ]);
    expect(snapshot.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidence_key: 'guardian-us::guardian-1',
        storyDrifted: true,
        topicDrifted: false,
        observedStoryIds: ['story-1', 'story-9'],
        latestTopicId: 'topic-1',
        latestSourceRoles: ['source'],
      }),
      expect.objectContaining({
        evidence_key: 'today-video::video-1',
        isCanonicalEvidence: false,
        latestSourceRoles: ['secondary_asset'],
      }),
    ]));
  });

  it('builds a retained mesh report from current execution and prior window evidence', () => {
    const currentSnapshot = {
      artifactDir: '/repo/.tmp/daemon-feed-semantic-soak/300',
      generatedAt: '2026-03-22T12:00:00.000Z',
      timestampMs: Date.parse('2026-03-22T12:00:00.000Z'),
      runCount: 1,
      storyCount: 2,
      auditableStoryCount: 1,
      visibleStoryIds: ['story-9', 'story-10'],
      topStoryIds: ['story-9', 'story-10'],
      topAuditableStoryIds: ['story-9'],
      evidence: [
        {
          evidence_key: 'guardian-us::guardian-1',
          source_id: 'guardian-us',
          firstSeenTimestampMs: Date.parse('2026-03-22T12:00:00.000Z'),
          lastSeenTimestampMs: Date.parse('2026-03-22T12:00:00.000Z'),
          latestTopicId: 'topic-1',
          latestStoryId: 'story-9',
          latestSourceRoles: ['source'],
          observedTopicIds: ['topic-1'],
          observedStoryIds: ['story-9'],
          topicDrifted: false,
          storyDrifted: false,
          seenInCurrent: true,
          seenInPrior: false,
          isCanonicalEvidence: true,
        },
        {
          evidence_key: 'cbs-politics::cbs-1',
          source_id: 'cbs-politics',
          firstSeenTimestampMs: Date.parse('2026-03-22T12:00:00.000Z'),
          lastSeenTimestampMs: Date.parse('2026-03-22T12:00:00.000Z'),
          latestTopicId: 'topic-1',
          latestStoryId: 'story-9',
          latestSourceRoles: ['source'],
          observedTopicIds: ['topic-1'],
          observedStoryIds: ['story-9'],
          topicDrifted: false,
          storyDrifted: false,
          seenInCurrent: true,
          seenInPrior: false,
          isCanonicalEvidence: true,
        },
        {
          evidence_key: 'bbc-general::bbc-1',
          source_id: 'bbc-general',
          firstSeenTimestampMs: Date.parse('2026-03-22T12:00:00.000Z'),
          lastSeenTimestampMs: Date.parse('2026-03-22T12:00:00.000Z'),
          latestTopicId: 'topic-3',
          latestStoryId: 'story-10',
          latestSourceRoles: ['source'],
          observedTopicIds: ['topic-3'],
          observedStoryIds: ['story-10'],
          topicDrifted: false,
          storyDrifted: false,
          seenInCurrent: true,
          seenInPrior: false,
          isCanonicalEvidence: true,
        },
      ],
      topics: [
        {
          topic_id: 'topic-1',
          canonical_source_count: 2,
          is_auditable: true,
        },
        {
          topic_id: 'topic-3',
          canonical_source_count: 1,
          is_auditable: false,
        },
      ],
      sourceCount: 3,
      topicCount: 2,
      auditableTopicCount: 1,
    };
    const priorSnapshots = [{
      artifactDir: '/repo/.tmp/daemon-feed-semantic-soak/200',
      generatedAt: '2026-03-22T08:00:00.000Z',
      timestampMs: Date.parse('2026-03-22T08:00:00.000Z'),
      evidence: [
        {
          evidence_key: 'guardian-us::guardian-1',
          source_id: 'guardian-us',
          publisher: 'guardian-us',
          url: 'https://example.com/guardian-1',
          url_hash: 'guardian-1',
          title: 'Bridge closure snarls traffic',
          firstSeenTimestampMs: Date.parse('2026-03-22T08:00:00.000Z'),
          lastSeenTimestampMs: Date.parse('2026-03-22T08:00:00.000Z'),
          latestTopicId: 'topic-1',
          latestStoryId: 'story-1',
          latestHeadline: 'Bridge closure snarls traffic',
          latestSourceRoles: ['source'],
          allSourceRoles: ['source'],
          latestSourceCount: 1,
          latestPrimarySourceCount: 1,
          latestSecondaryAssetCount: 0,
          latestIsAuditable: false,
          latestIsDomVisible: true,
          maxSourceCount: 1,
          maxPrimarySourceCount: 1,
          maxSecondaryAssetCount: 0,
          observationCount: 1,
          runNumbers: [1],
          observedTopicIds: ['topic-1'],
          observedStoryIds: ['story-1'],
          topicDrifted: false,
          storyDrifted: false,
          seenInCurrent: false,
          seenInPrior: true,
          isCanonicalEvidence: true,
          observations: [{
            generatedAt: '2026-03-22T08:00:00.000Z',
            run: 1,
            story_id: 'story-1',
            topic_id: 'topic-1',
            headline: 'Bridge closure snarls traffic',
            source_count: 1,
            primary_source_count: 1,
            secondary_asset_count: 0,
            is_auditable: false,
            is_dom_visible: true,
            source_roles: ['source'],
          }],
        },
        {
          evidence_key: 'npr-politics::npr-1',
          source_id: 'npr-politics',
          publisher: 'npr-politics',
          url: 'https://example.com/npr-1',
          url_hash: 'npr-1',
          title: 'Governor signs relief bill',
          firstSeenTimestampMs: Date.parse('2026-03-22T08:00:00.000Z'),
          lastSeenTimestampMs: Date.parse('2026-03-22T08:00:00.000Z'),
          latestTopicId: 'topic-2',
          latestStoryId: 'story-2',
          latestHeadline: 'Governor signs relief bill',
          latestSourceRoles: ['source'],
          allSourceRoles: ['source'],
          latestSourceCount: 1,
          latestPrimarySourceCount: 1,
          latestSecondaryAssetCount: 0,
          latestIsAuditable: false,
          latestIsDomVisible: true,
          maxSourceCount: 1,
          maxPrimarySourceCount: 1,
          maxSecondaryAssetCount: 0,
          observationCount: 1,
          runNumbers: [1],
          observedTopicIds: ['topic-2'],
          observedStoryIds: ['story-2'],
          topicDrifted: false,
          storyDrifted: false,
          seenInCurrent: false,
          seenInPrior: true,
          isCanonicalEvidence: true,
          observations: [{
            generatedAt: '2026-03-22T08:00:00.000Z',
            run: 1,
            story_id: 'story-2',
            topic_id: 'topic-2',
            headline: 'Governor signs relief bill',
            source_count: 1,
            primary_source_count: 1,
            secondary_asset_count: 0,
            is_auditable: false,
            is_dom_visible: true,
            source_roles: ['source'],
          }],
        },
      ],
    }];

    const report = buildGhostRetainedMeshReport(currentSnapshot, priorSnapshots, { lookbackHours: 24 });

    expect(report).toMatchObject({
      schemaVersion: 'daemon-feed-ghost-retained-mesh-report-v1',
      lookbackHours: 24,
      currentExecution: {
        topicCount: 2,
        auditableTopicCount: 1,
        uniqueCanonicalSourceCount: 3,
      },
      priorWindow: {
        snapshotCount: 1,
        topicCount: 2,
        auditableTopicCount: 0,
        uniqueCanonicalSourceCount: 2,
      },
      retainedMesh: {
        topicCount: 3,
        auditableTopicCount: 1,
        uniqueCanonicalSourceCount: 4,
      },
      freshContribution: {
        priorSnapshotCount: 1,
        retainedTopicCount: 1,
        newTopicCount: 1,
        lostTopicCount: 1,
        laterAttachmentCount: 1,
        singletonToAuditableCount: 1,
        growingTopicCount: 1,
        averageSourceDiversityGain: 0.5,
      },
      deltas: {
        auditableTopicCountDelta: 0,
        uniqueCanonicalSourceCountDelta: 1,
        topicCountDelta: 1,
      },
    });
    expect(report.freshContribution.laterAttachmentEvidenceKeys).toEqual(['cbs-politics::cbs-1']);
    expect(report.retainedMesh.topics).toEqual(expect.arrayContaining([
      expect.objectContaining({ topic_id: 'topic-2', canonical_source_count: 1 }),
    ]));
    expect(report.scoring.contaminationAssessment).toEqual({
      status: 'not_available',
      reason: 'retained_source_evidence_snapshot_omits_pair_text_and_pair_labels',
    });
  });

  it('filters historical retained snapshots and summarizes retained-mesh trends', () => {
    const artifactRoot = '/repo/.tmp/daemon-feed-semantic-soak';
    const currentArtifactDir = `${artifactRoot}/300`;
    const files = new Map([
      [`${artifactRoot}/100/run-1.retained-source-evidence.json`, JSON.stringify({
        generatedAt: '2026-03-22T02:00:00.000Z',
        story_count: 1,
        auditable_count: 0,
        visible_story_ids: ['story-1'],
        top_story_ids: ['story-1'],
        top_auditable_story_ids: [],
        sources: [makeSource({
          sourceId: 'guardian-us',
          urlHash: 'guardian-1',
          title: 'Older evidence',
          topicId: 'topic-1',
          storyId: 'story-1',
          sourceCount: 1,
          primarySourceCount: 1,
        })],
      })],
      [`${artifactRoot}/200/run-1.retained-source-evidence.json`, JSON.stringify({
        generatedAt: '2026-03-22T10:00:00.000Z',
        story_count: 1,
        auditable_count: 0,
        visible_story_ids: ['story-2'],
        top_story_ids: ['story-2'],
        top_auditable_story_ids: [],
        sources: [makeSource({
          sourceId: 'cbs-politics',
          urlHash: 'cbs-1',
          title: 'Recent evidence',
          topicId: 'topic-2',
          storyId: 'story-2',
          sourceCount: 1,
          primarySourceCount: 1,
        })],
      })],
      [`${artifactRoot}/100/ghost-retained-mesh-report.json`, JSON.stringify({
        artifactDir: `${artifactRoot}/100`,
        generatedAt: '2026-03-22T02:00:00.000Z',
        retainedMesh: { evidenceCount: 1, topicCount: 1, auditableTopicCount: 0, corroboratedTopicRate: 0, uniqueCanonicalSourceCount: 1, averageLastSeenAgeHours: 20, topicDriftRate: 0, storyDriftRate: 0 },
        currentExecution: { corroboratedTopicRate: 0, uniqueCanonicalSourceCount: 1, topicCount: 1, auditableTopicCount: 0 },
        freshContribution: { topicRetentionRate: 0, laterAttachmentCount: 0, singletonToAuditableCount: 0, growingTopicCount: 0, averageSourceDiversityGain: 0 },
        deltas: { corroboratedTopicRateDelta: 0, uniqueCanonicalSourceCountDelta: 0 },
      })],
      [`${artifactRoot}/200/ghost-retained-mesh-report.json`, JSON.stringify({
        artifactDir: `${artifactRoot}/200`,
        generatedAt: '2026-03-22T10:00:00.000Z',
        retainedMesh: { evidenceCount: 3, topicCount: 2, auditableTopicCount: 1, corroboratedTopicRate: 0.5, uniqueCanonicalSourceCount: 3, averageLastSeenAgeHours: 2, topicDriftRate: 0.25, storyDriftRate: 0.25 },
        currentExecution: { corroboratedTopicRate: 0.25, uniqueCanonicalSourceCount: 2, topicCount: 2, auditableTopicCount: 1 },
        freshContribution: { topicRetentionRate: 0.5, laterAttachmentCount: 1, singletonToAuditableCount: 1, growingTopicCount: 1, averageSourceDiversityGain: 1 },
        deltas: { corroboratedTopicRateDelta: 0.25, uniqueCanonicalSourceCountDelta: 1 },
      })],
    ]);
    const stats = new Map([
      [`${artifactRoot}/100`, Date.parse('2026-03-22T02:00:00.000Z')],
      [`${artifactRoot}/200`, Date.parse('2026-03-22T10:00:00.000Z')],
      [`${artifactRoot}/300`, Date.parse('2026-03-22T12:00:00.000Z')],
    ]);
    const fs = createFs(files, stats);

    const snapshots = readHistoricalExecutionRetainedSourceEvidenceSnapshots(artifactRoot, {
      currentArtifactDir,
      currentTimestampMs: Date.parse('2026-03-22T12:00:00.000Z'),
      lookbackHours: 6,
      lookbackExecutionCount: 5,
      ...fs,
    });
    const reports = readHistoricalGhostRetainedMeshReports(artifactRoot, {
      currentArtifactDir,
      lookbackExecutionCount: 5,
      ...fs,
    });
    const trend = buildGhostRetainedMeshTrendIndex(reports, {
      artifactRoot,
      latestArtifactDir: currentArtifactDir,
      lookbackExecutionCount: 5,
      lookbackHours: 24,
    });

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].artifactDir).toBe(`${artifactRoot}/200`);
    expect(reports).toHaveLength(2);
    expect(trend).toMatchObject({
      schemaVersion: 'daemon-feed-ghost-retained-mesh-trend-index-v1',
      reportCount: 2,
      latestReport: {
        artifactDir: `${artifactRoot}/200`,
        retainedMesh: {
          topicCount: 2,
          auditableTopicCount: 1,
        },
      },
      averages: {
        retainedCorroboratedTopicRate: 0.25,
        currentCorroboratedTopicRate: 0.125,
        corroboratedTopicRateDelta: 0.125,
        retainedUniqueCanonicalSourceCount: 2,
        uniqueCanonicalSourceCountDelta: 0.5,
        retainedAverageLastSeenAgeHours: 11,
        topicRetentionRate: 0.25,
        laterAttachmentCount: 0.5,
        singletonToAuditableCount: 0.5,
        averageSourceDiversityGain: 0.5,
        retainedTopicDriftRate: 0.125,
        retainedStoryDriftRate: 0.125,
      },
      totals: {
        retainedEvidenceCount: 4,
        retainedTopicCount: 3,
        retainedAuditableTopicCount: 1,
        laterAttachmentCount: 1,
        singletonToAuditableCount: 1,
        growingTopicCount: 1,
      },
    });
  });
});
