import { describe, expect, it, vi } from 'vitest';
import {
  DIRECTORY_ENTRY_AUTHOR_SCHEME,
  DIRECTORY_ENTRY_PROTOCOL_VERSION,
  DIRECTORY_ENTRY_WRITER_KIND,
  type DirectoryEntry,
  type DirectoryEntryPayload
} from '@vh/data-model';
import {
  createLumaPublicAuthorId,
  createSignedWriteEnvelope
} from '@vh/luma-sdk';
import {
  getDirectoryChain,
  lookupByIdentityDirectoryKey,
  lookupByNullifier,
  publishToDirectory,
  validateDirectoryEntry
} from './directoryAdapters';
import { HydrationBarrier } from './sync/barrier';
import type { VennClient } from './types';

const IDENTITY_DIRECTORY_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const OTHER_DIRECTORY_KEY = 'abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const SESSION_REF = Object.freeze({
  tokenHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  envelopeDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
});
const NONCE = '00112233445566778899aabbccddeeff';
const ISSUED_AT = 1777777777000;
const ED25519 = 'Ed25519';

function createMockChain() {
  const store = new Map<string, any>();
  const makeChain = (path: string[]): any => {
    const chain: any = {};
    chain.get = vi.fn((key: string) => makeChain([...path, key]));
    chain.once = vi.fn((cb?: (data: unknown) => void) => cb?.(store.get(path.join('/'))));
    chain.put = vi.fn((value: any, cb?: (ack?: any) => void) => {
      store.set(path.join('/'), value);
      cb?.({});
    });
    return chain;
  };
  return { chain: makeChain([]), store };
}

