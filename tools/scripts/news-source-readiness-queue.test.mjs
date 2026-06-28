import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSourceReadinessQueue } from './news-source-readiness-queue.mjs';

const NOW = new Date('2026-06-28T14:30:00.000Z');

function scout(overrides = {}) {
  return {
    schemaVersion: 'news-source-candidate-scout-report-v1',
    generatedAt: '2026-06-28T13:30:00.000Z',
    candidateCount: 2,
    promotableCandidateIds: ['ap-politics'],
    topPromotableCandidateId: 'ap-politics',
    recommendedAction: 'prepare_promotion_pr',
    runAssessment: { globalFeedStageFailure: false },
    candidates: [
      {
        sourceId: 'blocked-source',
        sourceName: 'Blocked Source',
        rssUrl: 'https://blocked.example/rss.xml',
        candidateOnlyStatus: 'rejected',
        candidateOnlyReasons: ['access-denied'],
        readableSampleRate: 0,
        promotable: false,
        blockingReasons: ['candidate_rejected', 'access-denied'],
        scoutRecommendedAction: 'skip_candidate',
      },
      {
        sourceId: 'ap-politics',
        sourceName: 'Associated Press Politics',
        rssUrl: 'https://apnews.com/politics',
        candidateOnlyStatus: 'admitted',
        readableSampleRate: 1,
        surfaceReadinessStatus: 'ready',
        surfaceReleaseEvidenceStatus: 'pass',
        candidateDecision: 'keep',
        contributionStatus: 'corroborated',
        ingestedItemCount: 80,
        bundleAppearanceCount: 1,
        corroboratedBundleCount: 1,
        promotable: true,
        blockingReasons: [],
        scoutRecommendedAction: 'prepare_promotion_pr',
      },
    ],
    ...overrides,
  };
}

function admission(overrides = {}) {
  return {
    schemaVersion: 'news-source-admission-report-v1',
    generatedAt: '2026-06-28T13:40:00.000Z',
    evaluationMode: 'product',
    sourceCount: 2,
    admittedSourceIds: ['ap-politics'],
    rejectedSourceIds: ['blocked-source'],
    inconclusiveSourceIds: [],
    ...overrides,
  };
}

function health(overrides = {}) {
  return {
    schemaVersion: 'news-source-health-report-v1',
    generatedAt: '2026-06-28T13:50:00.000Z',
    readinessStatus: 'ready',
    recommendedAction: 'keep_current_surface',
    keepSourceIds: ['ap-politics'],
    watchSourceIds: [],
    removeSourceIds: [],
    releaseEvidence: {
      status: 'pass',
      recommendedAction: 'release_ready',
      reasons: [],
      recentWindowRunCount: 8,
      recentReadyRunCount: 8,
      recentBlockedRunCount: 0,
    },
    ...overrides,
  };
}

test('builds a promotion queue when scout, admission, and health evidence are fresh and green', () => {
  const report = buildSourceReadinessQueue({
    scoutReport: scout(),
    admissionReport: admission(),
    healthReport: health(),
    now: NOW,
  });

  assert.equal(report.status, 'ready_for_source_promotion_pr');
  assert.deepEqual(report.promotionReadiness.blockers, []);
  assert.equal(report.candidateQueue[0].sourceId, 'ap-politics');
  assert.equal(report.candidateQueue[0].lane, 'promotion_candidate');
  assert.equal(report.candidateQueue[1].lane, 'blocked_candidate');
});

test('keeps the queue but blocks promotion when source-health release evidence is stale or red', () => {
  const report = buildSourceReadinessQueue({
    scoutReport: scout({ generatedAt: '2026-06-15T00:00:00.000Z' }),
    admissionReport: admission({ generatedAt: '2026-06-15T00:00:00.000Z' }),
    healthReport: health({
      generatedAt: '2026-06-15T00:00:00.000Z',
      releaseEvidence: {
        status: 'fail',
        recommendedAction: 'hold_release_for_trend_recovery',
        reasons: ['blocked_run_within_release_window'],
      },
    }),
    now: NOW,
  });

  assert.equal(report.status, 'queue_built_requires_fresh_evidence');
  assert.deepEqual(report.promotionReadiness.blockers, [
    'source_scout_stale_or_missing',
    'source_admission_stale_or_missing',
    'source_health_stale_or_missing',
    'source_health_release_evidence:fail',
  ]);
  assert.equal(report.candidateQueue[0].sourceId, 'ap-politics');
});

test('treats global scout feed-stage failure as infrastructure noise, not candidate readiness', () => {
  const report = buildSourceReadinessQueue({
    scoutReport: scout({ runAssessment: { globalFeedStageFailure: true } }),
    admissionReport: admission(),
    healthReport: health(),
    now: NOW,
  });

  assert.equal(report.status, 'queue_built_requires_fresh_evidence');
  assert.ok(report.promotionReadiness.blockers.includes('source_scout_global_feed_stage_failure'));
});

test('normalizes fixture and replay intake candidates without requiring the intake file', () => {
  const withIntake = buildSourceReadinessQueue({
    scoutReport: scout(),
    admissionReport: admission(),
    healthReport: health(),
    fixtureIntake: {
      generatedAt: '2026-06-28T13:45:00.000Z',
      candidates: [{
        candidateId: 'offline_replay_remote_mismatch:story-1',
        origin: 'offline_replay_remote_mismatch',
        intakeDecision: 'review_for_fixture_or_replay_promotion',
        storyId: 'story-1',
        headline: 'Story one',
      }],
    },
    now: NOW,
  });
  const withoutIntake = buildSourceReadinessQueue({
    scoutReport: scout(),
    admissionReport: admission(),
    healthReport: health(),
    now: NOW,
  });

  assert.equal(withIntake.fixtureReplayIntake[0].target, 'benchmark_or_replay_corpus');
  assert.deepEqual(withoutIntake.fixtureReplayIntake, []);
});
