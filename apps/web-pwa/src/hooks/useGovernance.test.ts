/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGovernance, useGovernanceStore } from './useGovernance';
import { useXpLedger } from '../store/xpLedger';

describe('useGovernance', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    // Reset zustand store to initial state (re-read from cleared storage)
    useGovernanceStore.setState({ storedVotesMap: {}, lastActions: {}, error: null });
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
});
