import { type DocumentAnalysisWorkItem, type DocumentAnalysisWorkResult, type EmbeddingWorkItem, type EmbeddingWorkResult, type PairJudgementWorkItem, type PairJudgementWorkResult, type PairRerankWorkResult, type StoryClusterModelProvider, type SummaryWorkItem, type SummaryWorkResult, type TranslationWorkItem, type TranslationWorkResult } from './modelProvider';
import { OpenAIClient, type OpenAIClientOptions } from './openaiClient';
import { normalizeDocumentType } from './contentSignals';
import { ensureSentence, normalizeText } from './textSignals';
export interface OpenAIStoryClusterProviderOptions extends OpenAIClientOptions {
  textModel?: string;
  embeddingModel?: string;
}
export const OPENAI_STORYCLUSTER_PROVIDER_ID = 'openai-storycluster';
export const DEFAULT_TEXT_MODEL = 'gpt-4o-mini';
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const PAIR_ID_MAX_LENGTH = 256;
const TITLE_MAX_LENGTH = 512;
const TEXT_MAX_LENGTH = 8_000;
const SUMMARY_MAX_LENGTH = 3_000;
const TRIGGER_MAX_LENGTH = 128;
const KEY_MAX_LENGTH = 160;
const ENTITY_LIST_MAX_ITEMS = 24;
const TRIGGER_LIST_MAX_ITEMS = 12;
const PAYLOAD_PREVIEW_MAX_LENGTH = 400;

