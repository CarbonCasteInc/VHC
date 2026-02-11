import { describe, expect, it } from 'vitest';
import {
  buildDigest,
  deriveDigestId,
  sanitizeQuote,
  DigestBuilderInputSchema,
  TopicDigestOutputSchema,
  VerifiedCommentSchema,
  DigestBuilderConfigSchema,
  type VerifiedComment,
  type DigestBuilderInput,
} from './digestBuilder';
import { TopicDigestInputSchema } from '@vh/data-model';

// ── Fixtures ───────────────────────────────────────────────────────

function makeComment(overrides?: Partial<VerifiedComment>): VerifiedComment {
  return {
    comment_id: 'c-1',
    content: 'This is a valid claim about the topic',
    stance: 'concur',
    principal_hash: 'hash-alice',
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function makeInput(overrides?: Partial<DigestBuilderInput>): DigestBuilderInput {
  return {
    topic_id: 'topic-42',
    window_start: 1_700_000_000_000,
    window_end: 1_700_100_000_000,
    comments: [
      makeComment({ comment_id: 'c-1', stance: 'concur', content: 'Key claim one' }),
      makeComment({ comment_id: 'c-2', stance: 'counter', content: 'Counterclaim one', principal_hash: 'hash-bob' }),
      makeComment({ comment_id: 'c-3', stance: 'discuss', content: 'Discussion point', principal_hash: 'hash-charlie' }),
    ],
    verified_comment_count: 3,
    unique_verified_principals: 3,
    ...overrides,
  };
}

// ── Schema tests ───────────────────────────────────────────────────

describe('VerifiedCommentSchema', () => {
  it('accepts valid comment', () => {
    expect(VerifiedCommentSchema.safeParse(makeComment()).success).toBe(true);
  });

  it('rejects empty comment_id', () => {
    expect(
      VerifiedCommentSchema.safeParse(makeComment({ comment_id: '' })).success,
    ).toBe(false);
  });

  it('rejects empty principal_hash', () => {
    expect(
      VerifiedCommentSchema.safeParse(makeComment({ principal_hash: '' })).success,
    ).toBe(false);
  });

  it('accepts all stance values', () => {
    for (const stance of ['concur', 'counter', 'discuss'] as const) {
      expect(
        VerifiedCommentSchema.safeParse(makeComment({ stance })).success,
      ).toBe(true);
    }
  });
});

describe('DigestBuilderInputSchema', () => {
  it('accepts valid input', () => {
    expect(DigestBuilderInputSchema.safeParse(makeInput()).success).toBe(true);
  });

  it('rejects empty topic_id', () => {
    expect(
      DigestBuilderInputSchema.safeParse(makeInput({ topic_id: '' })).success,
    ).toBe(false);
  });
});

describe('DigestBuilderConfigSchema', () => {
  it('applies defaults', () => {
    const config = DigestBuilderConfigSchema.parse({});
    expect(config.max_claims).toBe(10);
    expect(config.max_counterclaims).toBe(5);
    expect(config.max_quotes).toBe(5);
    expect(config.max_quote_length).toBe(280);
  });
});

// ── Output schema validation ───────────────────────────────────────

describe('buildDigest output schema', () => {
  it('produces output conforming to TopicDigestOutputSchema', () => {
    const result = buildDigest(makeInput());
    expect(TopicDigestOutputSchema.safeParse(result).success).toBe(true);
  });

  it('produces output conforming to data-model TopicDigestInputSchema', () => {
    const result = buildDigest(makeInput());
    expect(TopicDigestInputSchema.safeParse(result).success).toBe(true);
  });

  it('includes correct topic_id', () => {
    const result = buildDigest(makeInput());
    expect(result.topic_id).toBe('topic-42');
  });

  it('includes correct window boundaries', () => {
    const result = buildDigest(makeInput());
    expect(result.window_start).toBe(1_700_000_000_000);
    expect(result.window_end).toBe(1_700_100_000_000);
  });

  it('passes through verified_comment_count and unique_verified_principals', () => {
    const result = buildDigest(makeInput({ verified_comment_count: 15, unique_verified_principals: 5 }));
    expect(result.verified_comment_count).toBe(15);
    expect(result.unique_verified_principals).toBe(5);
  });
});

// ── Empty comment corpus ───────────────────────────────────────────

describe('buildDigest empty corpus', () => {
  it('handles empty comments array', () => {
    const result = buildDigest(makeInput({ comments: [], verified_comment_count: 0, unique_verified_principals: 0 }));
    expect(result.key_claims).toEqual([]);
    expect(result.salient_counterclaims).toEqual([]);
    expect(result.representative_quotes).toEqual([]);
    expect(result.verified_comment_count).toBe(0);
    expect(result.unique_verified_principals).toBe(0);
  });

  it('produces valid schema output for empty corpus', () => {
    const result = buildDigest(makeInput({ comments: [] }));
    expect(TopicDigestInputSchema.safeParse(result).success).toBe(true);
  });
});

// ── Content extraction ─────────────────────────────────────────────

describe('buildDigest content extraction', () => {
  it('extracts concur comments as key_claims', () => {
    const result = buildDigest(makeInput({
      comments: [
        makeComment({ comment_id: 'c-1', stance: 'concur', content: 'Claim A' }),
        makeComment({ comment_id: 'c-2', stance: 'concur', content: 'Claim B' }),
      ],
    }));
    expect(result.key_claims).toContain('Claim A');
    expect(result.key_claims).toContain('Claim B');
  });

  it('extracts discuss comments as key_claims', () => {
    const result = buildDigest(makeInput({
      comments: [
        makeComment({ comment_id: 'c-1', stance: 'discuss', content: 'Discussion point' }),
      ],
    }));
    expect(result.key_claims).toContain('Discussion point');
  });

  it('extracts counter comments as salient_counterclaims', () => {
    const result = buildDigest(makeInput({
      comments: [
        makeComment({ comment_id: 'c-1', stance: 'counter', content: 'Counterpoint A' }),
      ],
    }));
    expect(result.salient_counterclaims).toContain('Counterpoint A');
  });

  it('excludes empty-content comments from claims', () => {
    const result = buildDigest(makeInput({
      comments: [
        makeComment({ comment_id: 'c-1', stance: 'concur', content: '' }),
        makeComment({ comment_id: 'c-2', stance: 'concur', content: '   ' }),
        makeComment({ comment_id: 'c-3', stance: 'concur', content: 'Valid claim' }),
      ],
    }));
    expect(result.key_claims).toEqual(['Valid claim']);
  });

  it('excludes empty-content comments from counterclaims', () => {
    const result = buildDigest(makeInput({
      comments: [
        makeComment({ comment_id: 'c-1', stance: 'counter', content: '' }),
        makeComment({ comment_id: 'c-2', stance: 'counter', content: 'Valid counter' }),
      ],
    }));
    expect(result.salient_counterclaims).toEqual(['Valid counter']);
  });

  it('respects max_claims config', () => {
    const comments = Array.from({ length: 15 }, (_, i) =>
      makeComment({ comment_id: `c-${i}`, stance: 'concur', content: `Claim ${i}` }),
    );
    const result = buildDigest(makeInput({ comments }), { max_claims: 3 });
    expect(result.key_claims).toHaveLength(3);
  });

  it('respects max_counterclaims config', () => {
    const comments = Array.from({ length: 10 }, (_, i) =>
      makeComment({ comment_id: `c-${i}`, stance: 'counter', content: `Counter ${i}` }),
    );
    const result = buildDigest(makeInput({ comments }), { max_counterclaims: 2 });
    expect(result.salient_counterclaims).toHaveLength(2);
  });

  it('respects max_quotes config', () => {
    const comments = Array.from({ length: 10 }, (_, i) =>
      makeComment({ comment_id: `c-${i}`, content: `Quote ${i}` }),
    );
    const result = buildDigest(makeInput({ comments }), { max_quotes: 3 });
    expect(result.representative_quotes).toHaveLength(3);
  });
});

// ── Quote sanitization ─────────────────────────────────────────────

describe('sanitizeQuote', () => {
  it('strips long hex strings (likely hashes/nullifiers)', () => {
    const input = 'Comment by abcdef0123456789abcdef0123456789 said something';
    const result = sanitizeQuote(input);
    expect(result).not.toContain('abcdef0123456789');
    expect(result).toContain('[REDACTED]');
  });

  it('strips principal:xxx patterns', () => {
    expect(sanitizeQuote('principal:alice-123 made a point')).toContain('[REDACTED]');
    expect(sanitizeQuote('principal:alice-123 made a point')).not.toContain('alice-123');
  });

  it('strips author:xxx patterns', () => {
    expect(sanitizeQuote('author:bob-456 says')).toContain('[REDACTED]');
    expect(sanitizeQuote('author:bob-456 says')).not.toContain('bob-456');
  });

  it('strips user:xxx patterns', () => {
    expect(sanitizeQuote('user:charlie wrote')).toContain('[REDACTED]');
    expect(sanitizeQuote('user:charlie wrote')).not.toContain('charlie');
  });

  it('strips nullifier:xxx patterns', () => {
    expect(sanitizeQuote('nullifier:abc123 posted')).toContain('[REDACTED]');
    expect(sanitizeQuote('nullifier:abc123 posted')).not.toContain('abc123');
  });

  it('preserves normal text', () => {
    expect(sanitizeQuote('This is a normal comment about policy')).toBe(
      'This is a normal comment about policy',
    );
  });

  it('handles empty string', () => {
    expect(sanitizeQuote('')).toBe('');
  });

  it('is case-insensitive for identifier patterns', () => {
    expect(sanitizeQuote('AUTHOR:test123 claims')).toContain('[REDACTED]');
    expect(sanitizeQuote('Author:test123 claims')).toContain('[REDACTED]');
  });

  it('strips hex strings of exactly 16 chars', () => {
    expect(sanitizeQuote('id is 0123456789abcdef ok')).toContain('[REDACTED]');
  });

  it('does not strip short hex strings (< 16 chars)', () => {
    const result = sanitizeQuote('color #ff5533 is nice');
    expect(result).not.toContain('[REDACTED]');
  });
});

describe('buildDigest quote sanitization', () => {
  it('sanitizes quotes in output', () => {
    const result = buildDigest(makeInput({
      comments: [
        makeComment({
          comment_id: 'c-1',
          content: 'principal:alice-secret said this is important',
        }),
      ],
    }));
    const quotes = result.representative_quotes;
    expect(quotes.length).toBeGreaterThan(0);
    expect(quotes[0]).not.toContain('alice-secret');
    expect(quotes[0]).toContain('[REDACTED]');
  });

  it('truncates long quotes and sanitizes', () => {
    const longContent = 'A'.repeat(300);
    const result = buildDigest(
      makeInput({
        comments: [makeComment({ comment_id: 'c-1', content: longContent })],
      }),
      { max_quote_length: 100 },
    );
    expect(result.representative_quotes[0].length).toBeLessThanOrEqual(100);
    expect(result.representative_quotes[0].endsWith('…')).toBe(true);
  });

  it('excludes quotes that become empty after sanitization', () => {
    const result = buildDigest(makeInput({
      comments: [
        makeComment({
          comment_id: 'c-1',
          content: '   ',
        }),
      ],
    }));
    expect(result.representative_quotes).toEqual([]);
  });
});

// ── Deterministic digest_id ────────────────────────────────────────

describe('deriveDigestId', () => {
  it('produces same ID for same inputs', () => {
    const id1 = deriveDigestId('topic-42', 1000, 2000);
    const id2 = deriveDigestId('topic-42', 1000, 2000);
    expect(id1).toBe(id2);
  });

  it('produces different IDs for different topic_id', () => {
    const id1 = deriveDigestId('topic-A', 1000, 2000);
    const id2 = deriveDigestId('topic-B', 1000, 2000);
    expect(id1).not.toBe(id2);
  });

  it('produces different IDs for different window_start', () => {
    const id1 = deriveDigestId('topic-42', 1000, 2000);
    const id2 = deriveDigestId('topic-42', 1001, 2000);
    expect(id1).not.toBe(id2);
  });

  it('produces different IDs for different window_end', () => {
    const id1 = deriveDigestId('topic-42', 1000, 2000);
    const id2 = deriveDigestId('topic-42', 1000, 2001);
    expect(id1).not.toBe(id2);
  });

  it('starts with dg- prefix', () => {
    expect(deriveDigestId('topic-42', 1000, 2000)).toMatch(/^dg-[0-9a-f]{8}$/);
  });
});

describe('buildDigest deterministic digest_id', () => {
  it('produces same digest_id for same inputs', () => {
    const result1 = buildDigest(makeInput());
    const result2 = buildDigest(makeInput());
    expect(result1.digest_id).toBe(result2.digest_id);
  });

  it('produces different digest_id for different topic', () => {
    const result1 = buildDigest(makeInput({ topic_id: 'topic-A' }));
    const result2 = buildDigest(makeInput({ topic_id: 'topic-B' }));
    expect(result1.digest_id).not.toBe(result2.digest_id);
  });

  it('digest_id is independent of comment content', () => {
    const input1 = makeInput({
      comments: [makeComment({ comment_id: 'c-1', content: 'Version 1' })],
    });
    const input2 = makeInput({
      comments: [makeComment({ comment_id: 'c-1', content: 'Version 2' })],
    });
    expect(buildDigest(input1).digest_id).toBe(buildDigest(input2).digest_id);
  });
});

// ── Input validation ───────────────────────────────────────────────

describe('buildDigest input validation', () => {
  it('throws on invalid input', () => {
    expect(() =>
      buildDigest({ topic_id: '', window_start: 0, window_end: 0, comments: [], verified_comment_count: 0, unique_verified_principals: 0 }),
    ).toThrow();
  });
});
