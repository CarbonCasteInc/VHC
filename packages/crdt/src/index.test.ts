import { describe, expect, it } from 'vitest';
import * as index from './index';

describe('crdt index exports', () => {
  it('exposes LamportClock and LwwRegister', () => {
    expect(index.LamportClock).toBeDefined();
    expect(index.LwwRegister).toBeDefined();
  });

  it('exposes dedup functions', () => {
    expect(index.isOperationSeen).toBeDefined();
    expect(index.markOperationSeen).toBeDefined();
    expect(index.resetSeenOperations).toBeDefined();
  });

  it('exposes AwarenessAdapter', () => {
    expect(index.AwarenessAdapter).toBeDefined();
  });

  it('exposes GunYjsProvider', () => {
    expect(index.GunYjsProvider).toBeDefined();
  });

  it('exposes MockGunYjsProvider', () => {
    expect(index.MockGunYjsProvider).toBeDefined();
  });
});
