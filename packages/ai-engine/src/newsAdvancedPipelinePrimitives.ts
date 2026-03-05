import type { StoryBundle } from './newsTypes';
import type { StoryAdvancedPipelineOptions } from './newsAdvancedPipelineTypes';

const DEFAULT_REFINEMENT_PERIOD_MS = 30 * 60 * 1000;
const DEFAULT_MAX_TUPLES = 24;

const STOP_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'has',
  'have',
  'in',
  'into',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'their',
  'this',
  'to',
  'was',
  'were',
  'with',
]);

export interface NormalizedAdvancedOptions {
  readonly referenceNowMs: number;
  readonly refinementPeriodMs: number;
  readonly maxTuples: number;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

export function roundMetric(value: number): number {
  return Math.round(clamp01(value) * 1_000_000) / 1_000_000;
}

export function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function tokenize(value: string): string[] {
  return normalizeToken(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

export function titleCaseLabel(value: string): string {
  return tokenize(value)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ')
    .trim();
}

export function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

export function jaccardDistance(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 && right.size === 0) {
    return 0;
  }
  if (left.size === 0 || right.size === 0) {
    return 1;
  }

  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) {
      intersection += 1;
    }
  }

  const union = left.size + right.size - intersection;
  return 1 - intersection / union;
}

export function normalizeOptions(
  bundle: StoryBundle,
  options: StoryAdvancedPipelineOptions | undefined,
): NormalizedAdvancedOptions {
  const fallbackNow = Number.isFinite(bundle.cluster_window_end) ? bundle.cluster_window_end : 0;
  const referenceNowMs =
    typeof options?.referenceNowMs === 'number' && Number.isFinite(options.referenceNowMs) && options.referenceNowMs >= 0
      ? Math.floor(options.referenceNowMs)
      : fallbackNow;

  const refinementPeriodMs =
    typeof options?.refinementPeriodMs === 'number' &&
      Number.isFinite(options.refinementPeriodMs) &&
      options.refinementPeriodMs > 0
      ? Math.max(60_000, Math.floor(options.refinementPeriodMs))
      : DEFAULT_REFINEMENT_PERIOD_MS;

  const maxTuples =
    typeof options?.maxTuples === 'number' && Number.isFinite(options.maxTuples) && options.maxTuples > 0
      ? Math.max(1, Math.floor(options.maxTuples))
      : DEFAULT_MAX_TUPLES;

  return {
    referenceNowMs,
    refinementPeriodMs,
    maxTuples,
  };
}
