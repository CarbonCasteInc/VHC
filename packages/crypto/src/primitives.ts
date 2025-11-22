import { getWebCrypto, type CryptoProvider } from './provider';

export type HashInput = string | ArrayBuffer | ArrayBufferView;

const textEncoder = new TextEncoder();
const AES_GCM_IV_BYTES = 12;
const VALID_AES_KEY_LENGTHS = new Set([16, 24, 32]);
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_BYTES = 32;

function copyToArrayBuffer(view: ArrayBufferView | ArrayBuffer): ArrayBuffer {
  if (view instanceof ArrayBuffer) {
    return view.slice(0);
  }
  const uint8 = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  return uint8.slice().buffer;
}

function normalizeHashInput(input: HashInput): ArrayBuffer {
  if (typeof input === 'string') {
    return textEncoder.encode(input).buffer;
  }

  if (input instanceof ArrayBuffer) {
    return copyToArrayBuffer(input);
  }

  if (ArrayBuffer.isView(input)) {
    return copyToArrayBuffer(input);
  }

  throw new TypeError('Unsupported input for hashing.');
}

function normalizeData(input: string | Uint8Array): Uint8Array {
  if (typeof input === 'string') {
    return textEncoder.encode(input);
  }
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}

function toBuffer(view: Uint8Array): ArrayBuffer {
  return view.slice().buffer;
}

function bufferToHex(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function assertAesKey(key: Uint8Array) {
  if (!VALID_AES_KEY_LENGTHS.has(key.byteLength)) {
    throw new Error('AES key must be 16, 24, or 32 bytes long.');
  }
}

async function importAesKey(raw: Uint8Array, provider: CryptoProvider, usages: KeyUsage[]) {
  assertAesKey(raw);
  const material = new Uint8Array(raw.slice().buffer);
  return provider.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, usages);
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
  const normalized = normalizeHashInput(input);
  const digest = await provider.subtle.digest('SHA-256', normalized);
  return bufferToHex(digest);
}

export async function aesEncrypt(data: string | Uint8Array, key: Uint8Array) {
  const provider = await getWebCrypto();
  const cryptoKey = await importAesKey(key, provider, ['encrypt']);
  const iv = provider.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
  const plaintext = normalizeData(data);
  const ciphertext = await provider.subtle.encrypt(
    { name: 'AES-GCM', iv: copyToArrayBuffer(iv) },
    cryptoKey,
    toBuffer(plaintext)
  );

  return {
    iv,
    ciphertext: new Uint8Array(ciphertext)
  };
}

export async function aesDecrypt(iv: Uint8Array, ciphertext: Uint8Array, key: Uint8Array): Promise<Uint8Array> {
  const provider = await getWebCrypto();
  const cryptoKey = await importAesKey(key, provider, ['decrypt']);
  const plaintext = await provider.subtle.decrypt(
    { name: 'AES-GCM', iv: copyToArrayBuffer(iv) },
    cryptoKey,
    toBuffer(ciphertext)
  );
  return new Uint8Array(plaintext);
}

export async function deriveKey(secret: string, salt: string): Promise<Uint8Array> {
  const provider = await getWebCrypto();
  const secretBytes = textEncoder.encode(secret);
  const saltBytes = textEncoder.encode(salt);
  const baseKey = await provider.subtle.importKey(
    'raw',
    copyToArrayBuffer(secretBytes),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await provider.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: copyToArrayBuffer(saltBytes),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    baseKey,
    PBKDF2_KEY_BYTES * 8
  );

  return new Uint8Array(derivedBits);
}
