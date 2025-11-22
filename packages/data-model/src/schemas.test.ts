import { describe, expect, it } from 'vitest';
import { AnalysisSchema, MessageSchema, ProfileSchema } from './schemas';

describe('data-model schemas', () => {
  it('accepts a valid profile', () => {
    const result = ProfileSchema.parse({
      pubkey: 'pk',
      username: 'venn-user',
      bio: 'hello',
      avatarCid: 'cid'
    });
    expect(result.username).toBe('venn-user');
  });

  it('rejects too-short username', () => {
    expect(() =>
      ProfileSchema.parse({
        pubkey: 'pk',
        username: 'aa'
      })
    ).toThrow();
  });

  it('rejects too-long username', () => {
    expect(() =>
      ProfileSchema.parse({
        pubkey: 'pk',
        username: 'a'.repeat(31)
      })
    ).toThrow();
  });

  it('rejects message with invalid kind', () => {
    expect(() =>
      MessageSchema.parse({
        id: '1',
        timestamp: Date.now(),
        sender: 'pk',
        content: 'cipher',
        kind: 'video'
      })
    ).toThrow();
  });

  it('rejects invalid message timestamp', () => {
    expect(() =>
      MessageSchema.parse({
        id: '1',
        timestamp: -1,
        sender: 'pk',
        content: 'cipher',
        kind: 'text'
      })
    ).toThrow();
  });

  it('rejects analysis with out-of-range sentiment score', () => {
    expect(() =>
      AnalysisSchema.parse({
        canonicalId: 'abc',
        summary: 'test',
        biases: ['x'],
        counterpoints: ['y'],
        sentimentScore: -2,
        timestamp: Date.now()
      })
    ).toThrow();
  });

  it('rejects signal missing required fields', () => {
    expect(() =>
      SignalSchema.parse({
        topic_id: '',
        analysis_id: '',
        bias_vector: {},
        weight: 'bad'
      } as any)
    ).toThrow();
  });
});
