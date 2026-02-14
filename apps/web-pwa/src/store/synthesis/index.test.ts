import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TopicSynthesisV2 } from '@vh/data-model';

const hydrateSynthesisStoreMock = vi.fn<(...args: unknown[]) => boolean>();
const hasForbiddenSynthesisPayloadFieldsMock = vi.fn<(payload: unknown) => boolean>();
const readTopicLatestSynthesisMock = vi.fn<(client: unknown, topicId: string) => Promise<TopicSynthesisV2 | null>>();

vi.mock('./hydration', () => ({
  hydrateSynthesisStore: hydrateSynthesisStoreMock
}));

vi.mock('@vh/gun-client', () => ({
  hasForbiddenSynthesisPayloadFields: hasForbiddenSynthesisPayloadFieldsMock,
  readTopicLatestSynthesis: readTopicLatestSynthesisMock
}));

function synthesis(overrides: Partial<TopicSynthesisV2> = {}): TopicSynthesisV2 {
  return {
    schemaVersion: 'topic-synthesis-v2',
    topic_id: 'topic-1',
    epoch: 1,
    synthesis_id: 'synth-1',
    inputs: {
      story_bundle_ids: ['story-1'],
      topic_digest_ids: ['digest-1'],
      topic_seed_id: 'seed-1'
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
      source_dispersion: 0.3,
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

describe('synthesis store', () => {
  beforeEach(() => {
    hydrateSynthesisStoreMock.mockReset();
    hasForbiddenSynthesisPayloadFieldsMock.mockReset();
    readTopicLatestSynthesisMock.mockReset();

    hydrateSynthesisStoreMock.mockReturnValue(false);
    hasForbiddenSynthesisPayloadFieldsMock.mockReturnValue(false);
    readTopicLatestSynthesisMock.mockResolvedValue(null);

    vi.resetModules();
  });

  it('initializes with empty state', async () => {
    const { createSynthesisStore } = await import('./index');
    const store = createSynthesisStore({ enabled: false, resolveClient: () => null });

    expect(store.getState().enabled).toBe(false);
    expect(store.getState().topics).toEqual({});
  });

  it('getTopicState returns empty state for unknown or invalid topics', async () => {
    const { createSynthesisStore } = await import('./index');
    const store = createSynthesisStore({ enabled: true, resolveClient: () => null });

    expect(store.getState().getTopicState('topic-1')).toEqual({
      topicId: 'topic-1',
      epoch: null,
      synthesis: null,
      hydrated: false,
      loading: false,
      error: null
    });

    expect(store.getState().getTopicState('   ')).toEqual({
      topicId: '',
      epoch: null,
      synthesis: null,
      hydrated: false,
      loading: false,
      error: null
    });
  });

  it('setTopicSynthesis validates payloads and supports clear', async () => {
    const { createSynthesisStore } = await import('./index');
    const store = createSynthesisStore({ enabled: true, resolveClient: () => null });

    store.getState().setTopicError('topic-1', 'old-error');
    store.getState().setTopicSynthesis('topic-1', synthesis());

    const first = store.getState().getTopicState('topic-1');
    expect(first.epoch).toBe(1);
    expect(first.synthesis?.synthesis_id).toBe('synth-1');
    expect(first.error).toBeNull();

    store.getState().setTopicSynthesis('topic-1', null);
    const cleared = store.getState().getTopicState('topic-1');
    expect(cleared.epoch).toBeNull();
    expect(cleared.synthesis).toBeNull();
  });

  it('setTopicSynthesis ignores forbidden/invalid payloads and invalid topic ids', async () => {
    hasForbiddenSynthesisPayloadFieldsMock.mockImplementation((payload: unknown) => {
      return typeof payload === 'object' && payload !== null && 'token' in payload;
    });

    const { createSynthesisStore } = await import('./index');
    const store = createSynthesisStore({ enabled: true, resolveClient: () => null });

    store.getState().setTopicSynthesis('topic-1', { ...synthesis(), token: 'bad' } as TopicSynthesisV2);
    store.getState().setTopicSynthesis('topic-1', { invalid: true } as unknown as TopicSynthesisV2);
    store.getState().setTopicSynthesis('   ', synthesis());

    expect(store.getState().topics).toEqual({});
  });

  it('topic status setters mutate topic state and ignore empty ids', async () => {
    const { createSynthesisStore } = await import('./index');
    const store = createSynthesisStore({ enabled: true, resolveClient: () => null });

    store.getState().setTopicHydrated('topic-1', true);
    store.getState().setTopicLoading('topic-1', true);
    store.getState().setTopicError('topic-1', 'oops');
    store.getState().setTopicHydrated('   ', true);
    store.getState().setTopicLoading('   ', true);
    store.getState().setTopicError('   ', 'ignored');

    expect(store.getState().topics).toEqual({
      'topic-1': {
        topicId: 'topic-1',
        epoch: null,
        synthesis: null,
        hydrated: true,
        loading: true,
        error: 'oops'
      }
    });
  });

  it('startHydration toggles hydrated only when hydration is attached', async () => {
    hydrateSynthesisStoreMock.mockReturnValue(true);

    const { createSynthesisStore } = await import('./index');
    const store = createSynthesisStore({ enabled: true, resolveClient: () => ({}) as never });

    store.getState().startHydration('topic-1');
    expect(store.getState().getTopicState('topic-1').hydrated).toBe(true);

    hydrateSynthesisStoreMock.mockReturnValue(false);
    store.getState().setTopicHydrated('topic-2', false);
    store.getState().startHydration('topic-2');
    expect(store.getState().getTopicState('topic-2').hydrated).toBe(false);

    store.getState().startHydration('   ');

    const disabled = createSynthesisStore({ enabled: false, resolveClient: () => ({}) as never });
    disabled.getState().startHydration('topic-3');
    expect(disabled.getState().topics).toEqual({});
  });

  it('refreshTopic no-ops when disabled or topic id is empty', async () => {
    const { createSynthesisStore } = await import('./index');

    const disabled = createSynthesisStore({ enabled: false, resolveClient: () => ({}) as never });
    await disabled.getState().refreshTopic('topic-1');

    const enabled = createSynthesisStore({ enabled: true, resolveClient: () => ({}) as never });
    await enabled.getState().refreshTopic('   ');

    expect(readTopicLatestSynthesisMock).not.toHaveBeenCalled();
  });

  it('refreshTopic clears loading when no client is available', async () => {
    const { createSynthesisStore } = await import('./index');
    const store = createSynthesisStore({ enabled: true, resolveClient: () => null });

    await store.getState().refreshTopic('topic-1');

    expect(store.getState().getTopicState('topic-1').loading).toBe(false);
    expect(store.getState().getTopicState('topic-1').error).toBeNull();
    expect(readTopicLatestSynthesisMock).not.toHaveBeenCalled();
  });

  it('refreshTopic hydrates + loads latest synthesis', async () => {
    hydrateSynthesisStoreMock.mockReturnValue(true);
    const client = { id: 'client' };

    readTopicLatestSynthesisMock.mockResolvedValue(
      synthesis({ topic_id: 'topic-x', epoch: 8, synthesis_id: 'synth-8' })
    );

    const { createSynthesisStore } = await import('./index');
    const store = createSynthesisStore({ enabled: true, resolveClient: () => client as never });

    await store.getState().refreshTopic('topic-x');

    expect(hydrateSynthesisStoreMock).toHaveBeenCalled();
    expect(readTopicLatestSynthesisMock).toHaveBeenCalledWith(client, 'topic-x');

    const state = store.getState().getTopicState('topic-x');
    expect(state.hydrated).toBe(true);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.epoch).toBe(8);
    expect(state.synthesis?.synthesis_id).toBe('synth-8');
  });

  it('refreshTopic handles null latest (no synthesis available)', async () => {
    readTopicLatestSynthesisMock.mockResolvedValue(null);

    const { createSynthesisStore } = await import('./index');
    const store = createSynthesisStore({ enabled: true, resolveClient: () => ({}) as never });

    await store.getState().refreshTopic('topic-1');

    const topic = store.getState().getTopicState('topic-1');
    expect(topic.synthesis).toBeNull();
    expect(topic.epoch).toBeNull();
    expect(topic.loading).toBe(false);
    expect(topic.error).toBeNull();
  });

  it('refreshTopic drops invalid latest payloads after defensive parse', async () => {
    readTopicLatestSynthesisMock.mockResolvedValue({ invalid: true } as unknown as TopicSynthesisV2);

    const { createSynthesisStore } = await import('./index');
    const store = createSynthesisStore({ enabled: true, resolveClient: () => ({}) as never });

    await store.getState().refreshTopic('topic-1');

    const topic = store.getState().getTopicState('topic-1');
    expect(topic.synthesis).toBeNull();
    expect(topic.epoch).toBeNull();
  });

  it('refreshTopic captures thrown errors', async () => {
    readTopicLatestSynthesisMock.mockRejectedValue(new Error('boom'));

    const { createSynthesisStore } = await import('./index');
    const store = createSynthesisStore({ enabled: true, resolveClient: () => ({}) as never });

    await store.getState().refreshTopic('topic-1');

    expect(store.getState().getTopicState('topic-1').error).toBe('boom');
    expect(store.getState().getTopicState('topic-1').loading).toBe(false);
  });

  it('refreshTopic uses fallback error message for non-Error failures', async () => {
    readTopicLatestSynthesisMock.mockRejectedValue('boom-string');

    const { createSynthesisStore } = await import('./index');
    const store = createSynthesisStore({ enabled: true, resolveClient: () => ({}) as never });

    await store.getState().refreshTopic('topic-1');

    expect(store.getState().getTopicState('topic-1').error).toBe('Failed to refresh synthesis topic');
  });

  it('reset clears all topic state while preserving enabled flag', async () => {
    const { createSynthesisStore } = await import('./index');
    const store = createSynthesisStore({ enabled: true, resolveClient: () => null });

    store.getState().setTopicSynthesis('topic-1', synthesis());
    store.getState().setTopicError('topic-1', 'oops');

    expect(Object.keys(store.getState().topics)).toEqual(['topic-1']);

    store.getState().reset();

    expect(store.getState().enabled).toBe(true);
    expect(store.getState().topics).toEqual({});
  });

  it('createMockSynthesisStore seeds deterministic topic states', async () => {
    const { createMockSynthesisStore } = await import('./index');

    const store = createMockSynthesisStore([
      synthesis({ topic_id: 'topic-1', epoch: 2, synthesis_id: 'synth-2' }),
      synthesis({ topic_id: 'topic-2', epoch: 5, synthesis_id: 'synth-5' })
    ]);

    expect(store.getState().enabled).toBe(true);
    expect(store.getState().getTopicState('topic-1').epoch).toBe(2);
    expect(store.getState().getTopicState('topic-2').epoch).toBe(5);

    const empty = createMockSynthesisStore();
    expect(empty.getState().topics).toEqual({});
  });

  it('createSynthesisStore works with default dependency wiring', async () => {
    const { createSynthesisStore } = await import('./index');
    const store = createSynthesisStore();

    await store.getState().refreshTopic('topic-1');

    expect(store.getState().getTopicState('topic-1').loading).toBe(false);
  });

  it('module bootstrap uses E2E mock singleton branch when env is enabled', async () => {
    vi.stubEnv('VITE_E2E_MODE', 'true');
    vi.resetModules();

    const mod = await import('./index');

    expect(mod.useSynthesisStore.getState().enabled).toBe(true);
  });

  it('module bootstrap remains importable with default runtime globals', async () => {
    vi.resetModules();

    const mod = await import('./index');
    const store = mod.createSynthesisStore({ enabled: false, resolveClient: () => null });

    expect(store.getState().enabled).toBe(false);
  });

});
