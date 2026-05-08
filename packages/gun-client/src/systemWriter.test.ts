import { describe, expect, it, vi } from 'vitest';
import {
  SYSTEM_WRITER_KIND,
  SYSTEM_WRITER_PROTOCOL_VERSION,
  SYSTEM_WRITER_SIGNATURE_SUITE,
  SYSTEM_WRITER_VALIDATION_EVENT,
  canonicalizeSystemWriterRecordBytes,
  canonicalizeSystemWriterRecordForSigning,
  getSystemWriterAllowedClass,
  isSystemWriterAllowedPath,
  isSystemWriterPin,
  validateSystemWriterRecord,
  type SystemWriterPin,
} from './systemWriter';

const ED25519 = 'Ed25519';
const WRITER_ID = 'vh-system-writer-test-v1';
const ISSUED_AT = 1_777_777_777_000;

function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url');
}

function bytesToCryptoBufferSource(bytes: Uint8Array): BufferSource {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function createTestPin(): Promise<{
  readonly pin: SystemWriterPin;
  readonly privateKey: CryptoKey;
}> {
  const keyPair = await crypto.subtle.generateKey(ED25519, true, ['sign', 'verify']);
  if (!('privateKey' in keyPair) || !('publicKey' in keyPair)) {
    throw new Error('Ed25519 key generation failed');
  }
  const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  return {
    pin: {
      pinVersion: 1,
      schemaEpoch: SYSTEM_WRITER_PROTOCOL_VERSION,
      maxProtocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      signatureSuite: SYSTEM_WRITER_SIGNATURE_SUITE,
      writers: [
        {
          id: WRITER_ID,
          status: 'active',
          publicKey: {
            encoding: 'spki-base64url',
            material: bytesToBase64Url(spki),
          },
        },
      ],
    },
    privateKey: keyPair.privateKey,
  };
}

function baseRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 'news-story-v1',
    story_id: 'story-1',
    title: 'System writer foundation',
    body: { summary: 'JCS verified', score: 1 },
    _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
    _writerKind: SYSTEM_WRITER_KIND,
    _systemWriterId: WRITER_ID,
    _systemIssuedAt: ISSUED_AT,
    ...overrides,
  };
}

async function signRecord(
  record: Record<string, unknown>,
  privateKey: CryptoKey
): Promise<Record<string, unknown>> {
  const canonicalBytes = canonicalizeSystemWriterRecordBytes(record);
  const signature = await crypto.subtle.sign(
    ED25519,
    privateKey,
    bytesToCryptoBufferSource(canonicalBytes)
  );
  return {
    ...record,
    _systemSignature: bytesToBase64Url(signature),
  };
}

