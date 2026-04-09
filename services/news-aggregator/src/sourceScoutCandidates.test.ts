import { describe, expect, it } from 'vitest';
import { SOURCE_SCOUT_CANDIDATE_FEED_SOURCES } from './sourceScoutCandidates';

describe('SOURCE_SCOUT_CANDIDATE_FEED_SOURCES', () => {
  it('drops ap-topnews from the scout backlog once it is in the starter surface', () => {
    expect(
      SOURCE_SCOUT_CANDIDATE_FEED_SOURCES.some((source) => source.id === 'ap-topnews'),
    ).toBe(false);
  });

  it('keeps only unpromoted reviewed candidates in the scout backlog', () => {
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

  it('drops promoted candidates from the scout backlog once they join the starter surface', () => {
    expect(
      SOURCE_SCOUT_CANDIDATE_FEED_SOURCES.some((source) => source.id === 'ap-politics'),
    ).toBe(false);
    expect(
      SOURCE_SCOUT_CANDIDATE_FEED_SOURCES.some((source) => source.id === 'latimes-california'),
    ).toBe(false);
    expect(
      SOURCE_SCOUT_CANDIDATE_FEED_SOURCES.some((source) => source.id === 'militarytimes-news'),
    ).toBe(false);
    expect(
      SOURCE_SCOUT_CANDIDATE_FEED_SOURCES.some((source) => source.id === 'fedsmith-news'),
    ).toBe(false);
    expect(
      SOURCE_SCOUT_CANDIDATE_FEED_SOURCES.some((source) => source.id === 'democracydocket-alerts'),
    ).toBe(false);
    expect(
      SOURCE_SCOUT_CANDIDATE_FEED_SOURCES.some((source) => source.id === 'bigbendsentinel-border-wall'),
    ).toBe(false);
  });
});
