export type LoggerLike = Pick<Console, 'info' | 'warn' | 'error'>;

export interface DaemonWriteLaneSnapshot {
  write_class: string;
  pending_depth: number;
  in_flight: number;
  completed_count: number;
  failed_count: number;
  p95_ms: number | null;
}

export interface DaemonWriteLaneRegistry {
  run<T>(
    writeClass: string,
    attributes: Record<string, unknown>,
    task: () => Promise<T>,
  ): Promise<T>;
  snapshot(): DaemonWriteLaneSnapshot[];
  stop(): void;
}

interface QueuedWrite<T> {
  attributes: Record<string, unknown>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  task: () => Promise<T>;
}

interface LaneState {
  pending: Array<QueuedWrite<unknown>>;
  inFlight: number;
  completedCount: number;
  failedCount: number;
  durations: number[];
}

export interface DaemonWriteLaneOptions {
  logger?: LoggerLike;
  now?: () => number;
  defaultConcurrency?: number;
  classConcurrency?: Record<string, number | undefined>;
  maxSamples?: number;
}

function normalizeConcurrency(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function p95(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index] ?? null;
}

export function createDaemonWriteLaneRegistry(
  options: DaemonWriteLaneOptions = {},
): DaemonWriteLaneRegistry {
  const logger = options.logger ?? console;
  const now = options.now ?? Date.now;
  const defaultConcurrency = normalizeConcurrency(options.defaultConcurrency, 2);
  const maxSamples = normalizeConcurrency(options.maxSamples, 100);
  const lanes = new Map<string, LaneState>();
  let stopped = false;

  const stateFor = (writeClass: string): LaneState => {
    const existing = lanes.get(writeClass);
    if (existing) {
      return existing;
    }
    const created: LaneState = {
      pending: [],
      inFlight: 0,
      completedCount: 0,
      failedCount: 0,
      durations: [],
    };
    lanes.set(writeClass, created);
    return created;
  };

  const concurrencyFor = (writeClass: string): number =>
    normalizeConcurrency(options.classConcurrency?.[writeClass], defaultConcurrency);

  const recordDuration = (state: LaneState, durationMs: number): number | null => {
    state.durations.push(durationMs);
    if (state.durations.length > maxSamples) {
      state.durations.splice(0, state.durations.length - maxSamples);
    }
    return p95(state.durations);
  };

  const drain = (writeClass: string): void => {
    if (stopped) {
      return;
    }
    const state = stateFor(writeClass);
    const maxInFlight = concurrencyFor(writeClass);
    while (state.inFlight < maxInFlight && state.pending.length > 0) {
      const item = state.pending.shift();
      if (!item) {
        continue;
      }
      state.inFlight += 1;
      const startedAt = now();
      logger.info('[vh:news-daemon] write lane started', {
        write_class: writeClass,
        pending_depth: state.pending.length,
        in_flight: state.inFlight,
        ...item.attributes,
      });
      void item.task()
        .then((value) => {
          const durationMs = Math.max(0, now() - startedAt);
          state.completedCount += 1;
          const p95Ms = recordDuration(state, durationMs);
          logger.info('[vh:news-daemon] write lane completed', {
            write_class: writeClass,
            duration_ms: durationMs,
            p95_ms: p95Ms,
            pending_depth: state.pending.length,
            in_flight: Math.max(0, state.inFlight - 1),
            completed_count: state.completedCount,
            failed_count: state.failedCount,
            ...item.attributes,
          });
          item.resolve(value);
        })
        .catch((error) => {
          const durationMs = Math.max(0, now() - startedAt);
          state.failedCount += 1;
          const p95Ms = recordDuration(state, durationMs);
          logger.warn('[vh:news-daemon] write lane failed', {
            write_class: writeClass,
            duration_ms: durationMs,
            p95_ms: p95Ms,
            pending_depth: state.pending.length,
            in_flight: Math.max(0, state.inFlight - 1),
            completed_count: state.completedCount,
            failed_count: state.failedCount,
            ...item.attributes,
            error,
          });
          item.reject(error);
        })
        .finally(() => {
          state.inFlight = Math.max(0, state.inFlight - 1);
          drain(writeClass);
        });
    }
  };

  return {
    run<T>(writeClass: string, attributes: Record<string, unknown>, task: () => Promise<T>): Promise<T> {
      if (stopped) {
        return Promise.reject(new Error(`daemon write lane stopped: ${writeClass}`));
      }
      const state = stateFor(writeClass);
      return new Promise<T>((resolve, reject) => {
        state.pending.push({
          attributes,
          resolve: resolve as (value: unknown) => void,
          reject,
          task: task as () => Promise<unknown>,
        });
        logger.info('[vh:news-daemon] write lane enqueued', {
          write_class: writeClass,
          pending_depth: state.pending.length,
          in_flight: state.inFlight,
          ...attributes,
        });
        queueMicrotask(() => drain(writeClass));
      });
    },

    snapshot(): DaemonWriteLaneSnapshot[] {
      return [...lanes.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([writeClass, state]) => ({
          write_class: writeClass,
          pending_depth: state.pending.length,
          in_flight: state.inFlight,
          completed_count: state.completedCount,
          failed_count: state.failedCount,
          p95_ms: p95(state.durations),
        }));
    },

    stop() {
      stopped = true;
      for (const [writeClass, state] of lanes) {
        const pending = state.pending.splice(0);
        for (const item of pending) {
          item.reject(new Error(`daemon write lane stopped: ${writeClass}`));
        }
      }
    },
  };
}
