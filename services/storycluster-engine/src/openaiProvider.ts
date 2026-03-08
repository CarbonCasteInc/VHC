import { type DocumentAnalysisWorkItem, type DocumentAnalysisWorkResult, type EmbeddingWorkItem, type EmbeddingWorkResult, type PairJudgementWorkItem, type PairJudgementWorkResult, type PairRerankWorkResult, type StoryClusterModelProvider, type SummaryWorkItem, type SummaryWorkResult, type TranslationWorkItem, type TranslationWorkResult } from './modelProvider';
import { OpenAIClient, type OpenAIClientOptions } from './openaiClient';
import { ensureSentence, normalizeText } from './textSignals';
export interface OpenAIStoryClusterProviderOptions extends OpenAIClientOptions {
  textModel?: string;
  embeddingModel?: string;
}
const DEFAULT_TEXT_MODEL = 'gpt-4o-mini', DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const VALID_DOCUMENT_TYPES = new Set(['breaking_update', 'wire_report', 'hard_news', 'video_clip', 'liveblog', 'analysis', 'opinion', 'explainer_recap'] as const);
function chunkBySize<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}
function trimSummary(summary: string): string {
  return summary.replace(/\s+/g, ' ').trim();
}
function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, Number(value.toFixed(6))));
}
function judgementDecision(value: unknown): PairJudgementWorkResult['decision'] {
  return value === 'accepted' || value === 'rejected' || value === 'abstain' ? value : 'abstain';
}
function normalizeKeyList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return [...new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => normalizeText(value).replace(/\s+/g, '_'))
    .filter(Boolean))].sort();
}
function normalizeDocType(value: unknown): DocumentAnalysisWorkResult['doc_type'] {
  return typeof value === 'string' && VALID_DOCUMENT_TYPES.has(value as DocumentAnalysisWorkResult['doc_type'])
    ? value as DocumentAnalysisWorkResult['doc_type']
    : 'hard_news';
}
function normalizeMaybeText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function normalizeEventTuple(value: unknown): DocumentAnalysisWorkResult['event_tuple'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const tuple = value as Record<string, unknown>;
  const whenIso = normalizeMaybeText(tuple.when_iso);
  const whenMs = whenIso ? Date.parse(whenIso) : NaN;
  return {
    description: normalizeMaybeText(tuple.description) ?? '',
    trigger: normalizeMaybeText(tuple.trigger),
    who: normalizeKeyList(tuple.who),
    where: normalizeKeyList(tuple.where),
    when_ms: Number.isFinite(whenMs) ? whenMs : null,
    outcome: normalizeMaybeText(tuple.outcome),
  };
}
async function collectWithRetry<TRequest, TResult>(
  chunk: readonly TRequest[],
  request: (items: readonly TRequest[]) => Promise<TResult[]>,
  requestId: (item: TRequest) => string,
  resultId: (item: TResult) => string,
  fallback: (item: TRequest) => TResult,
): Promise<TResult[]> {
  const firstPass = await request(chunk);
  const resultsById = new Map(firstPass.map((item) => [resultId(item), item]));
  const missing = chunk.filter((item) => !resultsById.has(requestId(item)));
  if (missing.length > 0) {
    const retryPass = await request(missing);
    retryPass.forEach((item) => {
      resultsById.set(resultId(item), item);
    });
  }
  return chunk.map((item) => resultsById.get(requestId(item)) ?? fallback(item));
}
function defaultAnalysisResult(item: DocumentAnalysisWorkItem): DocumentAnalysisWorkResult {
  const entityHints = normalizeKeyList(item.entity_hints);
  return {
    doc_id: item.doc_id,
    doc_type: 'hard_news',
    entities: entityHints,
    linked_entities: entityHints,
    locations: [],
    temporal_ms: null,
    trigger: null,
    event_tuple: {
      description: item.title.trim(),
      trigger: null,
      who: entityHints,
      where: [],
      when_ms: null,
      outcome: normalizeMaybeText(item.summary),
    },
  };
}
export class OpenAIStoryClusterProvider implements StoryClusterModelProvider {
  readonly providerId = 'openai-storycluster';
  private readonly client: OpenAIClient;
  private readonly textModel: string;
  private readonly embeddingModel: string;
  constructor(options: OpenAIStoryClusterProviderOptions) {
    this.client = new OpenAIClient(options);
    this.textModel = options.textModel?.trim() || DEFAULT_TEXT_MODEL;
    this.embeddingModel = options.embeddingModel?.trim() || DEFAULT_EMBEDDING_MODEL;
  }
  async translate(items: TranslationWorkItem[]): Promise<TranslationWorkResult[]> {
    if (items.length === 0) {
      return [];
    }
    const chunks = chunkBySize(items, 8);
    const output: TranslationWorkResult[] = [];
    for (const chunk of chunks) {
      output.push(...await collectWithRetry(
        chunk,
        async (pending) => {
          const response = await this.client.chatJson<{ translations?: TranslationWorkResult[] }>({
            model: this.textModel,
            system: ['You translate news text into concise, faithful English.', 'Return strict JSON: {"translations":[{"doc_id":"...","translated_text":"..."}]}.', 'Preserve proper nouns, dates, locations, and event wording. No commentary.'].join(' '),
            user: JSON.stringify({ translations: pending }),
            temperature: 0,
            maxTokens: 4_000,
          });
          return (response.translations ?? []).map((item) => ({
            doc_id: item.doc_id,
            translated_text: trimSummary(item.translated_text),
          }));
        },
        (item) => item.doc_id,
        (item) => item.doc_id,
        (item) => ({
          doc_id: item.doc_id,
          translated_text: trimSummary(item.text),
        }),
      ));
    }
    return output;
  }
  async embed(items: EmbeddingWorkItem[], dimensions: number): Promise<EmbeddingWorkResult[]> {
    if (items.length === 0) {
      return [];
    }
    const chunks = chunkBySize(items, 64);
    const output: EmbeddingWorkResult[] = [];
    for (const chunk of chunks) {
      const vectors = await this.client.embed({
        model: this.embeddingModel,
        texts: chunk.map((item) => item.text),
        dimensions,
      });
      chunk.forEach((item, index) => {
        output.push({
          item_id: item.item_id,
          vector: vectors[index] ?? [],
        });
      });
    }
    return output;
  }
  async analyzeDocuments(items: DocumentAnalysisWorkItem[]): Promise<DocumentAnalysisWorkResult[]> {
    if (items.length === 0) {
      return [];
    }
    const chunks = chunkBySize(items, 6);
    const output: DocumentAnalysisWorkResult[] = [];
    for (const chunk of chunks) {
      output.push(...await collectWithRetry(
        chunk,
        async (pending) => {
          const response = await this.client.chatJson<{
            documents?: Array<{
              doc_id: string;
              doc_type?: string;
              entities?: unknown;
              linked_entities?: unknown;
              locations?: unknown;
              temporal_iso?: string | null;
              trigger?: string | null;
              event_tuple?: unknown;
            }>;
          }>({
            model: this.textModel,
            system: ['You analyze news documents for event clustering.', 'Return strict JSON: {"documents":[{"doc_id":"...","doc_type":"breaking_update|wire_report|hard_news|video_clip|liveblog|analysis|opinion|explainer_recap","entities":["..."],"linked_entities":["..."],"locations":["..."],"temporal_iso":"ISO-8601 or null","trigger":"token or null","event_tuple":{"description":"...","trigger":"...","who":["..."],"where":["..."],"when_iso":"ISO-8601 or null","outcome":"..."}}]}.', 'Entities, linked_entities, and locations must be concise canonical keys using lowercase words.', 'Use doc_type=video_clip for video pages or clips, analysis for analytical reporting, opinion for commentary, wire_report for wire copy, hard_news for straight reports.'].join(' '),
            user: JSON.stringify({ documents: pending }),
            temperature: 0,
            maxTokens: 4_000,
          });
          return (response.documents ?? []).map((item) => {
            const temporalIso = normalizeMaybeText(item.temporal_iso);
            const temporalMs = temporalIso ? Date.parse(temporalIso) : NaN;
            return {
              doc_id: item.doc_id,
              doc_type: normalizeDocType(item.doc_type),
              entities: normalizeKeyList(item.entities),
              linked_entities: normalizeKeyList(item.linked_entities),
              locations: normalizeKeyList(item.locations),
              temporal_ms: Number.isFinite(temporalMs) ? temporalMs : null,
              trigger: normalizeMaybeText(item.trigger),
              event_tuple: normalizeEventTuple(item.event_tuple),
            };
          });
        },
        (item) => item.doc_id,
        (item) => item.doc_id,
        defaultAnalysisResult,
      ));
    }
    return output;
  }
  async rerankPairs(items: PairJudgementWorkItem[]): Promise<PairRerankWorkResult[]> {
    if (items.length === 0) {
      return [];
    }
    const chunks = chunkBySize(items, 8);
    const output: PairRerankWorkResult[] = [];
    for (const chunk of chunks) {
      output.push(...await collectWithRetry<PairJudgementWorkItem, PairRerankWorkResult>(
        chunk,
        async (pending) => {
          const response = await this.client.chatJson<{ reranks?: Array<{ pair_id: string; score: number }> }>({
            model: this.textModel,
            system: ['You rerank document-to-cluster candidate pairs for same-event news clustering.', 'Return strict JSON: {"reranks":[{"pair_id":"...","score":0.0}]}.', 'score must be a calibrated 0..1 same-event similarity score.', 'Do not make final acceptance decisions here. Use the score only for ordering and margin comparison.'].join(' '),
            user: JSON.stringify({ rerank_pairs: pending }),
            temperature: 0,
            maxTokens: 4_000,
          });
          return (response.reranks ?? []).map((item) => ({
            pair_id: item.pair_id,
            score: clampScore(item.score),
          }));
        },
        (item) => item.pair_id,
        (item) => item.pair_id,
        (item) => ({
          pair_id: item.pair_id,
          score: 0,
        }),
      ));
    }
    return output;
  }
  async adjudicatePairs(items: PairJudgementWorkItem[]): Promise<PairJudgementWorkResult[]> {
    if (items.length === 0) {
      return [];
    }
    const chunks = chunkBySize(items, 8);
    const output: PairJudgementWorkResult[] = [];
    for (const chunk of chunks) {
      output.push(...await collectWithRetry<PairJudgementWorkItem, PairJudgementWorkResult>(
        chunk,
        async (pending) => {
          const response = await this.client.chatJson<{ judgements?: Array<{ pair_id: string; score: number; decision: string }> }>({
            model: this.textModel,
            system: ['You evaluate whether a news document belongs to an existing event cluster.', 'Use these decisions only: accepted, rejected, abstain.', 'Return strict JSON: {"judgements":[{"pair_id":"...","score":0.0,"decision":"accepted|rejected|abstain"}]}.', 'accepted means the same discrete event or its direct, time-bounded consequences are being covered.', 'reject topic-only links such as background explainers, opinion, analysis-only framing, or commentary that is not reporting the same event.', 'abstain means the items are near the same topic but event identity is still ambiguous.'].join(' '),
            user: JSON.stringify({ adjudication_pairs: pending }),
            temperature: 0,
            maxTokens: 4_000,
          });
          return (response.judgements ?? []).map((item) => ({
            pair_id: item.pair_id,
            score: clampScore(item.score),
            decision: judgementDecision(item.decision),
          }));
        },
        (item) => item.pair_id,
        (item) => item.pair_id,
        (item) => ({
          pair_id: item.pair_id,
          score: 0,
          decision: 'abstain' as const,
        }),
      ));
    }
    return output;
  }
  async summarize(items: SummaryWorkItem[]): Promise<SummaryWorkResult[]> {
    if (items.length === 0) {
      return [];
    }
    const chunks = chunkBySize(items, 6);
    const output: SummaryWorkResult[] = [];
    for (const chunk of chunks) {
      output.push(...await collectWithRetry(
        chunk,
        async (pending) => {
          const response = await this.client.chatJson<{ summaries?: SummaryWorkResult[] }>({
            model: this.textModel,
            system: ['You write canonical event summaries for a news clustering system.', 'Each summary must be 2-3 sentences, factual, neutral, and specific to the event.', 'Return strict JSON: {"summaries":[{"cluster_id":"...","summary":"..."}]}.'].join(' '),
            user: JSON.stringify({ clusters: pending }),
            temperature: 0.1,
            maxTokens: 4_000,
          });
          return (response.summaries ?? []).map((item) => ({
            cluster_id: item.cluster_id,
            summary: trimSummary(item.summary),
          }));
        },
        (item) => item.cluster_id,
        (item) => item.cluster_id,
        (item) => ({
          cluster_id: item.cluster_id,
          summary: ensureSentence(trimSummary(item.source_summaries[0] ?? item.headline)),
        }),
      ));
    }
    return output;
  }
}
export function createOpenAIStoryClusterProviderFromEnv(
  options: Omit<OpenAIStoryClusterProviderOptions, 'apiKey'> = {},
): OpenAIStoryClusterProvider {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for StoryCluster provider');
  }
  return new OpenAIStoryClusterProvider({
    ...options,
    apiKey,
    textModel: options.textModel ?? process.env.VH_STORYCLUSTER_TEXT_MODEL,
    embeddingModel: options.embeddingModel ?? process.env.VH_STORYCLUSTER_EMBEDDING_MODEL,
    baseUrl: options.baseUrl ?? process.env.VH_STORYCLUSTER_OPENAI_BASE_URL,
  });
}
