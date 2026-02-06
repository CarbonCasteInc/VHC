import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  publishIdentity,
  getPublishedIdentity,
  getFullIdentity,
  clearPublishedIdentity,
} from './identityProvider';

describe('identityProvider', () => {
  beforeEach(() => {
    clearPublishedIdentity();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts with null identity', () => {
    expect(getPublishedIdentity()).toBeNull();
    expect(getFullIdentity()).toBeNull();
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

  it('returns full record (including private keys) via getFullIdentity', () => {
    const record = {
      session: { nullifier: 'n', trustScore: 1, scaledTrustScore: 10000 },
      devicePair: { pub: 'pub', priv: 'priv', epub: 'epub', epriv: 'epriv' },
      attestation: { token: 'secret-token' },
    };
    publishIdentity(record);

    const full = getFullIdentity<typeof record>();
    expect(full).toEqual(record);
    expect(full?.devicePair.priv).toBe('priv');
    expect(full?.devicePair.epriv).toBe('epriv');
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
      devicePair: { pub: 'pub', priv: 'priv', epub: 'epub', epriv: 'epriv' },
    });
    expect(getPublishedIdentity()).not.toBeNull();
    expect(getFullIdentity()).not.toBeNull();
    clearPublishedIdentity();
    expect(getPublishedIdentity()).toBeNull();
    expect(getFullIdentity()).toBeNull();
  });

  it('returns a defensive copy — mutations do not affect the singleton', () => {
    publishIdentity({
      session: { nullifier: 'original', trustScore: 0.9, scaledTrustScore: 9000 },
    });
    const snapshot = getPublishedIdentity()!;
    snapshot.session.nullifier = 'mutated';
    expect(getPublishedIdentity()!.session.nullifier).toBe('original');
  });

  it('getFullIdentity returns a defensive copy — mutations do not affect the singleton', () => {
    const record = {
      session: { nullifier: 'original', trustScore: 0.9, scaledTrustScore: 9000 },
      devicePair: { pub: 'pub', priv: 'priv', epub: 'epub', epriv: 'epriv' },
    };
    publishIdentity(record);

    const full1 = getFullIdentity<typeof record>()!;
    full1.session.nullifier = 'mutated';
    full1.devicePair.priv = 'hacked';

    const full2 = getFullIdentity<typeof record>()!;
    expect(full2.session.nullifier).toBe('original');
    expect(full2.devicePair.priv).toBe('priv');
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

  it('uses the window branch when window is available', () => {
    const dispatchEvent = vi.fn();
    const fakeWindow = {
      dispatchEvent,
    } as unknown as Window & typeof globalThis;

    vi.stubGlobal('window', fakeWindow);

    publishIdentity({
      session: { nullifier: 'window-null', trustScore: 0.8, scaledTrustScore: 8000 },
    });

    expect((fakeWindow as any).__vh_identity_published).toBe(true);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const [event] = dispatchEvent.mock.calls[0] as [CustomEvent];
    expect(event.type).toBe('vh:identity-published');

    clearPublishedIdentity();
    expect((fakeWindow as any).__vh_identity_published).toBe(false);
  });
});
