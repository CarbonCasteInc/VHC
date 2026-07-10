import { pathToFileURL } from 'node:url';
import { isRelayRestAvailabilityTotalFailureError } from '@vh/gun-client';

export type ProcessLifecycle = Pick<typeof process, 'once' | 'exit'>;
export type CliLogger = Pick<Console, 'info' | 'error'>;
export const NEWS_DAEMON_FAIL_CLOSED_EXIT_CODE = 78;

/**
 * EX_UNAVAILABLE: the fail-close cause was a relay availability-total failure —
 * zero relays produced a validated acknowledgement after bounded endpoint-local
 * reconciliation and every POST remained network/deadline-unacknowledged. No
 * write-safety invariant is in doubt and the writes are id-keyed idempotent
 * upserts. systemd restarts exactly this exit code (`Restart=no` with
 * `RestartForceExitStatus=69`),
 * bounded by `StartLimitBurst`/`StartLimitIntervalSec`, giving transient
 * network blips a bounded self-recovery path while genuine write-safety halts
 * stay parked on 78 for operator inspection.
 *
 * 69 is chosen deliberately: the production wrapper already uses exit 75 for
 * sibling-daemon refusal and reap failures, so 75 would conflate a
 * duplicate-daemon incident (needs operator action) with a transport blip
 * (self-recovers). No other publisher tooling emits 69, so
 * ExecMainStatus=69 identifies this class unambiguously at the unit layer.
 */
export const NEWS_DAEMON_TRANSPORT_UNAVAILABLE_EXIT_CODE = 69;

/**
 * Fail-close always halts the process; only the exit code differs. Availability-
 * total relay failures exit EX_UNAVAILABLE(69) for bounded systemd restart;
 * every other fail-close cause keeps the non-restarting write-safety code 78.
 */
export function resolveFailClosedExitCode(error: unknown): number {
  return isRelayRestAvailabilityTotalFailureError(error)
    ? NEWS_DAEMON_TRANSPORT_UNAVAILABLE_EXIT_CODE
    : NEWS_DAEMON_FAIL_CLOSED_EXIT_CODE;
}

export interface CliDaemonProcessHandle {
  stop(): Promise<void>;
  readonly closed?: Promise<void>;
  closeExitCode?(): number | undefined;
}

export function isDirectExecution(metaUrl: string): boolean {
  const argvPath = process.argv[1];
  if (!argvPath) {
    return false;
  }
  try {
    return pathToFileURL(argvPath).href === metaUrl;
  } catch {
    return false;
  }
}

export async function runFromCli(
  startFromEnv: () => Promise<CliDaemonProcessHandle>,
  lifecycle: ProcessLifecycle = process,
  logger: CliLogger = console,
): Promise<void> {
  const processHandle = await startFromEnv();
  let exiting = false;
  const closeExitCode = (fallback: number): number => {
    const code = processHandle.closeExitCode?.();
    if (typeof code !== 'number') {
      return fallback;
    }
    return Number.isInteger(code) && code >= 0 && code <= 255 ? code : fallback;
  };
  const exitOnce = (code: number): void => {
    if (exiting) {
      return;
    }
    exiting = true;
    lifecycle.exit(code);
  };
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`[vh:news-daemon] received ${signal}; shutting down`);
    await processHandle.stop();
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    lifecycle.once(signal, () => {
      void shutdown(signal).finally(() => {
        exitOnce(0);
      });
    });
  }
  void processHandle.closed?.then(() => {
    exitOnce(closeExitCode(0));
  }, (error) => {
    logger.error('[vh:news-daemon] daemon process closed with error', error);
    exitOnce(closeExitCode(1));
  });
}
