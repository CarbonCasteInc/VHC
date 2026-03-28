import { describe, expect, it } from 'vitest';
import { SOURCE_SCOUT_CANDIDATE_FEED_SOURCES } from './sourceScoutCandidates';

describe('sourceScoutCandidates', () => {
  it('includes AP html-hub scout candidates', () => {
    expect(
      SOURCE_SCOUT_CANDIDATE_FEED_SOURCES.filter((source) => source.id.startsWith('ap-')).map((source) => ({
        id: source.id,
        rssUrl: source.rssUrl,
      })),
    ).toEqual([
      {
        id: 'ap-topnews',
        rssUrl: 'https://apnews.com/hub/apf-topnews',
      },
      {
        id: 'ap-politics',
        rssUrl: 'https://apnews.com/politics',
      },
    ]);
  });
});
