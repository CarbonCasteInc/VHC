/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MIN_TRUST_TO_VOTE, useGovernance, useGovernanceStore } from './useGovernance';
import { useXpLedger } from '../store/xpLedger';

const originalXpLedgerGetState = useXpLedger.getState;

function mockXpLedger(overrides: Record<string, unknown> = {}) {
  const setActiveNullifier = vi.fn();
  const canPerformAction = vi.fn(() => ({ allowed: true }));
  const consumeAction = vi.fn();
  const addXp = vi.fn();

  const mockedState = {
    setActiveNullifier,
    canPerformAction,
    consumeAction,
    addXp,
    ...overrides
  };

  useXpLedger.getState =
    () =>
      ({
        ...originalXpLedgerGetState(),
        ...mockedState
      } as any);

  return mockedState as {
    setActiveNullifier: ReturnType<typeof vi.fn>;
    canPerformAction: ReturnType<typeof vi.fn>;
    consumeAction: ReturnType<typeof vi.fn>;
    addXp: ReturnType<typeof vi.fn>;
    [key: string]: unknown;
  };
}

describe('useGovernance', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    // Reset zustand store to initial state (re-read from cleared storage)
    useGovernanceStore.setState({ storedVotesMap: {}, lastActions: {}, error: null });
  });

  afterEach(() => {
    useXpLedger.getState = originalXpLedgerGetState;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads proposals and tracks totals', () => {
    const { result } = renderHook(() => useGovernance('voter-1', 0.9));
    expect(result.current.proposals.length).toBeGreaterThan(0);
    expect(result.current.totalVotes).toBeGreaterThan(0);
  });

  it('submits votes and updates counts', async () => {
    const { result } = renderHook(() => useGovernance('voter-1', 0.9));
    const proposalId = result.current.proposals[0]!.id;
    await act(async () => {
      await result.current.submitVote({ proposalId, amount: 2, direction: 'for' });
    });
    expect(result.current.proposals.find((p) => p.id === proposalId)?.votesFor).toBeGreaterThan(12);
  });

  it('logs curated project mapping on vote', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { result } = renderHook(() => useGovernance('voter-1', 0.9));
    const proposalId = result.current.proposals[0]!.id;
    await act(async () => {
      await result.current.submitVote({ proposalId, amount: 1, direction: 'for' });
    });
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('On-chain ID: 101'));
    infoSpy.mockRestore();
  });

  it('rejects voting without identity or trust', async () => {
    const { result } = renderHook(() => useGovernance(undefined, 0.9));
    await expect(result.current.submitVote({ proposalId: 'proposal-1', amount: 1, direction: 'for' })).rejects.toThrow(
      /identity required/i
    );
  });

  it('hydrates stored votes for the same voter', async () => {
    const voterId = 'voter-2';
    const { result } = renderHook(() => useGovernance(voterId, 0.95));
    const proposalId = result.current.proposals[0]!.id;
    await act(async () => {
      await result.current.submitVote({ proposalId, amount: 3, direction: 'against' });
    });
    const persisted = JSON.parse(localStorage.getItem('vh_governance_votes') ?? '{}');
    expect(persisted[voterId][proposalId].amount).toBe(3);
    expect(JSON.parse(sessionStorage.getItem('vh_governance_votes') ?? '{}')[voterId][proposalId].amount).toBe(3);

    const { result: rerendered } = renderHook(() => useGovernance(voterId, 0.95));
    expect(rerendered.current.votedDirections[proposalId]).toBe('against');
    expect(rerendered.current.proposals.find((p) => p.id === proposalId)?.votesAgainst).toBe(6);
  });

  it('hydrates after voterId appears later', async () => {
    let voter: string | null = null;
    const { result, rerender } = renderHook(() => useGovernance(voter, 0.95));
    expect(result.current.votedDirections).toEqual({});

    voter = 'late-voter';
    await act(async () => {
      rerender();
    });
    const proposalId = result.current.proposals[0]!.id;
    await act(async () => {
      await result.current.submitVote({ proposalId, amount: 2, direction: 'for' });
    });
    expect(result.current.votedDirections[proposalId]).toBe('for');

    const { result: remount } = renderHook(() => useGovernance(voter, 0.95));
    expect(remount.current.votedDirections[proposalId]).toBe('for');
    expect(remount.current.proposals.find((p) => p.id === proposalId)?.votesFor).toBe(14);
  });

  it('isolates lastAction per voter', async () => {
    const { result: voterA } = renderHook(() => useGovernance('voter-A', 0.95));
    await act(async () => {
      await voterA.current.submitVote({ proposalId: voterA.current.proposals[0]!.id, amount: 1, direction: 'for' });
    });
    expect(voterA.current.lastAction).toContain('Vote recorded');

    const { result: voterB } = renderHook(() => useGovernance('voter-B', 0.95));
    expect(voterB.current.lastAction).toBeNull();
  });

  it('survives storage errors gracefully', async () => {
    const originalXp = useXpLedger.getState;
    // stub XP ledger to avoid storage writes during this test
    useXpLedger.getState = () =>
      ({
        setActiveNullifier: () => {},
        canPerformAction: () => ({ allowed: true }),
        consumeAction: () => {},
        addXp: () => {}
      } as any);

    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('boom');
    });
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('boom');
    });

    try {
      const { result } = renderHook(() => useGovernance('voter-storage', 0.95));
      expect(result.current.votedDirections).toEqual({});

      await act(async () => {
        await result.current.submitVote({ proposalId: result.current.proposals[0]!.id, amount: 1, direction: 'for' });
      });
      expect(result.current.proposals[0]!.votesFor).toBeGreaterThan(12);
    } finally {
      getItemSpy.mockRestore();
      setItemSpy.mockRestore();
      // restore xp
      useXpLedger.getState = originalXp;
    }
  });

  describe('storage guard hardening (#87)', () => {
    const assertSeedProposalCounts = (
      proposals: Array<{ id: string; votesFor: number; votesAgainst: number }>
    ) => {
      expect(proposals.find((p) => p.id === 'proposal-1')).toMatchObject({ votesFor: 12, votesAgainst: 3 });
      expect(proposals.find((p) => p.id === 'proposal-2')).toMatchObject({ votesFor: 8, votesAgainst: 1 });
    };

    it('T-1: readStoreMap rejects array in vote map key', () => {
      localStorage.setItem('vh_governance_votes', '[1,2,3]');

      const { result } = renderHook(() => useGovernance('v1', 0.95));

      expect(result.current.votedDirections).toEqual({});
      assertSeedProposalCounts(result.current.proposals);
    });

    it('T-2: readStoreMap rejects empty array', () => {
      localStorage.setItem('vh_governance_votes', '[]');

      const { result } = renderHook(() => useGovernance('v1', 0.95));

      expect(result.current.votedDirections).toEqual({});
      assertSeedProposalCounts(result.current.proposals);
    });

    it('T-3: readStoreMap rejects nested array of objects', () => {
      localStorage.setItem('vh_governance_votes', '[{"proposal-1":{"amount":1,"direction":"for"}}]');

      const { result } = renderHook(() => useGovernance('v1', 0.95));

      expect(result.current.votedDirections).toEqual({});
      assertSeedProposalCounts(result.current.proposals);
    });

    it('T-4: readFromStorage rejects array in per-voter key', () => {
      localStorage.setItem('vh_governance_votes:v1', '[{"amount":1,"direction":"for"}]');

      const { result } = renderHook(() => useGovernance('v1', 0.95));

      expect(result.current.votedDirections).toEqual({});
    });

    it('T-5: valid object still accepted (regression)', () => {
      localStorage.setItem('vh_governance_votes', '{"v1":{"proposal-1":{"amount":2,"direction":"for"}}}');

      const { result } = renderHook(() => useGovernance('v1', 0.95));

      expect(result.current.votedDirections['proposal-1']).toBe('for');
      expect(result.current.proposals.find((p) => p.id === 'proposal-1')?.votesFor).toBe(14);
    });

    it('T-6: null parsed value returns {}', () => {
      localStorage.setItem('vh_governance_votes', 'null');

      const { result } = renderHook(() => useGovernance('v1', 0.95));

      expect(result.current.votedDirections).toEqual({});
    });

    it('T-7: primitive number returns {}', () => {
      localStorage.setItem('vh_governance_votes', '42');

      const { result } = renderHook(() => useGovernance('v1', 0.95));

      expect(result.current.votedDirections).toEqual({});
    });

    it('T-8: primitive string returns {}', () => {
      localStorage.setItem('vh_governance_votes', '"hello"');

      const { result } = renderHook(() => useGovernance('v1', 0.95));

      expect(result.current.votedDirections).toEqual({});
    });
  });

  describe('governance vote budget enforcement', () => {
    let originalGetState: typeof useXpLedger.getState;

    beforeEach(() => {
      originalGetState = useXpLedger.getState;
    });

    afterEach(() => {
      useXpLedger.getState = originalGetState;
    });

    it('allows 20 governance votes and denies the 21st', async () => {
      const dailyLimitReason = 'Daily limit of 20 reached for governance_votes/day';
      const mockSetActiveNullifier = vi.fn();
      const mockConsume = vi.fn();
      const mockAddXp = vi.fn();
      let checks = 0;
      const mockCanPerform = vi.fn(() => {
        checks += 1;
        if (checks <= 20) return { allowed: true };
        return { allowed: false, reason: dailyLimitReason };
      });

      useXpLedger.getState =
        () =>
          ({
            ...originalGetState(),
            setActiveNullifier: mockSetActiveNullifier,
            canPerformAction: mockCanPerform,
            consumeAction: mockConsume,
            addXp: mockAddXp
          } as any);

      const { result } = renderHook(() => useGovernance('budget-voter', 0.95));
      const proposalId = result.current.proposals[0]!.id;

      for (let i = 0; i < 20; i += 1) {
        await act(async () => {
          await result.current.submitVote({
            proposalId,
            amount: 1,
            direction: i % 2 === 0 ? 'for' : 'against'
          });
        });
      }

      await expect(result.current.submitVote({ proposalId, amount: 1, direction: 'for' })).rejects.toThrow(
        dailyLimitReason
      );
      expect(mockCanPerform).toHaveBeenCalledTimes(21);
      expect(mockSetActiveNullifier).toHaveBeenCalledTimes(21);
      expect(mockConsume).toHaveBeenCalledTimes(20);
    });

    it('denied vote does not mutate stored votes or proposal counts', async () => {
      const denyReason = 'Daily limit of 20 reached for governance_votes/day';
      const mockCanPerform = vi.fn(() => ({ allowed: false, reason: denyReason }));

      useXpLedger.getState =
        () =>
          ({
            ...originalGetState(),
            setActiveNullifier: vi.fn(),
            canPerformAction: mockCanPerform,
            consumeAction: vi.fn(),
            addXp: vi.fn()
          } as any);

      const voterId = 'denied-voter';
      const { result } = renderHook(() => useGovernance(voterId, 0.95));
      const proposalId = result.current.proposals[0]!.id;
      const before = result.current.proposals.find((proposal) => proposal.id === proposalId)!;

      await expect(result.current.submitVote({ proposalId, amount: 2, direction: 'for' })).rejects.toThrow(denyReason);

      expect(useGovernanceStore.getState().storedVotesMap[voterId]).toBeUndefined();
      const after = result.current.proposals.find((proposal) => proposal.id === proposalId)!;
      expect(after.votesFor).toBe(before.votesFor);
      expect(after.votesAgainst).toBe(before.votesAgainst);
      expect(localStorage.getItem('vh_governance_votes')).toBeNull();
      expect(sessionStorage.getItem('vh_governance_votes')).toBeNull();
      expect(mockCanPerform).toHaveBeenCalledTimes(1);
    });

    it('enforces budget per nullifier so one voter does not block another', async () => {
      const denyReason = 'Daily limit of 20 reached for governance_votes/day';
      let activeNullifier: string | null = null;
      const mockSetActiveNullifier = vi.fn((nextNullifier: string | null) => {
        activeNullifier = nextNullifier;
      });
      const mockCanPerform = vi.fn(() =>
        activeNullifier === 'voter-A' ? { allowed: false, reason: denyReason } : { allowed: true }
      );
      const mockConsume = vi.fn();

      useXpLedger.getState =
        () =>
          ({
            ...originalGetState(),
            setActiveNullifier: mockSetActiveNullifier,
            canPerformAction: mockCanPerform,
            consumeAction: mockConsume,
            addXp: vi.fn()
          } as any);

      const { result: voterA } = renderHook(() => useGovernance('voter-A', 0.95));
      const { result: voterB } = renderHook(() => useGovernance('voter-B', 0.95));

      await expect(
        voterA.current.submitVote({ proposalId: voterA.current.proposals[0]!.id, amount: 1, direction: 'for' })
      ).rejects.toThrow(denyReason);

      await act(async () => {
        await voterB.current.submitVote({ proposalId: voterB.current.proposals[0]!.id, amount: 1, direction: 'for' });
      });

      expect(useGovernanceStore.getState().storedVotesMap['voter-A']).toBeUndefined();
      expect(useGovernanceStore.getState().storedVotesMap['voter-B']).toBeDefined();
      expect(mockSetActiveNullifier).toHaveBeenNthCalledWith(1, 'voter-A');
      expect(mockSetActiveNullifier).toHaveBeenNthCalledWith(2, 'voter-B');
      expect(mockConsume).toHaveBeenCalledTimes(1);
    });

    it('calls consumeAction once for a successful vote and never on denied votes', async () => {
      const denyReason = 'Daily limit of 20 reached for governance_votes/day';
      const mockSetActiveNullifier = vi.fn();
      const mockCanPerform = vi
        .fn()
        .mockReturnValueOnce({ allowed: true })
        .mockReturnValueOnce({ allowed: false, reason: denyReason });
      const mockConsume = vi.fn();

      useXpLedger.getState =
        () =>
          ({
            ...originalGetState(),
            setActiveNullifier: mockSetActiveNullifier,
            canPerformAction: mockCanPerform,
            consumeAction: mockConsume,
            addXp: vi.fn()
          } as any);

      const voterId = 'consume-check-voter';
      const { result } = renderHook(() => useGovernance(voterId, 0.95));
      const proposalId = result.current.proposals[0]!.id;

      await act(async () => {
        await result.current.submitVote({ proposalId, amount: 1, direction: 'for' });
      });

      await expect(result.current.submitVote({ proposalId, amount: 2, direction: 'against' })).rejects.toThrow(
        denyReason
      );

      expect(mockSetActiveNullifier).toHaveBeenCalledTimes(2);
      expect(mockConsume).toHaveBeenCalledTimes(1);
      expect(useGovernanceStore.getState().storedVotesMap[voterId]?.[proposalId]).toEqual({ amount: 1, direction: 'for' });
    });

    it('calls consumeAction for switched and updated votes too', async () => {
      const mockCanPerform = vi.fn(() => ({ allowed: true }));
      const mockConsume = vi.fn();
      const mockAddXp = vi.fn();

      useXpLedger.getState =
        () =>
          ({
            ...originalGetState(),
            setActiveNullifier: vi.fn(),
            canPerformAction: mockCanPerform,
            consumeAction: mockConsume,
            addXp: mockAddXp
          } as any);

      const { result } = renderHook(() => useGovernance('switch-update-voter', 0.95));
      const proposalId = result.current.proposals[0]!.id;

      let firstResult: Awaited<ReturnType<typeof result.current.submitVote>>;
      let secondResult: Awaited<ReturnType<typeof result.current.submitVote>>;
      let thirdResult: Awaited<ReturnType<typeof result.current.submitVote>>;

      await act(async () => {
        firstResult = await result.current.submitVote({ proposalId, amount: 1, direction: 'for' });
      });

      await act(async () => {
        secondResult = await result.current.submitVote({ proposalId, amount: 1, direction: 'against' });
      });

      await act(async () => {
        thirdResult = await result.current.submitVote({ proposalId, amount: 2, direction: 'against' });
      });

      expect(firstResult!).toBe('recorded');
      expect(secondResult!).toBe('switched');
      expect(thirdResult!).toBe('updated');
      expect(mockCanPerform).toHaveBeenCalledTimes(3);
      expect(mockConsume).toHaveBeenCalledTimes(3);
      expect(mockConsume).toHaveBeenNthCalledWith(1, 'governance_votes/day', 1);
      expect(mockConsume).toHaveBeenNthCalledWith(2, 'governance_votes/day', 1);
      expect(mockConsume).toHaveBeenNthCalledWith(3, 'governance_votes/day', 1);
      expect(mockAddXp).toHaveBeenCalledTimes(1);
    });
  });

  describe('coverage hardening matrix (T1-T26)', () => {
    it('T1: readFromStorage returns {} for non-object JSON (string primitive)', () => {
      localStorage.setItem('vh_governance_votes:edge-voter', '"just a string"');

      expect(useGovernanceStore.getState().getVotesForVoter('edge-voter')).toEqual({});
    });

    it('T2: readFromStorage returns {} for JSON number literal', () => {
      localStorage.setItem('vh_governance_votes:num-voter', '42');

      expect(useGovernanceStore.getState().getVotesForVoter('num-voter')).toEqual({});
    });

    it('T3: readStoreMap returns {} when map storage contains a JSON primitive', () => {
      localStorage.setItem('vh_governance_votes', '"not an object"');
      sessionStorage.setItem('vh_governance_votes', '"still not an object"');

      expect(useGovernanceStore.getState().getVotesForVoter('map-voter')).toEqual({});
    });

    it('T4: readFromStorage returns {} when storage value is JSON null', () => {
      localStorage.setItem('vh_governance_votes:null-voter', 'null');

      expect(useGovernanceStore.getState().getVotesForVoter('null-voter')).toEqual({});
    });

    it('T5: readFromStorage path handles one undefined storage global', () => {
      vi.stubGlobal('sessionStorage', undefined);
      localStorage.setItem(
        'vh_governance_votes:partial-storage-voter',
        JSON.stringify({ 'proposal-1': { amount: 2, direction: 'for' } })
      );

      expect(useGovernanceStore.getState().getVotesForVoter('partial-storage-voter')).toEqual({
        'proposal-1': { amount: 2, direction: 'for' }
      });
    });

    it('T6: gracefully handles undefined storage globals', () => {
      vi.stubGlobal('localStorage', undefined);
      vi.stubGlobal('sessionStorage', undefined);
      useGovernanceStore.setState({ storedVotesMap: {}, lastActions: {}, error: null });

      const { result } = renderHook(() => useGovernance('no-storage-voter', 0.95));
      expect(result.current.votedDirections).toEqual({});
      expect(result.current.proposals.find((p) => p.id === 'proposal-1')?.votesFor).toBe(12);
    });

    it('T7: persistStoredVotes is no-op when storage globals are undefined', () => {
      vi.stubGlobal('localStorage', undefined);
      vi.stubGlobal('sessionStorage', undefined);
      const ledger = mockXpLedger();

      const voteResult = useGovernanceStore.getState().submitVote({
        proposalId: 'proposal-1',
        amount: 1,
        direction: 'for',
        voterId: 'no-storage-write-voter',
        trustScore: 0.95,
        proposalTitle: undefined
      });

      expect(voteResult).toBe('recorded');
      expect(useGovernanceStore.getState().storedVotesMap['no-storage-write-voter']?.['proposal-1']).toEqual({
        amount: 1,
        direction: 'for'
      });
      expect(ledger.consumeAction).toHaveBeenCalledWith('governance_votes/day', 1);
    });

    it('T8: loadAllStoredVotes outer catch is defensive (branch ignored via v8 comment)', () => {
      localStorage.setItem('vh_governance_votes', '{not-json');

      expect(useGovernanceStore.getState().getVotesForVoter('outer-catch-voter')).toEqual({});
    });

    it('T9: submitVote rejects NaN trust score', () => {
      expect(() =>
        useGovernanceStore.getState().submitVote({
          proposalId: 'proposal-1',
          amount: 1,
          direction: 'for',
          voterId: 'nan-trust-voter',
          trustScore: Number.NaN,
          proposalTitle: 'NaN trust'
        })
      ).toThrow('Trust score below voting threshold');
      expect(useGovernanceStore.getState().error).toBe('Trust score below voting threshold');
    });

    it('T10: submitVote rejects negative trust score', () => {
      expect(() =>
        useGovernanceStore.getState().submitVote({
          proposalId: 'proposal-1',
          amount: 1,
          direction: 'for',
          voterId: 'negative-trust-voter',
          trustScore: -0.5,
          proposalTitle: 'Negative trust'
        })
      ).toThrow('Trust score below voting threshold');
      expect(useGovernanceStore.getState().error).toBe('Trust score below voting threshold');
    });

    it('T11: submitVote accepts trust score > 1 (clamped to 1)', () => {
      const ledger = mockXpLedger();

      const voteResult = useGovernanceStore.getState().submitVote({
        proposalId: 'proposal-2',
        amount: 1,
        direction: 'for',
        voterId: 'high-trust-voter',
        trustScore: 5,
        proposalTitle: 'High trust vote'
      });

      expect(voteResult).toBe('recorded');
      expect(ledger.canPerformAction).toHaveBeenCalledWith('governance_votes/day', 1);
    });

    it('T12: submitVote rejects null trust score', () => {
      expect(() =>
        useGovernanceStore.getState().submitVote({
          proposalId: 'proposal-1',
          amount: 1,
          direction: 'for',
          voterId: 'null-trust-voter',
          trustScore: null,
          proposalTitle: 'Null trust'
        })
      ).toThrow('Trust score below voting threshold');
      expect(useGovernanceStore.getState().error).toBe('Trust score below voting threshold');
    });

    it('T13: submitVote rejects trust score below MIN_TRUST_TO_VOTE', () => {
      expect(MIN_TRUST_TO_VOTE).toBe(0.7);

      expect(() =>
        useGovernanceStore.getState().submitVote({
          proposalId: 'proposal-1',
          amount: 1,
          direction: 'for',
          voterId: 'below-threshold-trust-voter',
          trustScore: MIN_TRUST_TO_VOTE - 0.01,
          proposalTitle: 'Below threshold trust'
        })
      ).toThrow('Trust score below voting threshold');
      expect(useGovernanceStore.getState().error).toBe('Trust score below voting threshold');
    });

    it('T14: store.getProposals returns seed proposals for null voterId', () => {
      const proposals = useGovernanceStore.getState().getProposals(null);

      expect(proposals).toHaveLength(2);
      expect(proposals[0]).toMatchObject({ id: 'proposal-1', votesFor: 12, votesAgainst: 3 });
      expect(proposals[1]).toMatchObject({ id: 'proposal-2', votesFor: 8, votesAgainst: 1 });
    });

    it('T15: store.getProposals applies stored votes for valid voterId', () => {
      useGovernanceStore.setState({
        storedVotesMap: {
          'store-proposals-voter': {
            'proposal-1': { amount: 4, direction: 'against' }
          }
        },
        lastActions: {},
        error: null
      });

      const proposals = useGovernanceStore.getState().getProposals('store-proposals-voter');
      const proposal = proposals.find((p) => p.id === 'proposal-1');

      expect(proposal?.votesFor).toBe(12);
      expect(proposal?.votesAgainst).toBe(7);
    });

    it('T16: store.getVotedDirections returns {} for null voterId', () => {
      expect(useGovernanceStore.getState().getVotedDirections(null)).toEqual({});
    });

    it('T17: store.getVotedDirections returns vote directions for valid voterId', () => {
      useGovernanceStore.setState({
        storedVotesMap: {
          'directions-voter': {
            'proposal-1': { amount: 3, direction: 'for' },
            'proposal-2': { amount: 1, direction: 'against' }
          }
        },
        lastActions: {},
        error: null
      });

      expect(useGovernanceStore.getState().getVotedDirections('directions-voter')).toEqual({
        'proposal-1': 'for',
        'proposal-2': 'against'
      });
    });

    it('T18: store.clearError resets error to null', () => {
      useGovernanceStore.setState({ error: 'some error' });

      useGovernanceStore.getState().clearError();

      expect(useGovernanceStore.getState().error).toBeNull();
    });

    it('T19: submitVote is no-op for amount 0', () => {
      useGovernanceStore.setState({ error: 'existing error' });

      const voteResult = useGovernanceStore.getState().submitVote({
        proposalId: 'proposal-1',
        amount: 0,
        direction: 'for',
        voterId: 'amount-zero-voter',
        trustScore: 0.95,
        proposalTitle: 'Amount zero vote'
      });

      expect(voteResult).toBeUndefined();
      expect(useGovernanceStore.getState().error).toBe('existing error');
      expect(useGovernanceStore.getState().storedVotesMap['amount-zero-voter']).toBeUndefined();
    });

    it('T20: submitVote is no-op for negative amount', () => {
      useGovernanceStore.setState({ error: 'still set' });

      const voteResult = useGovernanceStore.getState().submitVote({
        proposalId: 'proposal-1',
        amount: -5,
        direction: 'for',
        voterId: 'negative-amount-voter',
        trustScore: 0.95,
        proposalTitle: 'Negative amount vote'
      });

      expect(voteResult).toBeUndefined();
      expect(useGovernanceStore.getState().error).toBe('still set');
      expect(useGovernanceStore.getState().storedVotesMap['negative-amount-voter']).toBeUndefined();
    });

    it('T21: store.getVotesForVoter returns {} for falsy voterId', () => {
      expect(useGovernanceStore.getState().getVotesForVoter(null)).toEqual({});
      expect(useGovernanceStore.getState().getVotesForVoter(undefined)).toEqual({});
      expect(useGovernanceStore.getState().getVotesForVoter('')).toEqual({});
    });

    it('T22: submitVote uses default reason when budgetCheck.reason is undefined', () => {
      const canPerformAction = vi.fn(() => ({ allowed: false }));
      mockXpLedger({ canPerformAction });

      expect(() =>
        useGovernanceStore.getState().submitVote({
          proposalId: 'proposal-1',
          amount: 1,
          direction: 'for',
          voterId: 'default-reason-voter',
          trustScore: 0.95,
          proposalTitle: 'Budget default reason'
        })
      ).toThrow('Governance vote budget exhausted');

      expect(useGovernanceStore.getState().error).toBe('Governance vote budget exhausted');
    });

    it('T23: submitVote falls through curated title fallback to curated.title', () => {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      mockXpLedger();

      const voteResult = useGovernanceStore.getState().submitVote({
        proposalId: 'proposal-1',
        amount: 1,
        direction: 'for',
        voterId: 'curated-title-voter',
        trustScore: 0.95,
        proposalTitle: undefined
      });

      expect(voteResult).toBe('recorded');
      expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('Expand EV Charging Network'));
    });

    it('T24: submitVote uses proposalId when proposalTitle is undefined', () => {
      mockXpLedger();

      const voterId = 'proposal-id-fallback-voter';
      const proposalId = 'proposal-999';
      const voteResult = useGovernanceStore.getState().submitVote({
        proposalId,
        amount: 2,
        direction: 'against',
        voterId,
        trustScore: 0.95,
        proposalTitle: undefined
      });

      expect(voteResult).toBe('recorded');
      expect(useGovernanceStore.getState().lastActions[voterId]).toContain(`"${proposalId}"`);
    });

    it('T25: hook submitVote passes null when trustScore is undefined', async () => {
      const { result } = renderHook(() => useGovernance('hook-null-trust-voter'));

      await expect(result.current.submitVote({ proposalId: 'proposal-1', amount: 1, direction: 'for' })).rejects.toThrow(
        'Trust score below voting threshold'
      );
      expect(useGovernanceStore.getState().error).toBe('Trust score below voting threshold');
    });

    it('T26: loadStoredVotes returns mergedFallback object when no voter entry exists in map', () => {
      localStorage.setItem(
        'vh_governance_votes:merged-fallback-voter',
        JSON.stringify({ 'proposal-1': { amount: 2, direction: 'for' } })
      );
      sessionStorage.setItem(
        'vh_governance_votes:merged-fallback-voter',
        JSON.stringify({ 'proposal-2': { amount: 1, direction: 'against' } })
      );

      expect(useGovernanceStore.getState().getVotesForVoter('merged-fallback-voter')).toEqual({
        'proposal-1': { amount: 2, direction: 'for' },
        'proposal-2': { amount: 1, direction: 'against' }
      });
    });
  });

});
