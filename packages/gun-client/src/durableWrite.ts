import { putWithAckTimeout, type ChainWithGet, type PutAckResult } from './chain';
import { readGunTimeoutMs } from './runtimeConfig';

export type DurableWriteEventStage =
  | 'acked'
  | 'ack-timeout'
  | 'readback-confirmed'
  | 'relay-fallback'
  | 'failed';

export interface DurableWriteEvent {
  readonly writeClass: string;
  readonly stage: DurableWriteEventStage;
  readonly attempt?: number;
  readonly ack?: PutAckResult;
  readonly error?: string;
}

export interface DurableWriteResult {
  readonly ack: PutAckResult;
  readonly readback_confirmed: boolean;
  readonly relay_fallback: boolean;
}

export interface DurableWriteOptions<T> {
  readonly chain: ChainWithGet<T>;
  readonly value: T;
  readonly writeClass: string;
  readonly timeoutMs: number;
  readonly timeoutError?: string;
  readonly readback?: () => Promise<unknown>;
  readonly readbackPredicate?: (observed: unknown) => boolean;
  readonly readbackAttempts?: number;
  readonly readbackRetryMs?: number;
  readonly relayFallback?: () => Promise<boolean>;
  readonly onAckTimeout?: () => void;
  readonly onEvent?: (event: DurableWriteEvent) => void;
}

const DEFAULT_READBACK_ATTEMPTS = 6;
const DEFAULT_READBACK_RETRY_MS = readGunTimeoutMs(
  ['VITE_VH_GUN_DURABLE_WRITE_READBACK_RETRY_MS', 'VH_GUN_DURABLE_WRITE_READBACK_RETRY_MS'],
  250,
  25,
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emitDefaultDurableWriteEvent(event: DurableWriteEvent): void {
  if (event.stage === 'acked') {
    return;
  }
  const payload = {
    write_class: event.writeClass,
    stage: event.stage,
    attempt: event.attempt,
    acknowledged: event.ack?.acknowledged,
    timed_out: event.ack?.timedOut,
    latency_ms: event.ack?.latencyMs,
    error: event.error,
  };
  const label = '[vh:mesh:durable-write]';
  if (event.stage === 'failed') {
    console.warn(label, payload);
    return;
  }
  console.info(label, payload);
}

function emitEvent(options: DurableWriteOptions<unknown>, event: DurableWriteEvent): void {
  if (options.onEvent) {
    options.onEvent(event);
    return;
  }
  emitDefaultDurableWriteEvent(event);
}

async function confirmReadback<T>(options: DurableWriteOptions<T>): Promise<boolean> {
  if (!options.readback || !options.readbackPredicate) {
    return false;
  }

  const attempts = Math.max(1, Math.floor(options.readbackAttempts ?? DEFAULT_READBACK_ATTEMPTS));
  const retryMs = Math.max(0, Math.floor(options.readbackRetryMs ?? DEFAULT_READBACK_RETRY_MS));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const observed = await options.readback();
      if (options.readbackPredicate(observed)) {
        emitEvent(options as DurableWriteOptions<unknown>, {
          writeClass: options.writeClass,
          stage: 'readback-confirmed',
          attempt,
        });
        return true;
      }
    } catch (error) {
      if (attempt === attempts) {
        emitEvent(options as DurableWriteOptions<unknown>, {
          writeClass: options.writeClass,
          stage: 'failed',
          attempt,
          error: toErrorMessage(error),
        });
      }
    }

    if (attempt < attempts && retryMs > 0) {
      await sleep(retryMs);
    }
  }
  return false;
}

export async function writeWithDurability<T>(options: DurableWriteOptions<T>): Promise<DurableWriteResult> {
  const ack = await putWithAckTimeout(options.chain, options.value, {
    timeoutMs: options.timeoutMs,
    onTimeout: options.onAckTimeout,
  });

  if (!ack.timedOut) {
    emitEvent(options as DurableWriteOptions<unknown>, {
      writeClass: options.writeClass,
      stage: 'acked',
      ack,
    });
    return {
      ack,
      readback_confirmed: false,
      relay_fallback: false,
    };
  }

  emitEvent(options as DurableWriteOptions<unknown>, {
    writeClass: options.writeClass,
    stage: 'ack-timeout',
    ack,
  });

  if (await confirmReadback(options)) {
    return {
      ack,
      readback_confirmed: true,
      relay_fallback: false,
    };
  }

  if (options.relayFallback && await options.relayFallback()) {
    emitEvent(options as DurableWriteOptions<unknown>, {
      writeClass: options.writeClass,
      stage: 'relay-fallback',
      ack,
    });
    return {
      ack,
      readback_confirmed: false,
      relay_fallback: true,
    };
  }

  const errorMessage = options.timeoutError
    ?? `${options.writeClass} write timed out and readback did not confirm persistence`;
  emitEvent(options as DurableWriteOptions<unknown>, {
    writeClass: options.writeClass,
    stage: 'failed',
    ack,
    error: errorMessage,
  });
  throw new Error(errorMessage);
}
