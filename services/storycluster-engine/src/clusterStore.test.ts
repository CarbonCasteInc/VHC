import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FileClusterStore,
  MemoryClusterStore,
  getDefaultClusterStore,
  resetDefaultClusterStore,
} from './clusterStore';
import { sha256Hex } from './hashUtils';

const createdPaths: string[] = [];

afterEach(() => {
  for (const path of createdPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
  delete process.env.VH_STORYCLUSTER_STATE_DIR;
  delete process.env.VITEST;
  resetDefaultClusterStore();
});

describe('clusterStore', () => {
  it('stores topic state in memory', () => {
    const store = new MemoryClusterStore();
    const state = store.loadTopic('topic-a');
    state.next_cluster_seq = 4;
    store.saveTopic(state);

    const loaded = store.loadTopic('topic-a');
    expect(loaded.next_cluster_seq).toBe(4);
    expect(store.readiness()).toEqual({ ok: true, detail: 'memory-store' });
  });

  it('stores topic state on disk and tolerates invalid files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vh-storycluster-'));
    createdPaths.push(dir);
    const store = new FileClusterStore(dir);

    const state = store.loadTopic('topic-a');
    state.next_cluster_seq = 2;
    store.saveTopic(state);
    expect(store.loadTopic('topic-a').next_cluster_seq).toBe(2);

    writeFileSync(join(dir, 'corrupt.json'), '{bad json', 'utf8');
    expect(store.readiness().ok).toBe(true);

    const topicPath = join(dir, `${sha256Hex('topic-a', 24)}.json`);
    writeFileSync(topicPath, JSON.stringify({ schema_version: 'wrong', topic_id: 'different', next_cluster_seq: 99, clusters: [] }), 'utf8');
    expect(store.loadTopic('topic-a').next_cluster_seq).toBe(1);
  });

  it('normalizes legacy document type aliases when loading persisted state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vh-storycluster-legacy-'));
    createdPaths.push(dir);
    const store = new FileClusterStore(dir);
    const topicPath = join(dir, `${sha256Hex('topic-a', 24)}.json`);

    writeFileSync(topicPath, JSON.stringify({
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-a',
      next_cluster_seq: 2,
      clusters: [{
        story_id: 'story-1',
        topic_key: 'topic-a',
        created_at: 1,
        updated_at: 2,
        cluster_window_start: 1,
        cluster_window_end: 2,
        headline: 'Headline',
        summary_hint: 'Summary',
        primary_language: 'en',
        translation_applied: false,
        semantic_signature: 'sig',
        entity_scores: {},
        location_scores: {},
        trigger_scores: {},
        document_type_counts: {
          breaking_update: 0,
          wire_report: 1,
          hard_news: 0,
          video_clip: 0,
          liveblog: 0,
          analysis: 0,
          opinion: 0,
          explainer_recap: 2,
        },
        centroid_coarse: [],
        centroid_full: [],
        source_documents: [{
          source_key: 'wire-a:hash-a',
          source_id: 'wire-a',
          publisher: 'WIRE-A',
          url: 'https://example.com/a',
          canonical_url: 'https://example.com/a',
          url_hash: 'hash-a',
          published_at: 1,
          title: 'Headline',
          language: 'en',
          translation_applied: false,
          doc_type: 'wire_report',
          coverage_role: 'canonical',
          entities: [],
          locations: [],
          trigger: null,
          temporal_ms: null,
          event_tuple: null,
          coarse_vector: [],
          full_vector: [],
          semantic_signature: 'sig',
          text: 'Headline',
          doc_ids: ['doc-1'],
        }],
        lineage: { merged_from: [] },
      }],
    }), 'utf8');

    const loaded = store.loadTopic('topic-a');
    expect(loaded.clusters[0]?.document_type_counts.wire).toBe(1);
    expect(loaded.clusters[0]?.document_type_counts.explainer).toBe(2);
    expect(loaded.clusters[0]?.source_documents[0]?.doc_type).toBe('wire');
  });

  it('ignores non-numeric legacy document type counts while normalizing aliases', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vh-storycluster-bad-counts-'));
    createdPaths.push(dir);
    const store = new FileClusterStore(dir);
    const topicPath = join(dir, `${sha256Hex('topic-a', 24)}.json`);

    writeFileSync(topicPath, JSON.stringify({
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-a',
      next_cluster_seq: 2,
      clusters: [{
        story_id: 'story-1',
        topic_key: 'topic-a',
        created_at: 1,
        updated_at: 2,
        cluster_window_start: 1,
        cluster_window_end: 2,
        headline: 'Headline',
        summary_hint: 'Summary',
        primary_language: 'en',
        translation_applied: false,
        semantic_signature: 'sig',
        entity_scores: {},
        location_scores: {},
        trigger_scores: {},
        document_type_counts: {
          wire_report: 'bad',
          explainer_recap: 1,
        },
        centroid_coarse: [],
        centroid_full: [],
        source_documents: [],
        lineage: { merged_from: [] },
      }],
    }), 'utf8');

    const loaded = store.loadTopic('topic-a');
    expect(loaded.clusters[0]?.document_type_counts.wire).toBe(0);
    expect(loaded.clusters[0]?.document_type_counts.explainer).toBe(1);
  });

  it('supplies zeroed document type counts when persisted counts are missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vh-storycluster-missing-counts-'));
    createdPaths.push(dir);
    const store = new FileClusterStore(dir);
    const topicPath = join(dir, `${sha256Hex('topic-a', 24)}.json`);

    writeFileSync(topicPath, JSON.stringify({
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-a',
      next_cluster_seq: 2,
      clusters: [{
        story_id: 'story-1',
        topic_key: 'topic-a',
        created_at: 1,
        updated_at: 2,
        cluster_window_start: 1,
        cluster_window_end: 2,
        headline: 'Headline',
        summary_hint: 'Summary',
        primary_language: 'en',
        translation_applied: false,
        semantic_signature: 'sig',
        entity_scores: {},
        location_scores: {},
        trigger_scores: {},
        centroid_coarse: [],
        centroid_full: [],
        source_documents: [],
        lineage: { merged_from: [] },
      }],
    }), 'utf8');

    const loaded = store.loadTopic('topic-a');
    expect(loaded.clusters[0]?.document_type_counts).toEqual({
      breaking_update: 0,
      wire: 0,
      hard_news: 0,
      video_clip: 0,
      liveblog: 0,
      analysis: 0,
      opinion: 0,
      explainer: 0,
    });
  });

  it('reports readiness failure for invalid state directories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vh-storycluster-file-'));
    const filePath = join(dir, 'occupied');
    writeFileSync(filePath, 'x', 'utf8');
    createdPaths.push(dir);

    const brokenStore = Object.create(FileClusterStore.prototype) as FileClusterStore;
    Object.defineProperty(brokenStore, 'stateDir', { value: filePath });

    expect(brokenStore.readiness().ok).toBe(false);

    const throwingStore = Object.create(FileClusterStore.prototype) as FileClusterStore;
    Object.defineProperty(throwingStore, 'stateDir', { get: () => { throw 'bad-state-dir'; } });
    expect(throwingStore.readiness()).toEqual({ ok: false, detail: 'bad-state-dir' });
  });

  it('creates default stores from env', () => {
    process.env.VITEST = 'true';
    expect(getDefaultClusterStore()).toBeInstanceOf(MemoryClusterStore);

    resetDefaultClusterStore();
    delete process.env.VITEST;
    const dir = mkdtempSync(join(tmpdir(), 'vh-storycluster-default-'));
    createdPaths.push(dir);
    process.env.VH_STORYCLUSTER_STATE_DIR = dir;
    expect(getDefaultClusterStore()).toBeInstanceOf(FileClusterStore);

    resetDefaultClusterStore();
    delete process.env.VH_STORYCLUSTER_STATE_DIR;
    const defaultFileStore = getDefaultClusterStore() as FileClusterStore;
    expect(defaultFileStore.readiness().ok).toBe(true);
  });
});
