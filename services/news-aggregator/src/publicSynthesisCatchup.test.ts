import { describe, expect, it } from 'vitest';
import { assertPublicSynthesisCatchupSystemWriterPin } from './publicSynthesisCatchup';

describe('public synthesis catch-up runner', () => {
  it('fails loudly when no public system-writer pin is configured', () => {
    expect(() => assertPublicSynthesisCatchupSystemWriterPin({})).toThrow(
      /Public synthesis catch-up requires VH_SYSTEM_WRITER_PIN_JSON/,
    );
  });

  it('accepts a configured system-writer pin for signed lifecycle verification', () => {
    expect(() => assertPublicSynthesisCatchupSystemWriterPin({
      systemWriterPin: {
        pinVersion: 1,
        schemaEpoch: 'luma-public-v1',
        maxProtocolVersion: 'luma-public-v1',
        signatureSuite: 'jcs-ed25519-sha256-v1',
        writers: [
          {
            id: 'vh-public-writer-v1',
            status: 'active',
            publicKey: {
              encoding: 'spki-base64url',
              material: 'public-key-material',
            },
          },
        ],
      },
    })).not.toThrow();
  });
});
