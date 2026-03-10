import { describe, expect, it } from 'vitest';
import { projectBundleSources, projectStoryBundles } from './bundleProjection';
import type { ClusterBucket, StoredClusterRecord, StoredSourceDocument } from './stageState';

function makeSource(overrides: Partial<StoredSourceDocument> = {}): StoredSourceDocument {
  return {
    source_key: overrides.source_key ?? 'guardian-us:hash-1',
    source_id: overrides.source_id ?? 'guardian-us',
    publisher: overrides.publisher ?? 'The Guardian',
    url: overrides.url ?? 'https://example.com/story',
    canonical_url: overrides.canonical_url ?? 'https://example.com/story',
    url_hash: overrides.url_hash ?? 'hash-1',
    image_hash: overrides.image_hash,
    published_at: overrides.published_at ?? 100,
    title: overrides.title ?? 'Specific incident coverage',
    summary: overrides.summary ?? 'Specific incident summary.',
    language: overrides.language ?? 'en',
    translation_applied: overrides.translation_applied ?? false,
    doc_type: overrides.doc_type ?? 'hard_news',
    coverage_role: overrides.coverage_role ?? 'canonical',
    entities: overrides.entities ?? ['incident'],
    locations: overrides.locations ?? ['tehran'],
    trigger: overrides.trigger ?? 'strike',
    temporal_ms: overrides.temporal_ms ?? 100,
    event_tuple: overrides.event_tuple ?? null,
    coarse_vector: overrides.coarse_vector ?? [1, 0],
    full_vector: overrides.full_vector ?? [1, 0],
    semantic_signature: overrides.semantic_signature ?? 'sig-1',
    text: overrides.text ?? 'Specific incident coverage.',
    doc_ids: overrides.doc_ids ?? ['doc-1'],
  };
}

