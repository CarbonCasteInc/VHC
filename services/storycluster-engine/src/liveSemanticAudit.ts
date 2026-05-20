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
const MISSING_PAIR_LABEL_RETRY_LIMIT = 2;

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

function canonicalUrlKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

function exactSourceDuplicate(left: LiveSemanticAuditPair, right?: never): boolean;
function exactSourceDuplicate(left: LiveSemanticAuditSource, right: LiveSemanticAuditSource): boolean;
function exactSourceDuplicate(
  left: LiveSemanticAuditPair | LiveSemanticAuditSource,
  maybeRight?: LiveSemanticAuditSource,
): boolean {
  const leftSource = 'left' in left ? left.left : left;
  const rightSource = 'right' in left ? left.right : maybeRight;
  if (!rightSource) {
    return false;
  }
  return (
    leftSource.url_hash.trim().length > 0 &&
    leftSource.url_hash === rightSource.url_hash
  ) || (
    canonicalUrlKey(leftSource.url) === canonicalUrlKey(rightSource.url)
  );
}

function buildExactDuplicateResult(pair: LiveSemanticAuditPair): LiveSemanticAuditPairResult {
  return {
    pair_id: pair.pair_id,
    label: 'duplicate',
    confidence: 1,
    rationale: 'Exact duplicate source URL or URL hash across publisher feeds.',
  };
}

const ELECTION_RESULT_TERMS = [
  'best',
  'bests',
  'beat',
  'beats',
  'defeat',
  'defeats',
  'nomination',
  'nominee',
  'oust',
  'ousted',
  'ousts',
  'prevail',
  'prevails',
  'unseat',
  'unseated',
  'unseats',
  'win',
  'wins',
  'won',
] as const;

const ELECTION_RACE_TERMS = [
  'candidate',
  'election',
  'governor',
  'governor\'s',
  'gubernatorial',
  'gop',
  'nomination',
  'nominee',
  'primary',
  'race',
  'seat',
  'senate',
] as const;

const ELECTION_MATCHUP_PHRASES = [
  'face off',
  'faces off',
  'facing off',
  'matchup',
  'match up',
  'race between',
  'set for',
  'set to face',
  'showdown',
] as const;

const LOW_SIGNAL_PROPER_BIGRAMS = new Set([
  'Donald Trump',
  'President Trump',
  'White House',
  'United States',
]);

function normalizedSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/[^a-z0-9']+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsAnyTerm(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => new RegExp(`\\b${term}\\b`, 'i').test(text));
}

function containsAnyPhrase(text: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase));
}

