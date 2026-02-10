import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TopicSynthesisV2 } from '@vh/data-model';
import type { SynthesisState } from './types';

const gunMocks = vi.hoisted(() => ({
  getTopicLatestSynthesisChain: vi.fn(),
  hasForbiddenSynthesisPayloadFields: vi.fn<(payload: unknown) => boolean>()
}));

vi.mock('@vh/gun-client', () => ({
  getTopicLatestSynthesisChain: gunMocks.getTopicLatestSynthesisChain,
  hasForbiddenSynthesisPayloadFields: gunMocks.hasForbiddenSynthesisPayloadFields
}));

function synthesis(overrides: Partial<TopicSynthesisV2> = {}): TopicSynthesisV2 {
  return {
    schemaVersion: 'topic-synthesis-v2',
    topic_id: 'topic-1',
    epoch: 3,
    synthesis_id: 'synth-3',
    inputs: {
      story_bundle_ids: ['story-1'],
      topic_digest_ids: ['digest-1']
    },
    quorum: {
      required: 3,
      received: 3,
      reached_at: 100,
      timed_out: false,
      selection_rule: 'deterministic'
    },
    facts_summary: 'Summary',
    frames: [
      {
        frame: 'Frame',
        reframe: 'Reframe'
      }
    ],
    warnings: [],
    divergence_metrics: {
      disagreement_score: 0.2,
      source_dispersion: 0.1,
      candidate_count: 3
    },
    provenance: {
      candidate_ids: ['candidate-1', 'candidate-2', 'candidate-3'],
      provider_mix: [
        {
          provider_id: 'provider-1',
          count: 3
        }
      ]
    },
    created_at: 200,
    ...overrides
  };
}

interface SubscribableChain {
  chain: { on: ReturnType<typeof vi.fn> };
  emit: (data: unknown) => void;
  onSpy: ReturnType<typeof vi.fn>;
}

function createSubscribableChain(): SubscribableChain {
  let callback: ((data: unknown) => void) | undefined;
  const onSpy = vi.fn((cb: (data: unknown) => void) => {
    callback = cb;
  });

  return {
    chain: { on: onSpy },
    emit(data: unknown) {
      callback?.(data);
    },
    onSpy
  };
}

function createStore() {
  const state: SynthesisState = {
    enabled: true,
    topics: {},
    getTopicState: vi.fn(),
    setTopicSynthesis: vi.fn(),
    setTopicHydrated: vi.fn(),
    setTopicLoading: vi.fn(),
    setTopicError: vi.fn(),
    refreshTopic: vi.fn(),
    startHydration: vi.fn(),
    reset: vi.fn()
  };

  const store = {
    getState: () => state
  } as unknown as import('zustand').StoreApi<SynthesisState>;

  return { store, state };
}

describe('hydrateSynthesisStore', () => {
  beforeEach(() => {
    gunMocks.getTopicLatestSynthesisChain.mockReset();
    gunMocks.hasForbiddenSynthesisPayloadFields.mockReset();
    gunMocks.hasForbiddenSynthesisPayloadFields.mockReturnValue(false);
    vi.resetModules();
  });

  it('returns false for empty topic id', async () => {
    const { hydrateSynthesisStore } = await import('./hydration');
    const { store } = createStore();

    expect(hydrateSynthesisStore(() => ({}) as never, store, '   ')).toBe(false);
  });

  it('returns false when no client is available', async () => {
    const { hydrateSynthesisStore } = await import('./hydration');
    const { store } = createStore();

    expect(hydrateSynthesisStore(() => null, store, 'topic-1')).toBe(false);
  });

  it('returns false when subscription is unsupported', async () => {
    gunMocks.getTopicLatestSynthesisChain.mockReturnValue({ on: undefined });

    const { hydrateSynthesisStore } = await import('./hydration');
    const { store } = createStore();

    expect(hydrateSynthesisStore(() => ({}) as never, store, 'topic-1')).toBe(false);
  });

  it('attaches once per store/topic pair', async () => {
    const chain = createSubscribableChain();
    gunMocks.getTopicLatestSynthesisChain.mockReturnValue(chain.chain);

    const { hydrateSynthesisStore } = await import('./hydration');
    const { store } = createStore();

    expect(hydrateSynthesisStore(() => ({}) as never, store, 'topic-1')).toBe(true);
    expect(hydrateSynthesisStore(() => ({}) as never, store, 'topic-1')).toBe(true);

    expect(chain.onSpy).toHaveBeenCalledTimes(1);
  });

  it('hydrates each topic independently', async () => {
    const chainA = createSubscribableChain();
    const chainB = createSubscribableChain();

    gunMocks.getTopicLatestSynthesisChain
      .mockReturnValueOnce(chainA.chain)
      .mockReturnValueOnce(chainB.chain);

    const { hydrateSynthesisStore } = await import('./hydration');
    const { store } = createStore();

    expect(hydrateSynthesisStore(() => ({}) as never, store, 'topic-a')).toBe(true);
    expect(hydrateSynthesisStore(() => ({}) as never, store, 'topic-b')).toBe(true);

    expect(chainA.onSpy).toHaveBeenCalledTimes(1);
    expect(chainB.onSpy).toHaveBeenCalledTimes(1);
  });

  it('hydrates valid synthesis payloads', async () => {
    const chain = createSubscribableChain();
    gunMocks.getTopicLatestSynthesisChain.mockReturnValue(chain.chain);

    const { hydrateSynthesisStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateSynthesisStore(() => ({}) as never, store, 'topic-1');

    chain.emit({ _: { '#': 'meta' }, ...synthesis() });

    expect(state.setTopicSynthesis).toHaveBeenCalledWith('topic-1', expect.objectContaining({ synthesis_id: 'synth-3' }));
    expect(state.setTopicHydrated).toHaveBeenCalledWith('topic-1', true);
    expect(state.setTopicError).toHaveBeenCalledWith('topic-1', null);
  });

  it('ignores invalid and forbidden payloads', async () => {
    const chain = createSubscribableChain();
    gunMocks.getTopicLatestSynthesisChain.mockReturnValue(chain.chain);
    gunMocks.hasForbiddenSynthesisPayloadFields.mockImplementation((payload: unknown) => {
      return typeof payload === 'object' && payload !== null && 'token' in payload;
    });

    const { hydrateSynthesisStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateSynthesisStore(() => ({}) as never, store, 'topic-1');

    chain.emit(null);
    chain.emit({ invalid: true });
    chain.emit({ ...synthesis(), token: 'forbidden' });

    expect(state.setTopicSynthesis).not.toHaveBeenCalled();
    expect(state.setTopicHydrated).not.toHaveBeenCalled();
    expect(state.setTopicError).not.toHaveBeenCalled();
  });
});
