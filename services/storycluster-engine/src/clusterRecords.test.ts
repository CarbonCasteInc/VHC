import { describe, expect, it } from 'vitest';
import {
  clusterConfidence,
  connectedComponents,
  deriveClusterRecord,
  sourceKey,
  toStoredSource,
  upsertClusterRecord,
} from './clusterRecords';
import type { StoredSourceDocument, StoredTopicState, WorkingDocument } from './stageState';

function makeWorkingDocument(docId: string, title = 'Port attack expands'): WorkingDocument {
  return {
    doc_id: docId,
    source_id: `source-${docId}`,
    publisher: `Publisher ${docId}`,
    title,
    summary: `${title} summary.`,
    body: undefined,
    published_at: 100 + Number(docId.at(-1) ?? '0'),
    url: `https://example.com/${docId}`,
    canonical_url: `https://example.com/${docId}`,
    url_hash: `hash-${docId}`,
    image_hash: undefined,
    language_hint: undefined,
    entity_keys: ['port_attack'],
    translation_applied: false,
    source_variants: [{
      doc_id: docId,
      source_id: `source-${docId}`,
      publisher: `Publisher ${docId}`,
      url: `https://example.com/${docId}`,
      canonical_url: `https://example.com/${docId}`,
      url_hash: `hash-${docId}`,
      published_at: 100 + Number(docId.at(-1) ?? '0'),
      title,
      summary: `${title} summary.`,
      language: 'en',
      translation_applied: false,
    }],
    raw_text: `${title}. ${title} summary.`,
    normalized_text: `${title.toLowerCase()} summary`,
    language: 'en',
    translated_title: title,
    translated_text: `${title}. ${title} summary.`,
    translation_gate: false,
    doc_type: 'hard_news',
    doc_weight: 1,
    minhash_signature: [1, 2, 3],
    coarse_vector: [1, 0],
    full_vector: [1, 0],
    semantic_signature: `sig-${docId}`,
    event_tuple: null,
    entities: ['port_attack'],
    linked_entities: ['port_attack'],
    locations: ['tehran'],
    temporal_ms: 100,
    trigger: 'attack',
    candidate_matches: [],
    candidate_score: 0,
    hybrid_score: 0,
    rerank_score: 0,
    adjudication: 'accepted',
    cluster_key: 'topic-news',
  };
}

function makeTopicState(): StoredTopicState {
  return {
    schema_version: 'storycluster-state-v1',
    topic_id: 'topic-news',
    next_cluster_seq: 1,
    clusters: [],
  };
}

