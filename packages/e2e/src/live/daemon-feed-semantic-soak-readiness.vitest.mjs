import { describe, expect, it, vi } from 'vitest';
import { runDaemonFeedSemanticSoakReadiness } from './daemon-feed-semantic-soak-readiness.mjs';

describe('daemon-feed-semantic-soak-readiness', () => {
  it('writes and logs the explicit promotion decision surface', async () => {
    const writes = new Map();
    const logs = [];
    const decisionModule = await import('./daemon-feed-semantic-soak-decision.mjs');
    const loadSpy = vi.spyOn(decisionModule, 'loadPromotionDecisionArtifacts').mockReturnValue({
      artifactDir: '/repo/.tmp/daemon-feed-semantic-soak/123',
      summary: {
        executionPosture: { lane: 'public_semantic_soak', evidenceTier: 'smoke_only' },
        promotionAssessment: {
          promotable: false,
          status: 'not_ready',
          blockingReasons: ['insufficient_sample_fill_rate'],
          criteria: { minimumRuns: 5 },
        },
      },
      trend: {},
      index: {
        artifactPaths: {
          indexPath: '/repo/.tmp/daemon-feed-semantic-soak/123/release-artifact-index.json',
        },
      },
    });

    const decision = runDaemonFeedSemanticSoakReadiness({
      env: { VH_DAEMON_FEED_SOAK_ARTIFACT_ROOT: '/repo/.tmp/daemon-feed-semantic-soak' },
      log: (line) => logs.push(line),
      writeFile: (filePath, content) => writes.set(filePath, String(content)),
    });

    expect(decision.readinessStatus).toBe('not_ready');
    expect(decision.promotionBlockingReasons).toEqual(['insufficient_sample_fill_rate']);
    expect(decision.recommendedAction).toBe('remain_smoke_only');
    expect(logs[0]).toContain('"recommendedAction": "remain_smoke_only"');
    expect(writes.get('/repo/.tmp/daemon-feed-semantic-soak/123/promotion-decision.json')).toContain('"readinessStatus": "not_ready"');

    loadSpy.mockRestore();
  });

  it('passes an explicit artifact directory through to the loader', async () => {
    const decisionModule = await import('./daemon-feed-semantic-soak-decision.mjs');
    const loadSpy = vi.spyOn(decisionModule, 'loadPromotionDecisionArtifacts').mockReturnValue({
      artifactDir: '/repo/.tmp/daemon-feed-semantic-soak/custom',
      summary: {
        executionPosture: { lane: 'public_semantic_soak', evidenceTier: 'smoke_only' },
        promotionAssessment: {
          promotable: true,
          status: 'promotable',
          blockingReasons: [],
          criteria: { minimumRuns: 5 },
        },
      },
      trend: {},
      index: {
        artifactPaths: {
          indexPath: '/repo/.tmp/daemon-feed-semantic-soak/custom/release-artifact-index.json',
        },
      },
    });

    const decision = runDaemonFeedSemanticSoakReadiness({
      env: {
        VH_DAEMON_FEED_SOAK_ARTIFACT_DIR: '/repo/.tmp/daemon-feed-semantic-soak/custom',
      },
      log: () => {},
      writeFile: () => {},
    });

    expect(loadSpy).toHaveBeenCalledWith({
      artifactRoot: undefined,
      artifactDir: '/repo/.tmp/daemon-feed-semantic-soak/custom',
    });
    expect(decision.recommendedAction).toBe('eligible_for_promotion_review');

    loadSpy.mockRestore();
  });
});
