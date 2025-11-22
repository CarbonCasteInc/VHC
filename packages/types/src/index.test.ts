import { describe, expect, it } from 'vitest';
import {
  AttestationPayloadSchema,
  VerificationResultSchema,
  SessionResponseSchema,
  RegionProofSchema,
  type AttestationPayload,
  type VerificationResult,
  type SessionResponse,
  type RegionProof
} from './index';

describe('types schemas', () => {
  it('validates attestation payload', () => {
    const payload: AttestationPayload = {
      platform: 'web',
      integrityToken: 'tok',
      deviceKey: 'dev',
      nonce: 'n1'
    };
    expect(() => AttestationPayloadSchema.parse(payload)).not.toThrow();
  });

  it('rejects attestation payload with bad platform', () => {
    expect(() =>
      AttestationPayloadSchema.parse({
        platform: 'pc',
        integrityToken: 'tok',
        deviceKey: 'dev',
        nonce: 'n1'
      })
    ).toThrow();
  });

  it('validates verification result', () => {
    const result: VerificationResult = { success: true, trustScore: 0.9, issuedAt: Date.now() };
    expect(() => VerificationResultSchema.parse(result)).not.toThrow();
  });

  it('rejects verification result out of range', () => {
    expect(() =>
      VerificationResultSchema.parse({ success: true, trustScore: 2, issuedAt: 1 })
    ).toThrow();
  });

  it('validates session response', () => {
    const resp: SessionResponse = { token: 't', trustScore: 0.8, nullifier: 'n' };
    expect(() => SessionResponseSchema.parse(resp)).not.toThrow();
  });

  it('rejects session response with low trust type', () => {
    expect(() =>
      SessionResponseSchema.parse({ token: '', trustScore: -1, nullifier: '' })
    ).toThrow();
  });

  it('validates region proof', () => {
    expect(() =>
      RegionProofSchema.parse({
        proof: 'base64-proof',
        publicSignals: ['district-hash', 'nullifier'],
        timestamp: Date.now()
      })
    ).not.toThrow();
  });

  it('rejects region proof with empty signals or negative timestamp', () => {
    expect(() =>
      RegionProofSchema.parse({
        proof: '',
        publicSignals: [],
        timestamp: -10
      })
    ).toThrow();
  });
});
