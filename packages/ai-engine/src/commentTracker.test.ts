import { describe, expect, it } from 'vitest';
import {
  CommentActivityEntrySchema,
  CommentTrackerStateSchema,
  getActivitySince,
  meetsResynthesisThreshold,
  recordComment,
  resetForEpoch,
  type CommentTrackerState,
} from './commentTracker';

function emptyState(): CommentTrackerState {
  return { topics: new Map() };
}

// ── Schemas ────────────────────────────────────────────────────────

describe('CommentActivityEntrySchema', () => {
  it('accepts runtime Set input and keeps it as a Set', () => {
    const parsed = CommentActivityEntrySchema.parse({
      verified_comment_count: 2,
      unique_principals: new Set(['p-1', 'p-2']),
    });

    expect(parsed.verified_comment_count).toBe(2);
    expect(parsed.unique_principals).toBeInstanceOf(Set);
    expect(parsed.unique_principals.size).toBe(2);
  });

  it('accepts array input and de-duplicates principals during conversion', () => {
    const parsed = CommentActivityEntrySchema.parse({
      verified_comment_count: 3,
      unique_principals: ['p-1', 'p-1', 'p-2'],
    });

    expect([...parsed.unique_principals]).toEqual(['p-1', 'p-2']);
  });

  it('rejects negative verified_comment_count', () => {
    expect(
      CommentActivityEntrySchema.safeParse({
        verified_comment_count: -1,
        unique_principals: ['p-1'],
      }).success,
    ).toBe(false);
  });
});

describe('CommentTrackerStateSchema', () => {
  it('accepts runtime Map state and converts nested sets', () => {
    const parsed = CommentTrackerStateSchema.parse({
      topics: new Map([
        [
          'topic-1',
          {
            verified_comment_count: 1,
            unique_principals: new Set(['p-1']),
          },
        ],
      ]),
    });

    expect(parsed.topics).toBeInstanceOf(Map);
    expect(parsed.topics.get('topic-1')?.verified_comment_count).toBe(1);
    expect(parsed.topics.get('topic-1')?.unique_principals).toBeInstanceOf(Set);
  });

  it('accepts serializable tuple-array state', () => {
    const parsed = CommentTrackerStateSchema.parse({
      topics: [
        [
          'topic-1',
          {
            verified_comment_count: 2,
            unique_principals: ['p-1', 'p-2'],
          },
        ],
      ],
    });

    expect(parsed.topics.get('topic-1')?.unique_principals.size).toBe(2);
  });

  it('rejects empty topic ids', () => {
    expect(
      CommentTrackerStateSchema.safeParse({
        topics: [
          [
            '',
            {
              verified_comment_count: 1,
              unique_principals: ['p-1'],
            },
          ],
        ],
      }).success,
    ).toBe(false);
  });
});

// ── recordComment + getActivitySince ──────────────────────────────

describe('recordComment / getActivitySince', () => {
  it('records first comment for a topic without mutating prior state', () => {
    const state0 = emptyState();
    const state1 = recordComment(state0, 'topic-1', 'p-1');

    expect(state0.topics.size).toBe(0);
    expect(state1.topics.size).toBe(1);
    expect(getActivitySince(state1, 'topic-1')).toEqual({
      verified_comment_count: 1,
      unique_principal_count: 1,
    });
  });

  it('increments count and unique principal count for new principals', () => {
    const state1 = recordComment(emptyState(), 'topic-1', 'p-1');
    const state2 = recordComment(state1, 'topic-1', 'p-2');

    expect(getActivitySince(state1, 'topic-1')).toEqual({
      verified_comment_count: 1,
      unique_principal_count: 1,
    });
    expect(getActivitySince(state2, 'topic-1')).toEqual({
      verified_comment_count: 2,
      unique_principal_count: 2,
    });
  });

  it('increments only verified comment count for repeat principal', () => {
    const state1 = recordComment(emptyState(), 'topic-1', 'p-1');
    const state2 = recordComment(state1, 'topic-1', 'p-1');

    expect(getActivitySince(state2, 'topic-1')).toEqual({
      verified_comment_count: 2,
      unique_principal_count: 1,
    });
  });

  it('returns zero activity for topics with no tracked comments', () => {
    const state = recordComment(emptyState(), 'topic-1', 'p-1');

    expect(getActivitySince(state, 'topic-2')).toEqual({
      verified_comment_count: 0,
      unique_principal_count: 0,
    });
  });

  it('throws for empty ids', () => {
    expect(() => recordComment(emptyState(), '', 'p-1')).toThrow();
    expect(() => recordComment(emptyState(), 'topic-1', '')).toThrow();
    expect(() => getActivitySince(emptyState(), '')).toThrow();
  });
});

// ── resetForEpoch ─────────────────────────────────────────────────

describe('resetForEpoch', () => {
  it('removes tracked activity for the specified topic only', () => {
    const state1 = recordComment(emptyState(), 'topic-1', 'p-1');
    const state2 = recordComment(state1, 'topic-2', 'p-2');
    const state3 = resetForEpoch(state2, 'topic-1');

    expect(getActivitySince(state3, 'topic-1')).toEqual({
      verified_comment_count: 0,
      unique_principal_count: 0,
    });
    expect(getActivitySince(state3, 'topic-2')).toEqual({
      verified_comment_count: 1,
      unique_principal_count: 1,
    });
  });

  it('is a safe no-op when topic was never tracked', () => {
    const state1 = recordComment(emptyState(), 'topic-1', 'p-1');
    const state2 = resetForEpoch(state1, 'missing-topic');

    expect(state2).not.toBe(state1);
    expect(getActivitySince(state2, 'topic-1')).toEqual({
      verified_comment_count: 1,
      unique_principal_count: 1,
    });
  });
});

// ── meetsResynthesisThreshold ──────────────────────────────────────

describe('meetsResynthesisThreshold', () => {
  it('passes at exact default thresholds (10 comments, 3 unique)', () => {
    expect(
      meetsResynthesisThreshold({
        verified_comment_count: 10,
        unique_principal_count: 3,
      }),
    ).toBe(true);
  });

  it('fails when verified comment threshold is not met', () => {
    expect(
      meetsResynthesisThreshold({
        verified_comment_count: 9,
        unique_principal_count: 3,
      }),
    ).toBe(false);
  });

  it('fails when unique principal minimum is not met', () => {
    expect(
      meetsResynthesisThreshold({
        verified_comment_count: 10,
        unique_principal_count: 2,
      }),
    ).toBe(false);
  });

  it('respects config overrides', () => {
    expect(
      meetsResynthesisThreshold(
        {
          verified_comment_count: 2,
          unique_principal_count: 2,
        },
        {
          resynthesis_comment_threshold: 2,
          resynthesis_unique_principal_min: 2,
        },
      ),
    ).toBe(true);
  });

  it('throws for invalid activity shape', () => {
    expect(() =>
      meetsResynthesisThreshold({
        verified_comment_count: -1,
        unique_principal_count: 2,
      }),
    ).toThrow();
  });
});
