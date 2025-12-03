import { describe, expect, it } from 'vitest';
import { TopologyGuard } from './topology';

describe('TopologyGuard', () => {
  it('blocks PII in public path', () => {
    const guard = new TopologyGuard();
    expect(() => guard.validateWrite('vh/public/analyses/foo', { title: 'ok', nullifier: 'bad' })).toThrow();
  });

  it('requires encryption flag for sensitive paths', () => {
    const guard = new TopologyGuard();
    expect(() => guard.validateWrite('vh/sensitive/chat', { message: 'hi' })).toThrow();
    expect(() => guard.validateWrite('vh/sensitive/chat', { __encrypted: true, ciphertext: 'abc' })).not.toThrow();
  });

  it('allows public data without PII', () => {
    const guard = new TopologyGuard();
    expect(() => guard.validateWrite('vh/public/aggregates/topic', { ratio: 0.5 })).not.toThrow();
  });

  it('blocks any public payload combining district_hash and nullifier', () => {
    const guard = new TopologyGuard();
    expect(() =>
      guard.validateWrite('vh/public/aggregates/topic', { district_hash: 'd', nullifier: 'n' })
    ).toThrow();
  });

  it('allows hermes inbox writes when encrypted flag is present', () => {
    const guard = new TopologyGuard();
    expect(() =>
      guard.validateWrite('~alice-nullifier/hermes/inbox/msg-123', { __encrypted: true, ciphertext: 'x' })
    ).not.toThrow();
  });

  it('allows forum namespaces', () => {
    const guard = new TopologyGuard();
    expect(() =>
      guard.validateWrite('vh/forum/threads/thread-1', { title: 'hello', content: 'body' })
    ).not.toThrow();
  });

  it('rejects invalid hermes prefixes and raw user paths', () => {
    const guard = new TopologyGuard();
    expect(() => guard.validateWrite('vh/hermes/inbox', {})).toThrow();
    expect(() => guard.validateWrite('~user/raw/data', {})).toThrow();
  });
});
