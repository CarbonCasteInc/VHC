function readStringEnv(name: string): string | undefined {
  try {
    const importMetaValue = (import.meta as unknown as { env?: Record<string, unknown> }).env?.[name];
    if (typeof importMetaValue === 'string' && importMetaValue.trim().length > 0) {
      return importMetaValue.trim();
    }
  } catch {
    // ignore import.meta lookup failures
  }

  if (typeof process !== 'undefined') {
    const processValue = process.env?.[name];
    if (typeof processValue === 'string' && processValue.trim().length > 0) {
      return processValue.trim();
    }
  }

  try {
    const globalValue = (globalThis as { __VH_GUN_CLIENT_CONFIG__?: Record<string, unknown> })
      .__VH_GUN_CLIENT_CONFIG__?.[name];
    if (typeof globalValue === 'string' && globalValue.trim().length > 0) {
      return globalValue.trim();
    }
  } catch {
    // ignore global config lookup failures
  }

  return undefined;
}

function parsePositiveMs(raw: string | undefined, fallbackMs: number, minMs = 250): number {
  if (!raw) {
    return fallbackMs;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackMs;
  }
  return Math.max(minMs, Math.floor(parsed));
}

export function readGunTimeoutMs(
  names: readonly string[],
  fallbackMs: number,
  minMs = 250,
): number {
  for (const name of names) {
    const raw = readStringEnv(name);
    if (raw) {
      return parsePositiveMs(raw, fallbackMs, minMs);
    }
  }
  return fallbackMs;
}

