import { describe, expect, it } from 'vitest';
import {
  EpochSchedulerInputSchema,
  EpochSchedulerResultSchema,
  evaluateEpochEligibility,
  type EpochSchedulerInput,
} from './epochScheduler';

// ── Fixtures ───────────────────────────────────────────────────────

const now = 1_700_000_000_000;

function makeInput(overrides?: Partial<EpochSchedulerInput>): EpochSchedulerInput {
  return {
    topic_id: 'topic-42',
    current_epoch: 1,
    verified_comment_count_since_last: 10,
    unique_verified_principals_since_last: 3,
    last_epoch_timestamp: now - 1_800_000,
    epochs_today: 0,
    now,
    ...overrides,
  };
}

// ── Schemas ────────────────────────────────────────────────────────

describe('EpochSchedulerInputSchema', () => {
  it('accepts valid non-initial epoch input', () => {
    expect(EpochSchedulerInputSchema.safeParse(makeInput()).success).toBe(true);
  });

  it('accepts epoch 0 input without last_epoch_timestamp', () => {
    const input = makeInput({
      current_epoch: 0,
      verified_comment_count_since_last: 0,
      unique_verified_principals_since_last: 0,
      last_epoch_timestamp: undefined,
    });
    expect(EpochSchedulerInputSchema.safeParse(input).success).toBe(true);
  });

  it('rejects negative epochs_today', () => {
    expect(
      EpochSchedulerInputSchema.safeParse(makeInput({ epochs_today: -1 })).success,
    ).toBe(false);
  });
});

describe('EpochSchedulerResultSchema', () => {
  it('accepts valid scheduler result', () => {
    const result = evaluateEpochEligibility(makeInput());
    expect(EpochSchedulerResultSchema.safeParse(result).success).toBe(true);
  });
});

// ── Re-synthesis thresholds ────────────────────────────────────────

describe('evaluateEpochEligibility thresholds', () => {
  it('allows when comment threshold and unique principal minimum are met', () => {
    const result = evaluateEpochEligibility(makeInput());
    expect(result.allowed).toBe(true);
    expect(result.guards.resynthesis_threshold_met).toBe(true);
    expect(result.blocked_by).toEqual([]);
  });

  it('blocks when verified comment threshold is not met', () => {
    const result = evaluateEpochEligibility(
      makeInput({ verified_comment_count_since_last: 9 }),
    );
    expect(result.allowed).toBe(false);
    expect(result.guards.resynthesis_threshold_met).toBe(false);
    expect(result.blocked_by).toContain('resynthesis_threshold');
  });

  it('blocks when unique principal minimum is not met', () => {
    const result = evaluateEpochEligibility(
      makeInput({ unique_verified_principals_since_last: 2 }),
    );
    expect(result.allowed).toBe(false);
    expect(result.guards.resynthesis_threshold_met).toBe(false);
    expect(result.blocked_by).toContain('resynthesis_threshold');
  });
});

// ── Debounce guard ────────────────────────────────────────────────

describe('evaluateEpochEligibility debounce', () => {
  it('blocks when last epoch is less than 30 minutes ago', () => {
    const result = evaluateEpochEligibility(
      makeInput({ last_epoch_timestamp: now - 1_799_999 }),
    );
    expect(result.allowed).toBe(false);
    expect(result.guards.debounce_met).toBe(false);
    expect(result.blocked_by).toContain('debounce');
  });

  it('allows when last epoch is exactly 30 minutes ago', () => {
    const result = evaluateEpochEligibility(
      makeInput({ last_epoch_timestamp: now - 1_800_000 }),
    );
    expect(result.allowed).toBe(true);
    expect(result.guards.debounce_met).toBe(true);
  });

  it('blocks non-initial epoch when last_epoch_timestamp is missing', () => {
    const result = evaluateEpochEligibility(
      makeInput({ last_epoch_timestamp: undefined }),
    );
    expect(result.allowed).toBe(false);
    expect(result.guards.debounce_met).toBe(false);
    expect(result.blocked_by).toContain('debounce');
  });
});

// ── Daily cap guard ───────────────────────────────────────────────

describe('evaluateEpochEligibility daily cap', () => {
  it('blocks when 4 epochs already exist today', () => {
    const result = evaluateEpochEligibility(makeInput({ epochs_today: 4 }));
    expect(result.allowed).toBe(false);
    expect(result.guards.daily_cap_met).toBe(false);
    expect(result.blocked_by).toContain('daily_cap');
  });

  it('allows when fewer than 4 epochs exist today', () => {
    const result = evaluateEpochEligibility(makeInput({ epochs_today: 3 }));
    expect(result.allowed).toBe(true);
    expect(result.guards.daily_cap_met).toBe(true);
  });
});

// ── Combined outcomes + edge cases ────────────────────────────────

describe('evaluateEpochEligibility combined and edge cases', () => {
  it('allows when all guards pass', () => {
    const result = evaluateEpochEligibility(
      makeInput({
        verified_comment_count_since_last: 12,
        unique_verified_principals_since_last: 4,
        last_epoch_timestamp: now - 2_000_000,
        epochs_today: 2,
      }),
    );
    expect(result.allowed).toBe(true);
    expect(result.blocked_by).toEqual([]);
  });

  it('blocks when any guard fails', () => {
    const result = evaluateEpochEligibility(
      makeInput({
        verified_comment_count_since_last: 9,
        last_epoch_timestamp: now - 60_000,
        epochs_today: 4,
      }),
    );
    expect(result.allowed).toBe(false);
    expect(result.blocked_by).toEqual([
      'resynthesis_threshold',
      'debounce',
      'daily_cap',
    ]);
  });

  it('allows epoch 0 (first ever) with no prior epoch timestamp', () => {
    const result = evaluateEpochEligibility(
      makeInput({
        current_epoch: 0,
        verified_comment_count_since_last: 0,
        unique_verified_principals_since_last: 0,
        last_epoch_timestamp: undefined,
      }),
    );
    expect(result.allowed).toBe(true);
    expect(result.guards.resynthesis_threshold_met).toBe(true);
    expect(result.guards.debounce_met).toBe(true);
    expect(result.guards.daily_cap_met).toBe(true);
    expect(result.blocked_by).toEqual([]);
  });

  it('enforces exact boundary values from default config', () => {
    const result = evaluateEpochEligibility(
      makeInput({
        verified_comment_count_since_last: 10,
        unique_verified_principals_since_last: 3,
        last_epoch_timestamp: now - 1_800_000,
        epochs_today: 3,
      }),
    );
    expect(result.allowed).toBe(true);
  });
});
