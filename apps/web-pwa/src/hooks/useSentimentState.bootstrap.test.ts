/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const AGREEMENTS_KEY = 'vh_sentiment_agreements_v1';
const AGREEMENT_ALIASES_KEY = 'vh_sentiment_agreement_aliases_v1';

async function importFreshStore() {
  return import('./useSentimentState');
}

describe('useSentimentState storage bootstrap/persist guards', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('boots with empty maps when storage keys are absent', async () => {
    const { useSentimentState } = await importFreshStore();
    const state = useSentimentState.getState();

    expect(state.agreements).toEqual({});
    expect(state.pointIdAliases).toEqual({});
  });

  it('recovers from malformed persisted JSON payloads', async () => {
    localStorage.setItem(AGREEMENTS_KEY, '{malformed-json');
    localStorage.setItem(AGREEMENT_ALIASES_KEY, '{bad-alias-json');

    const { useSentimentState } = await importFreshStore();
    const state = useSentimentState.getState();

    expect(state.agreements).toEqual({});
    expect(state.pointIdAliases).toEqual({});
  });

  it('swallows persist exceptions when safeSetItem throws', async () => {
    vi.doMock('../utils/safeStorage', () => ({
      safeGetItem: () => null,
      safeSetItem: () => {
        throw new Error('simulated-write-failure');
      },
    }));

    vi.doMock('../store/xpLedger', () => ({
      useXpLedger: {
        getState: () => ({
          setActiveNullifier: () => {},
          canPerformAction: () => ({ allowed: true }),
          consumeAction: () => {},
        }),
      },
    }));

    vi.doMock('../store/clientResolver', () => ({
      resolveClientFromAppStore: () => null,
    }));

    vi.doMock('@vh/data-model', () => ({
      deriveAggregateVoterId: vi.fn().mockResolvedValue('voter-mock'),
      deriveVoteIntentId: vi.fn().mockResolvedValue('intent-mock'),
    }));

    vi.doMock('@vh/gun-client', () => ({
      writeSentimentEvent: vi.fn(),
      writeVoterNode: vi.fn(),
    }));

    vi.doMock('../utils/sentimentTelemetry', () => ({
      logVoteAdmission: vi.fn(),
      logMeshWriteResult: vi.fn(),
    }));

    const { useSentimentState } = await importFreshStore();

    expect(() => useSentimentState.getState().recordRead('topic-persist-guard')).not.toThrow();

    expect(() =>
      useSentimentState.getState().setAgreement({
        topicId: 'topic-persist-guard',
        pointId: 'legacy-point',
        synthesisPointId: 'synth-point',
        synthesisId: 'synth-id',
        epoch: 0,
        analysisId: 'analysis-id',
        desired: 1,
        constituency_proof: {
          district_hash: 'district',
          nullifier: 'nullifier',
          merkle_root: 'root',
        },
      }),
    ).not.toThrow();
  });
});
