import { describe, expect, it } from 'vitest';
import { deriveClusterRecord, toStoredSource, upsertClusterRecord } from './clusterRecords';
import {
  clusterHasSpecificCanonicalDocument,
  clusterHasSpecificEventDocument,
  clusterSignalsInternal,
  clusterTemporalAnchors,
  isRelatedCoverageAttachmentConflict,
  isRelatedCoverageConflict,
  isRelatedCoverageMergeConflict,
  isSecondaryAssetAttachmentConflict,
  representativeDocuments,
  sourceNovelty,
} from './clusterSignals';
import type { StoredTopicState, WorkingDocument } from './stageState';

function makeWorkingDocument(overrides: Partial<WorkingDocument> = {}): WorkingDocument {
  return {
    doc_id: overrides.doc_id ?? 'doc-1',
    source_id: overrides.source_id ?? 'wire-a',
    publisher: overrides.publisher ?? 'Reuters',
    title: overrides.title ?? 'Port attack expands overnight',
    summary: overrides.summary ?? 'Officials describe the port attack response.',
    body: overrides.body,
    published_at: overrides.published_at ?? 100,
    url: overrides.url ?? 'https://example.com/1',
    canonical_url: overrides.canonical_url ?? 'https://example.com/1',
    url_hash: overrides.url_hash ?? 'hash-1',
    image_hash: overrides.image_hash,
    language_hint: overrides.language_hint,
    entity_keys: overrides.entity_keys,
    translation_applied: overrides.translation_applied,
    source_variants: overrides.source_variants ?? [{
      doc_id: overrides.doc_id ?? 'doc-1',
      source_id: overrides.source_id ?? 'wire-a',
      publisher: overrides.publisher ?? 'Reuters',
      url: overrides.url ?? 'https://example.com/1',
      canonical_url: overrides.canonical_url ?? 'https://example.com/1',
      url_hash: overrides.url_hash ?? 'hash-1',
      published_at: overrides.published_at ?? 100,
      title: overrides.title ?? 'Port attack expands overnight',
      summary: overrides.summary ?? 'Officials describe the port attack response.',
      language: 'en',
      translation_applied: false,
      coverage_role: overrides.coverage_role ?? 'canonical',
    }],
    raw_text: overrides.raw_text ?? 'Port attack expands overnight. Officials describe the port attack response.',
    normalized_text: overrides.normalized_text ?? 'port attack expands overnight officials describe the port attack response',
    language: overrides.language ?? 'en',
    translated_title: overrides.translated_title ?? overrides.title ?? 'Port attack expands overnight',
    translated_text: overrides.translated_text ?? 'Port attack expands overnight. Officials describe the port attack response.',
    translation_gate: overrides.translation_gate ?? false,
    doc_type: overrides.doc_type ?? 'wire',
    coverage_role: overrides.coverage_role ?? 'canonical',
    doc_weight: overrides.doc_weight ?? 1.15,
    minhash_signature: overrides.minhash_signature ?? [1, 2, 3],
    coarse_vector: overrides.coarse_vector ?? [1, 0],
    full_vector: overrides.full_vector ?? [1, 0],
    semantic_signature: overrides.semantic_signature ?? 'sig-1',
    event_tuple: overrides.event_tuple ?? {
      description: 'Port attack expands overnight',
      trigger: 'attack',
      who: ['Port officials'],
      where: ['Tehran'],
      when_ms: overrides.published_at ?? 100,
      outcome: 'Response underway.',
    },
    entities: overrides.entities ?? ['port_attack'],
    linked_entities: overrides.linked_entities ?? ['port_attack'],
    locations: overrides.locations ?? ['tehran'],
    temporal_ms: overrides.temporal_ms ?? 100,
    trigger: overrides.trigger ?? 'attack',
    candidate_matches: overrides.candidate_matches ?? [],
    candidate_score: overrides.candidate_score ?? 0,
    hybrid_score: overrides.hybrid_score ?? 0,
    rerank_score: overrides.rerank_score ?? 0,
    adjudication: overrides.adjudication ?? 'rejected',
    cluster_key: overrides.cluster_key ?? 'topic-news',
  };
}

function makeCluster(document: WorkingDocument) {
  const topicState: StoredTopicState = {
    schema_version: 'storycluster-state-v1',
    topic_id: 'topic-news',
    next_cluster_seq: 1,
    clusters: [],
  };
  return deriveClusterRecord(topicState, 'topic-news', [toStoredSource(document, document.source_variants[0]!)]);
}

