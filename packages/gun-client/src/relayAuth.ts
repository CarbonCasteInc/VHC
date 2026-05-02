import SEA from 'gun/sea';

export interface RelayDevicePair {
  readonly pub: string;
  readonly priv: string;
}

function envValue(name: string): string {
  const viteValue = (() => {
    try {
      return (import.meta as any).env?.[name];
    } /* v8 ignore next 3 -- import.meta access can throw in legacy hosts; Vitest cannot trigger that runtime. */ catch {
      return undefined;
    }
  })();
  /* v8 ignore next -- browser builds may not expose process; Vitest always does. */
  const processValue = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  return String(viteValue ?? processValue ?? '').trim();
}

export function createRelayDaemonAuthHeaders(): Record<string, string> {
  const token = envValue('VH_RELAY_DAEMON_TOKEN') || envValue('VITE_VH_RELAY_DAEMON_TOKEN');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function createRelayUserSignatureHeaders(
  path: string,
  body: unknown,
  pair: RelayDevicePair | null | undefined,
  options: { readonly nonce?: string; readonly timestamp?: string } = {}
): Promise<Record<string, string>> {
  if (!pair?.pub || !pair.priv) {
    return {};
  }
  const nonce = options.nonce ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const timestamp = options.timestamp ?? String(Date.now());
  const canonical = JSON.stringify({ path, body, nonce, timestamp });
  const signature = await SEA.sign(canonical, pair as any);
  if (typeof signature !== 'string' || !signature.trim()) {
    return {};
  }
  const maybeBuffer = (globalThis as unknown as { Buffer?: { from(value: string, encoding: string): { toString(encoding: string): string } } }).Buffer;
  const encodedSignature = maybeBuffer
    ? maybeBuffer.from(signature, 'utf8').toString('base64url')
    : btoa(signature).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return {
    'x-vh-relay-device-pub': pair.pub,
    'x-vh-relay-signature': encodedSignature,
    'x-vh-relay-nonce': nonce,
    'x-vh-relay-timestamp': timestamp,
  };
}
