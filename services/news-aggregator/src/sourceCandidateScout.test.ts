import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FeedSourceSchema, STARTER_FEED_SOURCES, type FeedSource } from '@vh/ai-engine';
import {
  buildSourceCandidateScoutReport,
  sourceCandidateScoutInternal,
} from './sourceCandidateScout';
import type { SourceAdmissionReport } from './sourceAdmissionReport';
import type { SourceHealthReport } from './sourceHealthReport';

function candidate(id: string, rssUrl = `https://example.com/${id}.xml`): FeedSource {
  return FeedSourceSchema.parse({
    id,
    name: id,
    displayName: id,
    rssUrl,
    enabled: true,
  });
}

describe('sourceCandidateScout', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('filters starter sources and env-selected candidate ids', () => {
    const existing = STARTER_FEED_SOURCES[0]!;
    const candidates = sourceCandidateScoutInternal.resolveCandidateFeedSources({
      candidateFeedSources: [existing, candidate('alpha'), candidate('beta')],
      env: {
        VH_NEWS_SOURCE_SCOUT_CANDIDATE_IDS: 'beta',
      },
    });

    expect(candidates.map((source) => source.id)).toEqual(['beta']);
  });

  it('ranks promotable corroborating candidates ahead of blocked candidates', () => {
    const ranked = [
      {
        sourceId: 'watch',
        promotable: false,
        corroboratedBundleCount: 0,
        bundleAppearanceCount: 10,
        ingestedItemCount: 10,
        readableSampleRate: 1,
      },
      {
        sourceId: 'promotable',
        promotable: true,
        corroboratedBundleCount: 3,
        bundleAppearanceCount: 4,
        ingestedItemCount: 5,
        readableSampleRate: 1,
      },
    ].sort(
      sourceCandidateScoutInternal.compareCandidateResults as (left: never, right: never) => number,
    );

    expect(ranked.map((candidate) => candidate.sourceId)).toEqual(['promotable', 'watch']);
  });

  it('wraps scout fetches with a timeout', async () => {
    const wrapped = sourceCandidateScoutInternal.wrapFetchWithTimeout(
      async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        }, { once: true });
      }),
      5,
    );

    await expect(wrapped('https://example.com/feed.xml')).rejects.toThrow('aborted');
  });

  it('builds a scout report from injected admission and health writers', async () => {
    const alpha = candidate('alpha');
    const beta = candidate('beta');
    const now = () => 1234;
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'vh-source-scout-'));
    tempDirs.push(cwd);

    const report = await buildSourceCandidateScoutReport({
      cwd,
      now,
      candidateFeedSources: [alpha, beta],
      writeAdmissionArtifactFn: async ({ feedSources, artifactDir }) => {
        const source = feedSources?.[0]!;
        const candidateOnlyStatus = source.id === 'alpha' ? 'admitted' : 'inconclusive';
        const admissionReport: SourceAdmissionReport = {
          schemaVersion: 'news-source-admission-report-v1',
          generatedAt: new Date(now()).toISOString(),
          criteria: {
            sampleSize: 4,
            minimumSuccessCount: 2,
            minimumSuccessRate: 0.75,
          },
          sourceCount: 1,
          admittedSourceIds: candidateOnlyStatus === 'admitted' ? [source.id] : [],
          rejectedSourceIds: [],
          inconclusiveSourceIds: candidateOnlyStatus === 'inconclusive' ? [source.id] : [],
          sources: [
            {
              sourceId: source.id,
              sourceName: source.name,
              rssUrl: source.rssUrl,
              status: candidateOnlyStatus,
              admitted: candidateOnlyStatus === 'admitted',
              sampleLinkCount: 4,
              readableSampleCount: candidateOnlyStatus === 'admitted' ? 4 : 0,
              readableSampleRate: candidateOnlyStatus === 'admitted' ? 1 : 0,
              reasons: candidateOnlyStatus === 'admitted' ? [] : ['feed_links_unavailable'],
              sampledUrls: [],
              samples: [],
              lifecycle: [],
            },
          ],
        };

        return {
          artifactDir: artifactDir!,
          reportPath: `${artifactDir}/source-admission-report.json`,
          report: admissionReport,
        };
      },
      writeHealthArtifactFn: async ({ feedSources, artifactDir }) => {
        const source = feedSources?.find((entry) => entry.id === 'alpha')!;
        const sourceHealthReport: SourceHealthReport = {
          schemaVersion: 'news-source-health-report-v1',
          generatedAt: new Date(now()).toISOString(),
          readinessStatus: 'ready',
          recommendedAction: 'starter_surface_ready',
          sourceCount: feedSources?.length ?? 0,
          keepSourceIds: feedSources?.map((entry) => entry.id) ?? [],
          watchSourceIds: [],
          removeSourceIds: [],
          thresholds: {
            keepMinReadableSampleRate: 1,
            maxWatchSourceCount: 0,
            minEnabledSourceCount: 1,
            removeRejectedNonFeedOutage: true,
            requireHealthyLifecycleForKeep: true,
            historyLookbackRunCount: 8,
            watchEscalationRunCount: 3,
            readmissionKeepRunCount: 2,
            releaseEvidenceWindowRunCount: 5,
            maxNonReadyRunsInWindow: 1,
            minContributingSourceCount: 1,
          },
          observability: {
            enabledSourceCount: feedSources?.length ?? 0,
            keepSourceCount: feedSources?.length ?? 0,
            watchSourceCount: 0,
            removeSourceCount: 0,
            admittedSourceCount: feedSources?.length ?? 0,
            rejectedSourceCount: 0,
            inconclusiveSourceCount: 0,
            unstableLifecycleSourceCount: 0,
            historyEscalatedSourceCount: 0,
            pendingReadmissionSourceCount: 0,
            contributingSourceCount: feedSources?.length ?? 0,
            corroboratingSourceCount: feedSources?.length ?? 0,
            zeroContributionEnabledSourceCount: 0,
            reasonCounts: {},
          },
          feedContribution: {
            schemaVersion: 'news-source-feed-contribution-report-v1',
            generatedAt: new Date(now()).toISOString(),
            snapshotMode: 'heuristic_live_feed_snapshot',
            sourceCount: feedSources?.length ?? 0,
            totalIngestedItemCount: 10,
            totalNormalizedItemCount: 10,
            totalBundleCount: 5,
            totalSingletonBundleCount: 1,
            totalCorroboratedBundleCount: 4,
            contributingSourceIds: feedSources?.map((entry) => entry.id) ?? [],
            corroboratingSourceIds: feedSources?.map((entry) => entry.id) ?? [],
            zeroContributionSourceIds: [],
            sources: (feedSources ?? []).map((entry) => ({
              sourceId: entry.id,
              sourceName: entry.name,
              rssUrl: entry.rssUrl,
              ingestErrorCount: 0,
              ingestErrors: [],
              ingestedItemCount: entry.id === source.id ? 10 : 2,
              normalizedItemCount: entry.id === source.id ? 8 : 2,
              dedupDroppedItemCount: 0,
              bundleAppearanceCount: entry.id === source.id ? 5 : 2,
              singletonBundleCount: entry.id === source.id ? 2 : 0,
              corroboratedBundleCount: entry.id === source.id ? 3 : 2,
              contributionStatus: 'corroborated' as const,
            })),
          },
          historySummary: {
            lookbackRunCount: 0,
            priorReportCount: 0,
            escalatedSourceIds: [],
            pendingReadmissionSourceIds: [],
          },
          releaseEvidence: {
            status: 'pass',
            recommendedAction: 'release_ready',
            reasons: [],
            recentWindowRunCount: 1,
            recentReadyRunCount: 1,
            recentReviewRunCount: 0,
            recentBlockedRunCount: 0,
            latestNewWatchSourceIds: [],
            latestNewRemoveSourceIds: [],
          },
          runtimePolicy: {
            generatedAt: new Date(now()).toISOString(),
            readinessStatus: 'ready',
            recommendedAction: 'starter_surface_ready',
            enabledSourceIds: feedSources?.map((entry) => entry.id) ?? [],
            watchSourceIds: [],
            removeSourceIds: [],
          },
          sources: [
            {
              sourceId: source.id,
              sourceName: source.name,
              rssUrl: source.rssUrl,
              admissionStatus: 'admitted',
              baseDecision: 'keep',
              decision: 'keep',
              recommendedAction: 'keep_in_starter_surface',
              reasons: [],
              readableSampleRate: 1,
              readableSampleCount: 4,
              sampleLinkCount: 4,
              unstableLifecycleDomains: [],
              feedContribution: {
                sourceId: source.id,
                sourceName: source.name,
                rssUrl: source.rssUrl,
                ingestErrorCount: 0,
                ingestErrors: [],
                ingestedItemCount: 10,
                normalizedItemCount: 8,
                dedupDroppedItemCount: 2,
                bundleAppearanceCount: 5,
                singletonBundleCount: 2,
                corroboratedBundleCount: 3,
                contributionStatus: 'corroborated',
              },
              history: {
                priorReportCount: 0,
                priorEffectiveDecision: null,
                priorEffectiveDecisions: [],
                priorBaseDecisions: [],
                consecutiveBaseKeepRuns: 0,
                consecutiveDegradedRuns: 0,
                escalatedToRemove: false,
                pendingReadmission: false,
              },
            },
          ],
          paths: {
            artifactDir: artifactDir!,
            admissionReportPath: `${artifactDir}/source-admission-report.json`,
            sourceHealthReportPath: `${artifactDir}/source-health-report.json`,
            sourceHealthTrendPath: `${artifactDir}/source-health-trend.json`,
            latestArtifactDir: `${artifactDir}/latest`,
            latestAdmissionReportPath: `${artifactDir}/latest/source-admission-report.json`,
            latestSourceHealthReportPath: `${artifactDir}/latest/source-health-report.json`,
            latestSourceHealthTrendPath: `${artifactDir}/latest/source-health-trend.json`,
          },
        };

        return {
          latestArtifactDir: `${artifactDir}/latest`,
          latestAdmissionReportPath: `${artifactDir}/latest/source-admission-report.json`,
          latestSourceHealthReportPath: `${artifactDir}/latest/source-health-report.json`,
          latestSourceHealthTrendPath: `${artifactDir}/latest/source-health-trend.json`,
          artifactDir: artifactDir!,
          admissionReportPath: `${artifactDir}/source-admission-report.json`,
          sourceHealthReportPath: `${artifactDir}/source-health-report.json`,
          sourceHealthTrendPath: `${artifactDir}/source-health-trend.json`,
          admissionReport: {} as SourceAdmissionReport,
          sourceHealthReport,
          sourceHealthTrendIndex: {
            schemaVersion: 'news-source-health-trend-v1',
            generatedAt: new Date(now()).toISOString(),
            lookbackRunCount: 1,
            runCount: 1,
            releaseEvidence: sourceHealthReport.releaseEvidence,
            runs: [],
          },
        };
      },
    });

    expect(report.promotableCandidateIds).toEqual(['alpha']);
    expect(report.topPromotableCandidateId).toBe('alpha');
    expect(report.candidates[0]).toMatchObject({
      sourceId: 'alpha',
      promotable: true,
      candidateDecision: 'keep',
      contributionStatus: 'corroborated',
      scoutRecommendedAction: 'prepare_promotion_pr',
    });
    expect(report.candidates[1]).toMatchObject({
      sourceId: 'beta',
      promotable: false,
      candidateOnlyStatus: 'inconclusive',
      scoutRecommendedAction: 'hold_for_feed_access',
    });
  });
});
