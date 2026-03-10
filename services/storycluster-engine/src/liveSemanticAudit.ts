import { OpenAIClient, type OpenAIClientOptions } from './openaiClient';

export const LIVE_SEMANTIC_AUDIT_LABELS = [
  'duplicate',
  'same_incident',
  'same_developing_episode',
  'related_topic_only',
] as const;

export type LiveSemanticAuditLabel = (typeof LIVE_SEMANTIC_AUDIT_LABELS)[number];

export interface LiveSemanticAuditSource {
  readonly source_id: string;
  readonly publisher: string;
  readonly url: string;
  readonly url_hash: string;
  readonly published_at?: number;
  readonly title: string;
  readonly text: string;
}

export interface LiveSemanticAuditBundleLike {
  readonly story_id: string;
  readonly topic_id: string;
  readonly headline: string;
  readonly sources: ReadonlyArray<Omit<LiveSemanticAuditSource, 'text'>>;
  readonly primary_sources?: ReadonlyArray<Omit<LiveSemanticAuditSource, 'text'>>;
  readonly secondary_assets?: ReadonlyArray<Omit<LiveSemanticAuditSource, 'text'>>;
}

export interface LiveSemanticAuditPair {
  readonly pair_id: string;
  readonly story_id: string;
  readonly topic_id: string;
  readonly story_headline: string;
  readonly left: LiveSemanticAuditSource;
  readonly right: LiveSemanticAuditSource;
}

export interface LiveSemanticAuditPairResult {
  readonly pair_id: string;
  readonly label: LiveSemanticAuditLabel;
  readonly confidence: number;
  readonly rationale: string;
}

export interface LiveSemanticAuditClassifierOptions extends OpenAIClientOptions {
  readonly model?: string;
}

const DEFAULT_AUDIT_MODEL = 'gpt-4o-mini';
const MAX_TEXT_CHARS = 6_000;
const MAX_PAIRS_PER_REQUEST = 4;
const CLASSIFIER_BATCH_CONCURRENCY = 3;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }
  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function run(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }
      results[currentIndex] = await worker(items[currentIndex]!, currentIndex);
    }
  }

  await Promise.all(Array.from({ length: safeConcurrency }, () => run()));
  return results;
}

function normalizeAuditLabel(value: unknown, path: string): LiveSemanticAuditLabel {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if ((LIVE_SEMANTIC_AUDIT_LABELS as readonly string[]).includes(normalized)) {
    return normalized as LiveSemanticAuditLabel;
  }
  throw new Error(`${path} must be one of ${LIVE_SEMANTIC_AUDIT_LABELS.join(', ')}`);
}

function clampConfidence(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return Number(value.toFixed(6));
}

