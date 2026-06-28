export const DEFAULT_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES = 1_100_000_000;
export const DEFAULT_RELAY_WATCHDOG_MAX_RSS_BYTES = 1_800_000_000;

function parsePositiveInt(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolvePositiveEnv(env, names, fallback, fallbackSource) {
  for (const name of names) {
    const parsed = parsePositiveInt(env[name]);
    if (parsed !== null) {
      return { value: parsed, source: name };
    }
  }
  return { value: fallback, source: fallbackSource };
}

export function resolveRelayWatchdogLimits(env = process.env, {
  heapOverrideEnvNames = [],
  rssOverrideEnvNames = [],
} = {}) {
  const heap = resolvePositiveEnv(
    env,
    [...heapOverrideEnvNames, 'VH_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES'],
    DEFAULT_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES,
    'default:public-beta-compose',
  );
  const rss = resolvePositiveEnv(
    env,
    [...rssOverrideEnvNames, 'VH_RELAY_WATCHDOG_MAX_RSS_BYTES'],
    DEFAULT_RELAY_WATCHDOG_MAX_RSS_BYTES,
    'default:relay-server',
  );
  return {
    heapLimitBytes: heap.value,
    heapLimitSource: heap.source,
    rssLimitBytes: rss.value,
    rssLimitSource: rss.source,
  };
}
