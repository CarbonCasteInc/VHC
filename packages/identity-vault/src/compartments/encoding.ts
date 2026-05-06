export class VaultCompartmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultCompartmentError';
  }
}

export function randomBase64Url(byteLength: number): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new VaultCompartmentError('WebCrypto random source is unavailable');
  }

  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return bytesToBase64Url(bytes);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    const chunk = bytes.subarray(offset, offset + 0x8000);
    chunks.push(String.fromCharCode(...chunk));
  }

  const base64 = btoa(chunks.join(''));
  return base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function base64UrlToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) {
    throw new VaultCompartmentError('Invalid base64url material');
  }

  const padded = value.replaceAll('-', '+').replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
