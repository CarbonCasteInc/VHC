import { describe, expect, it } from 'vitest';
import {
  buildPromotionDecision,
  findLatestArtifactDir,
  loadPromotionDecisionArtifacts,
  writePromotionDecision,
} from './daemon-feed-semantic-soak-decision.mjs';

describe('daemon-feed-semantic-soak-decision', () => {
  it('chooses the newest artifact directory by mtime', () => {
    const artifactRoot = '/tmp/soak';
    const fullPaths = {
      older: `${artifactRoot}/older`,
      newer: `${artifactRoot}/newer`,
    };
    const result = findLatestArtifactDir(
      artifactRoot,
      () => [
        { isDirectory: () => true, name: 'older' },
        { isDirectory: () => true, name: 'newer' },
      ],
      (fullPath) => ({ mtimeMs: fullPath === fullPaths.older ? 1 : 2 }),
    );
    expect(result).toBe(fullPaths.newer);
  });

  it('builds a smoke-only decision when readiness is not met', () => {
    const decision = buildPromotionDecision({
      artifactDir: '/tmp/soak',
      summary: {
        executionPosture: { lane: 'public_semantic_soak', evidenceTier: 'smoke_only' },
        authoritativeCorrectnessGate: {
          gateId: 'storycluster-primary-correctness-gate-v1',
          proofMode: 'deterministic_corpus_plus_daemon_first_semantic_gate',
        },
        secondaryDistributionTelemetry: {
          role: 'secondary_distribution_telemetry',
        },
        promotionAssessment: {
          promotable: false,
          status: 'not_ready',
          blockingReasons: ['insufficient_run_count'],
          criteria: { minimumRuns: 5 },
        },
      },
      trend: {},
      index: {},
    });

    expect(decision).toMatchObject({
      readinessStatus: 'not_ready',
      promotable: false,
      recommendedAction: 'remain_smoke_only',
      recommendedEvidenceTier: 'smoke_only',
      promotionBlockingReasons: ['insufficient_run_count'],
      authoritativeCorrectnessGate: {
        gateId: 'storycluster-primary-correctness-gate-v1',
        proofMode: 'deterministic_corpus_plus_daemon_first_semantic_gate',
      },
      secondaryDistributionTelemetry: {
        role: 'secondary_distribution_telemetry',
      },
      paths: {
        artifactDir: '/tmp/soak',
        decisionPath: '/tmp/soak/promotion-decision.json',
      },
    });
  });

  it('builds an eligible-for-review decision when readiness is met', () => {
    const decision = buildPromotionDecision({
      artifactDir: '/tmp/soak',
      summary: {},
      trend: {
        promotionAssessment: {
          promotable: true,
          status: 'promotable',
          blockingReasons: [],
          criteria: { minimumRuns: 5 },
        },
      },
      index: {},
    });

    expect(decision).toMatchObject({
      readinessStatus: 'promotable',
      promotable: true,
      recommendedAction: 'eligible_for_promotion_review',
      recommendedEvidenceTier: 'eligible_for_promotion_review',
      promotionBlockingReasons: [],
    });
  });

  it('falls back to default not-ready semantics when no assessment exists', () => {
    const decision = buildPromotionDecision({
      artifactDir: '/tmp/soak',
      summary: {},
      trend: {},
      index: {
        executionPosture: { lane: 'public_semantic_soak', evidenceTier: 'smoke_only' },
        authoritativeCorrectnessGate: {
          gateId: 'storycluster-primary-correctness-gate-v1',
        },
        secondaryDistributionTelemetry: {
          role: 'secondary_distribution_telemetry',
        },
      },
    });

    expect(decision).toMatchObject({
      readinessStatus: 'not_ready',
      promotable: false,
      promotionBlockingReasons: ['promotion_assessment_missing'],
      executionPosture: { lane: 'public_semantic_soak', evidenceTier: 'smoke_only' },
      authoritativeCorrectnessGate: { gateId: 'storycluster-primary-correctness-gate-v1' },
      secondaryDistributionTelemetry: { role: 'secondary_distribution_telemetry' },
    });
  });

  it('loads artifacts from an explicit directory and writes the promotion decision', () => {
    const reads = new Map([
      ['/tmp/soak/semantic-soak-summary.json', JSON.stringify({ executionPosture: { lane: 'public_semantic_soak' } })],
      ['/tmp/soak/semantic-soak-trend.json', JSON.stringify({ promotionAssessment: { promotable: true, status: 'promotable', blockingReasons: [] } })],
      ['/tmp/soak/release-artifact-index.json', JSON.stringify({ artifactPaths: { indexPath: '/tmp/soak/release-artifact-index.json' } })],
    ]);
    const writes = new Map();

    const artifacts = loadPromotionDecisionArtifacts({
      artifactDir: '/tmp/soak',
      exists: () => true,
      readFile: (filePath) => reads.get(filePath),
    });
    const decision = buildPromotionDecision(artifacts);
    const decisionPath = writePromotionDecision(
      decision,
      (filePath, content) => writes.set(filePath, String(content)),
    );

    expect(artifacts.artifactDir).toBe('/tmp/soak');
    expect(artifacts.index.artifactPaths.indexPath).toBe('/tmp/soak/release-artifact-index.json');
    expect(decision.promotable).toBe(true);
    expect(decisionPath).toBe('/tmp/soak/promotion-decision.json');
    expect(writes.get('/tmp/soak/promotion-decision.json')).toContain('"recommendedAction": "eligible_for_promotion_review"');
  });

  it('fails cleanly when no artifact directory or required file exists', () => {
    expect(() => loadPromotionDecisionArtifacts({
      artifactRoot: '/tmp/soak',
      readdir: () => [],
      stat: () => ({ mtimeMs: 0 }),
    })).toThrow('no semantic-soak artifact directory found under /tmp/soak');

    expect(() => loadPromotionDecisionArtifacts({
      artifactDir: '/tmp/soak',
      exists: (filePath) => !filePath.endsWith('semantic-soak-trend.json'),
      readFile: () => '{}',
    })).toThrow('required semantic-soak artifact missing: /tmp/soak/semantic-soak-trend.json');
  });
});
