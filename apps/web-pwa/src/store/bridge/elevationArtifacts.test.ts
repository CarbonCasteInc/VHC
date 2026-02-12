import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ElevationArtifactsSchema } from '@vh/data-model';
import {
  generateBriefDocId,
  generateProposalScaffoldId,
  generateTalkingPointsId,
  generateElevationArtifacts,
  type ElevationContext,
} from './elevationArtifacts';

const ctx: ElevationContext = {
  sourceTopicId: 'topic-42',
  sourceSynthesisId: 'synth-7',
  sourceEpoch: 3,
};

const differentCtx: ElevationContext = {
  sourceTopicId: 'topic-99',
  sourceSynthesisId: 'synth-1',
  sourceEpoch: 1,
};

describe('elevationArtifacts generators', () => {
  /* ── determinism ────────────────────────────────────────── */

  it('generateBriefDocId is deterministic', async () => {
    const a = await generateBriefDocId(ctx);
    const b = await generateBriefDocId(ctx);
    expect(a).toBe(b);
    expect(a).toMatch(/^brief-[0-9a-f]{16}$/);
  });

  it('generateProposalScaffoldId is deterministic', async () => {
    const a = await generateProposalScaffoldId(ctx);
    const b = await generateProposalScaffoldId(ctx);
    expect(a).toBe(b);
    expect(a).toMatch(/^scaffold-[0-9a-f]{16}$/);
  });

  it('generateTalkingPointsId is deterministic', async () => {
    const a = await generateTalkingPointsId(ctx);
    const b = await generateTalkingPointsId(ctx);
    expect(a).toBe(b);
    expect(a).toMatch(/^talkingpoints-[0-9a-f]{16}$/);
  });

  /* ── uniqueness across types ────────────────────────────── */

  it('produces distinct IDs for different artifact types', async () => {
    const [brief, scaffold, tp] = await Promise.all([
      generateBriefDocId(ctx),
      generateProposalScaffoldId(ctx),
      generateTalkingPointsId(ctx),
    ]);
    const ids = new Set([brief, scaffold, tp]);
    expect(ids.size).toBe(3);
  });

  /* ── uniqueness across contexts ─────────────────────────── */

  it('produces different IDs for different contexts', async () => {
    const a = await generateBriefDocId(ctx);
    const b = await generateBriefDocId(differentCtx);
    expect(a).not.toBe(b);
  });

  /* ── generateElevationArtifacts ─────────────────────────── */

  it('returns a valid ElevationArtifacts object', async () => {
    const artifacts = await generateElevationArtifacts(ctx);
    const result = ElevationArtifactsSchema.safeParse(artifacts);
    expect(result.success).toBe(true);
  });

  it('includes correct source fields', async () => {
    const artifacts = await generateElevationArtifacts(ctx);
    expect(artifacts.sourceTopicId).toBe(ctx.sourceTopicId);
    expect(artifacts.sourceSynthesisId).toBe(ctx.sourceSynthesisId);
    expect(artifacts.sourceEpoch).toBe(ctx.sourceEpoch);
  });

  it('sets generatedAt to a recent timestamp', async () => {
    const before = Date.now();
    const artifacts = await generateElevationArtifacts(ctx);
    const after = Date.now();
    expect(artifacts.generatedAt).toBeGreaterThanOrEqual(before);
    expect(artifacts.generatedAt).toBeLessThanOrEqual(after);
  });

  it('generates deterministic IDs within the artifacts', async () => {
    const a = await generateElevationArtifacts(ctx);
    const b = await generateElevationArtifacts(ctx);
    expect(a.briefDocId).toBe(b.briefDocId);
    expect(a.proposalScaffoldId).toBe(b.proposalScaffoldId);
    expect(a.talkingPointsId).toBe(b.talkingPointsId);
  });
});
