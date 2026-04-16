import { describe, expect, it } from 'vitest';
import { buildClusterSummary } from './summaryBuilder';
import type { StoredClusterRecord } from './stageState';

function makeCluster(summary?: string): StoredClusterRecord {
  return {
    story_id: 'story-1',
    topic_key: 'topic-news',
    created_at: 100,
    updated_at: 120,
    cluster_window_start: 100,
    cluster_window_end: 120,
    headline: 'Port attack disrupts terminals overnight',
    summary_hint: '',
    primary_language: 'en',
    translation_applied: false,
    semantic_signature: 'sig-1',
    entity_scores: { port_attack: 2 },
    location_scores: { tehran: 1 },
    trigger_scores: { attack: 2 },
    document_type_counts: {
      breaking_update: 0,
      wire: 1,
      hard_news: 0,
      liveblog: 0,
      analysis: 0,
      opinion: 0,
      explainer: 0,
    },
    centroid_coarse: [1, 0],
    centroid_full: [1, 0],
    source_documents: [
      {
        source_key: 'wire-a:hash-a',
        source_id: 'wire-a',
        publisher: 'Reuters',
        url: 'https://example.com/a',
        canonical_url: 'https://example.com/a',
        url_hash: 'hash-a',
        published_at: 100,
        title: 'Port attack disrupts terminals overnight',
        summary,
        language: 'en',
        translation_applied: false,
        doc_type: 'wire',
        entities: ['port_attack'],
        locations: ['tehran'],
        trigger: 'attack',
        temporal_ms: 100,
        coarse_vector: [1, 0],
        full_vector: [1, 0],
        semantic_signature: 'sig-a',
        text: summary ?? 'Port attack disrupts terminals overnight.',
        doc_ids: ['doc-a'],
      },
      {
        source_key: 'wire-b:hash-b',
        source_id: 'wire-b',
        publisher: 'AP',
        url: 'https://example.com/b',
        canonical_url: 'https://example.com/b',
        url_hash: 'hash-b',
        published_at: 120,
        title: 'Officials say recovery talks begin Friday',
        summary: 'Officials say recovery talks begin Friday.',
        language: 'en',
        translation_applied: false,
        doc_type: 'wire',
        entities: ['port_attack'],
        locations: ['tehran'],
        trigger: 'attack',
        temporal_ms: 120,
        coarse_vector: [1, 0],
        full_vector: [1, 0],
        semantic_signature: 'sig-b',
        text: 'Officials say recovery talks begin Friday.',
        doc_ids: ['doc-b'],
      },
    ],
    lineage: { merged_from: [] },
  };
}

function makeEmptyCluster(): StoredClusterRecord {
  return {
    ...makeCluster(undefined),
    headline: 'Headline only',
    summary_hint: '',
    source_documents: [],
  };
}

describe('summaryBuilder', () => {
  it('builds summaries with lead, coverage, and update sentences', () => {
    const summary = buildClusterSummary(makeCluster('Ports remained shut after the overnight attack.'));
    expect(summary).toContain('Ports remained shut after the overnight attack.');
    expect(summary).toContain('2 canonical reports tracked the event');
    expect(summary).not.toContain('Reuters');
    expect(summary).not.toContain('AP');
    expect(summary).toContain('Officials say recovery talks begin Friday.');
  });

  it('falls back to the headline when no summary exists', () => {
    const summary = buildClusterSummary(makeCluster(undefined));
    expect(summary).toContain('Port attack disrupts terminals overnight.');
  });

  it('handles empty clusters and suppresses duplicate update sentences', () => {
    const cluster = makeCluster('Port attack disrupts terminals overnight.');
    cluster.source_documents[1] = {
      ...cluster.source_documents[1]!,
      summary: 'Port attack disrupts terminals overnight.',
      title: 'Port attack disrupts terminals overnight',
    };

    expect(buildClusterSummary(cluster)).toContain('Port attack disrupts terminals overnight.');
    expect(buildClusterSummary(cluster).match(/Port attack disrupts terminals overnight\./g)).toHaveLength(1);
    expect(buildClusterSummary(makeEmptyCluster())).toContain('Headline only.');
  });

  it('uses the latest title when the latest summary is absent', () => {
    const cluster = makeCluster('Ports remained shut after the overnight attack.');
    cluster.source_documents[1] = {
      ...cluster.source_documents[1]!,
      summary: undefined,
      title: 'Recovery talks resume without progress',
    };

    expect(buildClusterSummary(cluster)).toContain('Recovery talks resume without progress.');
  });

  it('uses singular coverage wording for one-source clusters', () => {
    const cluster = makeCluster('Ports remained shut after the overnight attack.');
    cluster.source_documents = [cluster.source_documents[0]!];

    expect(buildClusterSummary(cluster)).toContain('1 canonical report tracked the event');
    expect(buildClusterSummary(cluster)).not.toContain('Reuters');
  });

  it('keeps same-publisher asset metadata out of the summary', () => {
    const cluster = makeCluster('Ports remained shut after the overnight attack.');
    cluster.source_documents.push({
      ...cluster.source_documents[0]!,
      source_key: 'wire-a-video:hash-c',
      source_id: 'wire-a-video',
      url: 'https://example.com/video/a',
      canonical_url: 'https://example.com/video/a',
      url_hash: 'hash-c',
      title: 'Video: port attack aftermath',
      published_at: 121,
      text: 'Video: port attack aftermath',
      doc_ids: ['doc-c'],
    });

    expect(buildClusterSummary(cluster)).not.toContain('same-publisher asset');
  });

  it('omits plural same-publisher asset metadata from the summary', () => {
    const cluster = makeCluster('Ports remained shut after the overnight attack.');
    cluster.source_documents.push(
      {
        ...cluster.source_documents[0]!,
        source_key: 'wire-a-video:hash-c',
        source_id: 'wire-a-video',
        url: 'https://example.com/video/a',
        canonical_url: 'https://example.com/video/a',
        url_hash: 'hash-c',
        title: 'Video: port attack aftermath',
        published_at: 121,
        text: 'Video: port attack aftermath',
        doc_ids: ['doc-c'],
      },
      {
        ...cluster.source_documents[0]!,
        source_key: 'wire-a-photos:hash-d',
        source_id: 'wire-a-photos',
        url: 'https://example.com/photos/a',
        canonical_url: 'https://example.com/photos/a',
        url_hash: 'hash-d',
        title: 'Photos: port attack aftermath',
        published_at: 122,
        text: 'Photos: port attack aftermath',
        doc_ids: ['doc-d'],
      },
    );

    expect(buildClusterSummary(cluster)).not.toContain('same-publisher assets');
  });

  it('uses plural hour wording when the cluster spans multiple hours', () => {
    const cluster = makeCluster('Ports remained shut after the overnight attack.');
    cluster.cluster_window_end = cluster.cluster_window_start + 3 * 60 * 60 * 1000;

    expect(buildClusterSummary(cluster)).toContain('about 3 hours');
  });

  it('falls back to source id when a publisher name is blank', () => {
    const cluster = makeCluster('Ports remained shut after the overnight attack.');
    cluster.source_documents = [
      {
        ...cluster.source_documents[0]!,
        publisher: '',
        source_id: 'wire-a',
      },
    ];

    expect(buildClusterSummary(cluster)).toContain('1 canonical report tracked the event');
  });
});
