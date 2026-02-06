import { describe, expect, it, beforeEach } from 'vitest';
import {
  publishIdentity,
  getPublishedIdentity,
  clearPublishedIdentity,
} from './identityProvider';

describe('identityProvider', () => {
  beforeEach(() => {
    clearPublishedIdentity();
  });

  it('starts with null identity', () => {
    expect(getPublishedIdentity()).toBeNull();
  });

  it('publishes and retrieves identity snapshot', () => {
    publishIdentity({
      session: { nullifier: 'test-null', trustScore: 0.9, scaledTrustScore: 9000 },
    });
    const snapshot = getPublishedIdentity();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.session.nullifier).toBe('test-null');
    expect(snapshot!.session.trustScore).toBe(0.9);
    expect(snapshot!.session.scaledTrustScore).toBe(9000);
  });

  it('does not leak extra fields from input', () => {
    const input = {
      session: { nullifier: 'n', trustScore: 1, scaledTrustScore: 10000 },
      devicePair: { pub: 'pub', priv: 'SECRET', epub: 'epub', epriv: 'SECRET2' },
      someOtherField: 'should not appear',
    } as any;
    publishIdentity(input);
    const snapshot = getPublishedIdentity();
    expect((snapshot as any).devicePair).toBeUndefined();
    expect((snapshot as any).someOtherField).toBeUndefined();
    expect((snapshot as any).session.token).toBeUndefined();
  });

  it('clears identity', () => {
    publishIdentity({
      session: { nullifier: 'n', trustScore: 1, scaledTrustScore: 10000 },
    });
    expect(getPublishedIdentity()).not.toBeNull();
    clearPublishedIdentity();
    expect(getPublishedIdentity()).toBeNull();
  });

  it('returns a defensive copy — mutations do not affect the singleton', () => {
    publishIdentity({
      session: { nullifier: 'original', trustScore: 0.9, scaledTrustScore: 9000 },
    });
    const snapshot = getPublishedIdentity()!;
    snapshot.session.nullifier = 'mutated';
    expect(getPublishedIdentity()!.session.nullifier).toBe('original');
  });

  it('sets __vh_identity_published flag on globalThis', () => {
    expect((globalThis as any).__vh_identity_published).toBeFalsy();
    publishIdentity({
      session: { nullifier: 'n', trustScore: 1, scaledTrustScore: 10000 },
    });
    expect((globalThis as any).__vh_identity_published).toBe(true);
    clearPublishedIdentity();
    expect((globalThis as any).__vh_identity_published).toBe(false);
  });
});
