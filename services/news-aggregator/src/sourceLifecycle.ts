export type SourceStatus = 'healthy' | 'retrying' | 'failing';

export interface SourceLifecycleState {
  readonly sourceDomain: string;
  readonly status: SourceStatus;
  readonly totalAttempts: number;
  readonly totalSuccesses: number;
  readonly totalFailures: number;
  readonly consecutiveFailures: number;
  readonly retryCount: number;
  readonly lastAttemptAt: number | null;
  readonly lastSuccessAt: number | null;
  readonly lastFailureAt: number | null;
  readonly lastRetryAt: number | null;
  readonly nextRetryAt: number | null;
  readonly lastBackoffMs: number | null;
  readonly lastErrorMessage: string | null;
}

export interface SourceLifecycleOptions {
  readonly now?: () => number;
  readonly baseBackoffMs?: number;
  readonly maxBackoffMs?: number;
}

export const RETRY_BASE_BACKOFF_MS = 250;
export const RETRY_MAX_BACKOFF_MS = 8_000;

function initialState(sourceDomain: string): SourceLifecycleState {
  return {
    sourceDomain,
    status: 'healthy',
    totalAttempts: 0,
    totalSuccesses: 0,
    totalFailures: 0,
    consecutiveFailures: 0,
    retryCount: 0,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastRetryAt: null,
    nextRetryAt: null,
    lastBackoffMs: null,
    lastErrorMessage: null,
  };
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function calculateBackoffMs(attempt: number, baseBackoffMs: number, maxBackoffMs: number): number {
  const exponent = Math.max(0, attempt - 1);
  return Math.min(maxBackoffMs, baseBackoffMs * 2 ** exponent);
}

export class SourceLifecycleTracker {
  private readonly now: () => number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly states = new Map<string, SourceLifecycleState>();

  constructor(options: SourceLifecycleOptions = {}) {
    this.now = options.now ?? Date.now;
    this.baseBackoffMs = options.baseBackoffMs ?? RETRY_BASE_BACKOFF_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? RETRY_MAX_BACKOFF_MS;
  }

  canAttempt(sourceDomain: string, atMs: number = this.now()): boolean {
    const state = this.states.get(sourceDomain);
    if (!state?.nextRetryAt) {
      return true;
    }
    return atMs >= state.nextRetryAt;
  }

  recordAttempt(sourceDomain: string): SourceLifecycleState {
    return this.update(sourceDomain, (state) => ({
      ...state,
      totalAttempts: state.totalAttempts + 1,
      lastAttemptAt: this.now(),
    }));
  }

  recordRetry(sourceDomain: string, error: unknown, attempt: number): SourceLifecycleState {
    const now = this.now();
    const delayMs = calculateBackoffMs(attempt, this.baseBackoffMs, this.maxBackoffMs);

    return this.update(sourceDomain, (state) => ({
      ...state,
      status: 'retrying',
      retryCount: state.retryCount + 1,
      lastRetryAt: now,
      nextRetryAt: now + delayMs,
      lastBackoffMs: delayMs,
      lastErrorMessage: normalizeErrorMessage(error),
    }));
  }

  recordFailure(sourceDomain: string, error: unknown): SourceLifecycleState {
    const now = this.now();
    return this.update(sourceDomain, (state) => ({
      ...state,
      status: 'failing',
      totalFailures: state.totalFailures + 1,
      consecutiveFailures: state.consecutiveFailures + 1,
      lastFailureAt: now,
      nextRetryAt: null,
      lastErrorMessage: normalizeErrorMessage(error),
    }));
  }

  recordSuccess(sourceDomain: string): SourceLifecycleState {
    return this.update(sourceDomain, (state) => ({
      ...state,
      status: 'healthy',
      totalSuccesses: state.totalSuccesses + 1,
      consecutiveFailures: 0,
      lastSuccessAt: this.now(),
      nextRetryAt: null,
      lastBackoffMs: null,
      lastErrorMessage: null,
    }));
  }

  getState(sourceDomain: string): SourceLifecycleState | null {
    const state = this.states.get(sourceDomain);
    return state ? { ...state } : null;
  }

  snapshot(): SourceLifecycleState[] {
    return Array.from(this.states.values())
      .map((state) => ({ ...state }))
      .sort((a, b) => a.sourceDomain.localeCompare(b.sourceDomain));
  }

  private update(
    sourceDomain: string,
    updater: (state: SourceLifecycleState) => SourceLifecycleState,
  ): SourceLifecycleState {
    const current = this.states.get(sourceDomain) ?? initialState(sourceDomain);
    const next = updater(current);
    this.states.set(sourceDomain, next);
    return { ...next };
  }
}

export const sourceLifecycleInternal = {
  calculateBackoffMs,
  normalizeErrorMessage,
};
