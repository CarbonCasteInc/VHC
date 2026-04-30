import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FeedSourceSchema, STARTER_FEED_SOURCES, type FeedSource } from '@vh/ai-engine';
import {
  buildSourceCandidateScoutReport,
  writeSourceCandidateScoutReport,
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

  it('keeps demoted starter sources available for scout-first readmission', () => {
    const candidates = sourceCandidateScoutInternal.resolveCandidateFeedSources();

    expect(STARTER_FEED_SOURCES.map((source) => source.id)).not.toContain('washingtonexaminer-politics');
    expect(candidates.map((source) => source.id)).toContain('washingtonexaminer-politics');
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
              feedRead: {
                ok: candidateOnlyStatus === 'admitted',
                httpStatus: candidateOnlyStatus === 'admitted' ? 200 : null,
                contentType: candidateOnlyStatus === 'admitted' ? 'application/rss+xml' : null,
                bodyLength: candidateOnlyStatus === 'admitted' ? 1024 : null,
                resolvedFeedUrl:
                  source.id === 'alpha' && candidateOnlyStatus === 'admitted'
                    ? 'https://alpha.example.com/feed.xml'
                    : source.rssUrl,
                payloadKind: candidateOnlyStatus === 'admitted' ? 'xml' : 'unavailable',
                errorCode: candidateOnlyStatus === 'admitted' ? null : 'feed_fetch_error',
                errorMessage: candidateOnlyStatus === 'admitted' ? null : 'unavailable',
                attemptCount: 1,
                itemFragmentCount: candidateOnlyStatus === 'admitted' ? 4 : 0,
                entryFragmentCount: 0,
                extractedLinkCount: candidateOnlyStatus === 'admitted' ? 4 : 0,
              },
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
        expect(source?.rssUrl).toBe('https://alpha.example.com/feed.xml');
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
      resolvedRssUrl: 'https://alpha.example.com/feed.xml',
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

  it('preserves the previous latest report when a full run fails at the feed stage', async () => {
    const alpha = candidate('alpha');
    let mode: 'good' | 'bad' = 'good';
    let timestamp = 1000;
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'vh-source-scout-latest-'));
    tempDirs.push(cwd);

    const writeAdmissionArtifactFn = async ({ feedSources, artifactDir }: { feedSources?: readonly FeedSource[]; artifactDir?: string }) => {
      const source = feedSources?.[0]!;
      const admitted = mode === 'good';
      const reasons = admitted ? [] : ['feed_links_unavailable', 'feed_fetch_timeout'];
      const admissionReport: SourceAdmissionReport = {
        schemaVersion: 'news-source-admission-report-v1',
        generatedAt: new Date(timestamp).toISOString(),
        criteria: {
          sampleSize: 4,
          minimumSuccessCount: 2,
          minimumSuccessRate: 0.75,
        },
        sourceCount: 1,
        admittedSourceIds: admitted ? [source.id] : [],
        rejectedSourceIds: [],
        inconclusiveSourceIds: admitted ? [] : [source.id],
        sources: [
          {
            sourceId: source.id,
            sourceName: source.name,
            rssUrl: source.rssUrl,
            status: admitted ? 'admitted' : 'inconclusive',
            admitted,
            sampleLinkCount: admitted ? 4 : 0,
            readableSampleCount: admitted ? 4 : 0,
            readableSampleRate: admitted ? 1 : null,
            reasons,
            sampledUrls: [],
            samples: [],
            lifecycle: [],
            feedRead: {
              ok: admitted,
              httpStatus: admitted ? 200 : null,
              contentType: admitted ? 'application/rss+xml' : null,
              bodyLength: admitted ? 1024 : null,
              resolvedFeedUrl: source.rssUrl,
              payloadKind: admitted ? 'xml' : 'unavailable',
              errorCode: admitted ? null : 'feed_fetch_timeout',
              errorMessage: admitted ? null : 'timeout',
              attemptCount: admitted ? 1 : 2,
              itemFragmentCount: admitted ? 4 : 0,
              entryFragmentCount: 0,
              extractedLinkCount: admitted ? 4 : 0,
            },
          },
        ],
      };

      return {
        artifactDir: artifactDir!,
        reportPath: `${artifactDir}/source-admission-report.json`,
        report: admissionReport,
      };
    };

    const writeHealthArtifactFn = async ({ feedSources, artifactDir }: { feedSources?: readonly FeedSource[]; artifactDir?: string }) => {
      const source = feedSources?.find((entry) => entry.id === 'alpha')!;
      const sourceHealthReport: SourceHealthReport = {
        schemaVersion: 'news-source-health-report-v1',
        generatedAt: new Date(timestamp).toISOString(),
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
          generatedAt: new Date(timestamp).toISOString(),
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
          generatedAt: new Date(timestamp).toISOString(),
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
          generatedAt: new Date(timestamp).toISOString(),
          lookbackRunCount: 1,
          runCount: 1,
          releaseEvidence: sourceHealthReport.releaseEvidence,
          runs: [],
        },
      };
    };

    const firstReport = await writeSourceCandidateScoutReport({
      cwd,
      now: () => timestamp,
      candidateFeedSources: [alpha],
      writeAdmissionArtifactFn,
      writeHealthArtifactFn,
    });

    const latestReportPath = firstReport.paths.latestReportPath;
    const firstLatest = JSON.parse(readFileSync(latestReportPath, 'utf8')) as { topPromotableCandidateId: string | null };
    expect(firstLatest.topPromotableCandidateId).toBe('alpha');

    mode = 'bad';
    timestamp = 2000;
    const failedReport = await writeSourceCandidateScoutReport({
      cwd,
      now: () => timestamp,
      candidateFeedSources: [alpha],
      writeAdmissionArtifactFn,
      writeHealthArtifactFn,
    });

    expect(failedReport.runAssessment).toEqual({
      globalFeedStageFailure: true,
      latestPublicationAction: 'preserve_previous_latest',
      latestPublicationSkipReason: 'all_candidates_failed_at_feed_stage',
    });

    const preservedLatest = JSON.parse(readFileSync(latestReportPath, 'utf8')) as { topPromotableCandidateId: string | null };
    expect(preservedLatest.topPromotableCandidateId).toBe('alpha');
    const failedTimestamped = JSON.parse(readFileSync(failedReport.paths.reportPath, 'utf8')) as { runAssessment: { globalFeedStageFailure: boolean } };
    expect(failedTimestamped.runAssessment.globalFeedStageFailure).toBe(true);
  });
});
