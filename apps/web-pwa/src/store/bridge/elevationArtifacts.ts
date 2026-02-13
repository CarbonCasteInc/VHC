/**
 * Deterministic elevation artifact generators.
 *
 * Given the same synthesis context inputs (sourceTopicId, sourceSynthesisId,
 * sourceEpoch), the same artifact IDs are always produced.
 *
 * Spec refs:
 * - spec-hermes-forum-v0.md §5.2 (elevation outputs)
 * - spec-civic-action-kit-v0.md §2.1 (ElevationArtifacts interface)
 */

import type { ElevationArtifacts } from '@vh/data-model';

/** Context required to generate elevation artifacts. */
export interface ElevationContext {
  sourceTopicId: string;
  sourceSynthesisId: string;
  sourceEpoch: number;
}

/**
 * Deterministic SHA-256 hex hash using Web Crypto API.
 * Isolated here so tests can verify determinism without importing forum.ts.
 */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const ARTIFACT_PREFIX = 'elevation:artifact:';

/** Generate a deterministic artifact ID for a given artifact type and context. */
async function artifactId(kind: string, ctx: ElevationContext): Promise<string> {
  const seed = `${ARTIFACT_PREFIX}${kind}:${ctx.sourceTopicId}:${ctx.sourceSynthesisId}:${ctx.sourceEpoch}`;
  const hash = await sha256Hex(seed);
  return `${kind}-${hash.slice(0, 16)}`;
}

/**
 * Generate BriefDoc ID from synthesis context.
 * Deterministic: same inputs always produce the same ID.
 */
export async function generateBriefDocId(ctx: ElevationContext): Promise<string> {
  return artifactId('brief', ctx);
}

/**
 * Generate ProposalScaffold ID from synthesis context.
 * Deterministic: same inputs always produce the same ID.
 */
export async function generateProposalScaffoldId(ctx: ElevationContext): Promise<string> {
  return artifactId('scaffold', ctx);
}

/**
 * Generate TalkingPoints ID from synthesis context.
 * Deterministic: same inputs always produce the same ID.
 */
export async function generateTalkingPointsId(ctx: ElevationContext): Promise<string> {
  return artifactId('talkingpoints', ctx);
}

/**
 * Generate all elevation artifacts for a synthesis context.
 * Returns a complete ElevationArtifacts object with deterministic IDs.
 */
export async function generateElevationArtifacts(
  ctx: ElevationContext,
): Promise<ElevationArtifacts> {
  const [briefDocId, proposalScaffoldId, talkingPointsId] = await Promise.all([
    generateBriefDocId(ctx),
    generateProposalScaffoldId(ctx),
    generateTalkingPointsId(ctx),
  ]);

  return {
    briefDocId,
    proposalScaffoldId,
    talkingPointsId,
    generatedAt: Date.now(),
    sourceTopicId: ctx.sourceTopicId,
    sourceSynthesisId: ctx.sourceSynthesisId,
    sourceEpoch: ctx.sourceEpoch,
  };
}
