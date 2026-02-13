import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  isOperationSeen,
  markOperationSeen,
  resetSeenOperations,
  DEDUP_TTL_MS,
  DEDUP_CLEANUP_THRESHOLD
} from './dedup';

describe('dedup', () => {
  beforeEach(() => {
    resetSeenOperations();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false for unseen operation', () => {
    expect(isOperationSeen('op-1')).toBe(false);
  });

  it('returns true after marking an operation as seen', () => {
    markOperationSeen('op-1');
    expect(isOperationSeen('op-1')).toBe(true);
  });

  it('returns false after TTL expires', () => {
    vi.useFakeTimers();
    markOperationSeen('op-ttl');
    expect(isOperationSeen('op-ttl')).toBe(true);

    vi.advanceTimersByTime(DEDUP_TTL_MS + 1);
    expect(isOperationSeen('op-ttl')).toBe(false);
  });

  it('cleans up expired entries when threshold is exceeded', () => {
    vi.useFakeTimers();
    // Fill past threshold with old entries
    for (let i = 0; i < DEDUP_CLEANUP_THRESHOLD + 1; i++) {
      markOperationSeen(`old-${i}`);
    }
    // Advance past TTL
    vi.advanceTimersByTime(DEDUP_TTL_MS + 1);

    // This mark triggers cleanup of all expired entries
    markOperationSeen('trigger-cleanup');
    // Old entries should have been cleaned
    expect(isOperationSeen('old-0')).toBe(false);
    // New entry is fresh
    expect(isOperationSeen('trigger-cleanup')).toBe(true);
  });

  it('does not clean up fresh entries during cleanup', () => {
    vi.useFakeTimers();
    for (let i = 0; i < DEDUP_CLEANUP_THRESHOLD; i++) {
      markOperationSeen(`fresh-${i}`);
    }
    // Add one more to trigger cleanup — all are fresh so none removed
    markOperationSeen('extra');
    expect(isOperationSeen('fresh-0')).toBe(true);
    expect(isOperationSeen('extra')).toBe(true);
  });

  it('resetSeenOperations clears all entries', () => {
    markOperationSeen('op-a');
    markOperationSeen('op-b');
    resetSeenOperations();
    expect(isOperationSeen('op-a')).toBe(false);
    expect(isOperationSeen('op-b')).toBe(false);
  });

  it('exports TTL and threshold constants', () => {
    expect(DEDUP_TTL_MS).toBe(60_000);
    expect(DEDUP_CLEANUP_THRESHOLD).toBe(500);
  });
});
