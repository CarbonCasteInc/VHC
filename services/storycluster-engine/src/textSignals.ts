import { seededHash32, stableNumericSeed } from './hashUtils';

const WORD_STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'for', 'with', 'from', 'into', 'onto', 'over', 'under',
  'about', 'after', 'before', 'between', 'during', 'while', 'amid', 'via', 'in', 'on', 'at',
  'to', 'of', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this',
  'that', 'these', 'those', 'as', 'if', 'then', 'than', 'so', 'can', 'could', 'should', 'would',
  'may', 'might', 'will', 'just', 'also', 'more', 'most', 'less', 'least', 'says', 'said', 'say',
  'reports', 'report', 'news', 'update', 'updates', 'live', 'breaking', 'developing',
]);

export function normalizeText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeWords(input: string, minimumLength = 2): string[] {
  return normalizeText(input)
    .split(' ')
    .filter((token) => token.length >= minimumLength && !WORD_STOP_WORDS.has(token));
}

export function splitSentences(input: string): string[] {
  return input
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function ensureSentence(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 'Story update available.';
  }
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

export function buildWordShingles(input: string, size = 4): string[] {
  const tokens = tokenizeWords(input, 2);
  if (tokens.length <= size) {
    return tokens.length === 0 ? [] : [tokens.join(' ')];
  }

  const shingles: string[] = [];
  for (let index = 0; index <= tokens.length - size; index += 1) {
    shingles.push(tokens.slice(index, index + size).join(' '));
  }
  return shingles;
}

export function minhashSignature(input: string, size = 32): number[] {
  const shingles = buildWordShingles(input, 4);
  if (shingles.length === 0) {
    return Array.from({ length: size }, (_, index) => stableNumericSeed(`${input}:${index}`));
  }

  return Array.from({ length: size }, (_, index) => {
    let minimum = Number.MAX_SAFE_INTEGER;
    for (const shingle of shingles) {
      const value = seededHash32(shingle, 0x811c9dc5 ^ (index + 1));
      if (value < minimum) {
        minimum = value;
      }
    }
    return minimum;
  });
}

export function signatureSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const length = Math.min(left.length, right.length);
  let matches = 0;
  for (let index = 0; index < length; index += 1) {
    if (left[index] === right[index]) {
      matches += 1;
    }
  }
  return matches / length;
}

function pushHashed(vector: Float64Array, token: string, signSeed: number): void {
  const hash = seededHash32(token, signSeed);
  const index = hash % vector.length;
  const sign = (hash & 1) === 0 ? 1 : -1;
  vector[index]! += sign;
}

function addCharacterNgrams(vector: Float64Array, text: string): void {
  const compact = normalizeText(text).slice(0, 512).replace(/\s+/g, '_');
  if (compact.length < 3) {
    return;
  }

  for (let size = 3; size <= 5; size += 1) {
    if (compact.length < size) {
      continue;
    }
    for (let index = 0; index <= compact.length - size; index += 1) {
      pushHashed(vector, compact.slice(index, index + size), 0x9e3779b9 ^ size);
    }
  }
}

export function createHashedVector(input: string, dimensions: number): number[] {
  const vector = new Float64Array(dimensions);
  const normalized = normalizeText(input);
  for (const token of tokenizeWords(normalized, 2)) {
    pushHashed(vector, token, 0x811c9dc5);
  }
  addCharacterNgrams(vector, normalized);

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) {
    return Array.from(vector);
  }
  return Array.from(vector, (value) => Number((value / magnitude).toFixed(6)));
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  const length = Math.max(left.length, right.length);
  if (length === 0) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

export function jaccardSimilarity(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }
  const union = leftSet.size + rightSet.size - intersection;
  return intersection / union;
}

export function overlapRatio(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let shared = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      shared += 1;
    }
  }
  return shared / Math.max(1, Math.min(leftSet.size, rightSet.size));
}
