import { describe, expect, it } from 'vitest';
import { projectBundleSources } from './bundleProjection';
import { projectStorylineGroups } from './storylineProjection';
import type { ClusterBucket, StoredClusterRecord, StoredSourceDocument, WorkingDocument } from './stageState';

function makeSource(overrides: Partial<StoredSourceDocument> = {}): StoredSourceDocument {
  return {
    source_key: overrides.source_key ?? 'wire-a:hash-1',
    source_id: overrides.source_id ?? 'wire-a',
    publisher: overrides.publisher ?? 'Reuters',
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

function makeCluster(sourceDocuments: StoredSourceDocument[]): StoredClusterRecord {
  return {
    story_id: 'story-001',
    topic_key: 'topic-news',
    created_at: 100,
    updated_at: 160,
    cluster_window_start: 100,
    cluster_window_end: 160,
    headline: 'Port attack disrupts terminals overnight',
    summary_hint: 'Canonical event summary.',
    primary_language: 'en',
    translation_applied: false,
    semantic_signature: 'sig-storyline',
    entity_scores: { port_attack: 2, eastern_terminal: 1 },
    location_scores: { harbor: 1 },
    trigger_scores: { attack: 1 },
    document_type_counts: {
      breaking_update: 0,
      wire: 0,
      hard_news: 1,
      video_clip: 0,
      liveblog: 0,
      analysis: 0,
      opinion: 0,
      explainer: 1,
    },
    centroid_coarse: [1, 0],
    centroid_full: [1, 0],
    source_documents: sourceDocuments,
    lineage: { merged_from: [] },
  };
}

function makeRelatedDocument(overrides: Partial<WorkingDocument> = {}): WorkingDocument {
  return {
    doc_id: overrides.doc_id ?? 'doc-related',
    source_id: overrides.source_id ?? 'guardian',
    publisher: overrides.publisher ?? 'The Guardian',
    title: overrides.title ?? 'Explainer: latest port attack developments at a glance',
    body: overrides.body,
    summary: overrides.summary ?? 'A recap of the wider fallout.',
    published_at: overrides.published_at ?? 120,
    url: overrides.url ?? 'https://example.com/roundup',
    canonical_url: overrides.canonical_url ?? 'https://example.com/roundup',
    url_hash: overrides.url_hash ?? 'hash-roundup',
    image_hash: overrides.image_hash,
    language_hint: overrides.language_hint,
    entity_keys: overrides.entity_keys ?? ['port_attack'],
    translation_applied: overrides.translation_applied ?? false,
    source_variants: overrides.source_variants ?? [{
      doc_id: 'doc-related',
      source_id: 'guardian',
      publisher: 'The Guardian',
      url: 'https://example.com/roundup',
      canonical_url: 'https://example.com/roundup',
      url_hash: 'hash-roundup',
      published_at: 120,
      title: 'Explainer: latest port attack developments at a glance',
      summary: 'A recap of the wider fallout.',
      language: 'en',
      translation_applied: false,
      coverage_role: 'related',
    }],
    raw_text: overrides.raw_text ?? 'Explainer: latest port attack developments at a glance. A recap of the wider fallout.',
    normalized_text: overrides.normalized_text ?? 'explainer latest port attack developments at a glance a recap of the wider fallout',
    language: overrides.language ?? 'en',
    translated_title: overrides.translated_title ?? 'Explainer: latest port attack developments at a glance',
    translated_text: overrides.translated_text ?? 'Explainer: latest port attack developments at a glance. A recap of the wider fallout.',
    translation_gate: overrides.translation_gate ?? false,
    doc_type: overrides.doc_type ?? 'explainer',
    coverage_role: overrides.coverage_role ?? 'related',
    doc_weight: overrides.doc_weight ?? 0.55,
    minhash_signature: overrides.minhash_signature ?? [1, 2, 3],
    coarse_vector: overrides.coarse_vector ?? [1, 0],
    full_vector: overrides.full_vector ?? [1, 0],
    semantic_signature: overrides.semantic_signature ?? 'sig-related',
    event_tuple: overrides.event_tuple ?? null,
    entities: overrides.entities ?? ['port_attack'],
    linked_entities: overrides.linked_entities ?? ['port_attack'],
    locations: overrides.locations ?? ['harbor'],
    temporal_ms: overrides.temporal_ms ?? 120,
    trigger: overrides.trigger ?? 'attack',
    candidate_matches: overrides.candidate_matches ?? [],
    candidate_score: overrides.candidate_score ?? 0,
    hybrid_score: overrides.hybrid_score ?? 0,
    rerank_score: overrides.rerank_score ?? 0,
    adjudication: overrides.adjudication ?? 'rejected',
    cluster_key: overrides.cluster_key ?? 'topic-news',
    assigned_story_id: overrides.assigned_story_id,
  };
}

describe('storylineProjection', () => {
  it('projects related coverage into storyline groups without widening primary sources', () => {
    const sources = [
      makeSource({
        source_id: 'wire-a',
        publisher: 'Reuters',
        title: 'Specific incident report',
        coverage_role: 'canonical',
      }),
      makeSource({
        source_key: 'guardian:hash-roundup',
        source_id: 'guardian',
        publisher: 'The Guardian',
        url_hash: 'hash-roundup',
        title: 'At a glance: latest developments after the port attack',
        coverage_role: 'related',
        doc_type: 'explainer',
      }),
    ];
    const projected = projectBundleSources(sources);
    const storylines = projectStorylineGroups('topic-news', [{
      key: 'story-001',
      record: makeCluster([sources[0]!]),
      docs: [],
    } satisfies ClusterBucket], [makeRelatedDocument()]);

    expect(projected.primary_sources.map((source) => source.source_id)).toEqual(['wire-a']);
    expect(storylines).toHaveLength(1);
    expect(storylines[0]?.canonical_story_id).toBe('story-001');
    expect(storylines[0]?.related_coverage.map((source) => source.source_id)).toEqual(['guardian']);
  });

  it('skips storyline publication when no related coverage exists', () => {
    const storylines = projectStorylineGroups('topic-news', [{
      key: 'story-001',
      record: makeCluster([makeSource()]),
      docs: [],
    } satisfies ClusterBucket], []);
    expect(storylines).toEqual([]);
  });

  it('skips unmatched related coverage when it shares no entity or trigger overlap', () => {
    const storylines = projectStorylineGroups('topic-news', [{
      key: 'story-001',
      record: makeCluster([makeSource()]),
      docs: [],
    } satisfies ClusterBucket], [makeRelatedDocument({
      linked_entities: ['unmatched_market'],
      entities: ['unmatched_market'],
      trigger: 'slide',
      locations: ['exchange'],
    })]);

    expect(storylines).toEqual([]);
  });

  it('prefers the newest matching cluster when related coverage scores tie', () => {
    const olderCluster = {
      key: 'story-older',
      record: {
        ...makeCluster([makeSource()]),
        story_id: 'story-older',
        cluster_window_end: 150,
      },
      docs: [],
    } satisfies ClusterBucket;
    const newerCluster = {
      key: 'story-newer',
      record: {
        ...makeCluster([makeSource({ source_id: 'wire-b', url_hash: 'hash-2' })]),
        story_id: 'story-newer',
        cluster_window_end: 170,
      },
      docs: [],
    } satisfies ClusterBucket;

    const storylines = projectStorylineGroups('topic-news', [olderCluster, newerCluster], [makeRelatedDocument()]);

    expect(storylines).toHaveLength(1);
    expect(storylines[0]?.canonical_story_id).toBe('story-newer');
  });

  it('falls back to story id ordering when related coverage scores and recency tie', () => {
    const leftCluster = {
      key: 'story-a',
      record: {
        ...makeCluster([makeSource()]),
        story_id: 'story-a',
        cluster_window_end: 170,
      },
      docs: [],
    } satisfies ClusterBucket;
    const rightCluster = {
      key: 'story-b',
      record: {
        ...makeCluster([makeSource({ source_id: 'wire-b', url_hash: 'hash-2' })]),
        story_id: 'story-b',
        cluster_window_end: 170,
      },
      docs: [],
    } satisfies ClusterBucket;

    const storylines = projectStorylineGroups('topic-news', [rightCluster, leftCluster], [makeRelatedDocument()]);

    expect(storylines).toHaveLength(1);
    expect(storylines[0]?.canonical_story_id).toBe('story-a');
  });
});