function createClient(chain: any): VennClient {
  const hydrationBarrier = new HydrationBarrier();
  hydrationBarrier.markReady();
  return {
    gun: { get: vi.fn((key: string) => chain.get(key)) } as any,
    hydrationBarrier,
    topologyGuard: { validateWrite: vi.fn() } as any,
  } as VennClient;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function bytesToBufferSource(bytes: Uint8Array): BufferSource {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function createDirectoryEntry(
  overrides: Partial<DirectoryEntryPayload> = {},
  envelopeOverrides: Partial<DirectoryEntry['signedWriteEnvelope']> = {}
): Promise<DirectoryEntry> {
  const keyPair = await crypto.subtle.generateKey(ED25519, true, ['sign', 'verify']);
  if (!('privateKey' in keyPair) || !('publicKey' in keyPair)) {
    throw new Error('Ed25519 key generation failed');
  }
  const exportedPublicKey = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const payload: DirectoryEntryPayload = {
    schemaVersion: 'hermes-directory-v1',
    _protocolVersion: DIRECTORY_ENTRY_PROTOCOL_VERSION,
    _writerKind: DIRECTORY_ENTRY_WRITER_KIND,
    _authorScheme: DIRECTORY_ENTRY_AUTHOR_SCHEME,
    identityDirectoryKey: IDENTITY_DIRECTORY_KEY,
    devicePub: 'alice-device',
    epub: 'alice-epub',
    displayName: 'Alice',
    delegationSigningPublicKey: {
      signatureSuite: 'jcs-ed25519-sha256-v1',
      publicKey: {
        encoding: 'base64url',
        material: bytesToBase64Url(new Uint8Array(exportedPublicKey))
      },
      createdAt: ISSUED_AT
    },
    registeredAt: ISSUED_AT,
    lastSeenAt: ISSUED_AT + 1,
    ...overrides
  };

  const signedWriteEnvelope = await createSignedWriteEnvelope({
    profile: 'public-beta',
    audience: 'vh-directory-entry',
    origin: 'https://vh.example',
    scheme: DIRECTORY_ENTRY_AUTHOR_SCHEME,
    publicAuthor: createLumaPublicAuthorId(payload.identityDirectoryKey, DIRECTORY_ENTRY_AUTHOR_SCHEME),
    sessionRef: SESSION_REF,
    payload,
    sequence: ISSUED_AT,
    nonce: NONCE,
    issuedAt: ISSUED_AT,
    sign: async ({ canonicalBytes }) => bytesToBase64Url(new Uint8Array(
      await crypto.subtle.sign(ED25519, keyPair.privateKey, bytesToBufferSource(canonicalBytes))
    ))
  });

  return {
    ...payload,
    signedWriteEnvelope: {
      ...signedWriteEnvelope,
      ...envelopeOverrides
    }
  };
}

describe('directoryAdapters', () => {
  it('publishes and looks up v1 entries by identityDirectoryKey', async () => {
    const { chain, store } = createMockChain();
    const client = createClient(chain);
    const entry = await createDirectoryEntry();

    await publishToDirectory(client, entry);

    expect(store.get(`vh/directory/${IDENTITY_DIRECTORY_KEY}`)).toEqual(entry);
    expect(JSON.stringify(entry)).not.toContain('raw-principal-nullifier');
    expect(JSON.stringify(entry)).not.toContain('"nullifier"');
    await expect(lookupByIdentityDirectoryKey(client, IDENTITY_DIRECTORY_KEY)).resolves.toEqual(entry);
  });

  it('validates envelope binding, signed payload, and expected path key', async () => {
    const entry = await createDirectoryEntry();

    await expect(validateDirectoryEntry(entry, IDENTITY_DIRECTORY_KEY)).resolves.toEqual(entry);
    await expect(validateDirectoryEntry(entry, OTHER_DIRECTORY_KEY)).resolves.toBeNull();
    await expect(validateDirectoryEntry({
      ...entry,
      devicePub: 'tampered-device'
    }, IDENTITY_DIRECTORY_KEY)).resolves.toBeNull();
    await expect(validateDirectoryEntry({
      ...entry,
      signedWriteEnvelope: {
        ...entry.signedWriteEnvelope,
        publicAuthor: OTHER_DIRECTORY_KEY
      }
    }, IDENTITY_DIRECTORY_KEY)).resolves.toBeNull();
  });

  it('rejects raw-nullifier, missing-envelope, bad-signature, and private-key-shaped public records', async () => {
    const entry = await createDirectoryEntry();

    await expect(validateDirectoryEntry({
      ...entry,
      nullifier: 'raw-principal-nullifier'
    }, IDENTITY_DIRECTORY_KEY)).resolves.toBeNull();
    const { signedWriteEnvelope: _signedWriteEnvelope, ...missingEnvelope } = entry;
    await expect(validateDirectoryEntry(missingEnvelope, IDENTITY_DIRECTORY_KEY)).resolves.toBeNull();
    await expect(validateDirectoryEntry({
      ...entry,
      signedWriteEnvelope: {
        ...entry.signedWriteEnvelope,
        signature: 'not-a-valid-signature'
      }
    }, IDENTITY_DIRECTORY_KEY)).resolves.toBeNull();
    await expect(validateDirectoryEntry({
      ...entry,
      delegationSigningPublicKey: {
        ...entry.delegationSigningPublicKey!,
        privateKey: { encoding: 'base64url', material: 'secret-material' }
      }
    }, IDENTITY_DIRECTORY_KEY)).resolves.toBeNull();
  });

  it('keeps legacy v0 nullifier lookup read-only and rejects it from v1 publish', async () => {
    const { chain, store } = createMockChain();
    const client = createClient(chain);
    const legacy = {
      schemaVersion: 'hermes-directory-v0',
      nullifier: 'legacy-nullifier',
      devicePub: 'legacy-device',
      epub: 'legacy-epub',
      registeredAt: 1,
      lastSeenAt: 2
    };
    store.set('vh/directory/legacy-nullifier', legacy);

    await expect(lookupByNullifier(client, 'legacy-nullifier')).resolves.toEqual(legacy);
    await expect(publishToDirectory(client, legacy as never)).rejects.toThrow('Invalid LUMA directory entry');
  });

  it('returns null for malformed legacy v0 lookup records', async () => {
    const { chain, store } = createMockChain();
    const client = createClient(chain);
    store.set('vh/directory/malformed-legacy', {
      schemaVersion: 'hermes-directory-v0',
      nullifier: 'malformed-legacy',
      devicePub: 'legacy-device',
      epub: 'legacy-epub',
      registeredAt: -1,
      lastSeenAt: 2
    });

    await expect(lookupByNullifier(client, 'malformed-legacy')).resolves.toBeNull();
  });

  it('returns null when v1 lookup sees missing, malformed, or legacy records', async () => {
    const { chain, store } = createMockChain();
    const client = createClient(chain);
    store.set(`vh/directory/${IDENTITY_DIRECTORY_KEY}`, {
      schemaVersion: 'hermes-directory-v0',
      nullifier: 'legacy-nullifier',
      devicePub: 'legacy-device',
      epub: 'legacy-epub',
      registeredAt: 1,
      lastSeenAt: 2
    });

    await expect(lookupByIdentityDirectoryKey(client, OTHER_DIRECTORY_KEY)).resolves.toBeNull();
    await expect(lookupByIdentityDirectoryKey(client, IDENTITY_DIRECTORY_KEY)).resolves.toBeNull();
  });

  it('settles identity-directory lookup only once when a chain emits duplicate values', async () => {
    const entry = await createDirectoryEntry();
    const duplicateChain: any = {
      get: vi.fn(() => duplicateChain),
      once: vi.fn((cb?: (data: unknown) => void) => {
        cb?.(entry);
        cb?.(entry);
      }),
      put: vi.fn()
    };
    const client = createClient(duplicateChain);

    await expect(lookupByIdentityDirectoryKey(client, IDENTITY_DIRECTORY_KEY)).resolves.toEqual(entry);
  });

  it('rejects v1 records missing public delegation key material', async () => {
    const entry = await createDirectoryEntry();
    const { delegationSigningPublicKey: _delegationSigningPublicKey, ...entryWithoutPublicKey } = entry;

    await expect(validateDirectoryEntry(entryWithoutPublicKey, IDENTITY_DIRECTORY_KEY)).resolves.toBeNull();
  });

  it('rejects v1 records with unimportable delegation public key material', async () => {
    const entry = await createDirectoryEntry({
      delegationSigningPublicKey: {
        signatureSuite: 'jcs-ed25519-sha256-v1',
        publicKey: {
          encoding: 'base64url',
          material: '%%%%'
        },
        createdAt: ISSUED_AT
      }
    });

    await expect(validateDirectoryEntry(entry, IDENTITY_DIRECTORY_KEY)).resolves.toBeNull();
  });

  it('verifies directory signatures through the browser base64url fallback when Buffer is unavailable', async () => {
    const entry = await createDirectoryEntry();
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Buffer');
    Object.defineProperty(globalThis, 'Buffer', {
      configurable: true,
      value: undefined
    });

    try {
      await expect(validateDirectoryEntry(entry, IDENTITY_DIRECTORY_KEY)).resolves.toEqual(entry);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, 'Buffer', originalDescriptor);
      }
    }
  });

  it('resolves when publish ack times out but v1 readback confirms persistence', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const store = new Map<string, unknown>();
      const makeChain = (path: string[]): any => ({
        get: vi.fn((key: string) => makeChain([...path, key])),
        once: vi.fn((cb?: (data: unknown) => void) => cb?.(store.get(path.join('/')))),
        put: vi.fn((value: unknown) => {
          store.set(path.join('/'), value);
        }),
      });
      const client = createClient(makeChain([]));
      const entry = await createDirectoryEntry();

      await expect(publishToDirectory(client, entry)).resolves.toBeUndefined();
      expect(warning).toHaveBeenCalledWith('[vh:directory] publish ack timed out, requiring readback confirmation');
    } finally {
      warning.mockRestore();
    }
  }, 10_000);

  it('propagates physical publish errors after validating the LUMA entry', async () => {
    const failingChain: any = {
      get: vi.fn(() => failingChain),
      once: vi.fn((cb?: (data: unknown) => void) => cb?.(undefined)),
      put: vi.fn((_value: any, cb?: (ack?: { err?: string }) => void) => cb?.({ err: 'boom' }))
    };
    const client = createClient(failingChain);
    await expect(publishToDirectory(client, await createDirectoryEntry())).rejects.toThrow('boom');
  });

  it('creates guarded chains under the derived directory path', async () => {
    const { chain } = createMockChain();
    const client = createClient(chain);
    const guarded = getDirectoryChain(client, IDENTITY_DIRECTORY_KEY);
    const entry = await createDirectoryEntry();

    await guarded.put(entry);

    expect(client.topologyGuard.validateWrite).toHaveBeenCalledWith(
      `vh/directory/${IDENTITY_DIRECTORY_KEY}/`,
      entry
    );
  });
});
