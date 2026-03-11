interface RefreshableNewsState {
  refreshLatest: (limit?: number) => Promise<void>;
}

function readBridgeNumber(
  keys: ReadonlyArray<string>,
  fallback: number,
  min: number,
): number {
  for (const key of keys) {
    const nodeValue = (
      globalThis as { process?: { env?: Record<string, string | undefined> } }
    ).process?.env?.[key];
    const viteValue = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[key];
    const raw = nodeValue ?? viteValue;
    if (!raw) {
      continue;
    }
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= min) {
      return Math.floor(parsed);
    }
  }
  return fallback;
}

const NEWS_BRIDGE_REFRESH_TIMEOUT_MS = readBridgeNumber(
  ['VITE_NEWS_BRIDGE_REFRESH_TIMEOUT_MS', 'VH_NEWS_BRIDGE_REFRESH_TIMEOUT_MS'],
  60_000,
  5_000,
);
const NEWS_BRIDGE_REFRESH_ATTEMPTS = readBridgeNumber(
  ['VITE_NEWS_BRIDGE_REFRESH_ATTEMPTS', 'VH_NEWS_BRIDGE_REFRESH_ATTEMPTS'],
  3,
  1,
);
const NEWS_BRIDGE_REFRESH_BACKOFF_MS = readBridgeNumber(
  ['VITE_NEWS_BRIDGE_REFRESH_BACKOFF_MS', 'VH_NEWS_BRIDGE_REFRESH_BACKOFF_MS'],
  500,
  100,
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runRefreshLatestWithTimeout(newsState: RefreshableNewsState): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      newsState.refreshLatest(),
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`refreshLatest timeout after ${NEWS_BRIDGE_REFRESH_TIMEOUT_MS}ms`)),
          NEWS_BRIDGE_REFRESH_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
}

export async function runRefreshLatestWithRetry(
  newsState: RefreshableNewsState,
): Promise<void> {
  let lastError = new Error('refreshLatest failed');

  for (let attempt = 1; attempt <= NEWS_BRIDGE_REFRESH_ATTEMPTS; attempt += 1) {
    try {
      await runRefreshLatestWithTimeout(newsState);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < NEWS_BRIDGE_REFRESH_ATTEMPTS) {
        console.warn(
          `[vh:feed-bridge] refreshLatest attempt ${attempt}/${NEWS_BRIDGE_REFRESH_ATTEMPTS} failed; retrying`,
          error,
        );
        await sleep(NEWS_BRIDGE_REFRESH_BACKOFF_MS * attempt);
      }
    }
  }

  throw lastError;
}

export const feedBridgeRefreshInternal = {
  readBridgeNumber,
  runRefreshLatestWithTimeout,
};
