import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TopicSynthesisCorrection, TopicSynthesisV2 } from '@vh/data-model';
import type { SynthesisState } from './types';

const gunMocks = vi.hoisted(() => ({
  getTopicLatestSynthesisChain: vi.fn(),
  getTopicLatestSynthesisCorrectionChain: vi.fn(),
  hasForbiddenSynthesisPayloadFields: vi.fn<(payload: unknown) => boolean>(),
  // Defaults to the real parser (via the mock factory); a test may override
  // it to exercise the defensive rejection path in ingestSynthesis.
  parseTopicLatestSynthesisRecord: null as
    | null
    | ((...args: unknown[]) => Promise<unknown>)
}));

// The real parseTopicLatestSynthesisRecord stays in place by default so
// hydration ingestion exercises the actual fail-closed system-writer
// validation; a test can override gunMocks.parseTopicLatestSynthesisRecord.
vi.mock('@vh/gun-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vh/gun-client')>();
  return {
    ...actual,
    getTopicLatestSynthesisChain: gunMocks.getTopicLatestSynthesisChain,
    getTopicLatestSynthesisCorrectionChain: gunMocks.getTopicLatestSynthesisCorrectionChain,
    hasForbiddenSynthesisPayloadFields: gunMocks.hasForbiddenSynthesisPayloadFields,
    parseTopicLatestSynthesisRecord: (...args: unknown[]) =>
      (gunMocks.parseTopicLatestSynthesisRecord ?? actual.parseTopicLatestSynthesisRecord)(
        ...(args as Parameters<typeof actual.parseTopicLatestSynthesisRecord>)
      )
  };
});

