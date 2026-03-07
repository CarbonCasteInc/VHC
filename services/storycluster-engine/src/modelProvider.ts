import type { DocumentType, EventTuple } from './contentSignals';

export interface TranslationWorkItem {
  doc_id: string;
  language: string;
  text: string;
}

export interface TranslationWorkResult {
  doc_id: string;
  translated_text: string;
}

export interface EmbeddingWorkItem {
  item_id: string;
  text: string;
}

export interface EmbeddingWorkResult {
  item_id: string;
  vector: number[];
}

export interface DocumentAnalysisWorkItem {
  doc_id: string;
  title: string;
  summary?: string;
  publisher: string;
  language: string;
  text: string;
  published_at: number;
  entity_hints: string[];
}

export interface DocumentAnalysisWorkResult {
  doc_id: string;
  doc_type: DocumentType;
  entities: string[];
  linked_entities: string[];
  locations: string[];
  temporal_ms: number | null;
  trigger: string | null;
  event_tuple: EventTuple | null;
}

export interface PairJudgementWorkItem {
  pair_id: string;
  document_title: string;
  document_text: string;
  document_entities: string[];
  document_trigger: string | null;
  cluster_headline: string;
  cluster_summary: string;
  cluster_entities: string[];
  cluster_triggers: string[];
}

export interface PairJudgementWorkResult {
  pair_id: string;
  score: number;
  decision: 'accepted' | 'rejected' | 'abstain';
}

export interface PairRerankWorkResult {
  pair_id: string;
  score: number;
}

export interface SummaryWorkItem {
  cluster_id: string;
  headline: string;
  source_titles: string[];
  source_summaries: string[];
}

export interface SummaryWorkResult {
  cluster_id: string;
  summary: string;
}

export interface StoryClusterModelProvider {
  readonly providerId: string;
  translate(items: TranslationWorkItem[]): Promise<TranslationWorkResult[]>;
  embed(items: EmbeddingWorkItem[], dimensions: number): Promise<EmbeddingWorkResult[]>;
  analyzeDocuments(items: DocumentAnalysisWorkItem[]): Promise<DocumentAnalysisWorkResult[]>;
  rerankPairs(items: PairJudgementWorkItem[]): Promise<PairRerankWorkResult[]>;
  adjudicatePairs(items: PairJudgementWorkItem[]): Promise<PairJudgementWorkResult[]>;
  summarize(items: SummaryWorkItem[]): Promise<SummaryWorkResult[]>;
}
