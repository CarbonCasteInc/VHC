import { pathToFileURL } from 'node:url';

export type ProcessLifecycle = Pick<typeof process, 'once' | 'exit'>;
export type CliLogger = Pick<Console, 'info' | 'error'>;
export const NEWS_DAEMON_FAIL_CLOSED_EXIT_CODE = 78;

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
