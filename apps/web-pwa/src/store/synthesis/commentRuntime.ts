import { TopicSynthesisPipeline, type PipelineDeps, type PipelineOutput, type VerifiedComment } from '@vh/ai-engine';
import type { VennClient } from '@vh/gun-client';
import type { HermesComment, HermesThread } from '@vh/types';
import { useForumStore } from '../hermesForum';
import { setSynthesisBridgeHandler, isSynthesisV2Enabled } from '../forum/synthesisBridge';
import { useSynthesisStore } from './index';
import { persistSynthesisOutput } from './pipelineBridge';

type PipelineLike = Pick<TopicSynthesisPipeline, 'onCommentEvent'>;

export interface SynthesisCommentRuntimeDeps {
  readonly resolveClient: () => VennClient | null;
  readonly now?: () => number;
  readonly createPipeline?: (deps: PipelineDeps) => PipelineLike;
  readonly setBridgeHandler?: typeof setSynthesisBridgeHandler;
  readonly isEnabled?: () => boolean;
  readonly persistOutput?: (output: PipelineOutput) => void;
}

let runtimeStarted = false;

function sameTopic(thread: HermesThread, topicId: string): boolean {
  return thread.topicId === topicId || thread.id === topicId;
}

function toVerifiedComment(comment: HermesComment): VerifiedComment | null {
  if (!comment.stance) {
    return null;
  }

  return {
    comment_id: comment.id,
    content: comment.content,
    stance: comment.stance,
    principal_hash: comment.author,
    timestamp: comment.timestamp,
  };
}

function resolveVerifiedComments(topicId: string, windowStart: number, windowEnd: number): VerifiedComment[] {
  const forumState = useForumStore.getState();
  const threadIds = new Set(
    Array.from(forumState.threads.values())
      .filter((thread) => sameTopic(thread, topicId))
      .map((thread) => thread.id),
  );

  const comments: VerifiedComment[] = [];
  for (const threadId of threadIds) {
    for (const comment of forumState.comments.get(threadId) ?? []) {
      if (comment.timestamp < windowStart || comment.timestamp > windowEnd) {
        continue;
      }
      const verified = toVerifiedComment(comment);
      if (verified) {
        comments.push(verified);
      }
    }
  }

  return comments;
}

export function bootstrapSynthesisCommentRuntime(deps: SynthesisCommentRuntimeDeps): void {
  if (runtimeStarted) {
    return;
  }

  const enabled = deps.isEnabled?.() ?? isSynthesisV2Enabled();
  if (!enabled) {
    deps.setBridgeHandler?.(null);
    return;
  }

  const persistOutput =
    deps.persistOutput ??
    ((output: PipelineOutput) => {
      void persistSynthesisOutput(
        {
          resolveClient: deps.resolveClient,
          setTopicSynthesis: useSynthesisStore.getState().setTopicSynthesis,
        },
        output,
      );
    });

  const pipeline = (deps.createPipeline ?? ((pipelineDeps) => new TopicSynthesisPipeline(pipelineDeps)))({
    enabled,
    now: deps.now ?? (() => Date.now()),
    resolveTopicEpochMeta: (topicId) => {
      const topicState = useSynthesisStore.getState().topics[topicId];
      return {
        current_epoch: topicState?.epoch ?? 0,
        ...(topicState?.synthesis?.created_at != null
          ? { last_epoch_timestamp: topicState.synthesis.created_at }
          : {}),
        epochs_today: 0,
      };
    },
    resolveVerifiedComments,
    onSynthesisProduced: persistOutput,
  });

  (deps.setBridgeHandler ?? setSynthesisBridgeHandler)((event) => pipeline.onCommentEvent(event));
  runtimeStarted = true;
}

export function resetSynthesisCommentRuntimeForTest(): void {
  runtimeStarted = false;
  setSynthesisBridgeHandler(null);
}
