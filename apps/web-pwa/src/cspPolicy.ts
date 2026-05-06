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

const SAFE_SOURCE_PATTERN = /^(?:'self'|https?:\/\/[A-Za-z0-9.*:_-]+|wss?:\/\/[A-Za-z0-9.*:_-]+)$/;

export function parseExtraConnectSrc(raw: string | undefined): string[] {
  return Array.from(new Set(
    (raw ?? '')
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .filter((entry) => SAFE_SOURCE_PATTERN.test(entry)),
  ));
}

export function buildConnectSrc(extraConnectSrc?: string): string {
  return Array.from(new Set([
    ...BASE_CONNECT_SRC,
    ...parseExtraConnectSrc(extraConnectSrc),
  ])).join(' ');
}

export function buildCspContent(extraConnectSrc?: string): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${buildConnectSrc(extraConnectSrc)}`,
    "frame-src 'self' https:",
    "img-src 'self' https: data: blob: http://localhost:* http://127.0.0.1:*",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
