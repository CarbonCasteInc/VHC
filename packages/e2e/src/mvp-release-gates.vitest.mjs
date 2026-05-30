import { describe, expect, it } from 'vitest';
import { classifyGateFailure, GATES, REPORT_SCHEMA_VERSION, VALID_STATUSES } from './mvp-release-gates.mjs';

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
      'story_identity_growth',
      'public_feed_pagination_refresh',
      'stance_aggregate_decay_public_mesh',
    ]));
  });
});
