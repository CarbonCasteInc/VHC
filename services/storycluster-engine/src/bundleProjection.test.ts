import { describe, expect, it } from 'vitest';
import { deriveClusterRecord, toStoredSource } from './clusterRecords';
import { projectBundleSources, projectStoryBundles } from './bundleProjection';
import type { ClusterBucket, StoredTopicState, WorkingDocument } from './stageState';

function makeWorkingDocument(overrides: Partial<WorkingDocument> = {}): WorkingDocument {
  const docId = overrides.doc_id ?? 'doc-1';
  const sourceId = overrides.source_id ?? 'wire-a';
  const publisher = overrides.publisher ?? 'Reuters';
  const title = overrides.title ?? 'Port attack expands overnight';
  const url = overrides.url ?? `https://example.com/${docId}`;
  return {
    doc_id: docId,
    source_id: sourceId,
    publisher,
    title,
    summary: overrides.summary ?? `${title} summary.`,
    body: overrides.body,
    published_at: overrides.published_at ?? 100,
    url,
    canonical_url: overrides.canonical_url ?? url,
    url_hash: overrides.url_hash ?? `hash-${docId}`,
    image_hash: overrides.image_hash,
    language_hint: overrides.language_hint,
    entity_keys: overrides.entity_keys,
    translation_applied: overrides.translation_applied,
    source_variants: overrides.source_variants ?? [{
      doc_id: docId,
      source_id: sourceId,
      publisher,
      url,
      canonical_url: overrides.canonical_url ?? url,
      url_hash: overrides.url_hash ?? `hash-${docId}`,
      published_at: overrides.published_at ?? 100,
      title,
      summary: overrides.summary ?? `${title} summary.`,
      language: overrides.language ?? 'en',
      translation_applied: false,
      coverage_role: 'canonical',
    }],
    raw_text: overrides.raw_text ?? `${title}. ${overrides.summary ?? `${title} summary.`}`,
    normalized_text: overrides.normalized_text ?? title.toLowerCase(),
    language: overrides.language ?? 'en',
    translated_title: overrides.translated_title ?? title,
    translated_text: overrides.translated_text ?? `${title}. ${overrides.summary ?? `${title} summary.`}`,
    translation_gate: overrides.translation_gate ?? false,
    doc_type: overrides.doc_type ?? 'hard_news',
    coverage_role: overrides.coverage_role ?? 'canonical',
    doc_weight: overrides.doc_weight ?? 1,
    minhash_signature: overrides.minhash_signature ?? [1, 2, 3],
    coarse_vector: overrides.coarse_vector ?? [1, 0],
    full_vector: overrides.full_vector ?? [1, 0],
    semantic_signature: overrides.semantic_signature ?? `sig-${docId}`,
    event_tuple: overrides.event_tuple ?? null,
    entities: overrides.entities ?? ['port_attack'],
    linked_entities: overrides.linked_entities ?? ['port_attack'],
    locations: overrides.locations ?? ['tehran'],
    temporal_ms: overrides.temporal_ms ?? overrides.published_at ?? 100,
    trigger: overrides.trigger ?? 'attack',
    candidate_matches: overrides.candidate_matches ?? [],
    candidate_score: overrides.candidate_score ?? 0,
    hybrid_score: overrides.hybrid_score ?? 0,
    rerank_score: overrides.rerank_score ?? 0,
    adjudication: overrides.adjudication ?? 'accepted',
    cluster_key: overrides.cluster_key ?? 'topic-news',
    ...overrides,
  };
}

function makeClusterBucket(documents: WorkingDocument[]): ClusterBucket {
  const topicState: StoredTopicState = {
    schema_version: 'storycluster-state-v1',
    topic_id: 'topic-news',
    next_cluster_seq: 1,
    clusters: [],
  };
  const sourceDocuments = documents.map((document) => toStoredSource(document, document.source_variants[0]!));
  const record = deriveClusterRecord(topicState, 'topic-news', sourceDocuments);
  return { key: record.story_id, record, docs: documents };
}

