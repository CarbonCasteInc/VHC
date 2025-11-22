import { describe, expect, it } from 'vitest';
import * as index from './index';

describe('crdt index exports', () => {
  it('exposes LamportClock and LwwRegister', () => {
    expect(index.LamportClock).toBeDefined();
    expect(index.LwwRegister).toBeDefined();
  });
});
