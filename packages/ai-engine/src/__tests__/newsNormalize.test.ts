import { describe, expect, it } from 'vitest';
import {
  canonicalizeUrl,
  extractEntityKeys,
  newsNormalizeInternal,
  normalizeAndDedup,
} from '../newsNormalize';
import type { RawFeedItem } from '../newsTypes';

function item(overrides: Partial<RawFeedItem> = {}): RawFeedItem {
  return {
    sourceId: 'src-a',
    url: 'https://example.com/story',
    title: 'Breaking market update',
    publishedAt: 1_707_134_400_000,
    summary: 'Markets move after policy decision',
    ...overrides,
  };
}

describe('newsNormalize', () => {
  it('canonicalizes URLs by stripping tracking params and ordering query keys', () => {
    const canonical = canonicalizeUrl(
      'HTTPS://Example.com/story/?utm_source=x&z=2&fbclid=bad&a=1#fragment',
    );

    expect(canonical).toBe('https://example.com/story?a=1&z=2');
    expect(canonicalizeUrl('https://example.com/')).toBe('https://example.com/');
    expect(canonicalizeUrl('not-a-url')).toBe('not-a-url');

    expect(newsNormalizeInternal.isTrackingParam('utm_campaign')).toBe(true);
    expect(newsNormalizeInternal.isTrackingParam('fbclid')).toBe(true);
    expect(newsNormalizeInternal.isTrackingParam('non_tracking')).toBe(false);
  });

  it('detects language and selectively applies translation for supported non-English text', () => {
    const english = newsNormalizeInternal.buildClusterText({
      title: 'Markets rally after update',
      summary: 'The market moved higher',
    });
    expect(english.language).toBe('en');
    expect(english.translationApplied).toBe(false);

    const spanish = newsNormalizeInternal.buildClusterText({
      title: 'Última actualización de mercados',
      summary: 'Los mercados suben tras anuncio del gobierno',
    });
    expect(spanish.language).toBe('es');
    expect(spanish.translationApplied).toBe(true);
    expect(spanish.clusterText).toContain('latest');
    expect(spanish.clusterText).toContain('markets');

    const nonLatin = newsNormalizeInternal.buildClusterText({
      title: '市場速報',
      summary: '主要指数が上昇',
    });
    expect(nonLatin.language).toBe('unknown');
    expect(nonLatin.translationApplied).toBe(false);

    expect(newsNormalizeInternal.shouldTranslateLanguage('es')).toBe(true);
    expect(newsNormalizeInternal.shouldTranslateLanguage('en')).toBe(false);
    expect(newsNormalizeInternal.shouldTranslateLanguage('unknown')).toBe(false);
  });

  it('normalizes and deduplicates exact canonical URL collisions', () => {
    const normalized = normalizeAndDedup([
      item({
        url: 'https://example.com/story/?utm_source=abc&id=1',
        title: 'Headline one',
      }),
      item({
        url: 'https://example.com/story/?id=1',
        title: 'Headline one duplicate',
        publishedAt: 1_707_134_405_000,
      }),
      item({
        url: 'https://example.com/story/2',
        title: 'Headline two',
        imageUrl: 'https://cdn.example.com/image.jpg?utm_medium=rss',
      }),
    ]);

    expect(normalized).toHaveLength(2);
    expect(normalized[0]).toMatchObject({
      sourceId: 'src-a',
      publisher: 'src-a',
      canonicalUrl: 'https://example.com/story?id=1',
      language: 'en',
      translation_applied: false,
    });
    expect(normalized[0]?.url_hash).toMatch(/^[0-9a-f]{8}$/);
    expect(normalized[1]?.image_hash).toMatch(/^[0-9a-f]{8}$/);
    expect(normalized[1]?.cluster_text).toContain('headline two');
  });

  it('collapses near-duplicates using translated text and image signatures where available', () => {
    const items: RawFeedItem[] = [
      item({
        sourceId: 'src-es',
        url: 'https://es.example.com/a',
        title: 'Última actualización de mercados',
        summary: 'Los mercados suben',
        imageUrl: 'https://img.example.com/markets.jpg?utm_source=x',
      }),
      item({
        sourceId: 'src-en',
        url: 'https://en.example.com/b',
        title: 'Latest market update',
        summary: 'Markets rise after announcement',
        imageUrl: 'https://img.example.com/markets.jpg',
        publishedAt: 1_707_134_450_000,
      }),
      item({
        sourceId: 'src-en-2',
        url: 'https://en.example.com/c',
        title: 'Latest market update from Europe',
        summary: 'Markets rise in Europe after policy statement',
        publishedAt: 1_707_134_460_000,
      }),
    ];

    const deduped = normalizeAndDedup(items);
    expect(deduped).toHaveLength(2);
    expect(deduped[0]?.sourceId).toBe('src-es'); // first wins deterministically
    expect(deduped[1]?.sourceId).toBe('src-en-2');
  });

  it('honors configurable near-duplicate windows and bucket boundaries', () => {
    const items: RawFeedItem[] = [
      item({
        sourceId: 'src-1',
        url: 'https://example.com/a',
        title: 'Breaking market update',
        publishedAt: 1_707_134_400_000,
      }),
      item({
        sourceId: 'src-2',
        url: 'https://example.com/b',
        title: 'Breaking market update',
        publishedAt: 1_707_137_999_999,
      }),
      item({
        sourceId: 'src-3',
        url: 'https://example.com/c',
        title: 'Breaking market update',
        publishedAt: 1_707_138_000_001,
      }),
    ];

    const defaultWindow = normalizeAndDedup(items);
    expect(defaultWindow).toHaveLength(2);

    const tinyWindow = normalizeAndDedup(items, { nearDuplicateWindowMs: 1_000 });
    expect(tinyWindow).toHaveLength(3);

    expect(
      newsNormalizeInternal.toTimeBucket(1_707_134_400_000, 3_600_000),
    ).toBe(
      Math.floor(1_707_134_400_000 / 3_600_000),
    );
    expect(newsNormalizeInternal.toTimeBucket(undefined, 3_600_000)).toBe(-1);
  });

  it('exposes near-duplicate key + similarity helpers for deterministic collapse behavior', () => {
    const base = item({
      title: 'Breaking Market Update',
      imageUrl: 'https://img.example.com/a.jpg',
    });
    const same = item({
      title: 'Breaking market update!!',
      imageUrl: 'https://img.example.com/a.jpg?utm_source=rss',
    });

    const baseKey = newsNormalizeInternal.computeNearDuplicateKey(base, 3_600_000);
    const sameKey = newsNormalizeInternal.computeNearDuplicateKey(same, 3_600_000);
    expect(baseKey).toBe(sameKey);
    expect(baseKey).not.toContain('no-image');

    const noImageKey = newsNormalizeInternal.computeNearDuplicateKey(
      item({ imageUrl: undefined }),
      3_600_000,
    );
    expect(noImageKey).toContain('no-image');

    const translated = newsNormalizeInternal.translateTokens(['mercados', 'suben'], 'es');
    expect(translated.text).toBe('markets rise');
    expect(translated.translatedCount).toBe(2);

    const unknownTranslate = newsNormalizeInternal.translateTokens(['foo'], 'unknown');
    expect(unknownTranslate.translatedCount).toBe(0);

    expect(newsNormalizeInternal.textSimilarity('same text', 'same text')).toBe(1);
    expect(newsNormalizeInternal.textSimilarity('alpha beta', 'gamma delta')).toBe(0);
    expect(newsNormalizeInternal.sharedPrefixTokens('one two three', 'one two x')).toBe(2);

    const normalized = normalizeAndDedup([
      item({ sourceId: 'x', url: 'https://example.com/x', title: 'Prefix one two three four' }),
      item({ sourceId: 'y', url: 'https://example.com/y', title: 'Prefix one two three five' }),
    ]);
    expect(normalized).toHaveLength(1);

    const farApart = normalizeAndDedup([
      item({ sourceId: 'x', url: 'https://example.com/x1', title: 'Same title', publishedAt: 1_000 }),
      item({ sourceId: 'y', url: 'https://example.com/y1', title: 'Same title', publishedAt: 9_000_000 }),
    ]);
    expect(farApart).toHaveLength(2);
  });

  it('covers edge-case language and near-duplicate helper branches', () => {
    expect(newsNormalizeInternal.detectLanguage('   ')).toBe('unknown');
    expect(newsNormalizeInternal.detectLanguage('!!! ???')).toBe('unknown');
    expect(newsNormalizeInternal.detectLanguage('mercado')).toBe('en'); // low-confidence non-en falls back to en

    const untranslatedSupportedLang = newsNormalizeInternal.buildClusterText({
      title: 'le avec pour',
      summary: '',
    });
    expect(untranslatedSupportedLang.language).toBe('fr');
    expect(untranslatedSupportedLang.translationApplied).toBe(false);

    const translatedNoSummary = newsNormalizeInternal.buildClusterText({
      title: 'Última actualización de mercados',
      summary: undefined,
    });
    expect(translatedNoSummary.translationApplied).toBe(true);

    const englishNoSummary = newsNormalizeInternal.buildClusterText({
      title: 'Markets update',
      summary: undefined,
    });
    expect(englishNoSummary.translationApplied).toBe(false);

    expect(newsNormalizeInternal.textSimilarity('!!!', '!!!')).toBe(1);
    expect(newsNormalizeInternal.textSimilarity('!!!', 'abc')).toBe(0);

    const candidate = normalizeAndDedup([
      item({ sourceId: 'c1', url: 'https://example.com/c1', title: 'Same title', publishedAt: 1_000 }),
    ])[0]!;
    const existing = normalizeAndDedup([
      item({ sourceId: 'c2', url: 'https://example.com/c2', title: 'Same title', publishedAt: 9_000_000 }),
    ])[0]!;

    expect(newsNormalizeInternal.isNearDuplicateItem(candidate, existing, 3_600_000)).toBe(false);

    const fallbackCandidate = {
      ...candidate,
      cluster_text: undefined,
      image_hash: undefined,
    };
    const fallbackExisting = {
      ...candidate,
      canonicalUrl: 'https://example.com/c3',
      url_hash: 'beefbeef',
      cluster_text: undefined,
      image_hash: undefined,
    };
    expect(newsNormalizeInternal.isNearDuplicateItem(fallbackCandidate, fallbackExisting, 3_600_000)).toBe(true);
  });

  it('extracts stable entity keys and tokenization helpers', () => {
    expect(extractEntityKeys('Markets surge after central bank policy meeting')).toEqual([
      'bank',
      'central',
      'markets',
      'meeting',
      'policy',
      'surge',
    ]);

    expect(newsNormalizeInternal.normalizeTitle('  HELLO, World!!  ')).toBe('hello world');
    expect(newsNormalizeInternal.tokenizeWords('À bientôt, marchés!')).toEqual(['a', 'bientot', 'marches']);
    expect(newsNormalizeInternal.normalizeImageUrl('   ')).toBeUndefined();
  });

  it('strips html, urls, and entity noise before building cluster text and entity keys', () => {
    const built = newsNormalizeInternal.buildClusterText({
      title: 'Trump&apos;s team reacts',
      summary: '<p>Panel denies filing. <a href="https://example.com/story">Continue reading...</a></p>',
    });

    expect(built.clusterText).toContain('trump s team reacts');
    expect(built.clusterText).not.toContain('apos');
    expect(built.clusterText).not.toContain('href');
    expect(built.clusterText).not.toContain('https');
    expect(built.clusterText).not.toContain('continue reading');

    expect(
      extractEntityKeys('trump apos href https continue reading 2026 ballot recount'),
    ).toEqual(['ballot', 'recount', 'trump']);
  });

  it('decodes decimal and hex html entities and preserves unknown entities', () => {
    expect(
      newsNormalizeInternal.decodeHtmlEntities('Tom &#39;s &amp; Jerry &#x27;s <3 &bogus;'),
    ).toBe("Tom 's & Jerry 's <3 &bogus;");
    expect(
      newsNormalizeInternal.decodeHtmlEntities('Bad &#x110000; entity and &#999999999999; fallback'),
    ).toBe('Bad &#x110000; entity and &#999999999999; fallback');
    expect(
      newsNormalizeInternal.sanitizeFeedText('Rock&#x27;n&#39;roll &bogus; https://example.com'),
    ).toBe("Rock'n'roll &bogus;");
  });
});
