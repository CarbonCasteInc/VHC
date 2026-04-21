import { pathToFileURL } from 'node:url';
import type { NewsAggregatorDaemonProcessHandle } from './daemon';

export type ProcessLifecycle = Pick<typeof process, 'once' | 'exit'>;
export type CliLogger = Pick<Console, 'info' | 'error'>;

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
  startFromEnv: () => Promise<NewsAggregatorDaemonProcessHandle>,
  lifecycle: ProcessLifecycle = process,
  logger: CliLogger = console,
): Promise<void> {
  const processHandle = await startFromEnv();
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`[vh:news-daemon] received ${signal}; shutting down`);
    await processHandle.stop();
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    lifecycle.once(signal, () => {
      void shutdown(signal).finally(() => {
        lifecycle.exit(0);
      });
    });
  }
}
