import { clusterScoringConfig } from './clusterScoring';
import type { StoryClusterStageId } from './contracts';
import type { PairJudgementWorkResult, StoryClusterModelProvider } from './modelProvider';
import type { CandidateMatch, StoredClusterRecord, WorkingDocument } from './stageState';

const JUDGEMENT_ACCEPT_FLOOR = Math.min(0.95, Number((clusterScoringConfig.acceptThreshold + 0.08).toFixed(6)));
const JUDGEMENT_ABSTAIN_FLOOR = Math.min(
  clusterScoringConfig.acceptThreshold - 0.01,
  Number((clusterScoringConfig.reviewThreshold + 0.06).toFixed(6)),
);
const JUDGEMENT_REJECT_CEILING = Number((clusterScoringConfig.reviewThreshold - 0.04).toFixed(6));

export function requireClusterProvider(
  provider: StoryClusterModelProvider | undefined,
  stageId: StoryClusterStageId,
): StoryClusterModelProvider {
  if (!provider) {
    throw new Error(`storycluster model provider is required for ${stageId}`);
  }
  return provider;
}

export function buildPairId(documentId: string, storyId: string): string {
  return `${documentId}::${storyId}`;
}

export function pairWorkItem(
  document: WorkingDocument,
  cluster: StoredClusterRecord,
) {
  return {
    pair_id: buildPairId(document.doc_id, cluster.story_id),
    document_title: document.translated_title,
    document_text: document.translated_text,
    document_entities: document.linked_entities,
    document_trigger: document.trigger,
    cluster_headline: cluster.headline,
    cluster_summary: cluster.summary_hint,
    cluster_entities: Object.keys(cluster.entity_scores).sort(),
    cluster_triggers: Object.keys(cluster.trigger_scores).sort(),
  };
}

function normalizeJudgementScore(
  judgement: PairJudgementWorkResult,
  fallbackScore: number,
): number {
  if (judgement.decision === 'accepted') {
    return Math.max(fallbackScore, judgement.score, JUDGEMENT_ACCEPT_FLOOR);
  }
  if (judgement.decision === 'abstain') {
    return Math.min(
      clusterScoringConfig.acceptThreshold - 0.001,
      Math.max(fallbackScore, judgement.score, JUDGEMENT_ABSTAIN_FLOOR),
    );
  }
  return Math.min(fallbackScore, judgement.score || 0, JUDGEMENT_REJECT_CEILING);
}

export function applyPairJudgements(
  document: WorkingDocument,
  candidateMatches: readonly CandidateMatch[],
  judgementsById: ReadonlyMap<string, PairJudgementWorkResult>,
): CandidateMatch[] {
  return candidateMatches
    .map((match) => {
      const judgement = judgementsById.get(buildPairId(document.doc_id, match.story_id));
      if (!judgement) {
        return match;
      }
      return {
        ...match,
        adjudication: judgement.decision,
        rerank_score: normalizeJudgementScore(judgement, match.rerank_score),
        reason: judgement.decision === match.adjudication ? match.reason : `provider-${judgement.decision}`,
      };
    })
    .sort((left, right) => right.rerank_score - left.rerank_score || left.story_id.localeCompare(right.story_id));
}

export function shouldRequestPairJudgement(candidateMatches: readonly CandidateMatch[]): boolean {
  const top = candidateMatches[0];
  const second = candidateMatches[1];
  if (!top) {
    return false;
  }
  if (top.adjudication === 'accepted' && (!second || top.rerank_score - second.rerank_score >= 0.12)) {
    return false;
  }
  return (
    top.adjudication === 'abstain' ||
    top.hybrid_score >= clusterScoringConfig.reviewThreshold - 0.08 ||
    top.candidate_score >= 0.45 ||
    (!!second && top.rerank_score - second.rerank_score < 0.12)
  );
}