describe('bundleProjection', () => {
  it('prefers canonical publisher coverage over related roundup coverage', () => {
    const projected = projectBundleSources([
      makeSource({
        source_key: 'guardian-us:hash-roundup',
        url_hash: 'hash-roundup',
        title: 'Trump news at a glance: latest Iran developments',
        url: 'https://example.com/roundup',
        canonical_url: 'https://example.com/roundup',
        doc_type: 'breaking_update',
        coverage_role: 'related',
        published_at: 200,
      }),
      makeSource({
        source_key: 'guardian-us:hash-incident',
        url_hash: 'hash-incident',
        title: 'Specific drone strike report',
        url: 'https://example.com/incident',
        canonical_url: 'https://example.com/incident',
        doc_type: 'hard_news',
        coverage_role: 'canonical',
        published_at: 150,
      }),
    ]);

    expect(projected.primary_sources).toHaveLength(1);
    expect(projected.primary_sources[0]?.title).toBe('Specific drone strike report');
    expect(projected.secondary_assets.map((source) => source.title)).toContain(
      'Trump news at a glance: latest Iran developments',
    );
  });

  it('orders same-publisher candidates by canonical event tie-breakers', () => {
    const projected = projectBundleSources([
      makeSource({
        source_key: 'wire-a:hash-summary-missing',
        url_hash: 'hash-summary-missing',
        source_id: 'wire-a',
        publisher: 'Reuters',
        title: 'Reuters incident bulletin',
        summary: undefined,
        doc_type: 'hard_news',
        coverage_role: 'canonical',
        published_at: 100,
      }),
      makeSource({
        source_key: 'wire-a:hash-summary-present',
        url_hash: 'hash-summary-present',
        source_id: 'wire-a',
        publisher: 'Reuters',
        title: 'Reuters incident bulletin with summary',
        summary: 'Confirmed details from Reuters.',
        doc_type: 'hard_news',
        coverage_role: 'canonical',
        published_at: 100,
      }),
      makeSource({
        source_key: 'wire-a:hash-older',
        url_hash: 'hash-older',
        source_id: 'wire-a',
        publisher: 'Reuters',
        title: 'Reuters incident bulletin older',
        summary: 'Confirmed details from Reuters.',
        doc_type: 'hard_news',
        coverage_role: 'canonical',
        published_at: 90,
      }),
      makeSource({
        source_key: 'wire-a:hash-long',
        url_hash: 'hash-long',
        source_id: 'wire-a',
        publisher: 'Reuters',
        title: 'Reuters incident bulletin extended title',
        summary: 'Confirmed details from Reuters.',
        doc_type: 'hard_news',
        coverage_role: 'canonical',
        published_at: 100,
      }),
      makeSource({
        source_key: 'wire-a:hash-short',
        url_hash: 'hash-short',
        source_id: 'wire-a',
        publisher: 'Reuters',
        title: 'Reuters incident',
        summary: 'Confirmed details from Reuters.',
        doc_type: 'hard_news',
        coverage_role: 'canonical',
        published_at: 100,
      }),
      makeSource({
        source_key: 'wire-a:hash-opinion',
        url_hash: 'hash-opinion',
        source_id: 'wire-a',
        publisher: 'Reuters',
        title: 'Reuters opinion on the incident',
        summary: 'Confirmed details from Reuters.',
        doc_type: 'opinion',
        coverage_role: 'canonical',
        published_at: 100,
      }),
      makeSource({
        source_key: 'wire-a:hash-video',
        url_hash: 'hash-video',
        source_id: 'wire-a-video',
        publisher: 'Reuters',
        title: 'Video: Reuters incident bulletin',
        url: 'https://example.com/videos/incident',
        canonical_url: 'https://example.com/videos/incident',
        summary: 'Confirmed details from Reuters.',
        doc_type: 'breaking_update',
        coverage_role: 'canonical',
        published_at: 200,
      }),
    ]);

    expect(projected.primary_sources).toHaveLength(1);
    expect(projected.primary_sources[0]?.title).toBe('Reuters incident bulletin extended title');
    expect(projected.secondary_assets).toHaveLength(6);
    expect(projected.secondary_assets.map((source) => source.title)).toEqual(expect.arrayContaining([
      'Reuters incident',
      'Reuters incident bulletin with summary',
      'Reuters incident bulletin older',
      'Reuters incident bulletin',
      'Reuters opinion on the incident',
      'Video: Reuters incident bulletin',
    ]));
  });

  it('falls back to source id grouping and final source-key tie-breaks when titles are equal length', () => {
    const projected = projectBundleSources([
      makeSource({
        source_key: 'wire-a:z-key',
        source_id: 'wire-a',
        publisher: '',
        url_hash: 'hash-z',
        title: 'Alpha bulletin',
        summary: 'Equal summary.',
        doc_type: 'hard_news',
        coverage_role: 'canonical',
        published_at: 100,
      }),
      makeSource({
        source_key: 'wire-a:a-key',
        source_id: 'wire-a',
        publisher: '',
        url_hash: 'hash-a',
        title: 'Bravo bulletin',
        summary: 'Equal summary.',
        doc_type: 'hard_news',
        coverage_role: 'canonical',
        published_at: 100,
      }),
    ]);

    expect(projected.primary_sources).toHaveLength(1);
    expect(projected.primary_sources[0]?.source_id).toBe('wire-a');
    expect(projected.primary_sources[0]?.title).toBe('Bravo bulletin');
    expect(projected.secondary_assets.map((source) => source.title)).toEqual(['Alpha bulletin']);
  });

  it('does not promote related-only coverage to primary sources', () => {
    const projected = projectBundleSources([
      makeSource({
        source_key: 'guardian-us:hash-roundup',
        source_id: 'guardian-us',
        url_hash: 'hash-roundup',
        title: 'Trump news at a glance: latest Iran developments',
        url: 'https://example.com/roundup',
        canonical_url: 'https://example.com/roundup',
        doc_type: 'explainer_recap',
        coverage_role: 'related',
        published_at: 200,
      }),
      makeSource({
        source_key: 'cbs-politics:hash-video',
        source_id: 'cbs-politics',
        publisher: 'CBS News',
        url_hash: 'hash-video',
        title: 'Video: Armed opposition group says camp hit by drone strike',
        url: 'https://example.com/video',
        canonical_url: 'https://example.com/video',
        doc_type: 'video_clip',
        coverage_role: 'related',
        published_at: 150,
      }),
    ]);

    expect(projected.primary_sources).toEqual([]);
    expect(projected.sources).toEqual([]);
    expect(projected.secondary_assets.map((source) => source.title)).toEqual([
      'Video: Armed opposition group says camp hit by drone strike',
      'Trump news at a glance: latest Iran developments',
    ]);
  });

  it('omits related-only clusters from published StoryBundles', () => {
    const relatedOnlyRecord: StoredClusterRecord = {
      story_id: 'story-related-only',
      topic_key: 'topic-news',
      created_at: 100,
      updated_at: 110,
      cluster_window_start: 100,
      cluster_window_end: 110,
      headline: 'Roundup headline',
      summary_hint: 'Roundup summary',
      primary_language: 'en',
      translation_applied: false,
      semantic_signature: 'sig-related',
      entity_scores: { iran: 2 },
      location_scores: { iran: 1 },
      trigger_scores: {},
      document_type_counts: {
        breaking_update: 0,
        wire_report: 0,
        hard_news: 0,
        video_clip: 1,
        liveblog: 0,
        analysis: 0,
        opinion: 0,
        explainer_recap: 1,
      },
      centroid_coarse: [1, 0],
      centroid_full: [1, 0],
      source_documents: [
        makeSource({
          source_key: 'guardian-us:hash-roundup',
          source_id: 'guardian-us',
          url_hash: 'hash-roundup',
          title: 'Trump news at a glance: latest Iran developments',
          url: 'https://example.com/roundup',
          canonical_url: 'https://example.com/roundup',
          doc_type: 'explainer_recap',
          coverage_role: 'related',
        }),
        makeSource({
          source_key: 'cbs-politics:hash-video',
          source_id: 'cbs-politics',
          publisher: 'CBS News',
          url_hash: 'hash-video',
          title: 'Video: Armed opposition group says camp hit by drone strike',
          url: 'https://example.com/video',
          canonical_url: 'https://example.com/video',
          doc_type: 'video_clip',
          coverage_role: 'related',
        }),
      ],
      lineage: {
        merged_from: [],
      },
    };

    const bundles = projectStoryBundles('topic-news', [{
      key: relatedOnlyRecord.story_id,
      record: relatedOnlyRecord,
      docs: [],
    } satisfies ClusterBucket]);

    expect(bundles).toEqual([]);
  });
});
