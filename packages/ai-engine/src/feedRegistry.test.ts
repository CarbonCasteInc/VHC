import { describe, expect, it } from 'vitest';
import {
  STARTER_FEED_SOURCES,
  getSourceMetadata,
  resolveDisplayName,
} from './feedRegistry';
import { FeedSourceSchema, type FeedSource } from './newsTypes';

describe('feedRegistry', () => {
  describe('STARTER_FEED_SOURCES', () => {
    it('contains the baseline starter surface and evidence-admitted additions', () => {
      expect(STARTER_FEED_SOURCES.length).toBeGreaterThanOrEqual(23);
    });

    it('all sources pass FeedSourceSchema validation', () => {
      for (const source of STARTER_FEED_SOURCES) {
        expect(() => FeedSourceSchema.parse(source)).not.toThrow();
      }
    });

    it('all sources are enabled', () => {
      for (const source of STARTER_FEED_SOURCES) {
        expect(source.enabled).toBe(true);
      }
    });

    it('preserves the conservative coverage floor', () => {
      const conservative = STARTER_FEED_SOURCES.filter(
        (s) => s.perspectiveTag === 'conservative',
      );
      expect(conservative.length).toBeGreaterThanOrEqual(3);
    });

    it('preserves the progressive coverage floor', () => {
      const progressive = STARTER_FEED_SOURCES.filter(
        (s) => s.perspectiveTag === 'progressive',
      );
      expect(progressive.length).toBeGreaterThanOrEqual(3);
    });

    it('preserves the international-wire coverage floor', () => {
      const wire = STARTER_FEED_SOURCES.filter(
        (s) => s.perspectiveTag === 'international-wire',
      );
      expect(wire.length).toBeGreaterThanOrEqual(6);
    });

    it('includes the highest-confidence statehouse and specialist additions', () => {
      expect(
        STARTER_FEED_SOURCES.find((source) => source.id === 'texastribune-main'),
      ).toMatchObject({
        name: 'Texas Tribune',
        rssUrl: 'https://feeds.texastribune.org/feeds/main/',
        perspectiveTag: 'statehouse',
        iconKey: 'texastribune',
        enabled: true,
      });
      expect(
        STARTER_FEED_SOURCES.find((source) => source.id === 'kffhealthnews-original'),
      ).toMatchObject({
        name: 'KFF Health News',
        rssUrl: 'https://kffhealthnews.org/topics/syndicate/feed/aprss',
        perspectiveTag: 'health-policy',
        iconKey: 'kff',
        enabled: true,
      });
      expect(
        STARTER_FEED_SOURCES.find((source) => source.id === 'scotusblog-main'),
      ).toMatchObject({
        name: 'SCOTUSblog',
        rssUrl: 'https://feeds.feedburner.com/scotusblog/pFXs',
        perspectiveTag: 'courts-legal',
        iconKey: 'scotusblog',
        enabled: true,
      });
    });

    it('includes evidence-admitted abc politics coverage', () => {
      expect(
        STARTER_FEED_SOURCES.find((source) => source.id === 'abc-politics'),
      ).toMatchObject({
        name: 'ABC News Politics',
        rssUrl: 'https://abcnews.go.com/abcnews/politicsheadlines',
        perspectiveTag: 'broadcast-news',
        iconKey: 'abc',
        enabled: true,
      });
    });

    it('includes evidence-admitted nbc politics coverage', () => {
      expect(
        STARTER_FEED_SOURCES.find((source) => source.id === 'nbc-politics'),
      ).toMatchObject({
        name: 'NBC News Politics',
        rssUrl: 'https://feeds.nbcnews.com/feeds/nbcpolitics',
        perspectiveTag: 'broadcast-news',
        iconKey: 'nbc',
        enabled: true,
      });
    });

    it('includes evidence-admitted washington examiner politics coverage', () => {
      expect(
        STARTER_FEED_SOURCES.find(
          (source) => source.id === 'washingtonexaminer-politics',
        ),
      ).toMatchObject({
        name: 'Washington Examiner Politics',
        rssUrl: 'https://www.washingtonexaminer.com/tag/politics.rss',
        perspectiveTag: 'conservative',
        iconKey: 'washingtonexaminer',
        enabled: true,
      });
    });

    it('includes evidence-admitted pbs politics coverage', () => {
      expect(
        STARTER_FEED_SOURCES.find((source) => source.id === 'pbs-politics'),
      ).toMatchObject({
        name: 'PBS News Politics',
        rssUrl: 'https://www.pbs.org/newshour/feeds/rss/politics',
        perspectiveTag: 'public-broadcast',
        iconKey: 'pbs',
        enabled: true,
      });
    });

    it('includes evidence-admitted npr politics coverage', () => {
      expect(
        STARTER_FEED_SOURCES.find((source) => source.id === 'npr-politics'),
      ).toMatchObject({
        name: 'NPR Politics',
        rssUrl: 'https://feeds.npr.org/1014/rss.xml',
        perspectiveTag: 'public-radio',
        iconKey: 'npr',
        enabled: true,
      });
    });

    it('includes evidence-admitted npr general news coverage', () => {
      expect(
        STARTER_FEED_SOURCES.find((source) => source.id === 'npr-news'),
      ).toMatchObject({
        name: 'NPR News',
        rssUrl: 'https://feeds.npr.org/1001/rss.xml',
        perspectiveTag: 'public-radio',
        iconKey: 'npr',
        enabled: true,
      });
    });

    it('all sources have unique ids', () => {
      const ids = STARTER_FEED_SOURCES.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('all sources have valid RSS URLs', () => {
      for (const source of STARTER_FEED_SOURCES) {
        expect(() => new URL(source.rssUrl)).not.toThrow();
      }
    });

    it('all sources have displayName and iconKey', () => {
      for (const source of STARTER_FEED_SOURCES) {
        expect(source.displayName).toBeTruthy();
        expect(source.iconKey).toBeTruthy();
      }
    });

    it('is frozen (immutable)', () => {
      expect(Object.isFrozen(STARTER_FEED_SOURCES)).toBe(true);
    });
  });

  describe('getSourceMetadata', () => {
    it('returns metadata for known source', () => {
      const meta = getSourceMetadata('fox-latest');
      expect(meta).toEqual({
        displayName: 'Fox News',
        perspectiveTag: 'conservative',
        iconKey: 'fox',
      });
    });

    it('returns metadata for progressive source', () => {
      const meta = getSourceMetadata('guardian-us');
      expect(meta).toEqual({
        displayName: 'The Guardian',
        perspectiveTag: 'progressive',
        iconKey: 'guardian',
      });
    });

    it('returns metadata for international-wire source', () => {
      const meta = getSourceMetadata('bbc-general');
      expect(meta).toEqual({
        displayName: 'BBC News',
        perspectiveTag: 'international-wire',
        iconKey: 'bbc',
      });
    });

    it('returns undefined for unknown source', () => {
      expect(getSourceMetadata('nonexistent')).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      expect(getSourceMetadata('')).toBeUndefined();
    });

    it('returns correct metadata for all configured sources', () => {
      for (const source of STARTER_FEED_SOURCES) {
        const meta = getSourceMetadata(source.id);
        expect(meta).toBeDefined();
        expect(meta!.displayName).toBeTruthy();
      }
    });

    it('returns metadata for evidence-admitted abc politics', () => {
      const meta = getSourceMetadata('abc-politics');
      expect(meta).toEqual({
        displayName: 'ABC News',
        perspectiveTag: 'broadcast-news',
        iconKey: 'abc',
      });
    });

    it('returns metadata for evidence-admitted nbc politics', () => {
      const meta = getSourceMetadata('nbc-politics');
      expect(meta).toEqual({
        displayName: 'NBC News',
        perspectiveTag: 'broadcast-news',
        iconKey: 'nbc',
      });
    });

    it('returns metadata for evidence-admitted washington examiner politics', () => {
      const meta = getSourceMetadata('washingtonexaminer-politics');
      expect(meta).toEqual({
        displayName: 'Washington Examiner',
        perspectiveTag: 'conservative',
        iconKey: 'washingtonexaminer',
      });
    });

    it('returns metadata for evidence-admitted pbs politics', () => {
      const meta = getSourceMetadata('pbs-politics');
      expect(meta).toEqual({
        displayName: 'PBS News',
        perspectiveTag: 'public-broadcast',
        iconKey: 'pbs',
      });
    });

    it('returns metadata for evidence-admitted npr politics', () => {
      const meta = getSourceMetadata('npr-politics');
      expect(meta).toEqual({
        displayName: 'NPR',
        perspectiveTag: 'public-radio',
        iconKey: 'npr',
      });
    });

    it('returns metadata for evidence-admitted npr general news', () => {
      const meta = getSourceMetadata('npr-news');
      expect(meta).toEqual({
        displayName: 'NPR',
        perspectiveTag: 'public-radio',
        iconKey: 'npr',
      });
    });

    it('returns metadata for newly admitted specialist and international sources', () => {
      expect(getSourceMetadata('texastribune-main')).toEqual({
        displayName: 'Texas Tribune',
        perspectiveTag: 'statehouse',
        iconKey: 'texastribune',
      });
      expect(getSourceMetadata('sky-world')).toEqual({
        displayName: 'Sky News',
        perspectiveTag: 'international-wire',
        iconKey: 'sky',
      });
      expect(getSourceMetadata('channelnewsasia-latest')).toEqual({
        displayName: 'Channel NewsAsia',
        perspectiveTag: 'international-wire',
        iconKey: 'cna',
      });
    });

    it('falls back to name when displayName is absent', () => {
      const bbcMeta = getSourceMetadata('bbc-us-canada');
      expect(bbcMeta).toBeDefined();
      expect(bbcMeta!.displayName).toBe('BBC');
    });
  });

  describe('resolveDisplayName', () => {
    it('returns displayName when present', () => {
      const source: FeedSource = {
        id: 'test',
        name: 'Test Name',
        rssUrl: 'https://example.com/feed',
        displayName: 'Display Name',
        enabled: true,
      };
      expect(resolveDisplayName(source)).toBe('Display Name');
    });

    it('falls back to name when displayName is undefined', () => {
      const source: FeedSource = {
        id: 'test',
        name: 'Fallback Name',
        rssUrl: 'https://example.com/feed',
        enabled: true,
      };
      expect(resolveDisplayName(source)).toBe('Fallback Name');
    });
  });
});
