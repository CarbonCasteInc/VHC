/* @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canAnalyze, recordAnalysis } from './useAnalysis';

const ANALYSIS_BUDGET_KEY = 'vh_analysis_budget';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

describe('useAnalysis budget env override', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
  });

  it('falls back to default limit when override is blank', () => {
    vi.stubEnv('VITE_VH_ANALYSIS_DAILY_LIMIT', '   ');
    localStorage.setItem(
      ANALYSIS_BUDGET_KEY,
      JSON.stringify({ date: todayIso(), count: 20 }),
    );

    expect(canAnalyze()).toBe(false);
  });

  it('falls back to default limit when override is invalid', () => {
    vi.stubEnv('VITE_VH_ANALYSIS_DAILY_LIMIT', 'not-a-number');
    localStorage.setItem(
      ANALYSIS_BUDGET_KEY,
      JSON.stringify({ date: todayIso(), count: 20 }),
    );

    expect(canAnalyze()).toBe(false);
  });

  it('disables budget enforcement when override is 0', () => {
    vi.stubEnv('VITE_VH_ANALYSIS_DAILY_LIMIT', '0');
    localStorage.setItem(
      ANALYSIS_BUDGET_KEY,
      JSON.stringify({ date: todayIso(), count: 999 }),
    );

    expect(canAnalyze()).toBe(true);
    recordAnalysis();

    expect(localStorage.getItem(ANALYSIS_BUDGET_KEY)).toBe(
      JSON.stringify({ date: todayIso(), count: 999 }),
    );
  });

  it('floors positive decimal overrides before enforcing the limit', () => {
    vi.stubEnv('VITE_VH_ANALYSIS_DAILY_LIMIT', '2.9');
    localStorage.setItem(
      ANALYSIS_BUDGET_KEY,
      JSON.stringify({ date: todayIso(), count: 1 }),
    );

    expect(canAnalyze()).toBe(true);
    recordAnalysis();
    expect(canAnalyze()).toBe(false);
    expect(localStorage.getItem(ANALYSIS_BUDGET_KEY)).toBe(
      JSON.stringify({ date: todayIso(), count: 2 }),
    );
  });
});
