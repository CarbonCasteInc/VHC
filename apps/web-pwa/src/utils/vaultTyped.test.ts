import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IdentityRecord } from '@vh/types';
import { loadIdentityRecord, saveIdentityRecord } from './vaultTyped';

const { loadIdentityMock, saveIdentityMock } = vi.hoisted(() => ({
  loadIdentityMock: vi.fn(),
  saveIdentityMock: vi.fn(),
}));

vi.mock('@vh/identity-vault', () => ({
  loadIdentity: (...args: unknown[]) => loadIdentityMock(...(args as [])),
  saveIdentity: (...args: unknown[]) => saveIdentityMock(...(args as [])),
}));

const sampleRecord: IdentityRecord = {
  id: 'id-1',
  createdAt: 1,
  attestation: {
    platform: 'web',
    integrityToken: 'integrity-token',
    deviceKey: 'device-key',
    nonce: 'nonce',
  },
  session: {
    token: 'session-token',
    trustScore: 0.95,
    scaledTrustScore: 9500,
    nullifier: 'nullifier-1',
  },
  handle: 'alice',
  linkedDevices: ['device-a'],
  pendingLinkCode: 'link-abc',
  devicePair: {
    pub: 'pub',
    priv: 'priv',
    epub: 'epub',
    epriv: 'epriv',
  },
};

describe('vaultTyped', () => {
  beforeEach(() => {
    loadIdentityMock.mockReset();
    saveIdentityMock.mockReset();
  });

  it('loadIdentityRecord returns null when vault is empty', async () => {
    loadIdentityMock.mockResolvedValueOnce(null);

    await expect(loadIdentityRecord()).resolves.toBeNull();
  });

  it('loadIdentityRecord returns null for unexpected non-object payload', async () => {
    loadIdentityMock.mockResolvedValueOnce('bad-payload');

    await expect(loadIdentityRecord()).resolves.toBeNull();
  });

  it('loadIdentityRecord returns typed record when vault has identity data', async () => {
    loadIdentityMock.mockResolvedValueOnce(sampleRecord);

    await expect(loadIdentityRecord()).resolves.toEqual(sampleRecord);
  });

  it('saveIdentityRecord forwards record to vault save', async () => {
    saveIdentityMock.mockResolvedValueOnce(undefined);

    await expect(saveIdentityRecord(sampleRecord)).resolves.toBeUndefined();
    expect(saveIdentityMock).toHaveBeenCalledTimes(1);
    expect(saveIdentityMock).toHaveBeenCalledWith(sampleRecord);
  });
});
