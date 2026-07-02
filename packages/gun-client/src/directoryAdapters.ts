import {
  DIRECTORY_ENTRY_AUTHOR_SCHEME,
  DIRECTORY_ENTRY_AUDIENCE,
  DirectoryEntrySchema,
  LegacyDirectoryEntrySchema,
  type DelegationSigningPublicKey,
  type DirectoryEntry,
  type DirectoryEntryPayload,
  type LegacyDirectoryEntry
} from '@vh/data-model';
import {
  canonicalizeSignedWritePayload,
  lumaLog,
  verifySignedWriteEnvelope
} from '@vh/luma-sdk';
import { createGuardedChain, type ChainWithGet } from './chain';
import { writeWithDurability } from './durableWrite';
import type { VennClient } from './types';

const DIRECTORY_PUT_ACK_TIMEOUT_MS = 1000;
const ED25519 = 'Ed25519';

function directoryPath(identityDirectoryKey: string): string {
  return `vh/directory/${identityDirectoryKey}/`;
}

export function getDirectoryChain(client: VennClient, identityDirectoryKey: string) {
  const chain = client.gun.get('vh').get('directory').get(identityDirectoryKey) as unknown as ChainWithGet<DirectoryEntry>;
  return createGuardedChain(
    chain,
    client.hydrationBarrier,
    client.topologyGuard,
    directoryPath(identityDirectoryKey),
  );
}

function getLegacyDirectoryChain(client: VennClient, nullifier: string) {
  const chain = client.gun.get('vh').get('directory').get(nullifier) as unknown as ChainWithGet<LegacyDirectoryEntry>;
  return createGuardedChain(
    chain,
    client.hydrationBarrier,
    client.topologyGuard,
    directoryPath(nullifier),
  );
}

export async function lookupByIdentityDirectoryKey(
  client: VennClient,
  identityDirectoryKey: string
): Promise<DirectoryEntry | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: DirectoryEntry | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = setTimeout(() => settle(null), 3000);
    getDirectoryChain(client, identityDirectoryKey).once((data) => {
      void validateDirectoryEntry(data, identityDirectoryKey)
        .then(settle)
        .catch(() => settle(null));
    });
  });
}

/**
 * @deprecated Read-only compatibility path for pre-M0.B directory fixtures.
 * Product code must prefer lookupByIdentityDirectoryKey.
 */
export async function lookupByNullifier(client: VennClient, nullifier: string): Promise<LegacyDirectoryEntry | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 3000);
    getLegacyDirectoryChain(client, nullifier).once((data) => {
      clearTimeout(timeout);
      const result = LegacyDirectoryEntrySchema.safeParse(data);
      resolve(result.success ? result.data : null);
    });
  });
}

export async function publishToDirectory(client: VennClient, entry: DirectoryEntry): Promise<void> {
  const validatedEntry = await validateDirectoryEntry(entry, entry.identityDirectoryKey);
  if (!validatedEntry) {
    throw new Error('Invalid LUMA directory entry');
  }

  return writeWithDurability({
      chain: getDirectoryChain(client, validatedEntry.identityDirectoryKey) as unknown as ChainWithGet<DirectoryEntry>,
      value: validatedEntry,
      writeClass: 'directory',
      timeoutMs: DIRECTORY_PUT_ACK_TIMEOUT_MS,
      timeoutError: 'directory publish timed out and readback did not confirm persistence',
      onAckTimeout: () => lumaLog('warn', '[vh:directory] publish ack timed out, requiring readback confirmation'),
      readback: () => lookupByIdentityDirectoryKey(client, validatedEntry.identityDirectoryKey),
      readbackPredicate: (observed) => {
        const candidate = observed as DirectoryEntry | null;
        return Boolean(
          candidate
          && candidate.identityDirectoryKey === validatedEntry.identityDirectoryKey
          && candidate.devicePub === validatedEntry.devicePub
          && candidate.epub === validatedEntry.epub
          && candidate.signedWriteEnvelope.idempotencyKey === validatedEntry.signedWriteEnvelope.idempotencyKey
          && delegationSigningPublicKeyMatches(candidate, validatedEntry)
        );
      },
    })
    .then(() => undefined);
}

export async function validateDirectoryEntry(
  value: unknown,
  expectedIdentityDirectoryKey?: string
): Promise<DirectoryEntry | null> {
  const result = DirectoryEntrySchema.safeParse(value);
  if (!result.success) return null;

  const entry = result.data;
  if (expectedIdentityDirectoryKey && entry.identityDirectoryKey !== expectedIdentityDirectoryKey) {
    return null;
  }
  if (entry.signedWriteEnvelope.publicAuthor !== entry.identityDirectoryKey) {
    return null;
  }
  if (!entry.delegationSigningPublicKey) {
    return null;
  }

  const payload = directoryEntryPayload(entry);
  if (!payloadMatchesEnvelope(payload, entry.signedWriteEnvelope.payload)) {
    return null;
  }

  const verification = await verifySignedWriteEnvelope({
    envelope: entry.signedWriteEnvelope,
    verify: ({ canonicalBytes, signature }) => verifyDirectorySignature({
      canonicalBytes,
      signature,
      key: entry.delegationSigningPublicKey!
    })
  });

  return verification.valid ? entry : null;
}

function directoryEntryPayload(entry: DirectoryEntry): DirectoryEntryPayload {
  const { signedWriteEnvelope: _signedWriteEnvelope, ...payload } = entry;
  return payload;
}

function payloadMatchesEnvelope(payload: DirectoryEntryPayload, envelopePayload: DirectoryEntryPayload): boolean {
  return canonicalizeSignedWritePayload(payload) === canonicalizeSignedWritePayload(envelopePayload);
}

async function verifyDirectorySignature(input: {
  canonicalBytes: Uint8Array;
  signature: string;
  key: DelegationSigningPublicKey;
}): Promise<boolean> {
  try {
    const publicKey = await crypto.subtle.importKey(
      'spki',
      bytesToCryptoBufferSource(base64UrlToBytes(input.key.publicKey.material)),
      ED25519,
      false,
      ['verify']
    );
    return crypto.subtle.verify(
      ED25519,
      publicKey,
      bytesToCryptoBufferSource(base64UrlToBytes(input.signature)),
      bytesToCryptoBufferSource(input.canonicalBytes)
    );
  } catch {
    return false;
  }
}

function delegationSigningPublicKeyMatches(candidate: DirectoryEntry, expected: DirectoryEntry): boolean {
  const expectedKey = expected.delegationSigningPublicKey!;
  const candidateKey = candidate.delegationSigningPublicKey;
  return Boolean(
    candidateKey
    && candidateKey.signatureSuite === expectedKey.signatureSuite
    && candidateKey.publicKey.encoding === expectedKey.publicKey.encoding
    && candidateKey.publicKey.material === expectedKey.publicKey.material
    && candidateKey.createdAt === expectedKey.createdAt
  );
}

function base64UrlToBytes(value: string): Uint8Array {
  const NodeBuffer = (globalThis as typeof globalThis & {
    Buffer?: { from(input: string, encoding: 'base64url'): Uint8Array };
  }).Buffer;
  if (NodeBuffer) {
    return new Uint8Array(NodeBuffer.from(value, 'base64url'));
  }

  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToCryptoBufferSource(bytes: Uint8Array): BufferSource {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
