import { describe, expect, it, vi } from 'vitest';
import { parseThreadFromGun } from './helpers';

describe('parseThreadFromGun — tags parsing', () => {
  it('T-1 parses stringified JSON array tags', () => {
    const result = parseThreadFromGun({ tags: '["alpha","beta"]' });

    expect(result.tags).toEqual(['alpha', 'beta']);
  });

  it('T-2 passes through non-string tags as-is', () => {
    const tags = ['alpha', 'beta'];

    const result = parseThreadFromGun({ tags });

    expect(result.tags).toBe(tags);
  });

  it('T-3 defaults malformed JSON string tags to empty array', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const result = parseThreadFromGun({ tags: '{not-json' });

      expect(result.tags).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith('[vh:forum] Failed to parse tags, defaulting to empty array');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('T-4 leaves missing tags as undefined', () => {
    const result = parseThreadFromGun({ id: 'thread-1' });

    expect(result.tags).toBeUndefined();
  });
});

describe('parseThreadFromGun — proposal guard (#90)', () => {
  it('T-5 omits non-empty array proposal', () => {
    const result = parseThreadFromGun({ id: 'thread-1', proposal: ['a'] });

    expect('proposal' in result).toBe(false);
  });

  it('T-6 omits empty array proposal', () => {
    const result = parseThreadFromGun({ id: 'thread-1', proposal: [] });

    expect('proposal' in result).toBe(false);
  });

  it('T-7 omits array-of-objects proposal', () => {
    const result = parseThreadFromGun({ id: 'thread-1', proposal: [{ foo: 'bar' }] });

    expect('proposal' in result).toBe(false);
  });

  it('T-8 preserves valid plain object proposal and strips top-level _ metadata', () => {
    const result = parseThreadFromGun({
      id: 'thread-1',
      proposal: {
        _: { '#': 'proposal-meta' },
        kind: 'signal',
        payload: { text: 'hello' }
      }
    });

    expect(result.proposal).toEqual({
      kind: 'signal',
      payload: { text: 'hello' }
    });
  });

  it('T-9 preserves valid object proposal without _ as-is', () => {
    const proposal = { kind: 'signal', score: 10 };

    const result = parseThreadFromGun({ id: 'thread-1', proposal });

    expect(result.proposal).toEqual(proposal);
  });

  it('T-10 returns an empty object when proposal only contains _', () => {
    const result = parseThreadFromGun({
      id: 'thread-1',
      proposal: {
        _: { '#': 'proposal-meta' }
      }
    });

    expect(result.proposal).toEqual({});
  });

  it('T-11 omits null proposal', () => {
    const result = parseThreadFromGun({ id: 'thread-1', proposal: null });

    expect('proposal' in result).toBe(false);
  });

  it('T-12 omits undefined and missing proposal', () => {
    const withUndefined = parseThreadFromGun({ id: 'thread-1', proposal: undefined });
    const missing = parseThreadFromGun({ id: 'thread-2' });

    expect('proposal' in withUndefined).toBe(false);
    expect('proposal' in missing).toBe(false);
  });

  it('T-13 omits numeric proposal', () => {
    const result = parseThreadFromGun({ id: 'thread-1', proposal: 42 });

    expect('proposal' in result).toBe(false);
  });

  it('T-14 omits string proposal', () => {
    const result = parseThreadFromGun({ id: 'thread-1', proposal: 'proposal' });

    expect('proposal' in result).toBe(false);
  });

  it('T-15 omits boolean proposal', () => {
    const result = parseThreadFromGun({ id: 'thread-1', proposal: true });

    expect('proposal' in result).toBe(false);
  });

  it('T-16 strips only top-level _ from proposal', () => {
    const result = parseThreadFromGun({
      id: 'thread-1',
      proposal: {
        _: { '#': 'top-meta' },
        nested: {
          _: { '#': 'nested-meta' },
          keep: true
        }
      }
    });

    expect(result.proposal).toEqual({
      nested: {
        _: { '#': 'nested-meta' },
        keep: true
      }
    });
  });
});

describe('parseThreadFromGun — field pass-through', () => {
  it('T-17 passes through non-proposal fields unchanged', () => {
    const input = {
      id: 'thread-1',
      title: 'Title',
      body: 'Body',
      topicId: 'topic-1',
      authorId: 'author-1',
      timestamp: 1_706_000_000,
      tags: ['alpha', 'beta']
    };

    const result = parseThreadFromGun(input);

    expect(result).toMatchObject(input);
  });

  it('T-18 preserves root-level Gun _ metadata on the thread object', () => {
    const result = parseThreadFromGun({
      id: 'thread-1',
      _: { '#': 'thread-meta' },
      proposal: {
        _: { '#': 'proposal-meta' },
        label: 'keep'
      }
    });

    expect(result._).toEqual({ '#': 'thread-meta' });
    expect(result.proposal).toEqual({ label: 'keep' });
  });
});
