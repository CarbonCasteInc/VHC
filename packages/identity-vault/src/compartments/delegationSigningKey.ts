import type { DelegationSigningKeyCompartment } from '../types';
import { loadVaultV2, saveVaultV2 } from '../vault';
import {
  base64UrlToBytes,
  bytesToBase64Url,
  utf8,
  VaultCompartmentError
} from './encoding';

const SIGNATURE_SUITE = 'jcs-ed25519-sha256-v1';
const ED25519 = 'Ed25519';

export async function loadOrCreateDelegationSigningKey(): Promise<DelegationSigningKeyCompartment> {
  const vault = await loadVaultV2();
  const existing = vault?.delegationSigningKey;
  if (existing) return validateDelegationSigningKey(existing);

  const created = await createDelegationSigningKey();
  await saveVaultV2({
    schemaVersion: 2,
    ...(vault ?? {}),
    delegationSigningKey: created
  });
  return created;
}

export async function rotateDelegationSigningKey(): Promise<DelegationSigningKeyCompartment> {
  const vault = await loadVaultV2();
  const rotated = await createDelegationSigningKey();
  await saveVaultV2({
    schemaVersion: 2,
    ...(vault ?? {}),
    delegationSigningKey: rotated
  });
  return rotated;
}

export async function signWithDelegationSigningKey(
  message: string | Uint8Array,
  key: DelegationSigningKeyCompartment
): Promise<string> {
  const validKey = validateDelegationSigningKey(key);
  const privateKey = await importPrivateKey(validKey.privateKey.material);
  const signature = await crypto.subtle.sign(ED25519, privateKey, bytesFor(message));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function verifyWithDelegationSigningKey(input: {
  message: string | Uint8Array;
  signature: string;
  key: Pick<DelegationSigningKeyCompartment, 'publicKey' | 'signatureSuite'>;
}): Promise<boolean> {
  if (input.key.signatureSuite !== SIGNATURE_SUITE) {
    throw new VaultCompartmentError('Unsupported delegation signing suite');
  }

  const publicKey = await importPublicKey(input.key.publicKey.material);
  return crypto.subtle.verify(
    ED25519,
    publicKey,
    bytesToCryptoBufferSource(base64UrlToBytes(input.signature)),
    bytesFor(input.message)
  );
}

export function validateDelegationSigningKey(
  value: unknown
): DelegationSigningKeyCompartment {
  if (
    typeof value !== 'object'
    || value === null
    || (value as { schemaVersion?: unknown }).schemaVersion !== 1
    || (value as { signatureSuite?: unknown }).signatureSuite !== SIGNATURE_SUITE
    || !encodedMaterial((value as { publicKey?: unknown }).publicKey)
    || !encodedMaterial((value as { privateKey?: unknown }).privateKey)
    || typeof (value as { createdAt?: unknown }).createdAt !== 'number'
    || !Number.isSafeInteger((value as { createdAt: number }).createdAt)
    || (value as { createdAt: number }).createdAt < 0
  ) {
    throw new VaultCompartmentError('Invalid delegationSigningKey compartment');
  }

  return value as DelegationSigningKeyCompartment;
}

async function createDelegationSigningKey(): Promise<DelegationSigningKeyCompartment> {
  const keyPair = await crypto.subtle.generateKey(ED25519, true, ['sign', 'verify']);
  if (!('privateKey' in keyPair) || !('publicKey' in keyPair)) {
    throw new VaultCompartmentError('Ed25519 key generation failed');
  }

  const privateKey = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  const publicKey = await crypto.subtle.exportKey('spki', keyPair.publicKey);

  return {
    schemaVersion: 1,
    signatureSuite: SIGNATURE_SUITE,
    publicKey: {
      encoding: 'base64url',
      material: bytesToBase64Url(new Uint8Array(publicKey))
    },
    privateKey: {
      encoding: 'base64url',
      material: bytesToBase64Url(new Uint8Array(privateKey))
    },
    createdAt: Date.now()
  };
}

async function importPrivateKey(material: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'pkcs8',
    bytesToCryptoBufferSource(base64UrlToBytes(material)),
    ED25519,
    false,
    ['sign']
  );
}

async function importPublicKey(material: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'spki',
    bytesToCryptoBufferSource(base64UrlToBytes(material)),
    ED25519,
    false,
    ['verify']
  );
}

function encodedMaterial(value: unknown): boolean {
  return typeof value === 'object'
    && value !== null
    && (value as { encoding?: unknown }).encoding === 'base64url'
    && typeof (value as { material?: unknown }).material === 'string'
    && (value as { material: string }).material.length > 0;
}

function bytesFor(message: string | Uint8Array): BufferSource {
  if (typeof message === 'string') {
    return bytesToCryptoBufferSource(utf8(message));
  }
  return bytesToCryptoBufferSource(message);
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function bytesToCryptoBufferSource(bytes: Uint8Array): BufferSource {
  const NodeBuffer = (globalThis as typeof globalThis & {
    Buffer?: { from(value: Uint8Array): Uint8Array };
  }).Buffer;

  if (NodeBuffer) {
    return NodeBuffer.from(bytes) as unknown as BufferSource;
  }

  return bytesToArrayBuffer(bytes);
}

export const delegationSigningKey = Object.freeze({
  loadOrCreate: loadOrCreateDelegationSigningKey,
  rotate: rotateDelegationSigningKey,
  sign: signWithDelegationSigningKey,
  verify: verifyWithDelegationSigningKey
});
