export const DEFAULT_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES = 1_100_000_000;
export const DEFAULT_RELAY_WATCHDOG_MAX_RSS_BYTES = 1_800_000_000;
export const PUBLIC_BETA_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES = {
  'relay-a': 850_000_000,
  'relay-b': 1_000_000_000,
  'relay-c': 1_150_000_000,
};

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

export function normalizePublicBetaRelayKey(name) {
  const normalized = String(name ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (!normalized) return null;
  const direct = normalized.match(/^relay-([abc])$/);
  if (direct) return `relay-${direct[1]}`;
  const suffixed = normalized.match(/(?:^|-)relay-([abc])$/);
  return suffixed ? `relay-${suffixed[1]}` : null;
}

export function publicBetaRelayHeapEnvName(name) {
  const relayKey = normalizePublicBetaRelayKey(name);
  if (!relayKey) return null;
  const suffix = relayKey.at(-1).toUpperCase();
  return `VH_RELAY_${suffix}_WATCHDOG_MAX_HEAP_USED_BYTES`;
}

function publicBetaRelayHeapDefault(name) {
  const relayKey = normalizePublicBetaRelayKey(name);
  if (!relayKey) return null;
  const value = PUBLIC_BETA_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES[relayKey];
  return Number.isFinite(value) ? {
    value,
    source: `default:public-beta-compose:${relayKey}`,
  } : null;
}

export function resolveRelayWatchdogLimits(env = process.env, {
  heapOverrideEnvNames = [],
  rssOverrideEnvNames = [],
  targetName = null,
} = {}) {
  const targetHeapEnvName = publicBetaRelayHeapEnvName(targetName);
  const targetHeapDefault = publicBetaRelayHeapDefault(targetName);
  const heap = resolvePositiveEnv(
    env,
    [
      ...heapOverrideEnvNames,
      ...(targetHeapEnvName ? [targetHeapEnvName] : []),
      'VH_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES',
    ],
    targetHeapDefault?.value ?? DEFAULT_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES,
    targetHeapDefault?.source ?? 'default:public-beta-compose',
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