describe('system writer validation foundation', () => {
  it('accepts a valid JCS Ed25519 system writer record on an allowed path', async () => {
    const { pin, privateKey } = await createTestPin();
    const record = await signRecord(baseRecord(), privateKey);

    const result = await validateSystemWriterRecord({
      path: 'vh/news/stories/story-1/',
      record,
      pin,
    });

    expect(result).toMatchObject({
      valid: true,
      path: 'vh/news/stories/story-1',
      writerId: WRITER_ID,
      recordClass: 'news-story',
    });
  });

  it('uses JCS bytes so object key order does not change validation', async () => {
    const { pin, privateKey } = await createTestPin();
    const signed = await signRecord(baseRecord(), privateKey);
    const reordered = {
      title: signed.title,
      story_id: signed.story_id,
      schemaVersion: signed.schemaVersion,
      body: signed.body,
      _systemSignature: signed._systemSignature,
      _systemIssuedAt: signed._systemIssuedAt,
      _systemWriterId: signed._systemWriterId,
      _writerKind: signed._writerKind,
      _protocolVersion: signed._protocolVersion,
    };

    await expect(validateSystemWriterRecord({
      path: 'vh/news/stories/story-1',
      record: reordered,
      pin,
    })).resolves.toMatchObject({ valid: true });
  });

  it('excludes _systemSignature from the canonical bytes being signed', async () => {
    const { privateKey } = await createTestPin();
    const signed = await signRecord(baseRecord(), privateKey);
    const changedSignature = {
      ...signed,
      _systemSignature: `${signed._systemSignature}-changed`,
    };

    expect(canonicalizeSystemWriterRecordForSigning(signed)).not.toContain('_systemSignature');
    expect(canonicalizeSystemWriterRecordForSigning(changedSignature))
      .toBe(canonicalizeSystemWriterRecordForSigning(signed));
  });

  it('accepts only the explicit system writer path matrix', () => {
    expect(getSystemWriterAllowedClass('vh/news/stories/story-1')).toBe('news-story');
    expect(getSystemWriterAllowedClass('vh/news/stories/story-1/analysis/a1')).toBe('news-story-analysis');
    expect(getSystemWriterAllowedClass('vh/news/stories/story-1/analysis_latest')).toBe('news-story-analysis-latest');
    expect(getSystemWriterAllowedClass('vh/news/storylines/storyline-1')).toBe('news-storyline');
    expect(getSystemWriterAllowedClass('vh/topics/topic-1/latest')).toBe('topic-synthesis-latest');
    expect(getSystemWriterAllowedClass('vh/topics/topic-1/epochs/7/synthesis')).toBe('topic-synthesis-epoch');
    expect(getSystemWriterAllowedClass('vh/topics/topic-1/digests/digest-1')).toBe('topic-digest');
    expect(getSystemWriterAllowedClass('vh/discovery/index/latest')).toBe('discovery-index');
    expect(getSystemWriterAllowedClass('vh/civic/reps/jurisdiction-v1')).toBe('civic-representative-snapshot');
    expect(getSystemWriterAllowedClass('vh/aggregates/topics/topic-1/engagement/summary')).toBe('topic-engagement-summary');
    expect(isSystemWriterAllowedPath('vh/forum/threads/thread-1')).toBe(false);
    expect(isSystemWriterAllowedPath('vh/__mesh_drills/run-1/records/1')).toBe(false);
    expect(isSystemWriterAllowedPath('vh/aggregates/topics/topic-1/syntheses/s1/epochs/1/voters/v1/p1')).toBe(false);
    expect(isSystemWriterAllowedPath('vh/directory/identity-key')).toBe(false);
  });

  it('returns structured fail-closed results for invalid system writer records', async () => {
    const { pin, privateKey } = await createTestPin();
    const valid = await signRecord(baseRecord(), privateKey);

    await expect(validateSystemWriterRecord({
      path: 'vh/news/stories/story-1',
      record: valid,
      pin: null,
    })).resolves.toMatchObject({
      valid: false,
      event: SYSTEM_WRITER_VALIDATION_EVENT,
      reason: 'missing-pin',
    });

    await expect(validateSystemWriterRecord({
      path: 'vh/news/stories/story-1',
      record: { ...valid, _systemWriterId: 'unknown-writer' },
      pin,
    })).resolves.toMatchObject({
      valid: false,
      event: SYSTEM_WRITER_VALIDATION_EVENT,
      reason: 'unknown-signer-id',
    });

    await expect(validateSystemWriterRecord({
      path: 'vh/news/stories/story-1',
      record: { ...valid, title: 'tampered' },
      pin,
    })).resolves.toMatchObject({
      valid: false,
      event: SYSTEM_WRITER_VALIDATION_EVENT,
      reason: 'signature-invalid',
    });

    await expect(validateSystemWriterRecord({
      path: 'vh/news/stories/story-1',
      record: { ...valid, _protocolVersion: 'luma-public-v2' },
      pin,
    })).resolves.toMatchObject({
      valid: false,
      event: SYSTEM_WRITER_VALIDATION_EVENT,
      reason: 'protocol-version-mismatch',
    });
  });

  it('rejects disallowed paths, drill paths, user-author fields, and signed write envelopes', async () => {
    const { pin, privateKey } = await createTestPin();
    const valid = await signRecord(baseRecord(), privateKey);

    for (const path of [
      'vh/forum/threads/thread-1',
      'vh/forum/nominations/nomination-1',
      'vh/__mesh_drills/run-1/records/1',
      'vh/directory/identity-key',
    ]) {
      await expect(validateSystemWriterRecord({ path, record: valid, pin }))
        .resolves.toMatchObject({
          valid: false,
          event: SYSTEM_WRITER_VALIDATION_EVENT,
          reason: 'path-not-allowed',
        });
    }

    await expect(validateSystemWriterRecord({
      path: 'vh/news/stories/story-1',
      record: {
        ...valid,
        _authorScheme: 'forum-author-v1',
      },
      pin,
    })).resolves.toMatchObject({
      valid: false,
      event: SYSTEM_WRITER_VALIDATION_EVENT,
      reason: 'forbidden-field',
    });

    await expect(validateSystemWriterRecord({
      path: 'vh/news/stories/story-1',
      record: {
        ...valid,
        signedWriteEnvelope: {},
      },
      pin,
    })).resolves.toMatchObject({
      valid: false,
      event: SYSTEM_WRITER_VALIDATION_EVENT,
      reason: 'forbidden-field',
    });
  });

  it('rejects inactive pins and malformed signer metadata', async () => {
    const { pin, privateKey } = await createTestPin();
    const valid = await signRecord(baseRecord(), privateKey);
    const retiredPin: SystemWriterPin = {
      ...pin,
      writers: pin.writers.map((writer) => ({ ...writer, status: 'retired' })),
    };

    expect(isSystemWriterPin({ ...pin, writers: [] })).toBe(false);
    expect(isSystemWriterPin({ ...pin, signatureSuite: 'jcs-ed25519-sha512-v1' })).toBe(false);
    expect(isSystemWriterPin({
      ...pin,
      writers: [pin.writers[0], pin.writers[0]],
    })).toBe(false);
    expect(isSystemWriterPin({
      ...pin,
      writers: [null],
    })).toBe(false);
    expect(isSystemWriterPin({
      ...pin,
      writers: [{ ...pin.writers[0], id: ' trimmed ' }],
    })).toBe(false);
    expect(isSystemWriterPin({
      ...pin,
      writers: [{ ...pin.writers[0], status: 'unknown' }],
    })).toBe(false);
    expect(isSystemWriterPin({
      ...pin,
      writers: [{ ...pin.writers[0], publicKey: null }],
    })).toBe(false);
    expect(isSystemWriterPin({
      ...pin,
      writers: [{ ...pin.writers[0], publicKey: { encoding: 'raw-base64url', material: 'abc' } }],
    })).toBe(false);
    expect(isSystemWriterPin({
      ...pin,
      writers: [{ ...pin.writers[0], publicKey: { encoding: 'spki-base64url', material: '' } }],
    })).toBe(false);

    await expect(validateSystemWriterRecord({
      path: 'vh/news/stories/story-1',
      record: valid,
      pin: retiredPin,
    })).resolves.toMatchObject({
      valid: false,
      event: SYSTEM_WRITER_VALIDATION_EVENT,
      reason: 'unknown-signer-id',
    });
  });

  it('rejects malformed record shape before signature verification', async () => {
    const { pin, privateKey } = await createTestPin();
    const valid = await signRecord(baseRecord(), privateKey);

    await expect(validateSystemWriterRecord({
      path: 'vh/news/stories/story-1',
      record: null,
      pin,
    })).resolves.toMatchObject({
      valid: false,
      reason: 'invalid-record-shape',
    });

    await expect(validateSystemWriterRecord({
      path: 'vh/news/stories/story-1',
      record: { ...valid, _writerKind: 'legacy' },
      pin,
    })).resolves.toMatchObject({
      valid: false,
      reason: 'invalid-record-shape',
    });

    await expect(validateSystemWriterRecord({
      path: 'vh/news/stories/story-1',
      record: { ...valid, _systemSignature: '' },
      pin,
    })).resolves.toMatchObject({
      valid: false,
      reason: 'invalid-record-shape',
    });

    await expect(validateSystemWriterRecord({
      path: 'vh/news/stories/story-1',
      record: { ...valid, _systemIssuedAt: -1 },
      pin,
    })).resolves.toMatchObject({
      valid: false,
      reason: 'invalid-record-shape',
    });

    await expect(validateSystemWriterRecord({
      path: 'vh/news/stories/story-1',
      record: { ...valid, ignored: undefined },
      pin,
    })).resolves.toMatchObject({
      valid: false,
      reason: 'invalid-record-shape',
    });
    expect(() => canonicalizeSystemWriterRecordForSigning(null)).toThrow(/must be an object/);
  });

  it('rejects non-strict JSON before JCS canonicalization can drop fields', async () => {
    const cyclicObject: Record<string, unknown> = {};
    cyclicObject.self = cyclicObject;
    const cyclicArray: unknown[] = [];
    cyclicArray.push(cyclicArray);
    const sparseArray = [1, 2];
    delete sparseArray[1];
    const arrayWithSymbol = [1];
    Object.defineProperty(arrayWithSymbol, Symbol('hidden'), { value: 1 });
    const arrayWithAccessor = [1];
    Object.defineProperty(arrayWithAccessor, '0', {
      enumerable: true,
      get: () => 1,
    });
    const arrayWithExtraKey = [1] as unknown[] & { extra?: number };
    arrayWithExtraKey.extra = 2;
    const objectWithSymbol = { ok: true };
    Object.defineProperty(objectWithSymbol, Symbol('hidden'), { value: 1 });
    const objectWithAccessor = {};
    Object.defineProperty(objectWithAccessor, 'value', {
      enumerable: true,
      get: () => 1,
    });
    const objectWithHidden = {};
    Object.defineProperty(objectWithHidden, 'hidden', {
      enumerable: false,
      value: 1,
    });

    const invalidValues: readonly unknown[] = [
      Number.NaN,
      cyclicArray,
      sparseArray,
      arrayWithSymbol,
      arrayWithAccessor,
      arrayWithExtraKey,
      cyclicObject,
      new Date(0),
      objectWithSymbol,
      objectWithAccessor,
      objectWithHidden,
      1n,
      () => true,
    ];

    for (const value of invalidValues) {
      expect(() =>
        canonicalizeSystemWriterRecordForSigning(baseRecord({ invalid: value }))
      ).toThrow(/system writer record contains/);
    }

    expect(canonicalizeSystemWriterRecordForSigning(baseRecord({
      validArray: [1, { nested: true }, null],
    }))).toContain('"validArray":[1,{"nested":true},null]');
  });

  it('fails closed when default WebCrypto verification cannot run', async () => {
    const { pin, privateKey } = await createTestPin();
    const valid = await signRecord(baseRecord(), privateKey);
    const badPublicKeyPin: SystemWriterPin = {
      ...pin,
      writers: pin.writers.map((writer) => ({
        ...writer,
        publicKey: {
          ...writer.publicKey,
          material: 'not-valid-spki',
        },
      })),
    };

    await expect(validateSystemWriterRecord({
      path: 'vh/news/stories/story-1',
      record: valid,
      pin: badPublicKeyPin,
    })).resolves.toMatchObject({
      valid: false,
      reason: 'signature-invalid',
    });

    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {});
    try {
      await expect(validateSystemWriterRecord({
        path: 'vh/news/stories/story-1',
        record: valid,
        pin,
      })).resolves.toMatchObject({
        valid: false,
        reason: 'signature-invalid',
      });
    } finally {
      vi.stubGlobal('crypto', originalCrypto);
    }
  });

  it('verifies signatures without Node Buffer so the browser decoding path is covered', async () => {
    const { pin, privateKey } = await createTestPin();
    const valid = await signRecord(baseRecord(), privateKey);
    const originalBuffer = globalThis.Buffer;

    vi.stubGlobal('Buffer', undefined);
    try {
      await expect(validateSystemWriterRecord({
        path: 'vh/news/stories/story-1',
        record: valid,
        pin,
      })).resolves.toMatchObject({ valid: true });
    } finally {
      vi.stubGlobal('Buffer', originalBuffer);
    }
  });

  it('uses injected verification hooks without creating a signing surface', async () => {
    const { pin, privateKey } = await createTestPin();
    const valid = await signRecord(baseRecord(), privateKey);
    const verify = vi.fn(async () => true);

    await expect(validateSystemWriterRecord({
      path: 'vh/news/stories/story-1',
      record: { ...valid, _systemSignature: 'test-signature' },
      pin,
      verify,
    })).resolves.toMatchObject({ valid: true });

    expect(verify).toHaveBeenCalledWith(expect.objectContaining({
      signature: 'test-signature',
      path: 'vh/news/stories/story-1',
      writer: expect.objectContaining({ id: WRITER_ID }),
    }));

    const throwingVerify = vi.fn(async () => {
      throw new Error('verifier unavailable');
    });
    await expect(validateSystemWriterRecord({
      path: 'vh/news/stories/story-1',
      record: valid,
      pin,
      verify: throwingVerify,
    })).resolves.toMatchObject({
      valid: false,
      reason: 'signature-invalid',
    });
  });
});
