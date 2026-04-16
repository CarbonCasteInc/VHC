import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommentEvent, PipelineDeps, PipelineOutput } from '@vh/ai-engine';
import { useForumStore } from '../hermesForum';
import {
  bootstrapSynthesisCommentRuntime,
  resetSynthesisCommentRuntimeForTest,
} from './commentRuntime';

const EVENT: CommentEvent = {
  comment_id: 'comment-1',
  topic_id: 'topic-1',
  principal_hash: 'hash-alice',
  verified: true,
  kind: 'add',
  timestamp: 100,
};

const OUTPUT = {
  schemaVersion: 'topic-synthesis-v2',
  topic_id: 'topic-1',
  epoch: 1,
  synthesis_id: 'synth-1',
  inputs: { topic_digest_ids: ['digest-1'] },
  quorum: {
    required: 5,
    received: 5,
    reached_at: 100,
    timed_out: false,
    selection_rule: 'deterministic',
  },
  facts_summary: 'Facts.',
  frames: [],
  warnings: [],
  divergence_metrics: {
    disagreement_score: 0,
    source_dispersion: 0,
    candidate_count: 5,
  },
  provenance: {
    candidate_ids: ['c1', 'c2', 'c3', 'c4', 'c5'],
    provider_mix: [{ provider_id: 'test', count: 5 }],
  },
  created_at: 100,
} satisfies PipelineOutput;

describe('synthesis comment runtime', () => {
  beforeEach(() => {
    resetSynthesisCommentRuntimeForTest();
    useForumStore.setState({
      threads: new Map(),
      comments: new Map(),
      userVotes: new Map(),
    });
  });

  afterEach(() => {
    resetSynthesisCommentRuntimeForTest();
    vi.restoreAllMocks();
  });

  it('registers forum comment events with the TopicSynthesisPipeline handler', () => {
    let bridgeHandler: ((event: CommentEvent) => void) | null = null;
    const onCommentEvent = vi.fn();

    bootstrapSynthesisCommentRuntime({
      resolveClient: () => null,
      isEnabled: () => true,
      setBridgeHandler: (handler) => {
        bridgeHandler = handler;
      },
      createPipeline: () => ({ onCommentEvent }),
    });

    bridgeHandler?.(EVENT);

    expect(onCommentEvent).toHaveBeenCalledWith(EVENT);
  });

  it('resolves verified comments from forum threads sharing the unified topic id', () => {
    let pipelineDeps: PipelineDeps | null = null;

    useForumStore.setState({
      threads: new Map([
        [
          'thread-1',
          {
            id: 'thread-1',
            schemaVersion: 'hermes-thread-v0',
            title: 'Topic',
            content: 'Head',
            author: 'author',
            timestamp: 1,
            tags: [],
            topicId: 'topic-1',
            upvotes: 0,
            downvotes: 0,
            score: 0,
          },
        ],
      ]),
      comments: new Map([
        [
          'thread-1',
          [
            {
              id: 'comment-1',
              schemaVersion: 'hermes-comment-v1',
              threadId: 'thread-1',
              parentId: null,
              content: 'A useful claim',
              author: 'hash-alice',
              timestamp: 100,
              stance: 'concur',
              upvotes: 0,
              downvotes: 0,
            },
          ],
        ],
      ]),
      userVotes: new Map(),
    });

    bootstrapSynthesisCommentRuntime({
      resolveClient: () => null,
      isEnabled: () => true,
      setBridgeHandler: () => {},
      createPipeline: (deps) => {
        pipelineDeps = deps;
        return { onCommentEvent: vi.fn() };
      },
    });

    expect(pipelineDeps?.resolveVerifiedComments('topic-1', 0, 200)).toEqual([
      {
        comment_id: 'comment-1',
        content: 'A useful claim',
        stance: 'concur',
        principal_hash: 'hash-alice',
        timestamp: 100,
      },
    ]);
  });

  it('persists synthesis output produced by the pipeline', () => {
    const persistOutput = vi.fn();

    bootstrapSynthesisCommentRuntime({
      resolveClient: () => null,
      isEnabled: () => true,
      persistOutput,
      setBridgeHandler: () => {},
      createPipeline: (deps) => {
        deps.onSynthesisProduced?.(OUTPUT);
        return { onCommentEvent: vi.fn() };
      },
    });

    expect(persistOutput).toHaveBeenCalledWith(OUTPUT);
  });

  it('does not register when synthesis V2 is disabled', () => {
    const setBridgeHandler = vi.fn();

    bootstrapSynthesisCommentRuntime({
      resolveClient: () => null,
      isEnabled: () => false,
      setBridgeHandler,
      createPipeline: () => {
        throw new Error('pipeline should not be constructed');
      },
    });

    expect(setBridgeHandler).toHaveBeenCalledWith(null);
  });
});
