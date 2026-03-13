import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAnalysisInternal } from './useAnalysis';

describe('useAnalysis pending wait window override', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('honors a valid override and falls back for invalid values', () => {
    vi.stubEnv('VITE_VH_ANALYSIS_PENDING_WAIT_WINDOW_MS', '1800');
    expect(useAnalysisInternal.resolvePendingWaitWindowMs()).toBe(1800);

    vi.stubEnv('VITE_VH_ANALYSIS_PENDING_WAIT_WINDOW_MS', 'invalid');
    expect(useAnalysisInternal.resolvePendingWaitWindowMs()).toBe(35_000);
  });
});
