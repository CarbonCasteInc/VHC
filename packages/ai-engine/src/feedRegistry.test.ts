import { describe, expect, it } from 'vitest';
import {
  STARTER_FEED_SOURCES,
  getSourceMetadata,
  resolveDisplayName,
} from './feedRegistry';
import { FeedSourceSchema, type FeedSource } from './newsTypes';

describe('feedRegistry', () => {
  describe('STARTER_FEED_SOURCES', () => {
    it('contains exactly 9 sources', () => {
      expect(STARTER_FEED_SOURCES).toHaveLength(9);
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

    it('has 3 conservative sources', () => {
      const conservative = STARTER_FEED_SOURCES.filter(
        (s) => s.perspectiveTag === 'conservative',
      );
      expect(conservative).toHaveLength(3);
    });

    it('has 3 progressive sources', () => {
      const progressive = STARTER_FEED_SOURCES.filter(
        (s) => s.perspectiveTag === 'progressive',
      );
      expect(progressive).toHaveLength(3);
    });

    it('has 3 international-wire sources', () => {
      const wire = STARTER_FEED_SOURCES.filter(
        (s) => s.perspectiveTag === 'international-wire',
      );
      expect(wire).toHaveLength(3);
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

    it('returns correct metadata for all 9 sources', () => {
      for (const source of STARTER_FEED_SOURCES) {
        const meta = getSourceMetadata(source.id);
        expect(meta).toBeDefined();
        expect(meta!.displayName).toBeTruthy();
      }
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
