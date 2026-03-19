import { describe, expect, it } from 'vitest';
import {
  assessArtifactFreshness,
  buildProductionReadinessDecision,
  buildProductionReadinessRule,
  loadProductionReadinessArtifacts,
  runStoryclusterProductionReadiness,
  storyclusterProductionReadinessInternal,
  STORYCLUSTER_PRODUCTION_READINESS_SCHEMA_VERSION,
} from './storycluster-production-readiness.mjs';

function isoHoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

describe('storycluster-production-readiness', () => {
  it('defaults repo-rooted artifact paths to the workspace root instead of the package cwd', () => {
    const rule = buildProductionReadinessRule();

    expect(rule.correctnessGate.repoRoot).toBe('/Users/bldt/Desktop/VHC/VHC');
    expect(rule.sourceHealthTrend.latestReportPath).toBe('/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json');
    expect(rule.headlineSoakTrend.latestTrendPath).toBe('/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/headline-soak-trend-index.json');
    expect(rule.headlineSoakTrend.legacyTrendPath).toBe('/Users/bldt/Desktop/VHC/VHC/packages/e2e/.tmp/daemon-feed-semantic-soak/headline-soak-trend-index.json');
  });

  it('uses generatedAt first and falls back to mtime for freshness checks', () => {
    expect(assessArtifactFreshness(
      '/tmp/source-health-report.json',
      { generatedAt: isoHoursAgo(2) },
      24,
      {
        now: () => Date.now(),
        stat: () => ({ mtimeMs: Date.now() - 10 * 60 * 60 * 1000 }),
      },
    )).toMatchObject({
      timestampSource: 'generatedAt',
      stale: false,
    });

    expect(assessArtifactFreshness(
      '/tmp/headline-soak-trend-index.json',
      {},
      6,
      {
        now: () => Date.now(),
        stat: () => ({ mtimeMs: Date.now() - 8 * 60 * 60 * 1000 }),
      },
    )).toMatchObject({
      timestampSource: 'mtime',
      stale: true,
    });
  });

  it('loads latest source-health and headline-soak artifacts with freshness metadata', () => {
    const files = new Map([
      ['/repo/services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json', JSON.stringify({ generatedAt: isoHoursAgo(1), releaseEvidence: { status: 'pass' }, observability: { enabledSourceCount: 12, contributingSourceCount: 12, corroboratingSourceCount: 12 } })],
      ['/repo/services/news-aggregator/.tmp/news-source-admission/latest/source-health-trend.json', JSON.stringify({ generatedAt: isoHoursAgo(1), releaseEvidence: { status: 'pass' } })],
      ['/repo/.tmp/daemon-feed-semantic-soak/headline-soak-trend-index.json', JSON.stringify({ generatedAt: isoHoursAgo(4), releaseEvidence: { status: 'warn' }, executionCount: 4, promotableExecutionCount: 3 })],
    ]);

    const artifacts = loadProductionReadinessArtifacts({
      repoRoot: '/repo',
      exists: (filePath) => files.has(filePath),
      readFile: (filePath) => files.get(filePath),
      stat: () => ({ mtimeMs: Date.now() }),
      now: () => Date.now(),
    });

    expect(artifacts.sourceHealthFreshness.stale).toBe(false);
    expect(artifacts.headlineSoakFreshness.stale).toBe(false);
    expect(artifacts.headlineSoakTrend.releaseEvidence.status).toBe('warn');
  });

  it('falls back to the richer legacy headline-soak trend during path migration', () => {
    const files = new Map([
      ['/repo/.tmp/daemon-feed-semantic-soak/headline-soak-trend-index.json', JSON.stringify({ generatedAt: isoHoursAgo(1), executionCount: 1, releaseEvidence: { status: 'fail' } })],
      ['/repo/packages/e2e/.tmp/daemon-feed-semantic-soak/headline-soak-trend-index.json', JSON.stringify({ generatedAt: isoHoursAgo(2), executionCount: 5, releaseEvidence: { status: 'pass' } })],
    ]);

    expect(storyclusterProductionReadinessInternal.resolvePreferredHeadlineSoakTrendPath({
      primaryPath: '/repo/.tmp/daemon-feed-semantic-soak/headline-soak-trend-index.json',
      legacyPath: '/repo/packages/e2e/.tmp/daemon-feed-semantic-soak/headline-soak-trend-index.json',
      exists: (filePath) => files.has(filePath),
      readFile: (filePath) => files.get(filePath),
    })).toBe('/repo/packages/e2e/.tmp/daemon-feed-semantic-soak/headline-soak-trend-index.json');
  });

  it('builds pass, review, and blocked release decisions', () => {
    const rule = buildProductionReadinessRule('/repo');
    const base = {
      rule,
      artifactDir: '/repo/.tmp/storycluster-production-readiness/1',
      reportPath: '/repo/.tmp/storycluster-production-readiness/1/production-readiness-report.json',
      latestArtifactDir: '/repo/.tmp/storycluster-production-readiness/latest',
      latestReportPath: '/repo/.tmp/storycluster-production-readiness/latest/production-readiness-report.json',
      sourceHealthReportPath: '/repo/source-health-report.json',
      sourceHealthTrendPath: '/repo/source-health-trend.json',
      headlineSoakTrendPath: '/repo/headline-soak-trend-index.json',
      sourceHealthFreshness: { stale: false },
      headlineSoakFreshness: { stale: false },
      sourceHealthReport: {
        releaseEvidence: { status: 'pass', reasons: [] },
        observability: { enabledSourceCount: 12, contributingSourceCount: 12, corroboratingSourceCount: 12 },
      },
      sourceHealthTrend: { releaseEvidence: { status: 'pass', reasons: [] } },
      headlineSoakTrend: {
        releaseEvidence: { status: 'pass', reasons: [] },
        executionCount: 4,
        promotableExecutionCount: 4,
        latestExecution: { readinessStatus: 'promotable' },
      },
    };

    expect(buildProductionReadinessDecision({
      ...base,
      correctnessStatus: 'pass',
    })).toMatchObject({
      schemaVersion: STORYCLUSTER_PRODUCTION_READINESS_SCHEMA_VERSION,
      status: 'release_ready',
      recommendedAction: 'release_ready',
      reasons: [],
    });

    expect(buildProductionReadinessDecision({
      ...base,
      correctnessStatus: 'pass',
      headlineSoakTrend: {
        ...base.headlineSoakTrend,
        releaseEvidence: { status: 'warn', reasons: ['recent_strict_soak_failures_present'] },
      },
    })).toMatchObject({
      status: 'review_required',
      recommendedAction: 'review_release_evidence_warnings',
      reasons: ['headline_soak_release_evidence_warn'],
    });

    expect(buildProductionReadinessDecision({
      ...base,
      correctnessStatus: 'pass',
      sourceHealthReport: {
        observability: { enabledSourceCount: 12, contributingSourceCount: 12, corroboratingSourceCount: 12 },
      },
      sourceHealthTrend: { releaseEvidence: { status: 'warn', reasons: ['recent_source_watchlist_growth'] } },
    })).toMatchObject({
      status: 'review_required',
      recommendedAction: 'review_release_evidence_warnings',
      reasons: ['source_health_release_evidence_warn'],
    });

    expect(buildProductionReadinessDecision({
      ...base,
      correctnessStatus: 'pass',
      headlineSoakTrend: {
        executionCount: 2,
        promotableExecutionCount: 1,
        notReadyExecutionCount: 1,
        strictSoakFailCount: 1,
        latestExecution: { readinessStatus: 'not_ready' },
        usefulness: {
          averageCorroboratedBundleRate: 0.2,
          averageUniqueSourceCount: 1,
        },
      },
    })).toMatchObject({
      status: 'blocked',
      recommendedAction: 'hold_for_public_soak_recovery',
      reasons: ['headline_soak_release_evidence_failed'],
      headlineSoakTrend: {
        observedStatus: 'fail',
        releaseEvidence: {
          status: 'fail',
          reasons: expect.arrayContaining([
            'insufficient_headline_soak_execution_count',
            'latest_headline_soak_execution_not_promotable',
          ]),
        },
      },
    });

    expect(buildProductionReadinessDecision({
      ...base,
      correctnessStatus: 'unknown',
      sourceHealthFreshness: { stale: true },
      headlineSoakTrend: {
        ...base.headlineSoakTrend,
        releaseEvidence: { status: 'fail', reasons: ['insufficient_headline_soak_execution_count'] },
      },
    })).toMatchObject({
      status: 'blocked',
      recommendedAction: 'hold_for_public_soak_recovery',
      reasons: [
        'storycluster_correctness_gate_not_asserted',
        'source_health_evidence_stale',
        'headline_soak_release_evidence_failed',
      ],
    });
  });

  it('writes the latest production-readiness artifact and enforces when requested', () => {
    const writes = new Map();
    const files = new Map([
      ['/repo/services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json', JSON.stringify({ generatedAt: isoHoursAgo(1), releaseEvidence: { status: 'pass' }, observability: { enabledSourceCount: 12, contributingSourceCount: 12, corroboratingSourceCount: 12 } })],
      ['/repo/services/news-aggregator/.tmp/news-source-admission/latest/source-health-trend.json', JSON.stringify({ generatedAt: isoHoursAgo(1), releaseEvidence: { status: 'pass' } })],
      ['/repo/.tmp/daemon-feed-semantic-soak/headline-soak-trend-index.json', JSON.stringify({ generatedAt: isoHoursAgo(1), releaseEvidence: { status: 'pass' }, executionCount: 4, promotableExecutionCount: 4, latestExecution: { readinessStatus: 'promotable' } })],
    ]);

    const decision = runStoryclusterProductionReadiness({
      env: {
        VH_STORYCLUSTER_PRODUCTION_READINESS_REPO_ROOT: '/repo',
        VH_STORYCLUSTER_PRODUCTION_READINESS_CORRECTNESS_STATUS: 'pass',
        VH_STORYCLUSTER_PRODUCTION_READINESS_ENFORCE: 'true',
      },
      log: () => {},
      exists: (filePath) => files.has(filePath),
      mkdir: () => {},
      readFile: (filePath) => files.get(filePath),
      writeFile: (filePath, content) => writes.set(filePath, String(content)),
      stat: () => ({ mtimeMs: Date.now() }),
      now: () => 111,
    });

    expect(decision.status).toBe('release_ready');
    expect(writes.get('/repo/.tmp/storycluster-production-readiness/111/production-readiness-report.json')).toContain('"status": "release_ready"');
    expect(writes.get('/repo/.tmp/storycluster-production-readiness/latest/production-readiness-report.json')).toContain('"ruleId": "storycluster-production-readiness-v1"');
  });

  it('throws in enforce mode when the combined release rule is not ready', () => {
    const files = new Map([
      ['/repo/services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json', JSON.stringify({ generatedAt: isoHoursAgo(1), releaseEvidence: { status: 'pass' }, observability: { enabledSourceCount: 12, contributingSourceCount: 12, corroboratingSourceCount: 12 } })],
      ['/repo/services/news-aggregator/.tmp/news-source-admission/latest/source-health-trend.json', JSON.stringify({ generatedAt: isoHoursAgo(1), releaseEvidence: { status: 'pass' } })],
      ['/repo/.tmp/daemon-feed-semantic-soak/headline-soak-trend-index.json', JSON.stringify({ generatedAt: isoHoursAgo(1), releaseEvidence: { status: 'fail', reasons: ['insufficient_headline_soak_execution_count'] }, executionCount: 1, promotableExecutionCount: 0, latestExecution: { readinessStatus: 'not_ready' } })],
    ]);

    expect(() => runStoryclusterProductionReadiness({
      env: {
        VH_STORYCLUSTER_PRODUCTION_READINESS_REPO_ROOT: '/repo',
        VH_STORYCLUSTER_PRODUCTION_READINESS_CORRECTNESS_STATUS: 'pass',
        VH_STORYCLUSTER_PRODUCTION_READINESS_ENFORCE: 'true',
      },
      log: () => {},
      exists: (filePath) => files.has(filePath),
      mkdir: () => {},
      readFile: (filePath) => files.get(filePath),
      writeFile: () => {},
      stat: () => ({ mtimeMs: Date.now() }),
      now: () => 222,
    })).toThrowError(/storycluster-production-readiness-blocked:headline_soak_release_evidence_failed/);
  });

  it('exposes parser helpers for narrow branch coverage', () => {
    expect(storyclusterProductionReadinessInternal.parsePositiveInt('bad', 24)).toBe(24);
    expect(storyclusterProductionReadinessInternal.parseBoolean('bad', true)).toBe(true);
    expect(storyclusterProductionReadinessInternal.parseCorrectnessStatus('FAIL')).toBe('fail');
    expect(storyclusterProductionReadinessInternal.parseCorrectnessStatus('')).toBe('unknown');
  });
});
