/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    const proposalId = result.current.proposals[0].id;
    await act(async () => {
      await result.current.submitVote({ proposalId, amount: 2, direction: 'for' });
    });
    expect(result.current.proposals.find((p) => p.id === proposalId)?.votesFor).toBeGreaterThan(12);
  });

  it('logs curated project mapping on vote', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { result } = renderHook(() => useGovernance('voter-1', 0.9));
    const proposalId = result.current.proposals[0].id;
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
    const proposalId = result.current.proposals[0].id;
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
    const proposalId = result.current.proposals[0].id;
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
      await voterA.current.submitVote({ proposalId: voterA.current.proposals[0].id, amount: 1, direction: 'for' });
    });
    expect(voterA.current.lastAction).toContain('Vote recorded');

    const { result: voterB } = renderHook(() => useGovernance('voter-B', 0.95));
    expect(voterB.current.lastAction).toBeNull();
  });

  it('survives storage errors gracefully', async () => {
    const originalXp = useXpLedger.getState;
    // stub XP ledger to avoid storage writes during this test
    // @ts-expect-error override for test
    useXpLedger.getState = () =>
      ({
        setActiveNullifier: () => {},
        addXp: () => {}
      } as any);

    const badStorage = {
      getItem: () => {
        throw new Error('boom');
      },
      setItem: () => {
        throw new Error('boom');
      }
    } as any;
    const originalLocal = globalThis.localStorage;
    const originalSession = globalThis.sessionStorage;
    // @ts-expect-error override for test
    globalThis.localStorage = badStorage;
    // @ts-expect-error override for test
    globalThis.sessionStorage = badStorage;

    const { result } = renderHook(() => useGovernance('voter-storage', 0.95));
    expect(result.current.votedDirections).toEqual({});

    await act(async () => {
      await result.current.submitVote({ proposalId: result.current.proposals[0].id, amount: 1, direction: 'for' });
    });
    expect(result.current.proposals[0].votesFor).toBeGreaterThan(12);

    // restore
    // @ts-expect-error restore for test
    globalThis.localStorage = originalLocal;
    // @ts-expect-error restore for test
    globalThis.sessionStorage = originalSession;
    // restore xp
    // @ts-expect-error restore
    useXpLedger.getState = originalXp;
  });
});
