/**
 * Client-side rate limiter for beta gating.
 * Stores attempt counts in localStorage with time windows.
 */
import { safeGetItem, safeSetItem } from '../../utils/safeStorage';

const RATE_LIMIT_KEY = 'vh_rate_limits';

export interface RateLimitWindow {
  count: number;
  windowStart: number;
}

export interface RateLimitStore {
  windows: Record<string, RateLimitWindow>;
}

export interface RateLimitConfig {
  key: string;
  maxAttempts: number;
  windowMs: number;
}

export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  identity_create: {
    key: 'identity_create',
    maxAttempts: 3,
    windowMs: 15 * 60 * 1000,
  },
  invite_validate: {
    key: 'invite_validate',
    maxAttempts: 10,
    windowMs: 5 * 60 * 1000,
  },
  invite_redeem: {
    key: 'invite_redeem',
    maxAttempts: 5,
    windowMs: 15 * 60 * 1000,
  },
  session_create: {
    key: 'session_create',
    maxAttempts: 5,
    windowMs: 10 * 60 * 1000,
  },
};

export function loadRateLimitStore(): RateLimitStore {
  try {
    const raw = safeGetItem(RATE_LIMIT_KEY);
    if (!raw) return { windows: {} };
    const parsed = JSON.parse(raw) as RateLimitStore;
    if (!parsed || typeof parsed.windows !== 'object') {
      return { windows: {} };
    }
    return parsed;
  } catch {
    return { windows: {} };
  }
}

export function persistRateLimitStore(store: RateLimitStore): void {
  safeSetItem(RATE_LIMIT_KEY, JSON.stringify(store));
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function checkRateLimit(
  configKey: string,
  now?: number,
): RateLimitResult {
  const timestamp = now ?? Date.now();
  const config = RATE_LIMITS[configKey];
  if (!config) {
    return { allowed: true, remaining: Infinity, retryAfterMs: 0 };
  }

  const store = loadRateLimitStore();
  const window = store.windows[config.key];

  if (!window || timestamp >= window.windowStart + config.windowMs) {
    return {
      allowed: true,
      remaining: config.maxAttempts - 1,
      retryAfterMs: 0,
    };
  }

  if (window.count >= config.maxAttempts) {
    const retryAfterMs = window.windowStart + config.windowMs - timestamp;
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  return {
    allowed: true,
    remaining: config.maxAttempts - window.count - 1,
    retryAfterMs: 0,
  };
}

export function recordAttempt(
  configKey: string,
  now?: number,
): RateLimitResult {
  const timestamp = now ?? Date.now();
  const config = RATE_LIMITS[configKey];
  if (!config) {
    return { allowed: true, remaining: Infinity, retryAfterMs: 0 };
  }

  const store = loadRateLimitStore();
  const window = store.windows[config.key];

  if (!window || timestamp >= window.windowStart + config.windowMs) {
    store.windows[config.key] = { count: 1, windowStart: timestamp };
    persistRateLimitStore(store);
    return {
      allowed: true,
      remaining: config.maxAttempts - 1,
      retryAfterMs: 0,
    };
  }

  if (window.count >= config.maxAttempts) {
    const retryAfterMs = window.windowStart + config.windowMs - timestamp;
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  store.windows[config.key] = {
    ...window,
    count: window.count + 1,
  };
  persistRateLimitStore(store);
  return {
    allowed: true,
    remaining: config.maxAttempts - window.count - 1,
    retryAfterMs: 0,
  };
}

export function resetRateLimit(configKey: string): void {
  const store = loadRateLimitStore();
  delete store.windows[configKey];
  persistRateLimitStore(store);
}

export function resetAllRateLimits(): void {
  persistRateLimitStore({ windows: {} });
}
