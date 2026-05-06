export const BASE_CONNECT_SRC = [
  "'self'",
  'http://localhost:2048',
  'ws://localhost:2048',
  'http://100.75.18.26:2048',
  'ws://100.75.18.26:2048',
  'http://localhost:*',
  'ws://localhost:*',
  'http://127.0.0.1:*',
  'ws://127.0.0.1:*',
  'http://100.75.18.26:7777',
  'ws://100.75.18.26:7777',
] as const;

export interface BuildCspOptions {
  readonly strictConnectSrc?: boolean;
}

function safeExtraConnectSrc(entry: string): boolean {
  if (entry === "'self'") return true;
  if (entry.includes('*')) return false;
  try {
    const url = new URL(entry);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return false;
    return url.origin === entry;
  } catch {
    return false;
  }
}

export function parseExtraConnectSrc(raw: string | undefined): string[] {
  return Array.from(new Set(
    (raw ?? '')
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .filter(safeExtraConnectSrc),
  ));
}

export function buildConnectSrc(extraConnectSrc?: string, options: BuildCspOptions = {}): string {
  const baseConnectSrc = options.strictConnectSrc ? ["'self'"] : BASE_CONNECT_SRC;
  return Array.from(new Set([
    ...baseConnectSrc,
    ...parseExtraConnectSrc(extraConnectSrc),
  ])).join(' ');
}

export function buildCspContent(extraConnectSrc?: string, options: BuildCspOptions = {}): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${buildConnectSrc(extraConnectSrc, options)}`,
    "frame-src 'self' https:",
    "img-src 'self' https: data: blob: http://localhost:* http://127.0.0.1:*",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
