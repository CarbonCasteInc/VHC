function readStringEnv(name: string): string | undefined {
  const importMetaEnv = (
    globalThis as { __VH_IMPORT_META_ENV__?: Record<string, unknown> | undefined }
  ).__VH_IMPORT_META_ENV__ ?? (import.meta as unknown as { env?: Record<string, unknown> }).env;
  const importMetaValue = importMetaEnv?.[name];
  if (typeof importMetaValue === 'string' && importMetaValue.trim().length > 0) {
    return importMetaValue.trim();
  }

  if (typeof process !== 'undefined') {
    const processValue = process.env?.[name];
    if (typeof processValue === 'string' && processValue.trim().length > 0) {
      return processValue.trim();
    }
  }

  const globalValue = (globalThis as { __VH_GUN_CLIENT_CONFIG__?: Record<string, unknown> })
    .__VH_GUN_CLIENT_CONFIG__?.[name];
  if (typeof globalValue === 'string' && globalValue.trim().length > 0) {
    return globalValue.trim();
  }

  return undefined;
}

function parsePositiveMs(raw: string, fallbackMs: number, minMs = 250): number {
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