describe('clusterSignals', () => {
  it('flags roundup coverage against a specific incident cluster', () => {
    const specificCluster = makeCluster(makeWorkingDocument());
    const roundupDocument = makeWorkingDocument({
      doc_id: 'doc-roundup',
      source_id: 'guardian-roundup',
      publisher: 'The Guardian',
      title: 'Trump news at a glance: Iran latest',
      translated_title: 'Trump news at a glance: Iran latest',
      summary: 'A broad roundup of the latest Iran conflict developments.',
      coverage_role: 'canonical',
      event_tuple: null,
      trigger: 'talks',
      linked_entities: ['iran'],
      entities: ['iran'],
      locations: ['washington'],
    });
    const broadCluster = makeCluster(roundupDocument);

    expect(isRelatedCoverageConflict(roundupDocument, specificCluster)).toBe(true);
    expect(isRelatedCoverageConflict(makeWorkingDocument(), broadCluster)).toBe(false);
    expect(isRelatedCoverageMergeConflict(broadCluster, specificCluster)).toBe(true);
    const secondSpecificCluster = makeCluster(makeWorkingDocument({
      doc_id: 'doc-2',
      source_id: 'wire-b',
      url: 'https://example.com/2',
      canonical_url: 'https://example.com/2',
      url_hash: 'hash-2',
      published_at: 105,
      source_variants: [{
        doc_id: 'doc-2',
        source_id: 'wire-b',
        publisher: 'AP',
        url: 'https://example.com/2',
        canonical_url: 'https://example.com/2',
        url_hash: 'hash-2',
        published_at: 105,
        title: 'Port attack expands overnight',
        summary: 'AP confirms the port attack response.',
        language: 'en',
        translation_applied: false,
        coverage_role: 'canonical',
      }],
    }));

    expect(isRelatedCoverageMergeConflict(specificCluster, secondSpecificCluster)).toBe(false);
    expect(isRelatedCoverageMergeConflict(specificCluster, broadCluster)).toBe(true);
  });

  it('keeps representative sources ordered and tracks source novelty', () => {
    const first = makeWorkingDocument({
      doc_id: 'doc-3',
      source_id: 'wire-c',
      url: 'https://example.com/3',
      canonical_url: 'https://example.com/3',
      url_hash: 'hash-3',
      published_at: 90,
      source_variants: [{
        doc_id: 'doc-3',
        source_id: 'wire-c',
        publisher: 'Reuters',
        url: 'https://example.com/3',
        canonical_url: 'https://example.com/3',
        url_hash: 'hash-3',
        published_at: 90,
        title: 'Port attack expands overnight',
        summary: 'Officials describe the port attack response.',
        language: 'en',
        translation_applied: false,
        coverage_role: 'canonical',
      }],
    });
    const second = makeWorkingDocument({
      doc_id: 'doc-4',
      source_id: 'wire-b',
      url: 'https://example.com/4',
      canonical_url: 'https://example.com/4',
      url_hash: 'hash-4',
      published_at: 90,
      source_variants: [{
        doc_id: 'doc-4',
        source_id: 'wire-b',
        publisher: 'AP',
        url: 'https://example.com/4',
        canonical_url: 'https://example.com/4',
        url_hash: 'hash-4',
        published_at: 90,
        title: 'Port attack expands overnight',
        summary: 'AP confirms the port attack response.',
        language: 'en',
        translation_applied: false,
        coverage_role: 'canonical',
      }],
    });
    const cluster = upsertClusterRecord(
      makeCluster(first),
      [toStoredSource(second, second.source_variants[0]!)],
    );
    const representatives = representativeDocuments(cluster);

    expect(representatives).toHaveLength(2);
    expect(representatives[0]?.source_id).toBe('wire-b');
    expect(representatives[1]?.source_id).toBe('wire-c');
    expect(sourceNovelty(makeWorkingDocument({
      doc_id: 'doc-5',
      source_id: 'wire-d',
      url: 'https://example.com/5',
      canonical_url: 'https://example.com/5',
      url_hash: 'hash-5',
      source_variants: [{
        doc_id: 'doc-5',
        source_id: 'wire-d',
        publisher: 'BBC',
        url: 'https://example.com/5',
        canonical_url: 'https://example.com/5',
        url_hash: 'hash-5',
        published_at: 110,
        title: 'Port attack expands overnight',
        summary: 'BBC confirms the attack response.',
        language: 'en',
        translation_applied: false,
        coverage_role: 'canonical',
      }],
    }), cluster)).toBe(1);
    expect(sourceNovelty(makeWorkingDocument({
      source_id: 'wire-c',
      url_hash: 'hash-3',
      source_variants: [{
        doc_id: 'doc-3',
        source_id: 'wire-c',
        publisher: 'Reuters',
        url: 'https://example.com/3',
        canonical_url: 'https://example.com/3',
        url_hash: 'hash-3',
        published_at: 90,
        title: 'Port attack expands overnight',
        summary: 'Officials describe the port attack response.',
        language: 'en',
        translation_applied: false,
        coverage_role: 'canonical',
      }],
    }), cluster)).toBe(0);
  });

  it('collects temporal anchors from event, temporal, and published timestamps', () => {
    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-news',
      next_cluster_seq: 1,
      clusters: [],
    };
    const eventDocument = makeWorkingDocument({
      doc_id: 'doc-event',
      source_id: 'wire-event',
      published_at: 100,
      temporal_ms: 120,
      event_tuple: {
        description: 'Event anchored by explicit event time.',
        trigger: 'attack',
        who: ['Port officials'],
        where: ['Tehran'],
        when_ms: 140,
        outcome: 'Response underway.',
      },
    });
    const temporalDocument = makeWorkingDocument({
      doc_id: 'doc-temporal',
      source_id: 'wire-temporal',
      published_at: 200,
      temporal_ms: 220,
      event_tuple: {
        description: 'Event anchored by temporal fallback.',
        trigger: 'attack',
        who: ['Port officials'],
        where: ['Tehran'],
        when_ms: null,
        outcome: 'Response underway.',
      },
      source_variants: [{
        doc_id: 'doc-temporal',
        source_id: 'wire-temporal',
        publisher: 'Reuters',
        url: 'https://example.com/temporal',
        canonical_url: 'https://example.com/temporal',
        url_hash: 'hash-temporal',
        published_at: 200,
        title: 'Temporal anchor fallback',
        summary: 'Temporal anchor fallback.',
        language: 'en',
        translation_applied: false,
        coverage_role: 'canonical',
      }],
    });
    const publishedDocument = makeWorkingDocument({
      doc_id: 'doc-published',
      source_id: 'wire-published',
      published_at: 300,
      event_tuple: {
        description: 'Event anchored by published fallback.',
        trigger: 'attack',
        who: ['Port officials'],
        where: ['Tehran'],
        when_ms: null,
        outcome: 'Response underway.',
      },
      source_variants: [{
        doc_id: 'doc-published',
        source_id: 'wire-published',
        publisher: 'Reuters',
        url: 'https://example.com/published',
        canonical_url: 'https://example.com/published',
        url_hash: 'hash-published',
        published_at: 300,
        title: 'Published anchor fallback',
        summary: 'Published anchor fallback.',
        language: 'en',
        translation_applied: false,
        coverage_role: 'canonical',
      }],
    });
    publishedDocument.temporal_ms = null;

    const cluster = deriveClusterRecord(topicState, 'topic-news', [
      toStoredSource(eventDocument, eventDocument.source_variants[0]!),
      toStoredSource(temporalDocument, temporalDocument.source_variants[0]!),
      toStoredSource(publishedDocument, publishedDocument.source_variants[0]!),
    ]);

    expect(clusterTemporalAnchors(cluster)).toEqual([140, 220, 300]);
  });

  it('treats time, location, and actor-only tuples as specific event signals', () => {
    const broadDocument = makeWorkingDocument({
      doc_id: 'doc-roundup-2',
      source_id: 'guardian-roundup-2',
      publisher: 'The Guardian',
      title: 'Trump news at a glance: Iran latest',
      translated_title: 'Trump news at a glance: Iran latest',
      summary: 'A broad roundup of the latest Iran conflict developments.',
      coverage_role: 'canonical',
      event_tuple: null,
      trigger: 'talks',
      linked_entities: ['iran'],
      entities: ['iran'],
      locations: ['washington'],
    });
    const timeOnlyCluster = makeCluster(makeWorkingDocument({
      doc_id: 'doc-time',
      source_id: 'wire-time',
      event_tuple: {
        description: 'Time-only incident',
        trigger: null,
        who: [],
        where: [],
        when_ms: 100,
        outcome: null,
      },
      trigger: null,
    }));
    const locationOnlyCluster = makeCluster(makeWorkingDocument({
      doc_id: 'doc-location',
      source_id: 'wire-location',
      event_tuple: {
        description: 'Location-only incident',
        trigger: null,
        who: [],
        where: ['Tehran'],
        when_ms: null,
        outcome: null,
      },
      trigger: null,
    }));
    const actorOnlyCluster = makeCluster(makeWorkingDocument({
      doc_id: 'doc-actor',
      source_id: 'wire-actor',
      event_tuple: {
        description: 'Actor-only incident',
        trigger: null,
        who: ['Port officials'],
        where: [],
        when_ms: null,
        outcome: null,
      },
      trigger: null,
    }));
    const triggerOnlyCluster = makeCluster(makeWorkingDocument({
      doc_id: 'doc-trigger',
      source_id: 'wire-trigger',
      event_tuple: null,
      trigger: 'attack',
    }));

    expect(isRelatedCoverageConflict(broadDocument, timeOnlyCluster)).toBe(true);
    expect(isRelatedCoverageConflict(broadDocument, locationOnlyCluster)).toBe(true);
    expect(isRelatedCoverageConflict(broadDocument, actorOnlyCluster)).toBe(true);
    expect(clusterHasSpecificCanonicalDocument(triggerOnlyCluster)).toBe(true);
    expect(isRelatedCoverageConflict(broadDocument, triggerOnlyCluster)).toBe(true);
  });

  it('treats trigger-only canonical docs as specific while keeping video clips derivative', () => {
    expect(clusterSignalsInternal.hasSpecificEventSignal({
      doc_type: 'hard_news',
      coverage_role: 'canonical',
      translated_title: 'Trigger-only incident',
      summary: 'Straight report.',
      publisher: 'Reuters',
      event_tuple: null,
      trigger: 'attack',
      url: 'https://example.com/incident',
    })).toBe(true);
    expect(clusterSignalsInternal.isVideoClipDocument({
      doc_type: 'video_clip',
      coverage_role: 'related',
      translated_title: 'Video clip',
      summary: 'CBS video report.',
      publisher: 'CBS News',
      event_tuple: {
        description: 'Video clip',
        trigger: 'strike',
        who: ['Iranian opposition group'],
        where: ['Northern Iraq'],
        when_ms: 100,
        outcome: 'Camp hit.',
      },
      trigger: 'strike',
      url: 'https://www.cbsnews.com/video/drone-strike/',
    })).toBe(true);
    expect(clusterSignalsInternal.isBroadRelatedCoverage({
      doc_type: 'video_clip',
      coverage_role: 'related',
      translated_title: 'Video clip',
      summary: 'CBS video report.',
      publisher: 'CBS News',
      event_tuple: {
        description: 'Video clip',
        trigger: 'strike',
        who: ['Iranian opposition group'],
        where: ['Northern Iraq'],
        when_ms: 100,
        outcome: 'Camp hit.',
      },
      trigger: 'strike',
      url: 'https://www.cbsnews.com/video/drone-strike/',
    })).toBe(false);
    expect(clusterSignalsInternal.isSpecificCanonicalDocument({
      doc_type: 'video_clip',
      coverage_role: 'related',
      translated_title: 'Video clip',
      summary: 'CBS video report.',
      publisher: 'CBS News',
      event_tuple: {
        description: 'Video clip',
        trigger: 'strike',
        who: ['Iranian opposition group'],
        where: ['Northern Iraq'],
        when_ms: 100,
        outcome: 'Camp hit.',
      },
      trigger: 'strike',
      url: 'https://www.cbsnews.com/video/drone-strike/',
    })).toBe(false);
    expect(clusterSignalsInternal.isSpecificEventDocument({
      doc_type: 'video_clip',
      coverage_role: 'related',
      translated_title: 'Video clip',
      summary: 'CBS video report.',
      publisher: 'CBS News',
      event_tuple: {
        description: 'Video clip',
        trigger: 'strike',
        who: ['Iranian opposition group'],
        where: ['Northern Iraq'],
        when_ms: 100,
        outcome: 'Camp hit.',
      },
      trigger: 'strike',
      url: 'https://www.cbsnews.com/video/drone-strike/',
    })).toBe(true);
  });

  it('blocks broad related coverage from attaching to a video-only event cluster', () => {
    const videoOnlyCluster = makeCluster(makeWorkingDocument({
      doc_id: 'doc-video',
      source_id: 'cbs-video',
      publisher: 'CBS News',
      title: 'Armed Iranian opposition group says its camp was hit with drone strike',
      translated_title: 'Armed Iranian opposition group says its camp was hit with drone strike',
      summary: 'CBS video report on the drone strike.',
      url: 'https://www.cbsnews.com/video/armed-iranian-opposition-group-says-camp-hit-drone-strike/',
      canonical_url: 'https://www.cbsnews.com/video/armed-iranian-opposition-group-says-camp-hit-drone-strike/',
      doc_type: 'video_clip',
      coverage_role: 'related',
      event_tuple: {
        description: 'Drone strike hits opposition camp',
        trigger: 'strike',
        who: ['Iranian opposition group'],
        where: ['Northern Iraq'],
        when_ms: 216_000_300,
        outcome: 'Camp was hit in the strike.',
      },
      trigger: 'strike',
      linked_entities: ['iranian_opposition_group'],
      entities: ['iranian_opposition_group', 'drone', 'strike'],
      locations: ['northern_iraq'],
    }));
    const roundupDocument = makeWorkingDocument({
      doc_id: 'doc-roundup-video-conflict',
      source_id: 'guardian-roundup',
      publisher: 'The Guardian',
      title: 'Trump news at a glance: Iran latest',
      translated_title: 'Trump news at a glance: Iran latest',
      summary: 'A broad roundup of the latest Iran conflict developments.',
      coverage_role: 'canonical',
      event_tuple: null,
      trigger: 'talks',
      linked_entities: ['iran'],
      entities: ['iran'],
      locations: ['washington'],
    });
    const broadCluster = makeCluster(roundupDocument);

    expect(clusterHasSpecificCanonicalDocument(videoOnlyCluster)).toBe(false);
    expect(clusterHasSpecificEventDocument(videoOnlyCluster)).toBe(true);
    expect(isRelatedCoverageConflict(roundupDocument, videoOnlyCluster)).toBe(true);
    expect(isRelatedCoverageMergeConflict(videoOnlyCluster, broadCluster)).toBe(true);
  });

  it('blocks specific canonical docs from attaching to broad related clusters', () => {
    const broadCluster = makeCluster(makeWorkingDocument({
      doc_id: 'doc-roundup-specific-conflict',
      source_id: 'guardian-roundup-specific-conflict',
      publisher: 'The Guardian',
      title: 'Trump news at a glance: Iran latest',
      translated_title: 'Trump news at a glance: Iran latest',
      summary: 'A broad roundup of the latest Iran conflict developments.',
      coverage_role: 'canonical',
      event_tuple: null,
      trigger: 'talks',
      linked_entities: ['iran'],
      entities: ['iran'],
      locations: ['washington'],
    }));
    const specificDocument = makeWorkingDocument({
      doc_id: 'doc-specific-attachment',
      source_id: 'wire-specific-attachment',
      publisher: 'AP',
      title: 'Port authority confirms second overnight strike in Tehran',
      translated_title: 'Port authority confirms second overnight strike in Tehran',
      summary: 'Port authority confirms a second overnight strike in Tehran.',
      coverage_role: 'canonical',
      event_tuple: {
        description: 'Port authority confirms a second overnight strike in Tehran.',
        trigger: 'strike',
        who: ['Port authority'],
        where: ['Tehran'],
        when_ms: 216_000_500,
        outcome: 'Further damage reported.',
      },
      trigger: 'strike',
      linked_entities: ['port_authority', 'tehran_strike'],
      entities: ['port_authority', 'tehran_strike'],
      locations: ['tehran'],
    });

    expect(isRelatedCoverageAttachmentConflict(specificDocument, broadCluster)).toBe(true);
  });

  it('blocks video clips from attaching to clusters with no specific event documents', () => {
    const broadCluster = makeCluster(makeWorkingDocument({
      doc_id: 'doc-roundup-video-attachment',
      source_id: 'guardian-roundup-video-attachment',
      publisher: 'The Guardian',
      title: 'Trump news at a glance: Iran latest',
      translated_title: 'Trump news at a glance: Iran latest',
      summary: 'A broad roundup of the latest Iran conflict developments.',
      coverage_role: 'canonical',
      event_tuple: null,
      trigger: 'talks',
      linked_entities: ['iran'],
      entities: ['iran'],
      locations: ['washington'],
    }));
    const videoDocument = makeWorkingDocument({
      doc_id: 'doc-video-attachment',
      source_id: 'cbs-video-attachment',
      publisher: 'CBS News',
      title: 'Video: Tehran strike aftermath',
      translated_title: 'Video: Tehran strike aftermath',
      summary: 'CBS video report on the Tehran strike aftermath.',
      url: 'https://www.cbsnews.com/video/tehran-strike-aftermath/',
      canonical_url: 'https://www.cbsnews.com/video/tehran-strike-aftermath/',
      doc_type: 'video_clip',
      coverage_role: 'related',
      event_tuple: {
        description: 'Video report on the Tehran strike aftermath.',
        trigger: 'strike',
        who: ['Port authority'],
        where: ['Tehran'],
        when_ms: 216_000_600,
        outcome: 'Damage surveyed.',
      },
      trigger: 'strike',
      linked_entities: ['port_authority'],
      entities: ['port_authority', 'strike'],
      locations: ['tehran'],
    });

    expect(isSecondaryAssetAttachmentConflict(videoDocument, broadCluster)).toBe(true);
  });
});