function extractProperBigrams(...values: readonly string[]): Set<string> {
  const bigrams = new Set<string>();
  const pattern = /\b([A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?)\s+([A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?)\b/g;
  for (const value of values) {
    for (const match of value.matchAll(pattern)) {
      const bigram = `${match[1]} ${match[2]}`;
      if (!LOW_SIGNAL_PROPER_BIGRAMS.has(bigram)) {
        bigrams.add(bigram);
      }
    }
  }
  return bigrams;
}

function extractCandidateNameTokens(...values: readonly string[]): Set<string> {
  const tokens = new Set<string>();
  for (const bigram of extractProperBigrams(...values)) {
    for (const part of bigram.split(/\s+/)) {
      if (part.length >= 4) {
        tokens.add(part.toLowerCase());
      }
    }
  }
  const pattern = /\b[A-Z][a-z]{3,}\b/g;
  for (const value of values) {
    for (const match of value.matchAll(pattern)) {
      const token = match[0];
      if (!['Donald', 'President', 'Trump', 'White', 'House', 'United', 'States'].includes(token)) {
        tokens.add(token.toLowerCase());
      }
    }
  }
  return tokens;
}

function intersects(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }
  return false;
}

function isClearSameElectionResultPair(pair: LiveSemanticAuditPair): boolean {
  const leftEvidence = normalizedSearchText(`${pair.left.title} ${pair.left.text.slice(0, 800)}`);
  const rightEvidence = normalizedSearchText(`${pair.right.title} ${pair.right.text.slice(0, 800)}`);
  if (!containsAnyTerm(leftEvidence, ELECTION_RESULT_TERMS) || !containsAnyTerm(rightEvidence, ELECTION_RESULT_TERMS)) {
    return false;
  }
  if (!containsAnyTerm(leftEvidence, ELECTION_RACE_TERMS) || !containsAnyTerm(rightEvidence, ELECTION_RACE_TERMS)) {
    return false;
  }

  const leftActors = extractProperBigrams(pair.left.title, pair.story_headline, pair.left.text.slice(0, 600));
  const rightActors = extractProperBigrams(pair.right.title, pair.story_headline, pair.right.text.slice(0, 600));
  if (!intersects(leftActors, rightActors)) {
    return false;
  }

  const sharedRaceTerms = ELECTION_RACE_TERMS.filter((term) =>
    new RegExp(`\\b${term}\\b`, 'i').test(leftEvidence) && new RegExp(`\\b${term}\\b`, 'i').test(rightEvidence));
  return sharedRaceTerms.length > 0;
}

function isClearSameElectionMatchupPair(pair: LiveSemanticAuditPair): boolean {
  const leftEvidence = normalizedSearchText(`${pair.left.title} ${pair.left.text.slice(0, 800)}`);
  const rightEvidence = normalizedSearchText(`${pair.right.title} ${pair.right.text.slice(0, 800)}`);
  if (!containsAnyPhrase(leftEvidence, ELECTION_MATCHUP_PHRASES) || !containsAnyPhrase(rightEvidence, ELECTION_MATCHUP_PHRASES)) {
    return false;
  }
  if (!containsAnyTerm(leftEvidence, ELECTION_RACE_TERMS) || !containsAnyTerm(rightEvidence, ELECTION_RACE_TERMS)) {
    return false;
  }
  const leftCandidates = extractCandidateNameTokens(pair.left.title, pair.left.text.slice(0, 800));
  const rightCandidates = extractCandidateNameTokens(pair.right.title, pair.right.text.slice(0, 800));
  let sharedCandidateCount = 0;
  for (const token of leftCandidates) {
    if (rightCandidates.has(token)) {
      sharedCandidateCount += 1;
    }
  }
  return sharedCandidateCount >= 2;
}

function applyDeterministicAuditCorrections(
  pair: LiveSemanticAuditPair,
  result: LiveSemanticAuditPairResult,
): LiveSemanticAuditPairResult {
  if (
    result.label !== 'related_topic_only'
    || (!isClearSameElectionResultPair(pair) && !isClearSameElectionMatchupPair(pair))
  ) {
    return result;
  }

  return {
    pair_id: result.pair_id,
    label: 'same_incident',
    confidence: Math.max(result.confidence, 0.9),
    rationale:
      'Deterministic audit correction: both reports describe the same election-result event with shared actor and race context.',
  };
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
): {
  results: LiveSemanticAuditPairResult[];
  missingPairs: LiveSemanticAuditPair[];
} {
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

  const results: LiveSemanticAuditPairResult[] = [];
  const missingPairs: LiveSemanticAuditPair[] = [];
  for (const pair of pendingPairs) {
    const result = byId.get(pair.pair_id);
    if (!result) {
      missingPairs.push(pair);
      continue;
    }
    results.push(result);
  }

  return {
    results,
    missingPairs,
  };
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

function buildSemanticAuditSystemPrompt(): string {
  return [
    'You audit whether two publisher reports belong in the same canonical news event bundle.',
    `Use only these labels: ${LIVE_SEMANTIC_AUDIT_LABELS.join(', ')}.`,
    'Return exactly one pair_labels entry for every supplied pair_id. Do not omit, rename, or invent pair IDs.',
    'duplicate = same facts or same asset republished with minimal new reporting.',
    'same_incident = the same discrete incident covered by different publishers.',
    'same_developing_episode = direct follow-up within the same bounded event sequence.',
    'Use same_developing_episode when both reports describe the same ongoing confrontation, escalation, negotiation, investigation, or response arc involving the same core actors and immediate trigger, even if the framing or perspective differs.',
    'Timing context is not a separate event by itself: if one report mentions a prior summit, visit, or meeting only to situate the same core upcoming meeting, negotiation, or response, keep the pair in the same_developing_episode family.',
    'Different national, political, or institutional perspectives alone are not enough to downgrade a pair to related_topic_only when both reports still describe the same episode.',
    'related_topic_only = same broader topic, conflict, politician, or narrative, but not the same discrete event/episode.',
    'Broad roundups, explainers, opinion, and commentary paired with a specific incident report are usually related_topic_only.',
    'Be conservative: when uncertain, choose related_topic_only.',
    'Return strict JSON: {"pair_labels":[{"pair_id":"...","label":"duplicate|same_incident|same_developing_episode|related_topic_only","confidence":0.0,"rationale":"..."}]}.',
  ].join(' ');
}

function buildPairLabelRequest(pairs: readonly LiveSemanticAuditPair[]) {
  return JSON.stringify({
    required_pair_ids: pairs.map((pair) => pair.pair_id),
    pair_labels: pairs.map(requestPayload),
  });
}

async function classifyPairBatch(
  client: OpenAIClient,
  model: string,
  batch: readonly LiveSemanticAuditPair[],
): Promise<LiveSemanticAuditPairResult[]> {
  const resultsByPairId = new Map<string, LiveSemanticAuditPairResult>();
  let pendingPairs = [...batch];

  for (let attempt = 0; attempt <= MISSING_PAIR_LABEL_RETRY_LIMIT && pendingPairs.length > 0; attempt += 1) {
    const payload = await client.chatJson<{
    pair_labels?: Array<{
      pair_id?: string;
      label?: string;
      confidence?: number;
      rationale?: string;
    }>;
    }>({
      model,
      system: buildSemanticAuditSystemPrompt(),
      user: buildPairLabelRequest(pendingPairs),
      temperature: 0,
      maxTokens: 4_000,
    });
    const parsed = parsePairResults(payload, pendingPairs);
    for (const result of parsed.results) {
      resultsByPairId.set(result.pair_id, result);
    }
    pendingPairs = parsed.missingPairs;
  }

  if (pendingPairs.length > 0) {
    throw new Error(`pair label response missing ${pendingPairs.map((pair) => pair.pair_id).join(', ')}`);
  }

  return batch.map((pair) => resultsByPairId.get(pair.pair_id)!);
}

export async function classifyCanonicalSourcePairs(
  pairs: readonly LiveSemanticAuditPair[],
  options: LiveSemanticAuditClassifierOptions,
): Promise<LiveSemanticAuditPairResult[]> {
  if (pairs.length === 0) {
    return [];
  }

  const exactDuplicateResults = new Map(
    pairs
      .filter((pair) => exactSourceDuplicate(pair))
      .map((pair) => [pair.pair_id, buildExactDuplicateResult(pair)] as const),
  );
  const classifierPairs = pairs.filter((pair) => !exactDuplicateResults.has(pair.pair_id));
  if (classifierPairs.length === 0) {
    return pairs.map((pair) => exactDuplicateResults.get(pair.pair_id)!);
  }

  const client = new OpenAIClient(options);
  const model = options.model?.trim() || DEFAULT_AUDIT_MODEL;
  const batches = chunk(classifierPairs, MAX_PAIRS_PER_REQUEST);
  const batchResults = await mapWithConcurrency(
    batches,
    CLASSIFIER_BATCH_CONCURRENCY,
    async (batch) => classifyPairBatch(client, model, batch),
  );

  const classifierResults = new Map(batchResults.flat().map((result) => [result.pair_id, result]));
  return pairs.map((pair) => exactDuplicateResults.get(pair.pair_id)
    ?? applyDeterministicAuditCorrections(pair, classifierResults.get(pair.pair_id)!));
}

export function hasRelatedTopicOnlyPair(results: readonly LiveSemanticAuditPairResult[]): boolean {
  return results.some((result) => result.label === 'related_topic_only');
}

export const liveSemanticAuditInternal = {
  buildPairLabelRequest,
  buildSemanticAuditSystemPrompt,
  exactSourceDuplicate,
  isClearSameElectionMatchupPair,
  isClearSameElectionResultPair,
};
