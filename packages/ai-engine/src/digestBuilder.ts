/**
 * DigestBuilder — builds TopicDigestInput from verified forum comments.
 *
 * Takes a corpus of verified comments within a time window and produces
 * a TopicDigestInput conforming to topic-synthesis-v2.md §3.
 *
 * Key capabilities:
 * - Deterministic digest_id from {topic_id, window_start, window_end}
 * - Extracts key_claims, salient_counterclaims, representative_quotes
 * - Sanitizes quotes to strip principal identifiers (PII)
 * - Uses CommentTracker counts for verified_comment_count and unique_principals
 *
 * @module digestBuilder
 */

import { z } from 'zod';

// ── Input schemas ──────────────────────────────────────────────────

export const VerifiedCommentSchema = z.object({
  comment_id: z.string().min(1),
  content: z.string(),
  stance: z.enum(['concur', 'counter', 'discuss']),
  principal_hash: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
});

export type VerifiedComment = z.infer<typeof VerifiedCommentSchema>;

export const DigestBuilderInputSchema = z.object({
  topic_id: z.string().min(1),
  window_start: z.number().int().nonnegative(),
  window_end: z.number().int().nonnegative(),
  comments: z.array(VerifiedCommentSchema),
  verified_comment_count: z.number().int().nonnegative(),
  unique_verified_principals: z.number().int().nonnegative(),
});

export type DigestBuilderInput = z.infer<typeof DigestBuilderInputSchema>;

// ── Output type (matches TopicDigestInput from data-model) ─────────

export const TopicDigestOutputSchema = z.object({
  digest_id: z.string().min(1),
  topic_id: z.string().min(1),
  window_start: z.number().int().nonnegative(),
  window_end: z.number().int().nonnegative(),
  verified_comment_count: z.number().int().nonnegative(),
  unique_verified_principals: z.number().int().nonnegative(),
  key_claims: z.array(z.string()),
  salient_counterclaims: z.array(z.string()),
  representative_quotes: z.array(z.string()),
});

export type TopicDigestOutput = z.infer<typeof TopicDigestOutputSchema>;

// ── Configuration ──────────────────────────────────────────────────

export const DigestBuilderConfigSchema = z.object({
  max_claims: z.number().int().positive().default(10),
  max_counterclaims: z.number().int().positive().default(5),
  max_quotes: z.number().int().positive().default(5),
  max_quote_length: z.number().int().positive().default(280),
});

export type DigestBuilderConfig = z.infer<typeof DigestBuilderConfigSchema>;

// ── PII / principal sanitization ───────────────────────────────────

/**
 * Sanitize a quote by stripping potential principal identifiers.
 * Removes patterns that look like hashed IDs, nullifiers, or
 * raw principal references.
 */
export function sanitizeQuote(text: string): string {
  // Strip hex strings ≥ 16 chars (likely hashes/nullifiers)
  let sanitized = text.replace(/\b[0-9a-fA-F]{16,}\b/g, '[REDACTED]');
  // Strip patterns like "principal:xxx", "author:xxx", "user:xxx"
  sanitized = sanitized.replace(
    /\b(principal|author|user|nullifier)[:\s]+\S+/gi,
    '[REDACTED]',
  );
  return sanitized.trim();
}

// ── Deterministic digest_id ────────────────────────────────────────

/**
 * Derive a deterministic digest_id from {topic_id, window_start, window_end}.
 * Uses a simple string hash for synchronous operation in pure contexts.
 */
export function deriveDigestId(
  topicId: string,
  windowStart: number,
  windowEnd: number,
): string {
  const input = `digest:${topicId}:${windowStart}:${windowEnd}`;
  return `dg-${simpleHash(input)}`;
}

/**
 * Simple deterministic string hash (FNV-1a 32-bit).
 * Not cryptographic — used only for deterministic ID derivation.
 */
function simpleHash(str: string): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// ── Content extraction ─────────────────────────────────────────────

function extractClaims(
  comments: VerifiedComment[],
  max: number,
): string[] {
  const concurring = comments
    .filter((c) => c.stance === 'concur' || c.stance === 'discuss')
    .filter((c) => c.content.trim().length > 0);

  return concurring
    .map((c) => c.content.trim())
    .slice(0, max);
}

function extractCounterclaims(
  comments: VerifiedComment[],
  max: number,
): string[] {
  const countering = comments
    .filter((c) => c.stance === 'counter')
    .filter((c) => c.content.trim().length > 0);

  return countering
    .map((c) => c.content.trim())
    .slice(0, max);
}

function extractQuotes(
  comments: VerifiedComment[],
  max: number,
  maxLength: number,
): string[] {
  const candidates = comments
    .filter((c) => c.content.trim().length > 0)
    .map((c) => {
      const trimmed = c.content.trim();
      return trimmed.length > maxLength
        ? trimmed.slice(0, maxLength - 1) + '…'
        : trimmed;
    });

  return candidates
    .map(sanitizeQuote)
    .filter((q) => q.length > 0)
    .slice(0, max);
}

// ── Main builder function ──────────────────────────────────────────

/**
 * Build a TopicDigestInput from verified comments in a time window.
 *
 * @param input - Comment corpus and metadata
 * @param configOverrides - Optional config overrides
 * @returns TopicDigestOutput conforming to topic-synthesis-v2.md §3
 */
export function buildDigest(
  input: DigestBuilderInput,
  configOverrides?: Partial<DigestBuilderConfig>,
): TopicDigestOutput {
  const parsed = DigestBuilderInputSchema.parse(input);
  const config = DigestBuilderConfigSchema.parse(configOverrides ?? {});

  const digestId = deriveDigestId(
    parsed.topic_id,
    parsed.window_start,
    parsed.window_end,
  );

  const keyClaims = extractClaims(parsed.comments, config.max_claims);
  const salientCounterclaims = extractCounterclaims(
    parsed.comments,
    config.max_counterclaims,
  );
  const representativeQuotes = extractQuotes(
    parsed.comments,
    config.max_quotes,
    config.max_quote_length,
  );

  return TopicDigestOutputSchema.parse({
    digest_id: digestId,
    topic_id: parsed.topic_id,
    window_start: parsed.window_start,
    window_end: parsed.window_end,
    verified_comment_count: parsed.verified_comment_count,
    unique_verified_principals: parsed.unique_verified_principals,
    key_claims: keyClaims,
    salient_counterclaims: salientCounterclaims,
    representative_quotes: representativeQuotes,
  });
}