interface PayloadSanitizationStats {
  sanitizedFieldCount: number;
  removedControlCharCount: number;
  replacedLoneSurrogateCount: number;
  truncatedFieldCount: number;
}

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
function normalizeMaybeText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function sanitizeTextForOpenAIJson(
  value: string,
  maxLength: number,
  stats: PayloadSanitizationStats,
): string {
  let sanitized = '';
  let fieldMutated = false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        sanitized += value[index] ?? '';
        sanitized += value[index + 1] ?? '';
        index += 1;
        continue;
      }
      stats.replacedLoneSurrogateCount += 1;
      sanitized += ' ';
      fieldMutated = true;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      stats.replacedLoneSurrogateCount += 1;
      sanitized += ' ';
      fieldMutated = true;
      continue;
    }
    if ((code >= 0x00 && code <= 0x08) || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f) || code === 0x7f) {
      stats.removedControlCharCount += 1;
      sanitized += ' ';
      fieldMutated = true;
      continue;
    }
    sanitized += value[index] ?? '';
  }
  const collapsed = sanitized.replace(/\s+/g, ' ').trim();
  if (collapsed !== value) {
    fieldMutated = true;
  }
  sanitized = collapsed;
  if (sanitized.length > maxLength) {
    sanitized = `${sanitized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
    stats.truncatedFieldCount += 1;
    fieldMutated = true;
  }
  if (fieldMutated) {
    stats.sanitizedFieldCount += 1;
  }
  return sanitized;
}
function sanitizeStringListForOpenAIJson(
  values: readonly string[],
  maxItems: number,
  maxLength: number,
  stats: PayloadSanitizationStats,
): string[] {
  const seen = new Set<string>();
  const sanitized: string[] = [];
  for (const value of values.slice(0, maxItems)) {
    const next = sanitizeTextForOpenAIJson(value, maxLength, stats);
    if (!next || seen.has(next)) {
      continue;
    }
    seen.add(next);
    sanitized.push(next);
  }
  return sanitized;
}
function sanitizeOptionalTextForOpenAIJson(
  value: string | null,
  maxLength: number,
  stats: PayloadSanitizationStats,
): string | null {
  if (value === null) {
    return null;
  }
  const sanitized = sanitizeTextForOpenAIJson(value, maxLength, stats);
  return sanitized || null;
}
function sanitizePairJudgementWorkItems(
  items: readonly PairJudgementWorkItem[],
): { sanitized: PairJudgementWorkItem[]; stats: PayloadSanitizationStats } {
  const stats: PayloadSanitizationStats = {
    sanitizedFieldCount: 0,
    removedControlCharCount: 0,
    replacedLoneSurrogateCount: 0,
    truncatedFieldCount: 0,
  };
  return {
    sanitized: items.map((item) => ({
      pair_id: sanitizeTextForOpenAIJson(item.pair_id, PAIR_ID_MAX_LENGTH, stats),
      document_title: sanitizeTextForOpenAIJson(item.document_title, TITLE_MAX_LENGTH, stats),
      document_text: sanitizeTextForOpenAIJson(item.document_text, TEXT_MAX_LENGTH, stats),
      document_entities: sanitizeStringListForOpenAIJson(item.document_entities, ENTITY_LIST_MAX_ITEMS, KEY_MAX_LENGTH, stats),
      document_trigger: sanitizeOptionalTextForOpenAIJson(item.document_trigger, TRIGGER_MAX_LENGTH, stats),
      cluster_headline: sanitizeTextForOpenAIJson(item.cluster_headline, TITLE_MAX_LENGTH, stats),
      cluster_summary: sanitizeTextForOpenAIJson(item.cluster_summary, SUMMARY_MAX_LENGTH, stats),
      cluster_entities: sanitizeStringListForOpenAIJson(item.cluster_entities, ENTITY_LIST_MAX_ITEMS, KEY_MAX_LENGTH, stats),
      cluster_triggers: sanitizeStringListForOpenAIJson(item.cluster_triggers, TRIGGER_LIST_MAX_ITEMS, KEY_MAX_LENGTH, stats),
    })),
    stats,
  };
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
  readonly providerId = OPENAI_STORYCLUSTER_PROVIDER_ID;
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
            system: ['You analyze news documents for event clustering.', 'Return strict JSON: {"documents":[{"doc_id":"...","doc_type":"breaking_update|wire|hard_news|video_clip|liveblog|analysis|opinion|explainer","entities":["..."],"linked_entities":["..."],"locations":["..."],"temporal_iso":"ISO-8601 or null","trigger":"token or null","event_tuple":{"description":"...","trigger":"...","who":["..."],"where":["..."],"when_iso":"ISO-8601 or null","outcome":"..."}}]}.', 'Entities, linked_entities, and locations must be concise canonical keys using lowercase words.', 'linked_entities should prefer multi-word canonical keys for the main actors and event anchors, not just generic countries.', 'trigger must reflect the lead action of the report, not a background clause introduced by phrases like "even as", "while", or "amid".', 'Use doc_type=video_clip for video pages or clips, analysis for analytical reporting, opinion for commentary, wire for wire copy, hard_news for straight reports.', 'If older internal examples mention wire_report or explainer_recap, normalize them to wire and explainer before returning JSON.'].join(' '),
            user: JSON.stringify({ documents: pending }),
            temperature: 0,
            maxTokens: 4_000,
          });
          return (response.documents ?? []).map((item) => {
            const temporalIso = normalizeMaybeText(item.temporal_iso);
            const temporalMs = temporalIso ? Date.parse(temporalIso) : NaN;
            return {
              doc_id: item.doc_id,
              doc_type: normalizeDocumentType(item.doc_type),
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
          const { sanitized, stats } = sanitizePairJudgementWorkItems(pending);
          const user = JSON.stringify({ adjudication_pairs: sanitized });
          const payloadLengthBytes = new TextEncoder().encode(user).length;
          let response;
          try {
            response = await this.client.chatJson<{ judgements?: Array<{ pair_id: string; score: number; decision: string }> }>({
              model: this.textModel,
              system: ['You evaluate whether a news document belongs to an existing event cluster.', 'Use these decisions only: accepted, rejected, abstain.', 'Return strict JSON: {"judgements":[{"pair_id":"...","score":0.0,"decision":"accepted|rejected|abstain"}]}.', 'accepted means the same discrete event or its direct, time-bounded consequences are being covered.', 'reject topic-only links such as background explainers, opinion, analysis-only framing, or commentary that is not reporting the same event.', 'Different lead actions involving the same politician, country, or conflict should be rejected unless both documents clearly report the same incident or tightly bounded follow-up.', 'abstain means the items are near the same topic but event identity is still ambiguous.'].join(' '),
              user,
              temperature: 0,
              maxTokens: 4_000,
            });
          } catch (error) {
            console.warn('[vh:storycluster] adjudicatePairs request failed', {
              pairCount: pending.length,
              pairIds: pending.map((item) => item.pair_id),
              payloadLengthBytes,
              payloadPreview: user.slice(0, PAYLOAD_PREVIEW_MAX_LENGTH),
              sanitizationStats: stats,
            });
            throw error;
          }
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
function envTimeoutMs(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

export interface OpenAIStoryClusterProviderProvenance {
  readonly providerId: typeof OPENAI_STORYCLUSTER_PROVIDER_ID;
  readonly textModelId: string;
  readonly embeddingModelId: string;
  readonly baseUrl: string | null;
  readonly timeoutMs: number | null;
}

export function resolveOpenAIStoryClusterProviderProvenanceFromEnv(
  options: Omit<OpenAIStoryClusterProviderOptions, 'apiKey'> = {},
): OpenAIStoryClusterProviderProvenance {
  const textModelId = options.textModel?.trim() || process.env.VH_STORYCLUSTER_TEXT_MODEL?.trim() || DEFAULT_TEXT_MODEL;
  const embeddingModelId = options.embeddingModel?.trim() || process.env.VH_STORYCLUSTER_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
  const baseUrl = options.baseUrl?.trim() || process.env.VH_STORYCLUSTER_OPENAI_BASE_URL?.trim() || null;
  const timeoutMs = options.timeoutMs ?? envTimeoutMs('VH_STORYCLUSTER_OPENAI_TIMEOUT_MS') ?? null;

  return {
    providerId: OPENAI_STORYCLUSTER_PROVIDER_ID,
    textModelId,
    embeddingModelId,
    baseUrl,
    timeoutMs,
  };
}

export function createOpenAIStoryClusterProviderFromEnv(
  options: Omit<OpenAIStoryClusterProviderOptions, 'apiKey'> = {},
): OpenAIStoryClusterProvider {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for StoryCluster provider');
  }
  const provenance = resolveOpenAIStoryClusterProviderProvenanceFromEnv(options);
  return new OpenAIStoryClusterProvider({
    ...options,
    apiKey,
    textModel: provenance.textModelId,
    embeddingModel: provenance.embeddingModelId,
    baseUrl: provenance.baseUrl ?? undefined,
    timeoutMs: provenance.timeoutMs ?? undefined,
  });
}
