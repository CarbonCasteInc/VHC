import { describe, expect, it } from 'vitest';

import {
  BASE_ALLOWED_CLAIMS,
  BASE_FORBIDDEN_CLAIMS,
  MVP_CLOSEOUT_SCHEMA_VERSION,
  buildCloseoutReportFromEvidence,
  validateReleaseClaims,
} from './mvp-closeout.mjs';

const COMMIT = 'abc123';

function repo(overrides = {}) {
  return {
    branch: 'coord/mvp-consolidated-closeout-v1',
    commit: COMMIT,
    dirty: false,
    ...overrides,
  };
}

function mvpReleaseGates(overrides = {}) {
  return {
    schemaVersion: 'mvp-release-gates-report-v1',
    overallStatus: 'pass',
    repo: { commit: COMMIT },
    gates: [
      { id: 'source_health', status: 'pass' },
      { id: 'public_beta_launch_closeout', status: 'pass' },
      { id: 'luma_mvp_production_readiness', status: 'pass' },
    ],
    ...overrides,
  };
}

function sourceHealth(overrides = {}) {
  return {
    schemaVersion: 'news-source-health-report-v1',
    readinessStatus: 'ready',
    releaseEvidence: {
      status: 'pass',
      reasons: [],
      recentWindowRunCount: 5,
      recentReadyRunCount: 5,
      recentReviewRunCount: 0,
      recentBlockedRunCount: 0,
    },
    thresholds: {
      releaseEvidenceWindowRunCount: 5,
    },
    observability: {
      keepSourceCount: 28,
      watchSourceCount: 0,
      removeSourceCount: 0,
      reasonCounts: {},
    },
    sources: Array.from({ length: 28 }, (_, index) => ({ id: `source-${index}`, decision: 'keep' })),
    ...overrides,
  };
}

function lumaMvp(overrides = {}) {
  return {
    schema_version: 'luma-mvp-production-readiness-v1',
    status: 'pass',
    profile: 'public-beta',
    repo: { commit: COMMIT },
    blockers: [],
    release_claims: {
      allowed: [
        'LUMA public-beta is MVP-production-ready as a fail-closed beta-local identity and signed-write layer.',
      ],
      forbidden: [
        'Silver attestation readiness',
        'verified-human identity',
        'one-human-one-vote',
        'Sybil resistance',
      ],
    },
    ...overrides,
  };
}

function meshReviewRequired(overrides = {}) {
  return {
    schema_version: 'mesh-production-readiness-v1',
    status: 'review_required',
    repo: { commit: COMMIT, dirty: false },
    schema_epoch: 'post_luma_m0b',
    release_readiness_blockers: [
      { id: 'public-wss-deployment-proof', reason: 'public WSS infrastructure evidence is not passing' },
      { id: 'required-write-class-sample-floors', reason: 'required rows are insufficient_samples' },
    ],
    luma_gated_write_coverage: {
      status: 'pass',
      source_commit: COMMIT,
      source_dirty: false,
      luma_profile: 'e2e',
    },
    ...overrides,
  };
}

function productionAppCanary(overrides = {}) {
  return {
    schema_version: 'production-app-canary-report-v1',
    status: 'blocked',
    reason: 'mesh_not_release_ready',
    repo: { commit: COMMIT, dirty: false },
    ...overrides,
  };
}

function evidence(overrides = {}) {
  return {
    mvpReleaseGates: mvpReleaseGates(),
    sourceHealth: sourceHealth(),
    lumaMvp: lumaMvp(),
    mesh: meshReviewRequired(),
    productionAppCanary: productionAppCanary(),
    ...overrides,
  };
}

function build(overrides = {}) {
  return buildCloseoutReportFromEvidence({
    repo: repo(),
    evidence: evidence(overrides.evidence || {}),
    allowedClaims: overrides.allowedClaims || BASE_ALLOWED_CLAIMS,
    forbiddenClaims: BASE_FORBIDDEN_CLAIMS,
    generatedAt: '2026-05-12T00:00:00.000Z',
  });
}

