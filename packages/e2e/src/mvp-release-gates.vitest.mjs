import { describe, expect, it } from 'vitest';
import {
  buildReusedGateResult,
  classifyGateFailure,
  findReusableGateResult,
  GATES,
  REPORT_SCHEMA_VERSION,
  VALID_STATUSES,
} from './mvp-release-gates.mjs';

describe('mvp-release-gates runner helpers', () => {
  it('publishes the expected report schema and terminal states', () => {
    expect(REPORT_SCHEMA_VERSION).toBe('mvp-release-gates-report-v1');
    expect(VALID_STATUSES).toEqual(['pass', 'fail', 'setup_scarcity', 'skipped_not_in_scope']);
  });

  it('classifies setup scarcity separately from product failures', () => {
    expect(classifyGateFailure('BLOCKED_SETUP_SCARCITY: not enough vote-capable topics')).toBe('setup_scarcity');
    expect(classifyGateFailure('publisher-canary-feed_stage_outage')).toBe('setup_scarcity');
    expect(classifyGateFailure('public-relay-feed-composition-missing-multi-source')).toBe('setup_scarcity');
    expect(classifyGateFailure('fail:public-relay-feed-composition-missing-multi-source')).toBe('fail');
    expect(classifyGateFailure('public-relay-latest-index-missing-composition')).toBe('fail');
    expect(classifyGateFailure('public-relay-latest-index-missing-story-states')).toBe('fail');
    expect(classifyGateFailure('public-relay-latest-index-product-metadata-missing:2')).toBe('fail');
    expect(classifyGateFailure('public-relay-current-accepted-synthesis-missing')).toBe('fail');
    expect(classifyGateFailure('product_visible_synthesis_lifecycle_pending_stale')).toBe('fail');
    expect(classifyGateFailure('public-relay-peer-readback-not-configured')).toBe('fail');
    expect(classifyGateFailure('public-relay-peer-readback-failed:https://gun-b.example/:story_states_missing')).toBe('fail');
    expect(classifyGateFailure('public-relay-feed-composition-backfill-only-multi-source')).toBe('fail');
    expect(classifyGateFailure('public-relay-feed-stale:90000000/86400000')).toBe('fail');
    expect(classifyGateFailure('fresh-propagation-fixture-only')).toBe('fail');
    expect(classifyGateFailure('fresh-propagation-public-browser-smoke-missing')).toBe('fail');
    expect(classifyGateFailure('fresh-propagation-latest-activity-stale:90000000/86400000')).toBe('fail');
    expect(classifyGateFailure('setup_scarcity:fresh-propagation-feed-stage-outage')).toBe('setup_scarcity');
    expect(classifyGateFailure('fail:eligible_raw_story_hidden_without_allowed_reason,public_feed_composition_missing_multi_source')).toBe('fail');
    expect(classifyGateFailure('public-feed-initial-open-headlines-timeout public-relay-feed-composition-missing-multi-source')).toBe('fail');
    expect(classifyGateFailure('public-feed-load-more-not-from-mesh public-relay-feed-composition-missing-multi-source')).toBe('fail');
    expect(classifyGateFailure('public-feed-browser-csp-violations:3')).toBe('fail');
    expect(classifyGateFailure('expected story detail to render accepted synthesis')).toBe('fail');
  });

  it('includes production-feed blocking gates beyond analysis frame reliability', () => {
    const gateIds = GATES.map((gate) => gate.id);
    expect(gateIds).toEqual(expect.arrayContaining([
      'public_feed_composition_freshness',
      'public_feed_lifecycle_accountability',
      'public_feed_fresh_propagation',
      'story_identity_growth',
      'public_feed_pagination_refresh',
      'stance_aggregate_decay_public_mesh',
    ]));
  });

  it('uses the live public browser smoke for stance aggregate decay public mesh evidence', () => {
    expect(GATES.find((gate) => gate.id === 'stance_aggregate_decay_public_mesh')?.command)
      .toEqual(['pnpm', ['check:public-feed:stance-aggregate-decay']]);
  });

  it('reuses the prior browser-smoke packet for the duplicate pagination gate without weakening failure semantics', () => {
    const firstSmokeGate = GATES.find((gate) => gate.id === 'public_feed_analysis_frame_reliability');
    const paginationGate = GATES.find((gate) => gate.id === 'public_feed_pagination_refresh');
    expect(firstSmokeGate?.command).toEqual(['pnpm', ['test:public-feed:browser-smoke']]);
    expect(paginationGate?.command).toEqual(['pnpm', ['test:public-feed:browser-smoke']]);
    expect(paginationGate?.reusePreviousCommandResult).toBe(true);

    const previousResult = {
      id: 'public_feed_analysis_frame_reliability',
      label: 'Public feed latest-index, accepted synthesis, and frame-table reliability',
      status: 'fail',
      command: 'pnpm test:public-feed:browser-smoke',
      startedAt: '2026-06-08T00:00:00.000Z',
      endedAt: '2026-06-08T00:01:00.000Z',
      durationMs: 60000,
      exitCode: 1,
      artifactRefs: firstSmokeGate.artifactRefs,
      failureClassification: 'fail',
      summary: 'gun-latest-index-readback-timeout',
    };

    expect(findReusableGateResult(paginationGate, [previousResult])).toBe(previousResult);
    const reused = buildReusedGateResult(paginationGate, previousResult);
    expect(reused).toMatchObject({
      id: 'public_feed_pagination_refresh',
      status: 'fail',
      exitCode: 1,
      failureClassification: 'fail',
      reusedFromGateId: 'public_feed_analysis_frame_reliability',
      durationMs: 0,
    });
    expect(reused.summary).toContain('gun-latest-index-readback-timeout');
  });

  it('can reuse a passing browser-smoke packet for duplicate public-feed proof without rerunning it', () => {
    const firstSmokeGate = GATES.find((gate) => gate.id === 'public_feed_analysis_frame_reliability');
    const paginationGate = GATES.find((gate) => gate.id === 'public_feed_pagination_refresh');
    const previousResult = {
      id: 'public_feed_analysis_frame_reliability',
      label: 'Public feed latest-index, accepted synthesis, and frame-table reliability',
      status: 'pass',
      command: 'pnpm test:public-feed:browser-smoke',
      startedAt: '2026-06-08T00:00:00.000Z',
      endedAt: '2026-06-08T00:01:00.000Z',
      durationMs: 60000,
      exitCode: 0,
      artifactRefs: firstSmokeGate.artifactRefs,
      failureClassification: null,
      summary: 'Public feed latest-index, accepted synthesis, and frame-table reliability passed.',
    };

    const reused = buildReusedGateResult(paginationGate, previousResult);
    expect(reused).toMatchObject({
      id: 'public_feed_pagination_refresh',
      status: 'pass',
      exitCode: 0,
      failureClassification: null,
      reusedFromGateId: 'public_feed_analysis_frame_reliability',
    });
    expect(reused.summary).toContain('passed using the public_feed_analysis_frame_reliability browser-smoke evidence packet');
  });
});
