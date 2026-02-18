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
      guard.validateWrite('vh/hermes/inbox/device-123/msg-123', { __encrypted: true, ciphertext: 'x' })
    ).not.toThrow();
  });

  it('allows forum namespaces', () => {
    const guard = new TopologyGuard();
    expect(() =>
      guard.validateWrite('vh/forum/threads/thread-1', { title: 'hello', content: 'body' })
    ).not.toThrow();
  });

  it('allows wave-0 public discovery and story namespaces', () => {
    const guard = new TopologyGuard();
    expect(() => guard.validateWrite('vh/discovery/items/item-1', { id: 'item-1', score: 1 })).not.toThrow();
    expect(() => guard.validateWrite('vh/news/stories/story-1', { story_id: 'story-1', title: 'Headline' })).not.toThrow();
    expect(() => guard.validateWrite('vh/news/stories/story-1/analysis/a1', { analysisKey: 'a1' })).not.toThrow();
    expect(() =>
      guard.validateWrite('vh/news/stories/story-1/analysis_latest', {
        analysisKey: 'a1',
        created_at: '2026-02-18T22:00:00.000Z',
      })
    ).not.toThrow();
    expect(() =>
      guard.validateWrite('vh/aggregates/topics/topic-1/syntheses/synth-1/epochs/3/voters/voter-1/point-1', {
        point_id: 'point-1',
        agreement: 1,
        weight: 1,
        updated_at: '2026-02-18T22:00:00.000Z',
      })
    ).not.toThrow();
  });

  it('allows news removal entries (public, no PII)', () => {
    const guard = new TopologyGuard();
    expect(() => guard.validateWrite('vh/news/removed/abc123', {
      urlHash: 'abc123',
      canonicalUrl: 'https://example.com',
      removedAt: 1700000000000,
      reason: 'extraction-failed-permanently',
    })).not.toThrow();
  });

  it('blocks PII in news removal entries', () => {
    const guard = new TopologyGuard();
    expect(() => guard.validateWrite('vh/news/removed/abc123', {
      urlHash: 'abc123',
      email: 'user@example.com',
    })).toThrow();
  });

  it('requires encryption for wave-0 sensitive document namespaces', () => {
    const guard = new TopologyGuard();
    expect(() => guard.validateWrite('~alice/docs/draft-1', { title: 'draft' })).toThrow();
    expect(() =>
      guard.validateWrite('~alice/docs/draft-1', { __encrypted: true, ciphertext: 'abc123' })
    ).not.toThrow();
  });

  it('allows directory entries that contain nullifier', () => {
    const guard = new TopologyGuard();
    expect(() =>
      guard.validateWrite('vh/directory/alice', {
        schemaVersion: 'hermes-directory-v0',
        nullifier: 'alice',
        devicePub: 'pub',
        epub: 'epub',
        registeredAt: 1,
        lastSeenAt: 1
      })
    ).not.toThrow();
  });

  it('rejects invalid hermes prefixes and raw user paths', () => {
    const guard = new TopologyGuard();
    expect(() => guard.validateWrite('vh/hermes/inbox/device-123', {})).toThrow();
    expect(() => guard.validateWrite('~user/raw/data', {})).toThrow();
  });

  it('allows encrypted writes to hermes docKeys path (sensitive)', () => {
    const guard = new TopologyGuard();
    expect(() =>
      guard.validateWrite('~alice/hermes/docKeys/doc-1', {
        __encrypted: true,
        encryptedKey: 'abc123'
      })
    ).not.toThrow();
  });

  it('requires encryption for sentiment outbox path', () => {
    const guard = new TopologyGuard();
    expect(() => guard.validateWrite('~alice/outbox/sentiment/evt-1', { plaintext: true })).toThrow();
    expect(() =>
      guard.validateWrite('~alice/outbox/sentiment/evt-1', {
        __encrypted: true,
        ciphertext: 'abc123'
      })
    ).not.toThrow();
  });

  it('rejects unencrypted writes to hermes docKeys path', () => {
    const guard = new TopologyGuard();
    expect(() =>
      guard.validateWrite('~alice/hermes/docKeys/doc-1', {
        encryptedKey: 'abc123'
      })
    ).toThrow(/sensitive write without encryption flag/);
  });
});
