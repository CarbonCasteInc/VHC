import {
  createPrivateKey,
  createPublicKey,
  sign as ed25519Sign,
  verify as ed25519Verify
} from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  canonicalizeSignedWriteEnvelopeForSigning,
  canonicalizeSignedWritePayload,
  CLIENT_SIGNED_WRITE_SIGNATURE_SUITE,
  createLumaPublicAuthorId,
  createSignedWriteEnvelope,
  deriveSignedWriteIdempotencyKey,
  digestSignedWritePayload,
  isLumaPublicAuthorId,
  LUMA_SIGNED_WRITE_PROTOCOL_VERSION,
  signedWriteEnvelopeSigningInput,
  SignedWriteEnvelopeError,
  verifySignedWriteEnvelope,
  type CreateSignedWriteEnvelopeInput,
  type SignedWriteEnvelope,
  type SignedWriteSignHook,
  type SignedWriteVerifyHook
} from './signedWrites';

const PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIMhiE+oUkBP79LO/ed83g6I8s8VeivofrYTh8e1NQ8Ke
-----END PRIVATE KEY-----
`;

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAkpHdKIlWs3Zn2QaVf3nO9SdMT9g5Vkzijghfm3uteLQ=
-----END PUBLIC KEY-----
`;

const PUBLIC_AUTHOR_VALUE =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const SESSION_REF = Object.freeze({
  tokenHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  envelopeDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
});
const NONCE = '00112233445566778899aabbccddeeff';
const ISSUED_AT = 1777777777000;

const VECTOR_PAYLOAD = Object.freeze({
  title: 'LUMA launch',
  body: 'signed write',
  tags: ['m0b', 'jcs'],
  metadata: {
    count: 2,
    active: true,
    nested: {
      a: null,
      z: 'last'
    }
  }
});

const REORDERED_VECTOR_PAYLOAD = Object.freeze({
  metadata: {
    nested: {
      z: 'last',
      a: null
    },
    active: true,
    count: 2
  },
  tags: ['m0b', 'jcs'],
  body: 'signed write',
  title: 'LUMA launch'
});

const EXPECTED_CANONICAL_PAYLOAD =
  '{"body":"signed write","metadata":{"active":true,"count":2,"nested":{"a":null,"z":"last"}},"tags":["m0b","jcs"],"title":"LUMA launch"}';
const EXPECTED_PAYLOAD_DIGEST =
  '88904ae596dba42583755c10a239e1d3d9a12df9ee52188fd50ee52319e4dbf0';
const EXPECTED_IDEMPOTENCY_KEY =
  '3777e3e28dec03ac2df6ebdfca850a3b3d201449a2db95f9c2162471ebd2c829';
const EXPECTED_CANONICAL_ENVELOPE =
  '{"audience":"vh-forum-thread","envelopeVersion":1,"idempotencyKey":"3777e3e28dec03ac2df6ebdfca850a3b3d201449a2db95f9c2162471ebd2c829","issuedAt":1777777777000,"nonce":"00112233445566778899aabbccddeeff","origin":"https://vh.example","payload":{"body":"signed write","metadata":{"active":true,"count":2,"nested":{"a":null,"z":"last"}},"tags":["m0b","jcs"],"title":"LUMA launch"},"payloadDigest":"88904ae596dba42583755c10a239e1d3d9a12df9ee52188fd50ee52319e4dbf0","profile":"public-beta","protocolVersion":"luma-write-v1","publicAuthor":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","scheme":"forum-author-v1","sequence":7,"sessionRef":{"envelopeDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","tokenHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"signatureSuite":"jcs-ed25519-sha256-v1"}';
const EXPECTED_SIGNATURE =
  '7-tfl0mmIIDO33TXE30mmxWOIGPUn22M5Cyt57jyKxrMaZISs0sTV00Xh8lUlPkfFp80tMvTWqSrmOZqfXy9AQ';

const privateKey = createPrivateKey(PRIVATE_KEY_PEM);
const publicKey = createPublicKey(PUBLIC_KEY_PEM);

function ed25519SignHook(): SignedWriteSignHook<typeof VECTOR_PAYLOAD> {
  return ({ canonicalBytes }) => ed25519Sign(null, canonicalBytes, privateKey).toString('base64url');
}

function ed25519VerifyHook(): SignedWriteVerifyHook<typeof VECTOR_PAYLOAD> {
  return ({ canonicalBytes, signature }) => ed25519Verify(
    null,
    canonicalBytes,
    publicKey,
    Buffer.from(signature, 'base64url')
  );
}

