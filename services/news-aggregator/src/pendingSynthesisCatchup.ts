import type { NewsRuntimeSynthesisCandidate } from '@vh/ai-engine';
import type { StoryBundle } from '@vh/data-model';
import {
  readNewsLatestIndexPageWithRelayRestFallback,
  readNewsStoryWithRelayRestFallback,
  readNewsSynthesisLifecycleStatusWithRelayRestFallback,
  type NewsSynthesisLifecycleRecord,
  type VennClient,
} from '@vh/gun-client';
import {
  DEFAULT_BUNDLE_SYNTHESIS_MAX_TOKENS,
  DEFAULT_BUNDLE_SYNTHESIS_MODEL,
  DEFAULT_BUNDLE_SYNTHESIS_TEMPERATURE,
  getBundleSynthesisModel,
} from './bundleSynthesisRelay';
import type { LoggerLike } from './daemonUtils';

export interface PendingSynthesisCatchupCandidate {
  readonly story: StoryBundle;
  readonly lifecycle: NewsSynthesisLifecycleRecord;
  readonly candidate: NewsRuntimeSynthesisCandidate;
}

export interface PendingSynthesisCatchupResult {
  readonly scanned: number;
  readonly enqueued: number;
  readonly skipped: number;
  readonly staleInProgress: number;
  readonly candidates: readonly PendingSynthesisCatchupCandidate[];
}

export interface PendingSynthesisCatchupOptions {
  readonly limit?: number;
  readonly now?: () => number;
  readonly model?: string;
  readonly staleInProgressMs?: number;
  readonly logger?: LoggerLike;
  readonly readLatestPage?: typeof readNewsLatestIndexPageWithRelayRestFallback;
  readonly readStory?: typeof readNewsStoryWithRelayRestFallback;
  readonly readLifecycle?: typeof readNewsSynthesisLifecycleStatusWithRelayRestFallback;
}

const SYNTHESIS_CATCHUP_PROMPT = 'public-news-bundle-synthesis-catchup';
const SYNTHESIS_CATCHUP_PROVIDER_ID = 'remote-analysis';
export const DEFAULT_SYNTHESIS_IN_PROGRESS_STALE_MS = 10 * 60 * 1000;

function positiveLimit(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : fallback;
}

function staleInProgressMs(value: number | undefined): number {
  return positiveLimit(value, DEFAULT_SYNTHESIS_IN_PROGRESS_STALE_MS);
}

function lifecycleIsStaleInProgress(
  lifecycle: NewsSynthesisLifecycleRecord,
  nowMs: number,
  staleWindowMs: number,
): boolean {
  if (lifecycle.status !== 'in_progress') {
    return false;
  }
  const updatedAt = Number(lifecycle.updated_at);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
    return true;
  }
  return Math.max(0, Math.floor(nowMs - updatedAt)) > staleWindowMs;
}

export function isStoryPendingSynthesisCatchup(input: {
  readonly story: StoryBundle;
  readonly lifecycle: NewsSynthesisLifecycleRecord | null;
}, options: {
  readonly nowMs?: number;
  readonly staleInProgressMs?: number;
} = {}): input is { story: StoryBundle; lifecycle: NewsSynthesisLifecycleRecord } {
  if (
    !input.lifecycle
    || input.lifecycle.story_id !== input.story.story_id
    || input.lifecycle.source_set_revision !== input.story.provenance_hash
  ) {
    return false;
  }
  if (input.lifecycle.status === 'pending' || input.lifecycle.status === 'retryable_failure') {
    return true;
  }
  const nowMs = Math.max(0, Math.floor(options.nowMs ?? Date.now()));
  return lifecycleIsStaleInProgress(input.lifecycle, nowMs, staleInProgressMs(options.staleInProgressMs));
}

export function buildPendingSynthesisCandidate(input: {
  readonly story: StoryBundle;
  readonly model?: string;
  readonly now?: () => number;
}): NewsRuntimeSynthesisCandidate {
  const model = input.model?.trim() || getBundleSynthesisModel() || DEFAULT_BUNDLE_SYNTHESIS_MODEL;
  const requestedAt = Math.max(0, Math.floor((input.now ?? Date.now)()));
  return {
    story_id: input.story.story_id,
    provider: {
      provider_id: SYNTHESIS_CATCHUP_PROVIDER_ID,
      model_id: model,
      kind: 'remote',
    },
    request: {
      prompt: `${SYNTHESIS_CATCHUP_PROMPT}:${input.story.story_id}`,
      model,
      max_tokens: DEFAULT_BUNDLE_SYNTHESIS_MAX_TOKENS,
      temperature: DEFAULT_BUNDLE_SYNTHESIS_TEMPERATURE,
    },
    work_items: [
      {
        story_id: input.story.story_id,
        topic_id: input.story.topic_id,
        work_type: 'full-analysis',
        summary_hint: input.story.headline,
        requested_at: requestedAt,
      },
      {
        story_id: input.story.story_id,
        topic_id: input.story.topic_id,
        work_type: 'bias-table',
        summary_hint: input.story.headline,
        requested_at: requestedAt,
      },
    ],
  };
}

export async function collectPendingSynthesisCatchupCandidates(
  client: VennClient,
  options: PendingSynthesisCatchupOptions = {},
): Promise<PendingSynthesisCatchupResult> {
  const limit = positiveLimit(options.limit, 25);
  const readLatestPage = options.readLatestPage ?? readNewsLatestIndexPageWithRelayRestFallback;
  const readStory = options.readStory ?? readNewsStoryWithRelayRestFallback;
  const readLifecycle = options.readLifecycle ?? readNewsSynthesisLifecycleStatusWithRelayRestFallback;
  const nowMs = Math.max(0, Math.floor((options.now ?? Date.now)()));
  const inProgressStaleMs = staleInProgressMs(options.staleInProgressMs);
  const page = await readLatestPage(client, { limit });
  const storyIds = Object.keys(page.index);
  const candidates: PendingSynthesisCatchupCandidate[] = [];
  let skipped = 0;
  let staleInProgress = 0;

  for (const storyId of storyIds) {
    const story = page.stories?.[storyId] ?? await readStory(client, storyId).catch(() => null);
    if (!story) {
      skipped += 1;
      continue;
    }
    const lifecycle = await readLifecycle(client, storyId).catch(() => null);
    const eligibility = { story, lifecycle };
    if (!isStoryPendingSynthesisCatchup(eligibility, { nowMs, staleInProgressMs: inProgressStaleMs })) {
      skipped += 1;
      continue;
    }
    if (eligibility.lifecycle.status === 'in_progress') {
      staleInProgress += 1;
    }
    candidates.push({
      story,
      lifecycle: eligibility.lifecycle,
      candidate: buildPendingSynthesisCandidate({
        story,
        model: options.model,
        now: options.now,
      }),
    });
  }

  options.logger?.info('[vh:bundle-synthesis] pending catch-up scan complete', {
    scanned: storyIds.length,
    enqueued: candidates.length,
    skipped,
    limit,
    stale_in_progress: staleInProgress,
    in_progress_stale_ms: inProgressStaleMs,
  });

  return {
    scanned: storyIds.length,
    enqueued: candidates.length,
    skipped,
    staleInProgress,
    candidates,
  };
}
