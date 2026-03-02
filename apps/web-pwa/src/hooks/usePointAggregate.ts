import { useEffect, useState } from 'react';
import { readAggregates, type PointAggregate } from '@vh/gun-client';
import { resolveClientFromAppStore } from '../store/clientResolver';
import { consumeVoteTimestamp, logConvergenceLag } from '../utils/sentimentTelemetry';

type PointAggregateStatus = 'idle' | 'loading' | 'success' | 'error';
type PointAggregateTelemetryStatus = 'success' | 'error' | 'timeout';

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [500, 1000, 2000, 4000] as const;
const ZERO_SNAPSHOT_POLL_INTERVAL_MS = 3_000;
const ZERO_SNAPSHOT_POLL_ATTEMPTS = 10;
const LIVE_REFRESH_INTERVAL_MS = 4_000;

function isLiveRefreshEnabled(): boolean {
  const viteMode = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env?.MODE;
  if (viteMode === 'test') {
    return false;
  }
  return true;
}

const LIVE_REFRESH_ENABLED = isLiveRefreshEnabled();

export interface UsePointAggregateParams {
  readonly topicId: string;
  readonly synthesisId: string;
  readonly epoch: number;
  readonly pointId: string;
  readonly fallbackPointId?: string;
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

function areAggregatesEqual(left: PointAggregate | null, right: PointAggregate | null): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  return (
    left.point_id === right.point_id &&
    left.agree === right.agree &&
    left.disagree === right.disagree &&
    left.participants === right.participants &&
    left.weight === right.weight
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
    fallbackUsed?: boolean;
    fallbackPointId?: string;
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
    ...(params.fallbackUsed !== undefined ? { fallback_used: params.fallbackUsed } : {}),
    ...(params.fallbackPointId ? { fallback_point_id: params.fallbackPointId } : {}),
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
  fallbackPointId,
  enabled = true,
}: UsePointAggregateParams): UsePointAggregateResult {
  const effectiveFallbackPointId =
    fallbackPointId && fallbackPointId !== pointId ? fallbackPointId : undefined;
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
      let lastZeroAggregate: PointAggregate | null = null;

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

          if (!zeroSnapshot) {
            const voteTs = consumeVoteTimestamp(topicId, pointId);
            if (voteTs !== null) {
              const observedAt = Date.now();
              logConvergenceLag({
                topic_id: topicId,
                point_id: pointId,
                write_at: voteTs,
                observed_at: observedAt,
                lag_ms: Math.max(0, observedAt - voteTs),
              });
            }
            setResult({
              aggregate,
              status: 'success',
              error: null,
            });
            return;
          }

          lastZeroAggregate = aggregate;

          setResult({
            aggregate,
            status: 'success',
            error: null,
          });

          if (!shouldRetryZeroSnapshot) {
            break;
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

      // Fallback: if canonical exhausted retries with zeros and a distinct
      // fallback point ID is available, try it once before entering bounded
      // convergence polling.
      if (lastZeroAggregate && effectiveFallbackPointId && !cancelled) {
        const fallbackStartedAt = Date.now();
        try {
          const fallbackAggregate = await readAggregates(
            client,
            topicId,
            synthesisId,
            epoch,
            effectiveFallbackPointId,
          );
          if (cancelled) {
            return;
          }

          const fallbackZero = isZeroAggregate(fallbackAggregate);
          logAggregateRead('success', {
            topicId,
            synthesisId,
            epoch,
            pointId: effectiveFallbackPointId,
            attempt: MAX_RETRIES + 2,
            latencyMs: Date.now() - fallbackStartedAt,
            agree: fallbackAggregate.agree,
            disagree: fallbackAggregate.disagree,
            participants: fallbackAggregate.participants,
            weight: fallbackAggregate.weight,
            zeroSnapshot: fallbackZero,
            fallbackUsed: true,
            fallbackPointId: effectiveFallbackPointId,
          });

          if (!fallbackZero) {
            setResult({
              aggregate: fallbackAggregate,
              status: 'success',
              error: null,
            });
            return;
          }
        } catch {
          // Fallback read failed — keep the primary zero result.
        }
      }

      // Bounded convergence polling: mesh writes can land after initial read
      // retries (especially after reload). Keep polling while mounted so
      // cross-tab vote visibility converges without manual reopen.
      if (lastZeroAggregate && !cancelled) {
        for (let pollAttempt = 1; pollAttempt <= ZERO_SNAPSHOT_POLL_ATTEMPTS; pollAttempt += 1) {
          await sleep(ZERO_SNAPSHOT_POLL_INTERVAL_MS);
          if (cancelled) {
            return;
          }

          const attemptNumber = MAX_RETRIES + 2 + pollAttempt;
          const startedAt = Date.now();
          try {
            const aggregate = await readAggregates(client, topicId, synthesisId, epoch, pointId);
            if (cancelled) {
              return;
            }

            const zeroSnapshot = isZeroAggregate(aggregate);
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
              retrying: zeroSnapshot && pollAttempt < ZERO_SNAPSHOT_POLL_ATTEMPTS,
            });

            if (!zeroSnapshot) {
              setResult({
                aggregate,
                status: 'success',
                error: null,
              });
              return;
            }

            if (effectiveFallbackPointId) {
              const fallbackStartedAt = Date.now();
              try {
                const fallbackAggregate = await readAggregates(
                  client,
                  topicId,
                  synthesisId,
                  epoch,
                  effectiveFallbackPointId,
                );
                if (cancelled) {
                  return;
                }

                const fallbackZero = isZeroAggregate(fallbackAggregate);
                logAggregateRead('success', {
                  topicId,
                  synthesisId,
                  epoch,
                  pointId: effectiveFallbackPointId,
                  attempt: attemptNumber,
                  latencyMs: Date.now() - fallbackStartedAt,
                  agree: fallbackAggregate.agree,
                  disagree: fallbackAggregate.disagree,
                  participants: fallbackAggregate.participants,
                  weight: fallbackAggregate.weight,
                  zeroSnapshot: fallbackZero,
                  fallbackUsed: true,
                  fallbackPointId: effectiveFallbackPointId,
                });

                if (!fallbackZero) {
                  setResult({
                    aggregate: fallbackAggregate,
                    status: 'success',
                    error: null,
                  });
                  return;
                }
              } catch {
                // Best-effort fallback read during convergence polling.
              }
            }
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
          }
        }

        if (effectiveFallbackPointId) {
          console.warn('[vh:aggregate:convergence-zero]', {
            topic_id: topicId,
            synthesis_id: synthesisId,
            epoch,
            canonical_point_id: pointId,
            fallback_point_id: effectiveFallbackPointId,
            total_attempts: MAX_RETRIES + 2 + ZERO_SNAPSHOT_POLL_ATTEMPTS,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [effectiveFallbackPointId, enabled, epoch, pointId, synthesisId, topicId]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    if (!LIVE_REFRESH_ENABLED) {
      return () => {
        cancelled = true;
      };
    }

    if (!enabled || !topicId || !synthesisId || epoch === undefined || !pointId) {
      return () => {
        cancelled = true;
      };
    }

    const client = resolveClientFromAppStore();
    if (!client) {
      return () => {
        cancelled = true;
      };
    }

    const refreshLiveAggregate = async (): Promise<void> => {
      if (cancelled || inFlight) {
        return;
      }
      inFlight = true;

      try {
        const primary = await readAggregates(client, topicId, synthesisId, epoch, pointId);
        if (cancelled) {
          return;
        }

        let nextAggregate = primary;
        if (isZeroAggregate(primary) && effectiveFallbackPointId) {
          try {
            const fallback = await readAggregates(
              client,
              topicId,
              synthesisId,
              epoch,
              effectiveFallbackPointId,
            );
            if (!isZeroAggregate(fallback)) {
              nextAggregate = fallback;
            }
          } catch {
            // Best-effort fallback during background refresh.
          }
        }

        setResult((previous) => {
          if (
            previous.status === 'success' &&
            previous.error === null &&
            areAggregatesEqual(previous.aggregate, nextAggregate)
          ) {
            return previous;
          }

          return {
            aggregate: nextAggregate,
            status: 'success',
            error: null,
          };
        });
      } catch {
        // Ignore background refresh failures. Foreground read path reports errors.
      } finally {
        inFlight = false;
      }
    };

    void refreshLiveAggregate();
    const timer = setInterval(() => {
      void refreshLiveAggregate();
    }, LIVE_REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [effectiveFallbackPointId, enabled, epoch, pointId, synthesisId, topicId]);

  return result;
}
