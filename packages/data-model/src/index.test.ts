import { describe, expect, it } from 'vitest';
import * as index from './index';

describe('data-model index exports', () => {
  it('exposes schemas', () => {
    expect(index.ProfileSchema).toBeDefined();
    expect(index.MessageSchema).toBeDefined();
    expect(index.AnalysisSchema).toBeDefined();
    expect(index.AggregateSentimentSchema).toBeDefined();
    expect(index.CanonicalAnalysisSchema).toBeDefined();
    expect(index.XpLedgerSchema).toBeDefined();
    expect(index.HermesMessageSchema).toBeDefined();
    expect(index.HermesChannelSchema).toBeDefined();
    expect(index.HermesThreadSchema).toBeDefined();
    expect(index.HermesCommentSchema).toBeDefined();
    expect(index.ModerationEventSchema).toBeDefined();
  });
});
