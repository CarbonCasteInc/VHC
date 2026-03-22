export interface StoryBundleSource {
  readonly source_id: string;
  readonly publisher: string;
  readonly url: string;
  readonly url_hash: string;
  readonly published_at?: number;
  readonly title: string;
}

export interface LiveSemanticAuditBundleLike {
  readonly story_id: string;
  readonly topic_id: string;
  readonly headline: string;
  readonly sources: ReadonlyArray<StoryBundleSource>;
  readonly primary_sources?: ReadonlyArray<StoryBundleSource>;
  readonly secondary_assets?: ReadonlyArray<StoryBundleSource>;
}

export interface LiveSemanticAuditPair {
  readonly pair_id: string;
  readonly story_id: string;
  readonly topic_id: string;
  readonly story_headline: string;
  readonly left: StoryBundleSource & { readonly text: string };
  readonly right: StoryBundleSource & { readonly text: string };
}

export interface LiveSemanticAuditPairResult {
  readonly pair_id: string;
  readonly label: 'duplicate' | 'same_incident' | 'same_developing_episode' | 'related_topic_only';
  readonly confidence: number;
  readonly rationale: string;
}

export interface SemanticAuditBundleCandidate {
  readonly story_id: string;
  readonly topic_id: string;
  readonly headline: string;
}

export interface SemanticAuditStoreStorySnapshot {
  readonly story_id: string;
  readonly topic_id: string;
  readonly headline: string;
  readonly source_count: number;
  readonly primary_source_count: number;
  readonly secondary_asset_count: number;
  readonly is_auditable: boolean;
  readonly is_dom_visible: boolean;
}

export interface SemanticAuditStoreSnapshot {
  readonly story_count: number;
  readonly auditable_count: number;
  readonly visible_story_ids: ReadonlyArray<string>;
  readonly top_story_ids: ReadonlyArray<string>;
  readonly top_auditable_story_ids: ReadonlyArray<string>;
  readonly stories: ReadonlyArray<SemanticAuditStoreStorySnapshot>;
}

export interface RetainedSourceEvidenceObservation {
  readonly story_id: string;
  readonly topic_id: string;
  readonly headline: string;
  readonly source_count: number;
  readonly primary_source_count: number;
  readonly secondary_asset_count: number;
  readonly is_auditable: boolean;
  readonly is_dom_visible: boolean;
  readonly source_roles: ReadonlyArray<'source' | 'primary_source' | 'secondary_asset'>;
}

export interface RetainedSourceEvidenceRecord extends StoryBundleSource {
  readonly observations: ReadonlyArray<RetainedSourceEvidenceObservation>;
}

export interface RetainedSourceEvidenceSnapshot {
  readonly schemaVersion: 'daemon-feed-retained-source-evidence-v1';
  readonly generatedAt: string;
  readonly story_count: number;
  readonly auditable_count: number;
  readonly visible_story_ids: ReadonlyArray<string>;
  readonly top_story_ids: ReadonlyArray<string>;
  readonly top_auditable_story_ids: ReadonlyArray<string>;
  readonly source_count: number;
  readonly sources: ReadonlyArray<RetainedSourceEvidenceRecord>;
}

export interface DaemonFeedSemanticAuditOptions {
  readonly sampleCount?: number;
  readonly timeoutMs?: number;
  readonly openAIApiKey: string;
  readonly openAIBaseUrl?: string;
  readonly openAIModel?: string;
}

export interface AuditedBundlePairResult extends LiveSemanticAuditPairResult {
  readonly left: Pick<StoryBundleSource, 'source_id' | 'publisher' | 'title' | 'url'>;
  readonly right: Pick<StoryBundleSource, 'source_id' | 'publisher' | 'title' | 'url'>;
}

export interface SemanticAuditArticleFetchFailure {
  readonly source_id: string;
  readonly url: string;
  readonly error: string;
  readonly attempts: number;
}

export interface AuditedBundleReport {
  readonly story_id: string;
  readonly topic_id: string;
  readonly headline: string;
  readonly canonical_source_count: number;
  readonly secondary_asset_count: number;
  readonly canonical_sources: ReadonlyArray<StoryBundleSource>;
  readonly pairs: ReadonlyArray<AuditedBundlePairResult>;
  readonly has_related_topic_only_pair: boolean;
  readonly audit_status?: 'complete' | 'incomplete_article_text';
  readonly missing_article_sources?: ReadonlyArray<SemanticAuditArticleFetchFailure>;
}

export type SemanticAuditSupplyStatus = 'full' | 'partial' | 'empty';

export interface SemanticAuditSupplyDiagnostics {
  readonly status: SemanticAuditSupplyStatus;
  readonly story_count: number;
  readonly auditable_count: number;
  readonly visible_story_ids: ReadonlyArray<string>;
  readonly top_story_ids: ReadonlyArray<string>;
  readonly top_auditable_story_ids: ReadonlyArray<string>;
  readonly sample_fill_rate: number;
  readonly sample_shortfall: number;
}

export interface DaemonFeedSemanticAuditReport {
  readonly schema_version: 'daemon-first-feed-semantic-audit-v3';
  readonly base_url: string;
  readonly requested_sample_count: number;
  readonly sampled_story_count: number;
  readonly visible_story_ids: ReadonlyArray<string>;
  readonly supply: SemanticAuditSupplyDiagnostics;
  readonly bundles: ReadonlyArray<AuditedBundleReport>;
  readonly article_fetch_failures?: ReadonlyArray<SemanticAuditArticleFetchFailure>;
  readonly overall: {
    readonly audited_pair_count: number;
    readonly related_topic_only_pair_count: number;
    readonly incomplete_bundle_count: number;
    readonly article_fetch_failure_count: number;
    readonly sample_fill_rate: number;
    readonly sample_shortfall: number;
    readonly pass: boolean;
  };
}
