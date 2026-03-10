import type { ClusterBucket, PipelineState } from './stageState';
import type { StoryClusterModelProvider, SummaryWorkItem } from './modelProvider';
import type { ClusterVectorBackend } from './vectorBackend';
import { MemoryVectorBackend } from './vectorBackend';
import { canDocumentAttachToExistingCluster, canDocumentParticipateInCanonicalCluster } from './documentPolicy';
import { connectedComponents, deriveClusterRecord, preserveClusterIdentityWatermarks, toStoredSource, upsertClusterRecord } from './clusterRecords';
import { clusterScoringConfig, buildCandidateMatch, candidateEligible, shouldMergeClusters, shouldSplitPair } from './clusterScoring';
import { projectStoryBundles } from './bundleProjection';
import { applyPairReranks, applyPairJudgements, buildPairId, pairWorkItem, requireClusterProvider, shouldRequestPairJudgement } from './clusterJudgement';
export async function retrieveCandidates(
  state: PipelineState,
  vectorBackend: ClusterVectorBackend = new MemoryVectorBackend(),
): Promise<PipelineState> {
  const clusters = state.topic_state.clusters;
  const clusterLookup = new Map(clusters.map((cluster) => [cluster.story_id, cluster]));
  await vectorBackend.replaceTopicClusters(state.topicId, clusters);
  const retrievals = await vectorBackend.queryTopic(
    state.topicId,
    state.documents.map((document) => ({
      doc_id: document.doc_id,
      vector: document.coarse_vector,
    })),
    12,
  );
  let candidatesConsidered = 0;
  let candidatesRetained = 0;
  let prefilterHits = 0;
  const documents = state.documents.map((document) => {
    if (!canDocumentAttachToExistingCluster(document)) {
      return { ...document, candidate_matches: [], candidate_score: 0 };
    }
    const candidateMatches = (retrievals.get(document.doc_id) ?? [])
      .map((hit) => clusterLookup.get(hit.story_id))
      .filter((cluster): cluster is NonNullable<typeof cluster> => Boolean(cluster))
      .filter((cluster) => candidateEligible(document, cluster))
      .map((cluster) => buildCandidateMatch(document, cluster))
      .sort((left, right) => right.candidate_score - left.candidate_score || left.story_id.localeCompare(right.story_id))
      .slice(0, 8);
    candidatesConsidered += retrievals.get(document.doc_id)?.length ?? 0;
    candidatesRetained += candidateMatches.length;
    if (candidateMatches.length > 0) {
      prefilterHits += 1;
    }
    return {
      ...document,
      candidate_matches: candidateMatches,
      candidate_score: candidateMatches[0]?.candidate_score ?? 0,
    };
  });
  return {
    ...state,
    documents,
    stage_metrics: {
      ...state.stage_metrics,
      qdrant_candidate_retrieval: {
        candidates_considered: candidatesConsidered,
        candidates_retained: candidatesRetained,
        prefilter_hits: prefilterHits,
      },
    },
  };
}
export function scoreCandidates(state: PipelineState): PipelineState {
  const documents = state.documents.map((document) => ({ ...document, hybrid_score: document.candidate_matches[0]?.hybrid_score ?? 0 }));
  return {
    ...state,
    documents,
    stage_metrics: {
      ...state.stage_metrics,
      hybrid_scoring: {
        candidates_above_threshold: documents.filter((document) => document.hybrid_score >= clusterScoringConfig.reviewThreshold).length,
        candidates_below_threshold: documents.filter((document) => document.hybrid_score < clusterScoringConfig.reviewThreshold).length,
        scoring_version_count: 1,
      },
    },
  };
}
export async function rerankCandidates(
  state: PipelineState,
  provider: StoryClusterModelProvider | undefined,
): Promise<PipelineState> {
  const clusterLookup = new Map(state.topic_state.clusters.map((cluster) => [cluster.story_id, cluster]));
  const rerankItems = state.documents.flatMap((document) =>
    document.candidate_matches.slice(0, 3).map((match) => {
      const cluster = clusterLookup.get(match.story_id);
      if (!cluster) {
        throw new Error(`missing cluster ${match.story_id} during rerank`);
      }
      return pairWorkItem(document, cluster);
    }),
  );
  const reranks = await requireClusterProvider(provider, 'cross_encoder_rerank').rerankPairs(rerankItems);
  const rerankById = new Map(reranks.map((item) => [item.pair_id, item]));
  const documents = state.documents.map((document) => {
    const candidateMatches = applyPairReranks(document, document.candidate_matches, rerankById);
    return {
      ...document,
      candidate_matches: candidateMatches,
      rerank_score: candidateMatches[0]?.rerank_score ?? 0,
    };
  });
  return {
    ...state,
    documents,
    stage_metrics: {
      ...state.stage_metrics,
      cross_encoder_rerank: {
        reranked_pairs: rerankItems.length,
        accepted_after_rerank: documents.filter((document) => document.rerank_score >= clusterScoringConfig.acceptThreshold).length,
        rejected_after_rerank: documents.filter((document) => document.rerank_score < clusterScoringConfig.reviewThreshold).length,
      },
    },
  };
}
export async function adjudicateCandidates(
  state: PipelineState,
  provider: StoryClusterModelProvider | undefined,
): Promise<PipelineState> {
  const clusterLookup = new Map(state.topic_state.clusters.map((cluster) => [cluster.story_id, cluster]));
  const ambiguousDocuments = state.documents.filter((document) => {
    const top = document.candidate_matches[0];
    const second = document.candidate_matches[1];
    if (!top) {
      return false;
    }
    if (document.rerank_score < clusterScoringConfig.reviewThreshold) {
      return false;
    }
    if (document.rerank_score >= clusterScoringConfig.acceptThreshold && (!second || document.rerank_score - second.rerank_score >= 0.14)) {
      return false;
    }
    return true;
  });
  const adjudicationItems = ambiguousDocuments.map((document) => {
    const top = document.candidate_matches[0]!;
    const cluster = clusterLookup.get(top.story_id);
    if (!cluster) {
      throw new Error(`missing cluster ${top.story_id} during adjudication`);
    }
    return pairWorkItem(document, cluster);
  });
  const adjudications = adjudicationItems.length > 0
    ? await requireClusterProvider(provider, 'llm_adjudication').adjudicatePairs(adjudicationItems)
    : [];
  const adjudicationById = new Map(adjudications.map((item) => [item.pair_id, item]));
  const documents = state.documents.map((document) => {
    const top = document.candidate_matches[0];
    if (!top) {
      return { ...document, adjudication: 'rejected' as const };
    }
    const adjudicated = adjudicationById.get(buildPairId(document.doc_id, top.story_id));
    if (adjudicated) {
      return { ...document, adjudication: adjudicated.decision };
    }
    if (document.rerank_score >= clusterScoringConfig.acceptThreshold) {
      return { ...document, adjudication: 'accepted' as const };
    }
    return { ...document, adjudication: 'rejected' as const };
  });
  return {
    ...state,
    documents,
    stage_metrics: {
      ...state.stage_metrics,
      llm_adjudication: {
        ambiguity_rate: Number((documents.filter((document) => document.adjudication === 'abstain').length / Math.max(1, documents.length)).toFixed(6)),
        adjudicated_docs: adjudicationItems.length,
        adjudication_accepts: documents.filter((document) => document.adjudication === 'accepted').length,
        adjudication_rejects: documents.filter((document) => document.adjudication === 'rejected').length,
        adjudication_abstains: documents.filter((document) => document.adjudication === 'abstain').length,
      },
    },
  };
}
export async function assignClusters(
  state: PipelineState,
  provider: StoryClusterModelProvider | undefined,
): Promise<PipelineState> {
  const topicState = state.topic_state;
  const clusters = new Map(topicState.clusters.map((cluster) => [cluster.story_id, cluster]));
  const changedStoryIds = new Set<string>();
  let providerAdjudicatedDocs = 0;
  let providerJudgementPairs = 0;
  let providerAssignedDocs = 0;
  let providerRejectedDocs = 0;
  let relatedDocsDeferred = 0;
  for (const document of state.documents) {
    if (!canDocumentAttachToExistingCluster(document)) {
      document.assigned_story_id = undefined;
      relatedDocsDeferred += 1;
      continue;
    }
    let accepted = document.candidate_matches.find((match) => match.adjudication === 'accepted');
    if (!accepted) {
      const candidateMatches = [...clusters.values()]
        .filter((cluster) => candidateEligible(document, cluster))
        .map((cluster) => buildCandidateMatch(document, cluster))
        .sort((left, right) => right.rerank_score - left.rerank_score || left.story_id.localeCompare(right.story_id))
        .slice(0, 8);
      const fallbackMatches = provider && shouldRequestPairJudgement(candidateMatches)
        ? applyPairJudgements(
          document,
          candidateMatches,
          new Map(
            (await requireClusterProvider(provider, 'dynamic_cluster_assignment').adjudicatePairs(
              candidateMatches
                .slice(0, 3)
                .map((match) => pairWorkItem(document, clusters.get(match.story_id)!)),
            )).map((item) => [item.pair_id, item]),
          ),
        )
        : candidateMatches;
      if (provider && fallbackMatches !== candidateMatches) {
        providerAdjudicatedDocs += 1;
        providerJudgementPairs += Math.min(candidateMatches.length, 3);
      }
      document.candidate_matches = fallbackMatches;
      accepted = fallbackMatches.find((match) => match.adjudication === 'accepted');
      if (provider && fallbackMatches !== candidateMatches) {
        if (accepted) {
          providerAssignedDocs += 1;
        } else if (fallbackMatches.length > 0) {
          providerRejectedDocs += 1;
        }
      }
    }
    const sourceDocuments = document.source_variants.map((variant) => toStoredSource(document, variant));
    if (!accepted) {
      if (!canDocumentParticipateInCanonicalCluster(document)) {
        document.assigned_story_id = undefined;
        relatedDocsDeferred += 1;
        continue;
      }
      const created = deriveClusterRecord(topicState, state.topicId, sourceDocuments);
      clusters.set(created.story_id, created);
      changedStoryIds.add(created.story_id);
      document.assigned_story_id = created.story_id;
      continue;
    }
    const updated = upsertClusterRecord(clusters.get(accepted.story_id)!, sourceDocuments);
    clusters.set(updated.story_id, updated);
    changedStoryIds.add(updated.story_id);
    document.assigned_story_id = updated.story_id;
  }
  const ordered = [...clusters.values()].sort((left, right) => left.created_at - right.created_at || left.story_id.localeCompare(right.story_id));
  for (let index = 0; index < ordered.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < ordered.length; otherIndex += 1) {
      const left = ordered[index]!;
      const right = ordered[otherIndex]!;
      if (!clusters.has(left.story_id) || !clusters.has(right.story_id) || !shouldMergeClusters(left, right)) {
        continue;
      }
      const survivor = left;
      const removed = right;
      const next = upsertClusterRecord(survivor, removed.source_documents);
      next.lineage = { merged_from: [...new Set([...next.lineage.merged_from, removed.story_id])].sort() };
      clusters.set(next.story_id, next);
      clusters.delete(removed.story_id);
      changedStoryIds.add(next.story_id);
    }
  }
  for (const cluster of [...clusters.values()]) {
    const components = connectedComponents(cluster.source_documents, shouldSplitPair);
    if (components.length <= 1 || components[1]!.length < 2) {
      continue;
    }
    const [primary, ...secondary] = components;
    const retained = preserveClusterIdentityWatermarks(
      cluster,
      deriveClusterRecord(topicState, state.topicId, primary!, cluster.story_id, cluster.lineage),
    );
    clusters.set(cluster.story_id, retained);
    changedStoryIds.add(cluster.story_id);
    for (const component of secondary) {
      const splitCluster = deriveClusterRecord(topicState, state.topicId, component, undefined, { merged_from: [], split_from: cluster.story_id });
      clusters.set(splitCluster.story_id, splitCluster);
      changedStoryIds.add(splitCluster.story_id);
    }
  }
  topicState.clusters = [...clusters.values()].sort((left, right) => left.created_at - right.created_at || left.story_id.localeCompare(right.story_id));
  const changedClusters = topicState.clusters.filter((cluster) => changedStoryIds.has(cluster.story_id));
  const buckets: ClusterBucket[] = changedClusters.map((record) => ({
    key: record.story_id,
    record,
    docs: state.documents.filter((document) => document.assigned_story_id === record.story_id),
  }));
  return {
    ...state,
    topic_state: topicState,
    clusters: buckets,
    stage_metrics: {
      ...state.stage_metrics,
      dynamic_cluster_assignment: {
        clusters_created: buckets.filter((bucket) => bucket.record.lineage.merged_from.length === 0 && !bucket.record.lineage.split_from).length,
        clusters_updated: buckets.length,
        merges: buckets.reduce((sum, bucket) => sum + bucket.record.lineage.merged_from.length, 0),
        splits: buckets.filter((bucket) => bucket.record.lineage.split_from).length,
        singleton_clusters: topicState.clusters.filter((cluster) => cluster.source_documents.length === 1).length,
        largest_cluster_size: Math.max(0, ...topicState.clusters.map((cluster) => cluster.source_documents.length)),
        provider_adjudicated_docs: providerAdjudicatedDocs,
        provider_judgement_pairs: providerJudgementPairs,
        provider_assigned_docs: providerAssignedDocs,
        provider_rejected_docs: providerRejectedDocs,
        related_docs_deferred: relatedDocsDeferred,
      },
    },
  };
}
export async function bundleClusters(
  state: PipelineState,
  provider: StoryClusterModelProvider | undefined,
): Promise<PipelineState> {
  const providerInstance = requireClusterProvider(provider, 'summarize_publish_payloads');
  const summaryItems: SummaryWorkItem[] = state.clusters.map(({ record }) => ({
    cluster_id: record.story_id,
    headline: record.headline,
    source_titles: record.source_documents.map((document) => document.title),
    source_summaries: record.source_documents.map((document) => document.summary ?? document.text).filter(Boolean),
  }));
  const summaries = await providerInstance.summarize(summaryItems);
  const summaryById = new Map(summaries.map((item) => [item.cluster_id, item.summary]));
  const updatedClusters = state.clusters.map((bucket) => {
    const summary = summaryById.get(bucket.record.story_id);
    if (!summary) {
      throw new Error(`missing summary for ${bucket.record.story_id}`);
    }
    return {
      ...bucket,
      record: {
        ...bucket.record,
        summary_hint: summary,
      },
    };
  });
  const topicLookup = new Map(updatedClusters.map((bucket) => [bucket.record.story_id, bucket.record]));
  const topicState = {
    ...state.topic_state,
    clusters: state.topic_state.clusters.map((cluster) => topicLookup.get(cluster.story_id) ?? cluster),
  };
  return {
    ...state,
    topic_state: topicState,
    clusters: updatedClusters,
    bundles: projectStoryBundles(state.topicId, updatedClusters),
    stage_metrics: {
      ...state.stage_metrics,
      summarize_publish_payloads: {
        summaries_generated: updatedClusters.length,
        summary_failures: 0,
        fallback_summaries_used: 0,
      },
    },
  };
}
