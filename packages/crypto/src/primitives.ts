import { getWebCrypto } from './provider';

export type HashInput = string | ArrayBuffer | ArrayBufferView;

function normalizeInput(input: HashInput): ArrayBuffer {
  if (typeof input === 'string') {
    return new TextEncoder().encode(input).buffer;
  }

  if (input instanceof ArrayBuffer) {
    return input;
  }

  if (ArrayBuffer.isView(input)) {
    const view = input as ArrayBufferView;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
  }

  throw new TypeError('Unsupported input for hashing.');
}

function bufferToHex(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function randomBytes(length: number): Promise<Uint8Array> {
  if (!Number.isInteger(length) || length <= 0) {
    throw new Error('randomBytes length must be a positive integer.');
  }

  const provider = await getWebCrypto();
  const buffer = new Uint8Array(length);
  provider.getRandomValues(buffer);
  return buffer;
}

export async function sha256(input: HashInput): Promise<string> {
  const provider = await getWebCrypto();
  const normalized = normalizeInput(input);
  const digest = await provider.subtle.digest('SHA-256', normalized);
  return bufferToHex(digest);
}