function baseCreateInput(
  overrides: Partial<CreateSignedWriteEnvelopeInput<typeof VECTOR_PAYLOAD>> = {}
): CreateSignedWriteEnvelopeInput<typeof VECTOR_PAYLOAD> {
  return {
    profile: 'public-beta',
    audience: 'vh-forum-thread',
    origin: 'https://vh.example',
    scheme: 'forum-author-v1',
    publicAuthor: createLumaPublicAuthorId(PUBLIC_AUTHOR_VALUE, 'forum-author-v1'),
    sessionRef: SESSION_REF,
    payload: VECTOR_PAYLOAD,
    sequence: 7,
    nonce: NONCE,
    issuedAt: ISSUED_AT,
    sign: ed25519SignHook(),
    ...overrides
  };
}

async function createVectorEnvelope(
  overrides: Partial<CreateSignedWriteEnvelopeInput<typeof VECTOR_PAYLOAD>> = {}
): Promise<SignedWriteEnvelope<typeof VECTOR_PAYLOAD>> {
  return createSignedWriteEnvelope(baseCreateInput(overrides));
}

function withEnvelopePatch(
  envelope: SignedWriteEnvelope<typeof VECTOR_PAYLOAD>,
  patch: Partial<SignedWriteEnvelope<typeof VECTOR_PAYLOAD>>
): SignedWriteEnvelope<typeof VECTOR_PAYLOAD> {
  return {
    ...envelope,
    ...patch
  };
}