describe('mvp-closeout report builder', () => {
  it('publishes the expected schema', () => {
    expect(MVP_CLOSEOUT_SCHEMA_VERSION).toBe('mvp-closeout-report-v1');
  });

  it('passes when MVP gates, source health, LUMA, Mesh boundary, and canary boundary are consistent', () => {
    const report = build();

    expect(report.status).toBe('pass');
    expect(report.mvp_release_gates.status).toBe('pass');
    expect(report.source_health.releaseEvidence.status).toBe('pass');
    expect(report.source_health.releaseEvidence.recentWindowRunCount).toBe(5);
    expect(report.luma_mvp.status).toBe('pass');
    expect(report.mesh.status).toBe('review_required');
    expect(report.mesh.sample_floor_blocker_present).toBe(true);
    expect(report.mesh.public_wss_blocker_present).toBe(true);
    expect(report.production_app_canary.status).toBe('blocked');
    expect(report.production_app_canary.reason).toBe('mesh_not_release_ready');
    expect(report.release_claims.allowed).toContain('MVP public-beta release gates passed for the implemented MVP scope.');
    expect(report.release_claims.forbidden).toContain('The full app is production ready.');
  });

  it('fails when source health is warn', () => {
    const report = build({
      evidence: {
        sourceHealth: sourceHealth({
          readinessStatus: 'review',
          releaseEvidence: {
            status: 'warn',
            reasons: ['latest_run_not_ready'],
            recentWindowRunCount: 5,
            recentReadyRunCount: 4,
            recentReviewRunCount: 1,
            recentBlockedRunCount: 0,
          },
        }),
      },
    });

    expect(report.status).toBe('blocked');
    expect(report.failures).toContain('source health releaseEvidence.status is warn');
  });

  it('fails when the source-health release window is incomplete', () => {
    const report = build({
      evidence: {
        sourceHealth: sourceHealth({
          releaseEvidence: {
            status: 'pass',
            reasons: [],
            recentWindowRunCount: 4,
            recentReadyRunCount: 4,
            recentReviewRunCount: 0,
            recentBlockedRunCount: 0,
          },
        }),
      },
    });

    expect(report.status).toBe('blocked');
    expect(report.failures).toContain('source health release window 4 is below required 5');
  });

  it('fails when LUMA MVP readiness is blocked', () => {
    const report = build({
      evidence: {
        lumaMvp: lumaMvp({
          status: 'blocked',
          blockers: [{ id: 'mesh_luma_coverage', reason: 'missing report' }],
        }),
      },
    });

    expect(report.status).toBe('blocked');
    expect(report.failures).toContain('LUMA MVP readiness status is blocked');
  });

  it('fails when MVP release gates fail', () => {
    const report = build({
      evidence: {
        mvpReleaseGates: mvpReleaseGates({
          overallStatus: 'fail',
          gates: [
            { id: 'source_health', status: 'fail' },
            { id: 'public_beta_launch_closeout', status: 'pass' },
          ],
        }),
      },
    });

    expect(report.status).toBe('blocked');
    expect(report.failures).toContain('mvp release gates status is fail');
    expect(report.failures).toContain('mvp release gates source_health status is fail');
  });

  it('fails when the repo is dirty', () => {
    const report = buildCloseoutReportFromEvidence({
      repo: repo({ dirty: true }),
      evidence: evidence(),
      allowedClaims: BASE_ALLOWED_CLAIMS,
      forbiddenClaims: BASE_FORBIDDEN_CLAIMS,
      generatedAt: '2026-05-12T00:00:00.000Z',
    });

    expect(report.status).toBe('blocked');
    expect(report.failures).toContain('repo is dirty');
  });

  it('fails if allowed claims imply Mesh release_ready while Mesh is review_required', () => {
    const report = build({
      allowedClaims: [
        'MVP public-beta release gates passed for the implemented MVP scope.',
        'Mesh is release_ready.',
      ],
    });

    expect(report.status).toBe('blocked');
    expect(report.failures).toContain('allowed claims imply Mesh release_ready while Mesh is not release_ready');
  });

  it('fails if allowed claims imply production app canary pass while canary is blocked', () => {
    const report = build({
      allowedClaims: [
        'MVP public-beta release gates passed for the implemented MVP scope.',
        'Production app canary passed.',
      ],
    });

    expect(report.status).toBe('blocked');
    expect(report.failures).toContain('allowed claims imply production app canary passed while canary is not pass');
  });

  it('allows bounded MVP public-beta claims while preserving forbidden Mesh/app/Silver claims', () => {
    const failures = validateReleaseClaims({
      allowedClaims: BASE_ALLOWED_CLAIMS,
      meshStatus: 'review_required',
      meshSampleFloorBlockerPresent: true,
      meshPublicWssBlockerPresent: true,
      productionAppCanaryStatus: 'blocked',
    });
    const report = build();

    expect(failures).toEqual([]);
    expect(report.release_claims.allowed).toContain('Source health passed the complete release evidence window.');
    expect(report.release_claims.forbidden).toEqual(
      expect.arrayContaining([
        'Mesh is release_ready unless the Mesh packet itself reports release_ready with no release-readiness blockers.',
        'Production app canary passed unless the production app canary report status is pass.',
        'LUMA Silver/verified-human/one-human-one-vote/Sybil resistance is ready.',
      ]),
    );
  });
});
