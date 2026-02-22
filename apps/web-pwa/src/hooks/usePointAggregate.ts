import { useEffect, useState } from 'react';
import { readAggregates, type PointAggregate } from '@vh/gun-client';
import { resolveClientFromAppStore } from '../store/clientResolver';

type PointAggregateStatus = 'idle' | 'loading' | 'success' | 'error';
type PointAggregateTelemetryStatus = 'success' | 'error' | 'timeout';

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [500, 1000, 2000, 4000] as const;

export interface UsePointAggregateParams {
  readonly topicId: string;
  readonly synthesisId: string;
  readonly epoch: number;
  readonly pointId: string;
  readonly enabled?: boolean;
}

export interface UsePointAggregateResult {
  readonly aggregate: PointAggregate | null;
  readonly status: PointAggregateStatus;
  readonly error: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeErrorCode(error: unknown): string {
  if (error instanceof Error) {
    const normalizedMessage = error.message.toLowerCase();
    if (normalizedMessage.includes('timeout') || normalizedMessage.includes('timed out')) {
      return 'timeout';
    }

    return error.name || 'error';
  }

  return 'unknown_error';
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isZeroAggregate(aggregate: PointAggregate): boolean {
  return (
    aggregate.agree === 0 &&
    aggregate.disagree === 0 &&
    aggregate.participants === 0 &&
    aggregate.weight === 0
  );
}

function logAggregateRead(
  status: PointAggregateTelemetryStatus,
  params: {
    topicId: string;
    synthesisId: string;
    epoch: number;
    pointId: string;
    attempt: number;
    latencyMs: number;
    errorCode?: string;
    agree?: number;
    disagree?: number;
    participants?: number;
    weight?: number;
    zeroSnapshot?: boolean;
    retrying?: boolean;
  },
): void {
  const payload = {
    topic_id: params.topicId,
    synthesis_id: params.synthesisId,
    epoch: params.epoch,
    point_id: params.pointId,
    status,
    latency_ms: params.latencyMs,
    attempt: params.attempt,
    ...(params.errorCode ? { error_code: params.errorCode } : {}),
    ...(params.agree !== undefined ? { agree: params.agree } : {}),
    ...(params.disagree !== undefined ? { disagree: params.disagree } : {}),
    ...(params.participants !== undefined ? { participants: params.participants } : {}),
    ...(params.weight !== undefined ? { weight: params.weight } : {}),
    ...(params.zeroSnapshot !== undefined ? { zero_snapshot: params.zeroSnapshot } : {}),
    ...(params.retrying !== undefined ? { retrying: params.retrying } : {}),
  };

  if (status === 'success') {
    console.info('[vh:aggregate:read]', payload);
    return;
  }

  console.warn('[vh:aggregate:read]', payload);
}

export function usePointAggregate({
  topicId,
  synthesisId,
  epoch,
  pointId,
  enabled = true,
}: UsePointAggregateParams): UsePointAggregateResult {
  const [result, setResult] = useState<UsePointAggregateResult>({
    aggregate: null,
    status: 'idle',
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    if (!enabled || !topicId || !synthesisId || epoch === undefined || !pointId) {
      setResult({ aggregate: null, status: 'idle', error: null });
      return () => {
        cancelled = true;
      };
    }

    const client = resolveClientFromAppStore();
    if (!client) {
      setResult({ aggregate: null, status: 'idle', error: null });
      return () => {
        cancelled = true;
      };
    }

    setResult({ aggregate: null, status: 'loading', error: null });

    void (async () => {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        const attemptNumber = attempt + 1;
        const startedAt = Date.now();

        try {
          const aggregate = await readAggregates(client, topicId, synthesisId, epoch, pointId);
          if (cancelled) {
            return;
          }

          const zeroSnapshot = isZeroAggregate(aggregate);
          const shouldRetryZeroSnapshot = zeroSnapshot && attempt < MAX_RETRIES;

          logAggregateRead('success', {
            topicId,
            synthesisId,
            epoch,
            pointId,
            attempt: attemptNumber,
            latencyMs: Date.now() - startedAt,
            agree: aggregate.agree,
            disagree: aggregate.disagree,
            participants: aggregate.participants,
            weight: aggregate.weight,
            zeroSnapshot,
            retrying: shouldRetryZeroSnapshot,
          });

          setResult({
            aggregate,
            status: 'success',
            error: null,
          });

          if (!shouldRetryZeroSnapshot) {
            return;
          }

          const delayMs = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]!;
          await sleep(delayMs);
          if (cancelled) {
            break;
          }
          continue;
        } catch (error) {
          if (cancelled) {
            return;
          }

          const errorCode = normalizeErrorCode(error);
          logAggregateRead(errorCode === 'timeout' ? 'timeout' : 'error', {
            topicId,
            synthesisId,
            epoch,
            pointId,
            attempt: attemptNumber,
            latencyMs: Date.now() - startedAt,
            errorCode,
          });

          if (attempt >= MAX_RETRIES) {
            setResult({
              aggregate: null,
              status: 'error',
              error: normalizeErrorMessage(error),
            });
            continue;
          }

          const delayMs = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]!;
          await sleep(delayMs);
          if (cancelled) {
            break;
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, epoch, pointId, synthesisId, topicId]);

  return result;
}
