/* @vitest-environment jsdom */

import { describe, expect, it, beforeEach } from 'vitest';
import { safeSetItem } from '../../utils/safeStorage';
import {
  checkRateLimit,
  recordAttempt,
  resetRateLimit,
  resetAllRateLimits,
  RATE_LIMITS,
  loadRateLimitStore,
} from './rateLimiter';

const NOW = 1_700_000_000_000;

beforeEach(() => {
  safeSetItem('vh_rate_limits', '');
  safeSetItem('vh_invite_tokens', '');
  safeSetItem('vh_audit_log', '');
  safeSetItem('vh_invite_kill_switch', '');
});

describe('checkRateLimit', () => {
  it('allows first attempt', () => {
    const result = checkRateLimit('invite_validate', NOW);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(
      RATE_LIMITS['invite_validate']!.maxAttempts - 1,
    );
  });

  it('uses Date.now() when now parameter is omitted', () => {
    const result = checkRateLimit('invite_validate');
    expect(result.allowed).toBe(true);
  });

  it('allows unknown config key', () => {
    const result = checkRateLimit('unknown_key', NOW);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(Infinity);
  });

  it('returns remaining when within active window and under limit', () => {
    const config = RATE_LIMITS['invite_validate']!;
    recordAttempt('invite_validate', NOW);
    recordAttempt('invite_validate', NOW + 100);
    const result = checkRateLimit('invite_validate', NOW + 200);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(config.maxAttempts - 2 - 1);
    expect(result.retryAfterMs).toBe(0);
  });

  it('resets window after expiry', () => {
    const config = RATE_LIMITS['invite_validate']!;
    for (let i = 0; i < config.maxAttempts; i++) {
      recordAttempt('invite_validate', NOW + i);
    }
    expect(checkRateLimit('invite_validate', NOW + 100).allowed).toBe(false);

    const afterWindow = NOW + config.windowMs + 1;
    expect(checkRateLimit('invite_validate', afterWindow).allowed).toBe(true);
  });
});

describe('recordAttempt', () => {
  it('uses Date.now() when now parameter is omitted', () => {
    const result = recordAttempt('invite_validate');
    expect(result.allowed).toBe(true);
  });

  it('tracks attempts within window', () => {
    const r1 = recordAttempt('identity_create', NOW);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = recordAttempt('identity_create', NOW + 1000);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = recordAttempt('identity_create', NOW + 2000);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);

    const r4 = recordAttempt('identity_create', NOW + 3000);
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
    expect(r4.retryAfterMs).toBeGreaterThan(0);
  });

  it('calculates correct retryAfterMs', () => {
    const config = RATE_LIMITS['identity_create']!;
    for (let i = 0; i < config.maxAttempts; i++) {
      recordAttempt('identity_create', NOW + i);
    }
    const result = recordAttempt('identity_create', NOW + 5000);
    expect(result.retryAfterMs).toBe(config.windowMs - 5000);
  });

  it('allows unknown config key', () => {
    const result = recordAttempt('unknown', NOW);
    expect(result.allowed).toBe(true);
  });
});

describe('resetRateLimit', () => {
  it('resets a specific limit', () => {
    for (let i = 0; i < 3; i++) {
      recordAttempt('identity_create', NOW + i);
    }
    expect(checkRateLimit('identity_create', NOW + 100).allowed).toBe(false);

    resetRateLimit('identity_create');
    expect(checkRateLimit('identity_create', NOW + 100).allowed).toBe(true);
  });
});

describe('resetAllRateLimits', () => {
  it('resets all limits', () => {
    for (let i = 0; i < 10; i++) {
      recordAttempt('invite_validate', NOW + i);
    }
    for (let i = 0; i < 3; i++) {
      recordAttempt('identity_create', NOW + i);
    }

    resetAllRateLimits();
    expect(checkRateLimit('invite_validate', NOW + 100).allowed).toBe(true);
    expect(checkRateLimit('identity_create', NOW + 100).allowed).toBe(true);
  });
});

describe('loadRateLimitStore', () => {
  it('returns empty store when localStorage is empty', () => {
    expect(loadRateLimitStore()).toEqual({ windows: {} });
  });

  it('handles corrupted localStorage', () => {
    safeSetItem('vh_rate_limits', '{bad');
    expect(loadRateLimitStore()).toEqual({ windows: {} });
  });

  it('handles malformed windows', () => {
    safeSetItem('vh_rate_limits', '{"windows": "not-object"}');
    expect(loadRateLimitStore()).toEqual({ windows: {} });
  });
});

describe('RATE_LIMITS config', () => {
  it('defines 4 rate limit configs', () => {
    expect(Object.keys(RATE_LIMITS)).toHaveLength(4);
  });

  it.each(['identity_create', 'invite_validate', 'invite_redeem', 'session_create'])(
    'config "%s" has valid limits',
    (key) => {
      const config = RATE_LIMITS[key]!;
      expect(config.maxAttempts).toBeGreaterThan(0);
      expect(config.windowMs).toBeGreaterThan(0);
    },
  );
});
