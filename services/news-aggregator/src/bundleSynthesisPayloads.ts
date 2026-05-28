import {
  attachPersistedFramePointIds,
} from '@vh/ai-engine';
import type { CandidateSynthesis, StoryBundle, TopicSynthesisV2 } from '@vh/data-model';
import {
  writeTopicLatestSynthesisIfNotDowngrade,
  type VennClient,
} from '@vh/gun-client';
import { resolveAnalysisSources } from './bundleSynthesisFullText';

export const BUNDLE_SYNTHESIS_EPOCH = 0;
const PROVIDER_ID = 'openai';
const LATEST_OWNER_PREFIX = 'news-bundle:';

export type AcceptedSynthesisWriteFailureStage = 'epoch_write_failed' | 'latest_write_failed';

export class AcceptedSynthesisWriteError extends Error {
  constructor(
    public readonly stage: AcceptedSynthesisWriteFailureStage,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'AcceptedSynthesisWriteError';
    this.cause = cause;
  }
}

export function normalizeIdToken(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._:-]+/g, '_') || 'story';
}

export function buildCandidatePayload(input: {
  candidateId: string;
  bundle: StoryBundle;
  keyFacts: string[];
  summary: string;
  frames: CandidateSynthesis['frames'];
  sourceAnalyses: NonNullable<CandidateSynthesis['source_analyses']>;
  warnings: string[];
  model: string;
  now: number;
}): CandidateSynthesis {
  return {
    candidate_id: input.candidateId,
    topic_id: input.bundle.topic_id,
    epoch: BUNDLE_SYNTHESIS_EPOCH,
    critique_notes: ['publish-time full-text story bundle synthesis'],
    key_facts: input.keyFacts,
    facts_summary: input.summary,
    frames: input.frames,
    source_analyses: input.sourceAnalyses,
    warnings: input.warnings,
    divergence_hints: [],
    provider: {
      provider_id: PROVIDER_ID,
      model_id: input.model,
      kind: 'remote',
    },
    created_at: input.now,
  };
}

export function buildTopicSynthesisPayload(input: {
  synthesisId: string;
  candidateId: string;
  bundle: StoryBundle;
  summary: string;
  frames: CandidateSynthesis['frames'];
  warnings: string[];
  now: number;
}): TopicSynthesisV2 {
  return {
    schemaVersion: 'topic-synthesis-v2',
    topic_id: input.bundle.topic_id,
    epoch: BUNDLE_SYNTHESIS_EPOCH,
    synthesis_id: input.synthesisId,
    inputs: {
      story_bundle_ids: [input.bundle.story_id],
    },
    quorum: {
      required: 1,
      received: 1,
      reached_at: input.now,
      timed_out: false,
      selection_rule: 'deterministic',
    },
    facts_summary: input.summary,
    frames: attachPersistedFramePointIds(input.synthesisId, input.frames),
    warnings: input.warnings,
    divergence_metrics: {
      disagreement_score: input.frames.length > 0 ? 0.5 : 0,
      source_dispersion: resolveAnalysisSources(input.bundle).length > 1 ? 1 : 0,
      candidate_count: 1,
    },
    provenance: {
      candidate_ids: [input.candidateId],
      provider_mix: [{ provider_id: PROVIDER_ID, count: 1 }],
    },
    created_at: input.now,
  };
}

export async function writeAcceptedSynthesis(input: {
  client: VennClient;
  bundle: StoryBundle;
  candidateId: string;
  synthesisId: string;
  summary: string;
  frames: CandidateSynthesis['frames'];
  warnings: string[];
  createdAt: number;
  writeSynthesis: (client: VennClient, synthesis: TopicSynthesisV2) => Promise<TopicSynthesisV2>;
  writeLatest: typeof writeTopicLatestSynthesisIfNotDowngrade;
}): Promise<{ latestStatus: 'written' | 'skipped'; synthesis: TopicSynthesisV2 }> {
  const synthesis = buildTopicSynthesisPayload({
    synthesisId: input.synthesisId,
    candidateId: input.candidateId,
    bundle: input.bundle,
    summary: input.summary,
    frames: input.frames,
    warnings: input.warnings,
    now: input.createdAt,
  });

  try {
    await input.writeSynthesis(input.client, synthesis);
  } catch (error) {
    throw new AcceptedSynthesisWriteError('epoch_write_failed', error);
  }
  let latestResult: Awaited<ReturnType<typeof writeTopicLatestSynthesisIfNotDowngrade>>;
  try {
    latestResult = await input.writeLatest(input.client, synthesis, {
      canOverwriteExisting: (existing) => existing.synthesis_id.startsWith(LATEST_OWNER_PREFIX),
    });
  } catch (error) {
    throw new AcceptedSynthesisWriteError('latest_write_failed', error);
  }
  return { latestStatus: latestResult.status, synthesis };
}
