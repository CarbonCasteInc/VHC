import { describe, expect, it } from 'vitest';
import { classifyGateFailure, REPORT_SCHEMA_VERSION, VALID_STATUSES } from './mvp-release-gates.mjs';

describe('mvp-release-gates runner helpers', () => {
  it('publishes the expected report schema and terminal states', () => {
    expect(REPORT_SCHEMA_VERSION).toBe('mvp-release-gates-report-v1');
    expect(VALID_STATUSES).toEqual(['pass', 'fail', 'setup_scarcity', 'skipped_not_in_scope']);
  });

  it('classifies setup scarcity separately from product failures', () => {
    expect(classifyGateFailure('BLOCKED_SETUP_SCARCITY: not enough vote-capable topics')).toBe('setup_scarcity');
    expect(classifyGateFailure('publisher-canary-feed_stage_outage')).toBe('setup_scarcity');
    expect(classifyGateFailure('expected story detail to render accepted synthesis')).toBe('fail');
  });
});
