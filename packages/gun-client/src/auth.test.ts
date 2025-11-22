import { describe, expect, it } from 'vitest';
import { createSession } from './auth';
import type { AttestationPayload } from '@vh/types';
import { vi } from 'vitest';

describe('createSession', () => {
  const payload: AttestationPayload = {
    platform: 'web',
    deviceKey: 'dev-key',
    integrityToken: 'token',
    nonce: 'nonce'
  };

  const mockFetch = (trustScore: number) =>
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        token: 't1',
        trustScore,
        nullifier: 'n1'
      })
    } as any);

  it('accepts high trust devices', async () => {
    const fetchSpy = mockFetch(0.9);
    const original = globalThis.fetch;
    globalThis.fetch = fetchSpy as any;
    const session = await createSession(payload, 'http://verifier');
    expect(fetchSpy).toHaveBeenCalled();
    expect(session.token).toBe('t1');
    globalThis.fetch = original;
  });

  it('rejects low trust devices', async () => {
    const fetchSpy = mockFetch(0.1);
    const original = globalThis.fetch;
    globalThis.fetch = fetchSpy as any;
    await expect(createSession(payload, 'http://verifier')).rejects.toThrow('Security Error');
    globalThis.fetch = original;
  });
});
