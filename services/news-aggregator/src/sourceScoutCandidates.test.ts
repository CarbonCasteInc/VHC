import { describe, expect, it } from 'vitest';
import { SOURCE_SCOUT_CANDIDATE_FEED_SOURCES } from './sourceScoutCandidates';

describe('SOURCE_SCOUT_CANDIDATE_FEED_SOURCES', () => {
  it('keeps ap-politics in the scout backlog after ap-topnews promotion', () => {
    expect(
      SOURCE_SCOUT_CANDIDATE_FEED_SOURCES.find((source) => source.id === 'ap-politics'),
    ).toMatchObject({
      name: 'Associated Press Politics',
      displayName: 'AP',
      rssUrl: 'https://apnews.com/politics',
      perspectiveTag: 'wire-service',
      iconKey: 'ap',
      enabled: true,
    });
  });

  it('drops ap-topnews from the scout backlog once it is in the starter surface', () => {
    expect(
      SOURCE_SCOUT_CANDIDATE_FEED_SOURCES.some((source) => source.id === 'ap-topnews'),
    ).toBe(false);
  });

  it('keeps reviewed HTML-hub candidates in the scout backlog until promotion', () => {
    expect(
      SOURCE_SCOUT_CANDIDATE_FEED_SOURCES.find((source) => source.id === 'washingtonpost-politics'),
    ).toMatchObject({
      name: 'The Washington Post Politics',
      displayName: 'The Washington Post',
      rssUrl: 'https://www.washingtonpost.com/politics/',
      perspectiveTag: 'national-newspaper',
      iconKey: 'washingtonpost',
      enabled: true,
    });

    expect(
      SOURCE_SCOUT_CANDIDATE_FEED_SOURCES.find((source) => source.id === 'wsfa-state'),
    ).toMatchObject({
      name: 'WSFA 12 News State Politics',
      displayName: 'WSFA 12 News',
      rssUrl: 'https://www.wsfa.com/politics/state/',
      perspectiveTag: 'statehouse',
      iconKey: 'wsfa',
      enabled: true,
    });
  });
});