async function flushIngest(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

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
        frame_point_id: 'frame-point-1',
        frame: 'Frame',
        reframe_point_id: 'reframe-point-1',
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

function correction(overrides: Partial<TopicSynthesisCorrection> = {}): TopicSynthesisCorrection {
  return {
    schemaVersion: 'topic-synthesis-correction-v1',
    correction_id: 'correction-1',
    topic_id: 'topic-1',
    synthesis_id: 'synth-3',
    epoch: 3,
    status: 'suppressed',
    reason_code: 'inaccurate_summary',
    operator_id: 'ops-user-1',
    created_at: 300,
    audit: {
      action: 'synthesis_correction'
    },
    ...overrides
  };
}

interface SubscribableChain {
  chain: {
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };
  emit: (data: unknown) => void;
  setSnapshot: (data: unknown) => void;
  setScalarSnapshot: (key: string, data: unknown) => void;
  onSpy: ReturnType<typeof vi.fn>;
  offSpy: ReturnType<typeof vi.fn>;
  onceSpy: ReturnType<typeof vi.fn>;
  getSpy: ReturnType<typeof vi.fn>;
}

function createSubscribableChain(): SubscribableChain {
  let callback: ((data: unknown) => void) | undefined;
  let snapshot: unknown = null;
  const scalarSnapshots = new Map<string, unknown>();
  const onSpy = vi.fn((cb: (data: unknown) => void) => {
    callback = cb;
  });
  const offSpy = vi.fn((cb: (data: unknown) => void) => {
    if (callback === cb) {
      callback = undefined;
    }
  });
  const onceSpy = vi.fn((cb: (data: unknown) => void) => {
    cb(snapshot);
  });
  const getSpy = vi.fn((key: string) => ({
    once: vi.fn((cb: (data: unknown) => void) => {
      cb(scalarSnapshots.get(key) ?? null);
    })
  }));

  return {
    chain: { on: onSpy, off: offSpy, once: onceSpy, get: getSpy },
    emit(data: unknown) {
      callback?.(data);
    },
    setSnapshot(data: unknown) {
      snapshot = data;
    },
    setScalarSnapshot(key: string, data: unknown) {
      scalarSnapshots.set(key, data);
    },
    onSpy,
    offSpy,
    onceSpy,
    getSpy
  };
}

function createStore() {
  const state: SynthesisState = {
    enabled: true,
    topics: {},
    getTopicState: vi.fn(),
    setTopicSynthesis: vi.fn(),
    setTopicCorrection: vi.fn(),
    setTopicInvalid: vi.fn(),
    setTopicHydrated: vi.fn(),
    setTopicLoading: vi.fn(),
    setTopicError: vi.fn(),
    refreshTopic: vi.fn(),
    startHydration: vi.fn(),
    stopHydration: vi.fn(),
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
    gunMocks.getTopicLatestSynthesisCorrectionChain.mockReset();
    gunMocks.hasForbiddenSynthesisPayloadFields.mockReset();
    gunMocks.getTopicLatestSynthesisCorrectionChain.mockReturnValue({ on: undefined });
    gunMocks.hasForbiddenSynthesisPayloadFields.mockReturnValue(false);
    gunMocks.parseTopicLatestSynthesisRecord = null;
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.VITE_VH_SYNTHESIS_HYDRATION_TOPIC_LIMIT;
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
    gunMocks.getTopicLatestSynthesisCorrectionChain.mockReturnValue({ on: undefined });

    const { hydrateSynthesisStore } = await import('./hydration');
    const { store } = createStore();

    expect(hydrateSynthesisStore(() => ({}) as never, store, 'topic-1')).toBe(false);
  });

  it('attaches once per store/topic pair', async () => {
    const chain = createSubscribableChain();
    gunMocks.getTopicLatestSynthesisChain.mockReturnValue(chain.chain);
    gunMocks.getTopicLatestSynthesisCorrectionChain.mockReturnValue({ on: undefined });

    const { hydrateSynthesisStore } = await import('./hydration');
    const { store } = createStore();

    expect(hydrateSynthesisStore(() => ({}) as never, store, 'topic-1')).toBe(true);
    expect(hydrateSynthesisStore(() => ({}) as never, store, 'topic-1')).toBe(true);

    expect(chain.onSpy).toHaveBeenCalledTimes(1);
  });

  it('pulls a latest synthesis snapshot when hydration is started again for an existing topic', async () => {
    const chain = createSubscribableChain();
    gunMocks.getTopicLatestSynthesisChain.mockReturnValue(chain.chain);
    gunMocks.getTopicLatestSynthesisCorrectionChain.mockReturnValue({ on: undefined });

    const { hydrateSynthesisStore } = await import('./hydration');
    const { store, state } = createStore();

    expect(hydrateSynthesisStore(() => ({}) as never, store, 'topic-1')).toBe(true);
    chain.setSnapshot({
      __topic_synthesis_json: JSON.stringify(synthesis()),
      topic_id: 'topic-1',
      synthesis_id: 'synth-3',
      epoch: 3
    });
    expect(hydrateSynthesisStore(() => ({}) as never, store, 'topic-1')).toBe(true);
    await flushIngest();

    expect(chain.onSpy).toHaveBeenCalledTimes(1);
    expect(chain.onceSpy).toHaveBeenCalledTimes(2);
    expect(state.setTopicSynthesis).toHaveBeenCalledWith('topic-1', expect.objectContaining({ synthesis_id: 'synth-3' }));
  });

  it('recovers latest synthesis from the scalar JSON envelope when the root node is metadata-only', async () => {
    const chain = createSubscribableChain();
    chain.setSnapshot({ _: { '#': 'vh/topics/topic-1/latest' } });
    chain.setScalarSnapshot('__topic_synthesis_json', JSON.stringify(synthesis({ synthesis_id: 'synth-scalar' })));
    gunMocks.getTopicLatestSynthesisChain.mockReturnValue(chain.chain);
    gunMocks.getTopicLatestSynthesisCorrectionChain.mockReturnValue({ on: undefined });

    const { hydrateSynthesisStore } = await import('./hydration');
    const { store, state } = createStore();

    expect(hydrateSynthesisStore(() => ({}) as never, store, 'topic-1')).toBe(true);
    await flushIngest();

    expect(chain.getSpy).toHaveBeenCalledWith('__topic_synthesis_json');
    expect(state.setTopicSynthesis).toHaveBeenCalledWith('topic-1', expect.objectContaining({ synthesis_id: 'synth-scalar' }));
  });

  it('recovers latest correction from the scalar JSON envelope when the root node is metadata-only', async () => {
    const chain = createSubscribableChain();
    const correctionChain = createSubscribableChain();
    correctionChain.setSnapshot({ _: { '#': 'vh/topics/topic-1/synthesis_corrections/latest' } });
    correctionChain.setScalarSnapshot('__topic_synthesis_correction_json', JSON.stringify(correction({ correction_id: 'correction-scalar' })));
    gunMocks.getTopicLatestSynthesisChain.mockReturnValue(chain.chain);
    gunMocks.getTopicLatestSynthesisCorrectionChain.mockReturnValue(correctionChain.chain);

    const { hydrateSynthesisStore } = await import('./hydration');
    const { store, state } = createStore();

    expect(hydrateSynthesisStore(() => ({}) as never, store, 'topic-1')).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(correctionChain.getSpy).toHaveBeenCalledWith('__topic_synthesis_correction_json');
    expect(state.setTopicCorrection).toHaveBeenCalledWith('topic-1', expect.objectContaining({ correction_id: 'correction-scalar' }));
  });

  it('ignores malformed scalar JSON envelopes and unsupported scalar reads', async () => {
    const chain = createSubscribableChain();
    chain.setSnapshot({ _: { '#': 'vh/topics/topic-1/latest' } });
    chain.setScalarSnapshot('__topic_synthesis_json', '{');
    const correctionChain = {
      on: vi.fn(),
      once: vi.fn((cb: (data: unknown) => void) => cb({ _: { '#': 'vh/topics/topic-1/correction' } })),
      get: vi.fn(() => ({}))
    };
    gunMocks.getTopicLatestSynthesisChain.mockReturnValue(chain.chain);
    gunMocks.getTopicLatestSynthesisCorrectionChain.mockReturnValue(correctionChain);

    const { hydrateSynthesisStore } = await import('./hydration');
    const { store, state } = createStore();

    expect(hydrateSynthesisStore(() => ({}) as never, store, 'topic-1')).toBe(true);
    await flushIngest();

    expect(state.setTopicSynthesis).not.toHaveBeenCalled();
    expect(state.setTopicCorrection).not.toHaveBeenCalled();
  });

  it('ignores non-string JSON envelopes and late scalar callbacks after timeout', async () => {
    vi.useFakeTimers();
    let scalarCallback: ((data: unknown) => void) | undefined;
    const chain = {
      on: vi.fn(),
      once: vi.fn((cb: (data: unknown) => void) => cb({ __topic_synthesis_json: 42 })),
      get: vi.fn(() => ({
        once: vi.fn((cb: (data: unknown) => void) => {
          scalarCallback = cb;
        })
      }))
    };
    gunMocks.getTopicLatestSynthesisChain.mockReturnValue(chain);
    gunMocks.getTopicLatestSynthesisCorrectionChain.mockReturnValue({ on: undefined });

    try {
      const { hydrateSynthesisStore } = await import('./hydration');
      const { store, state } = createStore();

      expect(hydrateSynthesisStore(() => ({}) as never, store, 'topic-1')).toBe(true);
      await vi.advanceTimersByTimeAsync(2_501);
      scalarCallback?.(JSON.stringify(synthesis({ synthesis_id: 'late-synth' })));
      await Promise.resolve();

      expect(state.setTopicSynthesis).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hydrates each topic independently', async () => {
    const chainA = createSubscribableChain();
    const chainB = createSubscribableChain();

    gunMocks.getTopicLatestSynthesisChain
      .mockReturnValueOnce(chainA.chain)
      .mockReturnValueOnce(chainB.chain);
    gunMocks.getTopicLatestSynthesisCorrectionChain.mockReturnValue({ on: undefined });

    const { hydrateSynthesisStore } = await import('./hydration');
    const { store } = createStore();

    expect(hydrateSynthesisStore(() => ({}) as never, store, 'topic-a')).toBe(true);
    expect(hydrateSynthesisStore(() => ({}) as never, store, 'topic-b')).toBe(true);

    expect(chainA.onSpy).toHaveBeenCalledTimes(1);
    expect(chainB.onSpy).toHaveBeenCalledTimes(1);
  });

  it('releases topic subscriptions explicitly', async () => {
    const chain = createSubscribableChain();
    gunMocks.getTopicLatestSynthesisChain.mockReturnValue(chain.chain);
    gunMocks.getTopicLatestSynthesisCorrectionChain.mockReturnValue({ on: undefined });

    const { hydrateSynthesisStore, releaseSynthesisHydration } = await import('./hydration');
    const { store, state } = createStore();

    expect(hydrateSynthesisStore(() => ({}) as never, store, 'topic-1')).toBe(true);
    releaseSynthesisHydration(store, 'topic-1');
    chain.emit(synthesis());
    await flushIngest();

    expect(chain.offSpy).toHaveBeenCalledTimes(2);
    expect(chain.offSpy).toHaveBeenNthCalledWith(1, expect.any(Function));
    expect(chain.offSpy).toHaveBeenNthCalledWith(2);
    expect(state.setTopicSynthesis).not.toHaveBeenCalledWith(
      'topic-1',
      expect.objectContaining({ synthesis_id: 'synth-3' }),
    );
  });

  it('ignores late callbacks after release when Gun keeps the old handler alive', async () => {
    const chain = createSubscribableChain();
    chain.offSpy.mockImplementation(() => undefined);
    gunMocks.getTopicLatestSynthesisChain.mockReturnValue(chain.chain);
    gunMocks.getTopicLatestSynthesisCorrectionChain.mockReturnValue({ on: undefined });

    const { hydrateSynthesisStore, releaseSynthesisHydration } = await import('./hydration');
    const { store, state } = createStore();

    expect(hydrateSynthesisStore(() => ({}) as never, store, 'topic-1')).toBe(true);
    releaseSynthesisHydration(store, 'topic-1');
    releaseSynthesisHydration(store, '   ');
    chain.emit(synthesis());
    await flushIngest();

    expect(state.setTopicSynthesis).not.toHaveBeenCalled();
  });

  it('evicts least-recent topic subscriptions beyond the bounded hydration limit', async () => {
    process.env.VITE_VH_SYNTHESIS_HYDRATION_TOPIC_LIMIT = '1';
    vi.resetModules();
    const chainA = createSubscribableChain();
    const chainB = createSubscribableChain();
    gunMocks.getTopicLatestSynthesisChain
      .mockReturnValueOnce(chainA.chain)
      .mockReturnValueOnce(chainB.chain);
    gunMocks.getTopicLatestSynthesisCorrectionChain.mockReturnValue({ on: undefined });

    const { hydrateSynthesisStore } = await import('./hydration');
    const { store, state } = createStore();

    expect(hydrateSynthesisStore(() => ({}) as never, store, 'topic-a')).toBe(true);
    expect(hydrateSynthesisStore(() => ({}) as never, store, 'topic-b')).toBe(true);

    expect(chainA.offSpy).toHaveBeenCalledTimes(2);
    expect(chainA.offSpy).toHaveBeenNthCalledWith(1, expect.any(Function));
    expect(chainA.offSpy).toHaveBeenNthCalledWith(2);
    expect(chainB.offSpy).not.toHaveBeenCalled();
    expect(state.setTopicHydrated).toHaveBeenCalledWith('topic-a', false);
  });

  it('falls back to the default topic limit when the environment value is invalid', async () => {
    process.env.VITE_VH_SYNTHESIS_HYDRATION_TOPIC_LIMIT = 'invalid';
    vi.resetModules();
    const chain = createSubscribableChain();
    gunMocks.getTopicLatestSynthesisChain.mockReturnValue(chain.chain);
    gunMocks.getTopicLatestSynthesisCorrectionChain.mockReturnValue({ on: undefined });

    const { hydrateSynthesisStore } = await import('./hydration');
    const { store } = createStore();

    expect(hydrateSynthesisStore(() => ({}) as never, store, 'topic-1')).toBe(true);
    expect(chain.offSpy).not.toHaveBeenCalled();
  });

  it('hydrates valid synthesis payloads', async () => {
    const chain = createSubscribableChain();
    gunMocks.getTopicLatestSynthesisChain.mockReturnValue(chain.chain);
    gunMocks.getTopicLatestSynthesisCorrectionChain.mockReturnValue({ on: undefined });

    const { hydrateSynthesisStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateSynthesisStore(() => ({}) as never, store, 'topic-1');

    chain.emit({ _: { '#': 'meta' }, ...synthesis() });
    await flushIngest();

    expect(state.setTopicSynthesis).toHaveBeenCalledWith('topic-1', expect.objectContaining({ synthesis_id: 'synth-3' }));
    expect(state.setTopicHydrated).toHaveBeenCalledWith('topic-1', true);
    expect(state.setTopicError).toHaveBeenCalledWith('topic-1', null);
  });

  it('hydrates Gun-safe synthesis envelopes from live topic subscriptions', async () => {
    const chain = createSubscribableChain();
    gunMocks.getTopicLatestSynthesisChain.mockReturnValue(chain.chain);
    gunMocks.getTopicLatestSynthesisCorrectionChain.mockReturnValue({ on: undefined });

    const { hydrateSynthesisStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateSynthesisStore(() => ({}) as never, store, 'topic-1');

    chain.emit({
      _: { '#': 'meta' },
      __topic_synthesis_json: JSON.stringify(synthesis()),
      topic_id: 'topic-1',
      synthesis_id: 'synth-3',
      epoch: 3
    });
    await flushIngest();

    expect(state.setTopicSynthesis).toHaveBeenCalledWith('topic-1', expect.objectContaining({ synthesis_id: 'synth-3' }));
    expect(state.setTopicHydrated).toHaveBeenCalledWith('topic-1', true);
    expect(state.setTopicError).toHaveBeenCalledWith('topic-1', null);
  });

  it('hydrates valid synthesis correction payloads', async () => {
    const synthesisChain = { on: undefined };
    const correctionChain = createSubscribableChain();
    gunMocks.getTopicLatestSynthesisChain.mockReturnValue(synthesisChain);
    gunMocks.getTopicLatestSynthesisCorrectionChain.mockReturnValue(correctionChain.chain);

    const { hydrateSynthesisStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateSynthesisStore(() => ({}) as never, store, 'topic-1');

    correctionChain.emit({ _: { '#': 'meta' }, ...correction() });

    expect(state.setTopicCorrection).toHaveBeenCalledWith(
      'topic-1',
      expect.objectContaining({ correction_id: 'correction-1' })
    );
    expect(state.setTopicHydrated).toHaveBeenCalledWith('topic-1', true);
    expect(state.setTopicError).toHaveBeenCalledWith('topic-1', null);
  });

  it('hydrates Gun-safe synthesis correction envelopes from live topic subscriptions', async () => {
    const synthesisChain = { on: undefined };
    const correctionChain = createSubscribableChain();
    gunMocks.getTopicLatestSynthesisChain.mockReturnValue(synthesisChain);
    gunMocks.getTopicLatestSynthesisCorrectionChain.mockReturnValue(correctionChain.chain);

    const { hydrateSynthesisStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateSynthesisStore(() => ({}) as never, store, 'topic-1');

    correctionChain.emit({
      _: { '#': 'meta' },
      __topic_synthesis_correction_json: JSON.stringify(correction()),
      topic_id: 'topic-1',
      correction_id: 'correction-1',
      synthesis_id: 'synth-3',
      epoch: 3
    });

    expect(state.setTopicCorrection).toHaveBeenCalledWith(
      'topic-1',
      expect.objectContaining({ correction_id: 'correction-1' })
    );
    expect(state.setTopicHydrated).toHaveBeenCalledWith('topic-1', true);
    expect(state.setTopicError).toHaveBeenCalledWith('topic-1', null);
  });

  it('leaves state unchanged when synthesis validation rejects unexpectedly', async () => {
    const synthesisChain = createSubscribableChain();
    gunMocks.getTopicLatestSynthesisChain.mockReturnValue(synthesisChain.chain);
    gunMocks.getTopicLatestSynthesisCorrectionChain.mockReturnValue({ on: undefined });
    gunMocks.parseTopicLatestSynthesisRecord = () => Promise.reject(new Error('boom'));

    const { hydrateSynthesisStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateSynthesisStore(() => ({}) as never, store, 'topic-1');
    synthesisChain.emit({ _: { '#': 'meta' }, ...synthesis() });
    await flushIngest();

    expect(state.setTopicInvalid).not.toHaveBeenCalled();
    expect(state.setTopicSynthesis).not.toHaveBeenCalled();
    expect(state.setTopicHydrated).not.toHaveBeenCalled();
  });

  it('ignores correction envelopes whose scalar payload is non-string or unparseable', async () => {
    const correctionChain = createSubscribableChain();
    gunMocks.getTopicLatestSynthesisChain.mockReturnValue({ on: undefined });
    gunMocks.getTopicLatestSynthesisCorrectionChain.mockReturnValue(correctionChain.chain);

    const { hydrateSynthesisStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateSynthesisStore(() => ({}) as never, store, 'topic-1');

    // Non-string scalar under the envelope key -> decode returns null.
    correctionChain.emit({ __topic_synthesis_correction_json: 42 });
    // Malformed JSON string -> JSON.parse throws -> decode returns null.
    correctionChain.emit({ __topic_synthesis_correction_json: '{not valid json' });

    expect(state.setTopicCorrection).not.toHaveBeenCalled();
    expect(state.setTopicHydrated).not.toHaveBeenCalled();
  });

  it('ignores forbidden, invalid, and cross-topic correction payloads', async () => {
    const correctionChain = createSubscribableChain();
    gunMocks.getTopicLatestSynthesisChain.mockReturnValue({ on: undefined });
    gunMocks.getTopicLatestSynthesisCorrectionChain.mockReturnValue(correctionChain.chain);
    gunMocks.hasForbiddenSynthesisPayloadFields.mockImplementation((payload: unknown) => {
      return typeof payload === 'object' && payload !== null && 'token' in payload;
    });

    const { hydrateSynthesisStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateSynthesisStore(() => ({}) as never, store, 'topic-1');

    correctionChain.emit({ ...correction(), token: 'forbidden' });
    correctionChain.emit({ invalid: true });
    correctionChain.emit(correction({ topic_id: 'topic-2' }));

    expect(state.setTopicCorrection).not.toHaveBeenCalled();
    expect(state.setTopicHydrated).not.toHaveBeenCalled();
    expect(state.setTopicError).not.toHaveBeenCalled();
  });

  it('ignores invalid and forbidden payloads', async () => {
    const chain = createSubscribableChain();
    gunMocks.getTopicLatestSynthesisChain.mockReturnValue(chain.chain);
    gunMocks.getTopicLatestSynthesisCorrectionChain.mockReturnValue({ on: undefined });
    gunMocks.hasForbiddenSynthesisPayloadFields.mockImplementation((payload: unknown) => {
      return typeof payload === 'object' && payload !== null && 'token' in payload;
    });

    const { hydrateSynthesisStore } = await import('./hydration');
    const { store, state } = createStore();

    hydrateSynthesisStore(() => ({}) as never, store, 'topic-1');

    chain.emit(null);
    chain.emit({ invalid: true });
    chain.emit({ ...synthesis(), token: 'forbidden' });
    chain.emit(synthesis({ topic_id: 'topic-2' }));
    chain.emit({ __topic_synthesis_json: '{' });
    chain.emit({ __topic_synthesis_json: JSON.stringify({ ...synthesis(), token: 'forbidden' }) });
    await flushIngest();

    expect(state.setTopicSynthesis).not.toHaveBeenCalled();
    expect(state.setTopicCorrection).not.toHaveBeenCalled();
    expect(state.setTopicInvalid).not.toHaveBeenCalled();
    expect(state.setTopicHydrated).not.toHaveBeenCalled();
    expect(state.setTopicError).not.toHaveBeenCalled();
  });

  it('fails closed on invalid system-writer latest records and flags the topic invalid', async () => {
    const chain = createSubscribableChain();
    gunMocks.getTopicLatestSynthesisChain.mockReturnValue(chain.chain);
    gunMocks.getTopicLatestSynthesisCorrectionChain.mockReturnValue({ on: undefined });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const { hydrateSynthesisStore } = await import('./hydration');
      const { store, state } = createStore();
      const client = { config: {} };

      hydrateSynthesisStore(() => client as never, store, 'topic-1');

      chain.emit({
        _writerKind: 'system',
        _protocolVersion: 'luma-public-v1',
        _systemWriterId: 'vh-system-writer-dev-v1',
        _systemIssuedAt: 1_700_000_000_000,
        _systemSignature: 'tampered-signature',
        __topic_synthesis_json: JSON.stringify(synthesis()),
        topic_id: 'topic-1',
        synthesis_id: 'synth-3',
        epoch: 3
      });
      await flushIngest();

      expect(state.setTopicInvalid).toHaveBeenCalledWith('topic-1', true);
      expect(state.setTopicSynthesis).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