describe('LUMA SignedWriteEnvelope SDK surface', () => {
  it('creates and verifies the frozen M0.B JCS/Ed25519 vector', async () => {
    const envelope = await createVectorEnvelope();
    const verification = await verifySignedWriteEnvelope({
      envelope,
      verify: ed25519VerifyHook()
    });

    expect(canonicalizeSignedWritePayload(VECTOR_PAYLOAD)).toBe(EXPECTED_CANONICAL_PAYLOAD);
    await expect(digestSignedWritePayload(VECTOR_PAYLOAD))
      .resolves.toBe(EXPECTED_PAYLOAD_DIGEST);
    await expect(deriveSignedWriteIdempotencyKey({
      payloadDigest: EXPECTED_PAYLOAD_DIGEST,
      audience: 'vh-forum-thread',
      sequence: 7
    })).resolves.toBe(EXPECTED_IDEMPOTENCY_KEY);
    expect(canonicalizeSignedWriteEnvelopeForSigning(envelope))
      .toBe(EXPECTED_CANONICAL_ENVELOPE);
    expect(Buffer.from(signedWriteEnvelopeSigningInput(envelope)).toString('utf8'))
      .toBe(EXPECTED_CANONICAL_ENVELOPE);
    expect(envelope).toEqual({
      envelopeVersion: 1,
      signatureSuite: CLIENT_SIGNED_WRITE_SIGNATURE_SUITE,
      protocolVersion: LUMA_SIGNED_WRITE_PROTOCOL_VERSION,
      profile: 'public-beta',
      audience: 'vh-forum-thread',
      origin: 'https://vh.example',
      scheme: 'forum-author-v1',
      publicAuthor: PUBLIC_AUTHOR_VALUE,
      sessionRef: SESSION_REF,
      payload: VECTOR_PAYLOAD,
      payloadDigest: EXPECTED_PAYLOAD_DIGEST,
      sequence: 7,
      nonce: NONCE,
      idempotencyKey: EXPECTED_IDEMPOTENCY_KEY,
      issuedAt: ISSUED_AT,
      signature: EXPECTED_SIGNATURE
    });
    expect(verification).toMatchObject({
      valid: true,
      payloadDigest: EXPECTED_PAYLOAD_DIGEST,
      idempotencyKey: EXPECTED_IDEMPOTENCY_KEY,
      canonicalEnvelope: EXPECTED_CANONICAL_ENVELOPE
    });
  });

  it('keeps payloadDigest and signing input stable when object key order changes', async () => {
    const first = await createVectorEnvelope();
    const second = await createSignedWriteEnvelope(baseCreateInput({
      payload: REORDERED_VECTOR_PAYLOAD as typeof VECTOR_PAYLOAD
    }));

    expect(second.payloadDigest).toBe(first.payloadDigest);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.signature).toBe(first.signature);
    expect(canonicalizeSignedWriteEnvelopeForSigning(second))
      .toBe(canonicalizeSignedWriteEnvelopeForSigning(first));
  });

  it('excludes signature from canonical signing bytes', async () => {
    const envelope = await createVectorEnvelope();
    const changedSignature = withEnvelopePatch(envelope, {
      signature: 'different-signature'
    });

    expect(canonicalizeSignedWriteEnvelopeForSigning(envelope)).not.toContain('"signature":');
    expect(canonicalizeSignedWriteEnvelopeForSigning(changedSignature))
      .toBe(canonicalizeSignedWriteEnvelopeForSigning(envelope));
    await expect(verifySignedWriteEnvelope({
      envelope: changedSignature,
      verify: ed25519VerifyHook()
    })).resolves.toMatchObject({
      valid: false,
      reason: 'signature_verification_failed'
    });
  });

  it('requires caller-provided public-author ids instead of direct raw strings', async () => {
    const publicAuthor = createLumaPublicAuthorId(PUBLIC_AUTHOR_VALUE, 'forum-author-v1');

    expect(publicAuthor).toEqual({
      kind: 'luma-public-author-id',
      scheme: 'forum-author-v1',
      value: PUBLIC_AUTHOR_VALUE
    });
    expect(isLumaPublicAuthorId(publicAuthor)).toBe(true);
    await expect(createSignedWriteEnvelope(baseCreateInput({
      publicAuthor: PUBLIC_AUTHOR_VALUE as never
    }))).rejects.toMatchObject({
      reason: 'invalid_public_author'
    });
    await expect(createSignedWriteEnvelope(baseCreateInput({
      publicAuthor: createLumaPublicAuthorId(PUBLIC_AUTHOR_VALUE, 'voter-v1')
    }))).rejects.toMatchObject({
      reason: 'public_author_scheme_mismatch'
    });
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['wrong object', {}],
    ['wrong kind', { kind: 'raw-nullifier', scheme: 'forum-author-v1', value: PUBLIC_AUTHOR_VALUE }],
    ['unregistered scheme', { kind: 'luma-public-author-id', scheme: 'legacy', value: PUBLIC_AUTHOR_VALUE }],
    ['invalid value', { kind: 'luma-public-author-id', scheme: 'forum-author-v1', value: 'not-hex' }]
  ])('rejects %s as a public author id guard', (_label, value) => {
    expect(isLumaPublicAuthorId(value)).toBe(false);
  });

  it.each([
    [
      'unsupported audience',
      { audience: 'vh-unknown' },
      'unsupported_audience'
    ],
    [
      'unregistered scheme',
      { scheme: 'legacy-nullifier' },
      'unregistered_scheme'
    ],
    [
      'unsupported profile',
      { profile: 'staging' },
      'unsupported_profile'
    ],
    [
      'unsupported signature suite',
      { signatureSuite: 'jcs-ed25519-sha512-v1' },
      'unsupported_signature_suite'
    ],
    [
      'unsupported protocol',
      { protocolVersion: 'luma-write-v2' },
      'unsupported_protocol_version'
    ],
    [
      'blank origin',
      { origin: '' },
      'invalid_origin'
    ],
    [
      'missing sessionRef',
      { sessionRef: null },
      'invalid_session_ref'
    ],
    [
      'blank session token hash',
      { sessionRef: { tokenHash: '', envelopeDigest: SESSION_REF.envelopeDigest } },
      'invalid_session_ref'
    ],
    [
      'negative sequence',
      { sequence: -1 },
      'invalid_sequence'
    ],
    [
      'fractional sequence',
      { sequence: 1.25 },
      'invalid_sequence'
    ],
    [
      'short nonce',
      { nonce: 'abc' },
      'invalid_nonce'
    ],
    [
      'uppercase nonce',
      { nonce: '00112233445566778899AABBCCDDEEFF' },
      'invalid_nonce'
    ],
    [
      'negative issuedAt',
      { issuedAt: -1 },
      'invalid_issued_at'
    ],
    [
      'empty signature',
      { sign: () => '' },
      'invalid_signature'
    ],
    [
      'uncanonicalizable payload',
      { payload: undefined },
      'invalid_payload_digest'
    ]
  ])('fails closed while creating on %s', async (_label, patch, reason) => {
    await expect(createSignedWriteEnvelope(baseCreateInput(
      patch as Partial<CreateSignedWriteEnvelopeInput<typeof VECTOR_PAYLOAD>>
    ))).rejects.toMatchObject({ reason });
  });

  it.each([
    [
      'invalid envelope version',
      { envelopeVersion: 2 },
      'invalid_envelope_version'
    ],
    [
      'unsupported protocol',
      { protocolVersion: 'luma-write-v2' },
      'unsupported_protocol_version'
    ],
    [
      'unsupported signature suite',
      { signatureSuite: 'jcs-ed25519-sha512-v1' },
      'unsupported_signature_suite'
    ],
    [
      'unsupported profile',
      { profile: 'staging' },
      'unsupported_profile'
    ],
    [
      'unsupported audience',
      { audience: 'vh-unknown' },
      'unsupported_audience'
    ],
    [
      'unregistered scheme',
      { scheme: 'legacy-nullifier' },
      'unregistered_scheme'
    ],
    [
      'invalid public author',
      { publicAuthor: 'ABCDEF' },
      'invalid_public_author'
    ],
    [
      'blank origin',
      { origin: '' },
      'invalid_origin'
    ],
    [
      'missing sessionRef',
      { sessionRef: null },
      'invalid_session_ref'
    ],
    [
      'bad sequence',
      { sequence: -1 },
      'invalid_sequence'
    ],
    [
      'bad nonce',
      { nonce: 'bad-nonce' },
      'invalid_nonce'
    ],
    [
      'bad issuedAt',
      { issuedAt: -1 },
      'invalid_issued_at'
    ],
    [
      'empty signature',
      { signature: '' },
      'invalid_signature'
    ],
    [
      'invalid payloadDigest',
      { payloadDigest: 'not-hex' },
      'invalid_payload_digest'
    ],
    [
      'invalid idempotencyKey',
      { idempotencyKey: 'not-hex' },
      'invalid_idempotency_key'
    ],
    [
      'tampered payload',
      { payload: { ...VECTOR_PAYLOAD, body: 'tampered' } },
      'payload_digest_mismatch'
    ],
    [
      'mismatched payloadDigest',
      { payloadDigest: '0000000000000000000000000000000000000000000000000000000000000000' },
      'payload_digest_mismatch'
    ],
    [
      'mismatched idempotencyKey',
      { idempotencyKey: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' },
      'idempotency_key_mismatch'
    ],
    [
      'tampered metadata',
      { origin: 'https://evil.example' },
      'signature_verification_failed'
    ],
    [
      'failed signature',
      { signature: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
      'signature_verification_failed'
    ]
  ])('returns a structured verification failure for %s', async (_label, patch, reason) => {
    const envelope = await createVectorEnvelope();

    await expect(verifySignedWriteEnvelope({
      envelope: withEnvelopePatch(envelope, patch as Partial<SignedWriteEnvelope<typeof VECTOR_PAYLOAD>>),
      verify: ed25519VerifyHook()
    })).resolves.toMatchObject({
      valid: false,
      reason
    });
  });

  it('uses injected sign and verify hooks without owning key lifecycle', async () => {
    const sign = vi.fn(ed25519SignHook());
    const envelope = await createSignedWriteEnvelope(baseCreateInput({ sign }));
    const verify = vi.fn(ed25519VerifyHook());
    const result = await verifySignedWriteEnvelope({ envelope, verify });

    expect(sign).toHaveBeenCalledWith(expect.objectContaining({
      signatureSuite: CLIENT_SIGNED_WRITE_SIGNATURE_SUITE,
      canonicalEnvelope: EXPECTED_CANONICAL_ENVELOPE
    }));
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({
      signatureSuite: CLIENT_SIGNED_WRITE_SIGNATURE_SUITE,
      canonicalEnvelope: EXPECTED_CANONICAL_ENVELOPE,
      signature: EXPECTED_SIGNATURE
    }));
    expect(result.valid).toBe(true);
  });

  it('reports missing WebCrypto SHA-256 as a closed failure', async () => {
    vi.stubGlobal('crypto', undefined);

    await expect(digestSignedWritePayload(VECTOR_PAYLOAD)).rejects.toMatchObject({
      reason: 'invalid_payload_digest'
    });

    vi.unstubAllGlobals();
  });

  it('rethrows unexpected envelope validation errors', async () => {
    const envelope = await createVectorEnvelope();
    const throwingEnvelope = Object.create(envelope) as SignedWriteEnvelope<typeof VECTOR_PAYLOAD>;
    Object.defineProperty(throwingEnvelope, 'envelopeVersion', {
      get() {
        throw new Error('unexpected getter failure');
      }
    });

    await expect(verifySignedWriteEnvelope({
      envelope: throwingEnvelope,
      verify: ed25519VerifyHook()
    })).rejects.toThrow(/unexpected getter failure/);
  });

  it('throws a signed-write error for invalid public author construction', () => {
    expect(() => createLumaPublicAuthorId(
      'ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789',
      'forum-author-v1'
    )).toThrow(SignedWriteEnvelopeError);
    expect(() => createLumaPublicAuthorId(PUBLIC_AUTHOR_VALUE, 'legacy-nullifier'))
      .toThrow(SignedWriteEnvelopeError);
  });
});
