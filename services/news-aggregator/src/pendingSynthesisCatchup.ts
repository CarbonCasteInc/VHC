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
  readonly candidates: readonly PendingSynthesisCatchupCandidate[];
}

export interface PendingSynthesisCatchupOptions {
  readonly limit?: number;
  readonly now?: () => number;
  readonly model?: string;
  readonly logger?: LoggerLike;
  readonly readLatestPage?: typeof readNewsLatestIndexPageWithRelayRestFallback;
  readonly readStory?: typeof readNewsStoryWithRelayRestFallback;
  readonly readLifecycle?: typeof readNewsSynthesisLifecycleStatusWithRelayRestFallback;
}

const SYNTHESIS_CATCHUP_PROMPT = 'public-news-bundle-synthesis-catchup';
const SYNTHESIS_CATCHUP_PROVIDER_ID = 'remote-analysis';

function positiveLimit(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : fallback;
}

export function isStoryPendingSynthesisCatchup(input: {
  readonly story: StoryBundle;
  readonly lifecycle: NewsSynthesisLifecycleRecord | null;
}): input is { story: StoryBundle; lifecycle: NewsSynthesisLifecycleRecord } {
  return Boolean(
    input.lifecycle
      && input.lifecycle.story_id === input.story.story_id
      && input.lifecycle.source_set_revision === input.story.provenance_hash
      && (input.lifecycle.status === 'pending' || input.lifecycle.status === 'retryable_failure'),
  );
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
  const page = await readLatestPage(client, { limit });
  const storyIds = Object.keys(page.index);
  const candidates: PendingSynthesisCatchupCandidate[] = [];
  let skipped = 0;

  for (const storyId of storyIds) {
    const story = page.stories?.[storyId] ?? await readStory(client, storyId).catch(() => null);
    if (!story) {
      skipped += 1;
      continue;
    }
    const lifecycle = await readLifecycle(client, storyId).catch(() => null);
    const eligibility = { story, lifecycle };
    if (!isStoryPendingSynthesisCatchup(eligibility)) {
      skipped += 1;
      continue;
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
  });

  return {
    scanned: storyIds.length,
    enqueued: candidates.length,
    skipped,
    candidates,
  };
}
