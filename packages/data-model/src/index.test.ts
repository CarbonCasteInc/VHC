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
    expect(index.DirectoryEntrySchema).toBeDefined();
    expect(index.StoryBundleSchema).toBeDefined();
    expect(index.CandidateSynthesisSchema).toBeDefined();
    expect(index.StoryAnalysisArtifactSchema).toBeDefined();
    expect(index.SentimentEventSchema).toBeDefined();
    expect(index.AggregateVoterNodeSchema).toBeDefined();
    expect(index.SocialNotificationSchema).toBeDefined();
    expect(index.NominationEventSchema).toBeDefined();
    expect(index.FeedItemSchema).toBeDefined();
  });
});