describe('bundleProjection', () => {
  it('normalizes same-publisher assets into primary sources and secondary assets', () => {
    const article = makeWorkingDocument({
      doc_id: 'doc-article',
      source_id: 'cbs-article',
      publisher: 'CBS',
      title: 'Jan. 6 plaque honoring police officers displayed at the Capitol after delay',
      summary: 'The plaque was installed after months of delay.',
      published_at: 100,
      doc_type: 'hard_news',
    });
    const video = makeWorkingDocument({
      doc_id: 'doc-video',
      source_id: 'cbs-video',
      publisher: 'CBS',
      title: 'Video: Jan. 6 plaque honoring police officers displayed at the Capitol',
      summary: undefined,
      url: 'https://example.com/video/plaque',
      canonical_url: 'https://example.com/video/plaque',
      published_at: 110,
      doc_type: 'hard_news',
    });
    const wire = makeWorkingDocument({
      doc_id: 'doc-wire',
      source_id: 'wire-a',
      publisher: 'AP',
      title: 'Police plaque displayed at the Capitol after delay',
      published_at: 120,
      doc_type: 'wire_report',
    });

    const projected = projectBundleSources([
      toStoredSource(article, article.source_variants[0]!),
      toStoredSource(video, video.source_variants[0]!),
      toStoredSource(wire, wire.source_variants[0]!),
    ]);

    expect(projected.sources).toHaveLength(2);
    expect(projected.primary_sources.map((source) => source.source_id)).toEqual(['wire-a', 'cbs-article']);
    expect(projected.secondary_assets.map((source) => source.source_id)).toEqual(['cbs-video']);
  });

  it('falls back to source id grouping when publisher is blank and computes coverage from primary sources only', () => {
    const first = makeWorkingDocument({
      doc_id: 'doc-a',
      source_id: 'source-a',
      publisher: '',
      title: 'Port attack expands overnight',
      published_at: 100,
      doc_type: 'breaking_update',
    });
    const second = makeWorkingDocument({
      doc_id: 'doc-b',
      source_id: 'source-a',
      publisher: '',
      title: 'Watch: port attack aftermath',
      url: 'https://example.com/videos/aftermath',
      canonical_url: 'https://example.com/videos/aftermath',
      published_at: 110,
      doc_type: 'liveblog',
    });
    const third = makeWorkingDocument({
      doc_id: 'doc-c',
      source_id: 'source-c',
      publisher: 'Reuters',
      title: 'Port attack response widens',
      published_at: 120,
      doc_type: 'wire_report',
    });

    const bundle = projectStoryBundles('topic-news', [makeClusterBucket([first, second, third])])[0]!;
    expect(bundle.sources).toHaveLength(2);
    expect(bundle.primary_sources).toHaveLength(2);
    expect(bundle.secondary_assets).toHaveLength(1);
    expect(bundle.coverage_score).toBe(0.25);
  });

  it('prefers higher-priority canonical documents and breaks ties with summary, recency, title length, and source key', () => {
    const breaking = makeWorkingDocument({
      doc_id: 'doc-breaking',
      source_id: 'same-publisher-1',
      publisher: 'Desk',
      title: 'Port attack expands overnight',
      summary: undefined,
      published_at: 100,
      doc_type: 'breaking_update',
    });
    const withSummary = makeWorkingDocument({
      doc_id: 'doc-summary',
      source_id: 'same-publisher-2',
      publisher: 'Desk',
      title: 'Port attack expands overnight again',
      summary: 'Desk summary.',
      published_at: 100,
      doc_type: 'hard_news',
    });
    const newer = makeWorkingDocument({
      doc_id: 'doc-newer',
      source_id: 'same-publisher-3',
      publisher: 'Desk',
      title: 'Port attack expands later tonight',
      summary: undefined,
      published_at: 105,
      doc_type: 'hard_news',
    });
    const longerTitle = makeWorkingDocument({
      doc_id: 'doc-longer',
      source_id: 'same-publisher-4',
      publisher: 'Desk',
      title: 'Port attack expands much later overnight',
      summary: undefined,
      published_at: 105,
      doc_type: 'hard_news',
    });
    const sourceKeyTie = makeWorkingDocument({
      doc_id: 'doc-z',
      source_id: 'same-publisher-z',
      publisher: 'Desk',
      title: 'Port attack expands much later tomorrow',
      summary: undefined,
      published_at: 105,
      doc_type: 'hard_news',
    });
    const sourceKeyTieEarlier = makeWorkingDocument({
      doc_id: 'doc-a',
      source_id: 'same-publisher-a',
      publisher: 'Desk',
      title: 'Port attack expands much later tomorrow',
      summary: undefined,
      published_at: 105,
      doc_type: 'hard_news',
    });

    const projected = projectBundleSources([
      toStoredSource(withSummary, withSummary.source_variants[0]!),
      toStoredSource(newer, newer.source_variants[0]!),
      toStoredSource(sourceKeyTie, sourceKeyTie.source_variants[0]!),
      toStoredSource(sourceKeyTieEarlier, sourceKeyTieEarlier.source_variants[0]!),
      toStoredSource(longerTitle, longerTitle.source_variants[0]!),
      toStoredSource(breaking, breaking.source_variants[0]!),
    ]);

    expect(projected.primary_sources.map((source) => source.source_id)).toEqual(['same-publisher-1']);
    expect(projected.secondary_assets.map((source) => source.source_id)).toEqual([
      'same-publisher-2',
      'same-publisher-3',
      'same-publisher-4',
      'same-publisher-a',
      'same-publisher-z',
    ]);
  });
});