function normalizeRationale(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${path} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${path} must be non-empty`);
  }
  return normalized;
}

function sourceKey(source: Pick<LiveSemanticAuditSource, 'source_id' | 'url_hash'>): string {
  return `${source.source_id}:${source.url_hash}`;
}

function pairId(storyId: string, left: Pick<LiveSemanticAuditSource, 'source_id' | 'url_hash'>, right: Pick<LiveSemanticAuditSource, 'source_id' | 'url_hash'>): string {
  const sorted = [sourceKey(left), sourceKey(right)].sort();
  return `${storyId}::${sorted[0]}::${sorted[1]}`;
}

function canonicalSources(bundle: LiveSemanticAuditBundleLike): ReadonlyArray<Omit<LiveSemanticAuditSource, 'text'>> {
  return (bundle.primary_sources ?? bundle.sources)
    .slice()
    .sort((left, right) =>
      `${left.publisher}:${left.source_id}:${left.url_hash}`.localeCompare(
        `${right.publisher}:${right.source_id}:${right.url_hash}`,
      ));
}

function truncateText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, MAX_TEXT_CHARS);
}

export function buildCanonicalSourcePairs(
  bundle: LiveSemanticAuditBundleLike,
  resolveText: (source: Omit<LiveSemanticAuditSource, 'text'>) => string,
): LiveSemanticAuditPair[] {
  const sources = canonicalSources(bundle);
  const hydrated = sources.map((source, index) => {
    const text = truncateText(resolveText(source));
    if (!text) {
      throw new Error(`missing audit text for canonical source ${index} (${source.source_id}) in ${bundle.story_id}`);
    }
    return { ...source, text };
  });

  const pairs: LiveSemanticAuditPair[] = [];
  for (let leftIndex = 0; leftIndex < hydrated.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < hydrated.length; rightIndex += 1) {
      const left = hydrated[leftIndex]!;
      const right = hydrated[rightIndex]!;
      pairs.push({
        pair_id: pairId(bundle.story_id, left, right),
        story_id: bundle.story_id,
        topic_id: bundle.topic_id,
        story_headline: bundle.headline,
        left,
        right,
      });
    }
  }
  return pairs;
}

function parsePairResults(
  payload: unknown,
  pendingPairs: readonly LiveSemanticAuditPair[],
): LiveSemanticAuditPairResult[] {
  const raw = (payload as { pair_labels?: unknown }).pair_labels;
  if (!Array.isArray(raw)) {
    throw new Error('pair label response must include pair_labels');
  }

  const byId = new Map<string, LiveSemanticAuditPairResult>();
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`pair_labels[${index}] must be an object`);
    }
    const record = item as Record<string, unknown>;
    const pairIdValue = typeof record.pair_id === 'string' ? record.pair_id.trim() : '';
    if (!pairIdValue) {
      throw new Error(`pair_labels[${index}].pair_id must be non-empty`);
    }
    byId.set(pairIdValue, {
      pair_id: pairIdValue,
      label: normalizeAuditLabel(record.label, `pair_labels[${index}].label`),
      confidence: clampConfidence(record.confidence, `pair_labels[${index}].confidence`),
      rationale: normalizeRationale(record.rationale, `pair_labels[${index}].rationale`),
    });
  }

  return pendingPairs.map((pair) => {
    const result = byId.get(pair.pair_id);
    if (!result) {
      throw new Error(`pair label response missing ${pair.pair_id}`);
    }
    return result;
  });
}

function requestPayload(pair: LiveSemanticAuditPair) {
  return {
    pair_id: pair.pair_id,
    story_id: pair.story_id,
    story_headline: pair.story_headline,
    left: {
      publisher: pair.left.publisher,
      title: pair.left.title,
      published_at: pair.left.published_at ?? null,
      url: pair.left.url,
      text: pair.left.text,
    },
    right: {
      publisher: pair.right.publisher,
      title: pair.right.title,
      published_at: pair.right.published_at ?? null,
      url: pair.right.url,
      text: pair.right.text,
    },
  };
}

export async function classifyCanonicalSourcePairs(
  pairs: readonly LiveSemanticAuditPair[],
  options: LiveSemanticAuditClassifierOptions,
): Promise<LiveSemanticAuditPairResult[]> {
  if (pairs.length === 0) {
    return [];
  }

  const client = new OpenAIClient(options);
  const model = options.model?.trim() || DEFAULT_AUDIT_MODEL;
  const batches = chunk(pairs, MAX_PAIRS_PER_REQUEST);
  const batchResults = await mapWithConcurrency(
    batches,
    CLASSIFIER_BATCH_CONCURRENCY,
    async (batch) => {
      const payload = await client.chatJson<{
      pair_labels?: Array<{
        pair_id?: string;
        label?: string;
        confidence?: number;
        rationale?: string;
      }>;
      }>({
        model,
        system: [
          'You audit whether two publisher reports belong in the same canonical news event bundle.',
          `Use only these labels: ${LIVE_SEMANTIC_AUDIT_LABELS.join(', ')}.`,
          'duplicate = same facts or same asset republished with minimal new reporting.',
          'same_incident = the same discrete incident covered by different publishers.',
          'same_developing_episode = direct follow-up within the same bounded event sequence.',
          'related_topic_only = same broader topic, conflict, politician, or narrative, but not the same discrete event/episode.',
          'Be conservative: when uncertain, choose related_topic_only.',
          'Broad roundups, explainers, opinion, and commentary paired with a specific incident report are usually related_topic_only.',
          'Return strict JSON: {"pair_labels":[{"pair_id":"...","label":"duplicate|same_incident|same_developing_episode|related_topic_only","confidence":0.0,"rationale":"..."}]}.',
        ].join(' '),
        user: JSON.stringify({ pair_labels: batch.map(requestPayload) }),
        temperature: 0,
        maxTokens: 4_000,
      });
      return parsePairResults(payload, batch);
    },
  );

  return batchResults.flat();
}

export function hasRelatedTopicOnlyPair(results: readonly LiveSemanticAuditPairResult[]): boolean {
  return results.some((result) => result.label === 'related_topic_only');
}
