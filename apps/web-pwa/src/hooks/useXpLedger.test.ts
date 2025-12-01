/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from 'vitest';
import { useXpLedger } from './useXpLedger';

describe('useXpLedger', () => {
  beforeEach(() => {
    localStorage.clear();
    useXpLedger.setState({
      tracks: { civic: 0, social: 0, project: 0 },
      totalXP: 0,
      lastUpdated: 0,
      activeNullifier: null,
      addXp: useXpLedger.getState().addXp,
      calculateRvu: useXpLedger.getState().calculateRvu,
      claimDailyBoost: useXpLedger.getState().claimDailyBoost,
      setActiveNullifier: useXpLedger.getState().setActiveNullifier
    });
    useXpLedger.getState().setActiveNullifier('nullifier-1');
  });

  it('adds XP and recomputes total', () => {
    useXpLedger.getState().addXp('civic', 5);
    useXpLedger.getState().addXp('project', 3);
    const state = useXpLedger.getState();
    expect(state.tracks.civic).toBe(5);
    expect(state.tracks.project).toBe(3);
    expect(state.totalXP).toBe(8);
    const persisted = JSON.parse(localStorage.getItem('vh_xp_ledger:nullifier-1') ?? '{}');
    expect(persisted.totalXP).toBe(8);
  });

  it('calculates RVU with scaled trust score', () => {
    useXpLedger.getState().addXp('civic', 10);
    const rvu = useXpLedger.getState().calculateRvu(0.75);
    expect(rvu).toBeCloseTo(7.5);
  });

  it('clamps trustScore when above 1 or below 0', () => {
    useXpLedger.getState().addXp('civic', 4);
    expect(useXpLedger.getState().calculateRvu(5)).toBeCloseTo(4);
    expect(useXpLedger.getState().calculateRvu(-2)).toBeCloseTo(0);
  });

  it('claims daily boost only when trustScore >= 0.5', () => {
    const none = useXpLedger.getState().claimDailyBoost(0.4);
    expect(none).toBe(0);
    const boosted = useXpLedger.getState().claimDailyBoost(0.6);
    expect(boosted).toBe(10);
    expect(useXpLedger.getState().totalXP).toBeGreaterThan(0);
  });

  it('switches ledgers when nullifier changes', () => {
    useXpLedger.getState().addXp('project', 4);
    useXpLedger.getState().setActiveNullifier('nullifier-2');
    expect(useXpLedger.getState().totalXP).toBe(0);
    useXpLedger.getState().addXp('project', 2);
    expect(JSON.parse(localStorage.getItem('vh_xp_ledger:nullifier-2') ?? '{}').totalXP).toBe(2);
    useXpLedger.getState().setActiveNullifier('nullifier-1');
    expect(useXpLedger.getState().tracks.project).toBe(4);
  });
});