describe('clusterRecords', () => {
  it('creates and updates cluster records', () => {
    const topicState = makeTopicState();
    const sourceA = toStoredSource(makeWorkingDocument('doc-1'), makeWorkingDocument('doc-1').source_variants[0]!);
    const sourceB = toStoredSource(makeWorkingDocument('doc-2'), makeWorkingDocument('doc-2').source_variants[0]!);

    expect(sourceKey(makeWorkingDocument('doc-1').source_variants[0]!)).toBe('source-doc-1:hash-doc-1');

    const cluster = deriveClusterRecord(topicState, 'topic-news', [sourceA]);
    expect(cluster.story_id).toMatch(/^story-/);
    expect(topicState.next_cluster_seq).toBe(2);
    expect(cluster.summary_hint.length).toBeGreaterThan(0);

    const updated = upsertClusterRecord(cluster, [sourceB]);
    expect(updated.source_documents).toHaveLength(2);
    expect(updated.story_id).toBe(cluster.story_id);
    expect(updated.source_documents[0]?.linked_entities).toContain('port_attack');
    expect(updated.entity_scores.port_attack).toBeGreaterThan(0);
  });

  it('handles empty cluster inputs and merges duplicate source updates', () => {
    const topicState = makeTopicState();
    const empty = deriveClusterRecord(topicState, 'topic-news', []);
    expect(empty.headline).toBe('Untitled story');
    expect(empty.cluster_window_end).toBe(0);
    expect(empty.centroid_coarse).toEqual([]);

    const baseDocument = makeWorkingDocument('doc-9');
    const duplicate = toStoredSource(baseDocument, baseDocument.source_variants[0]!);
    const cluster = deriveClusterRecord(topicState, 'topic-news', [duplicate], 'story-stable');
    const updated = upsertClusterRecord(cluster, [{
      ...duplicate,
      published_at: duplicate.published_at - 5,
      title: `${duplicate.title} extended`,
      summary: undefined,
      doc_ids: [...duplicate.doc_ids, 'doc-9b'],
    }]);

    expect(updated.source_documents).toHaveLength(1);
    expect(updated.source_documents[0]?.published_at).toBe(duplicate.published_at - 5);
    expect(updated.source_documents[0]?.title).toContain('extended');
    expect(updated.source_documents[0]?.doc_ids).toEqual(['doc-9', 'doc-9b']);

    const mediaBackfill = upsertClusterRecord(
      deriveClusterRecord(topicState, 'topic-news', [{ ...duplicate, image_url: undefined, image_hash: undefined }], 'story-media'),
      [{ ...duplicate, image_url: 'https://images.example.com/doc-9.jpg', image_hash: 'image-hash-doc-9' }],
    );
    expect(mediaBackfill.source_documents[0]?.image_url).toBe('https://images.example.com/doc-9.jpg');
    expect(mediaBackfill.source_documents[0]?.image_hash).toBe('image-hash-doc-9');

    const replacement = upsertClusterRecord(
      deriveClusterRecord(topicState, 'topic-news', [{ ...duplicate, summary: undefined }], 'story-replace'),
      [{ ...duplicate, summary: 'Replacement summary.', coarse_vector: [1], full_vector: [1] }],
    );
    expect(replacement.source_documents[0]?.summary).toBe('Replacement summary.');

    const tieCluster = deriveClusterRecord(topicState, 'topic-news', [
      { ...duplicate, source_key: 'source-a', published_at: 200, title: 'Alpha', coarse_vector: [1, 0], full_vector: [1, 0] },
      { ...duplicate, source_key: 'source-b', published_at: 200, title: 'Bravo', coarse_vector: [1], full_vector: [1] },
    ]);
    expect(tieCluster.headline).toBe('Alpha');
  });

  it('preserves created_at and updated_at when an older source backfill arrives later', () => {
    const topicState = makeTopicState();
    const firstDocument = makeWorkingDocument('doc-7');
    firstDocument.published_at = 120;
    firstDocument.source_variants[0]!.published_at = 120;
    const initial = deriveClusterRecord(
      topicState,
      'topic-news',
      [toStoredSource(firstDocument, firstDocument.source_variants[0]!)],
      'story-stable',
    );

    const olderBackfillDocument = makeWorkingDocument('doc-7');
    olderBackfillDocument.published_at = 100;
    olderBackfillDocument.source_variants[0]!.published_at = 100;
    const updated = upsertClusterRecord(initial, [toStoredSource(olderBackfillDocument, olderBackfillDocument.source_variants[0]!)]);

    expect(updated.story_id).toBe('story-stable');
    expect(updated.created_at).toBe(120);
    expect(updated.updated_at).toBe(120);
    expect(updated.cluster_window_start).toBe(100);
    expect(updated.cluster_window_end).toBe(120);
    expect(updated.source_documents[0]?.published_at).toBe(100);
  });

  it('keeps story ids stable for identical source inputs even when next_cluster_seq changes', () => {
    const baseDocument = makeWorkingDocument('doc-5', 'Cuba prepares for possible US military aggression');
    const source = toStoredSource(baseDocument, baseDocument.source_variants[0]!);

    const firstState = makeTopicState();
    const first = deriveClusterRecord(firstState, 'topic-news', [source]);

    const laterState = makeTopicState();
    laterState.next_cluster_seq = 4;
    const later = deriveClusterRecord(laterState, 'topic-news', [source]);

    expect(first.source_documents).toEqual(later.source_documents);
    expect(first.story_id).toBe(later.story_id);
  });

  it('computes confidence and connected components', () => {
    const sourceA: StoredSourceDocument = toStoredSource(makeWorkingDocument('doc-1'), makeWorkingDocument('doc-1').source_variants[0]!);
    const sourceB: StoredSourceDocument = toStoredSource(makeWorkingDocument('doc-2'), makeWorkingDocument('doc-2').source_variants[0]!);
    const sourceC: StoredSourceDocument = {
      ...toStoredSource(makeWorkingDocument('doc-3', 'Separate market slump'), makeWorkingDocument('doc-3', 'Separate market slump').source_variants[0]!),
      full_vector: [0, 1],
    };

    expect(clusterConfidence([sourceA])).toBe(0.74);
    expect(clusterConfidence([sourceA, sourceB])).toBeGreaterThan(0.35);

    const components = connectedComponents([sourceA, sourceB, sourceC], (left, right) => left.trigger === right.trigger && left.full_vector[0] === right.full_vector[0]);
    expect(components).toHaveLength(2);
    expect(components[0]).toHaveLength(2);
  });
});
