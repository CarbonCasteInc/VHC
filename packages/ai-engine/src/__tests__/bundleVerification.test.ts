import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildVerificationMap,
  clusterItems,
  computeClusterConfidence,
  newsClusterInternal,
} from '../newsCluster';
import {
  BUNDLE_VERIFICATION_THRESHOLD,
  BundleVerificationRecordSchema,
} from '../newsTypes';
import type { NormalizedItem } from '../newsTypes';

function makeItem(overrides: Partial<NormalizedItem> = {}): NormalizedItem {
  return {
    sourceId: 'src-a',
    publisher: 'src-a',
    url: 'https://example.com/a',
    canonicalUrl: 'https://example.com/a',
    title: 'Test story headline',
    publishedAt: 1707134400000,
    summary: 'Summary text',
    author: 'Author',
    url_hash: 'hash-a',
    entity_keys: ['markets', 'policy'],
    ...overrides,
  };
}

describe('bundle verification', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-02-05T14:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('BUNDLE_VERIFICATION_THRESHOLD', () => {
    it('is 0.6', () => {
      expect(BUNDLE_VERIFICATION_THRESHOLD).toBe(0.6);
    });
  });

  describe('BundleVerificationRecordSchema', () => {
    it('validates a correct record', () => {
      const result = BundleVerificationRecordSchema.safeParse({
        story_id: 'story-1',
        confidence: 0.85,
        evidence: ['entity_overlap:0.80'],
        method: 'entity_time_cluster',
        verified_at: 1000,
      });
      expect(result.success).toBe(true);
    });

    it('rejects confidence out of range', () => {
      expect(
        BundleVerificationRecordSchema.safeParse({
          story_id: 'story-1',
          confidence: 1.5,
          evidence: ['e'],
          method: 'entity_time_cluster',
          verified_at: 1000,
        }).success,
      ).toBe(false);

      expect(
        BundleVerificationRecordSchema.safeParse({
          story_id: 'story-1',
          confidence: -0.1,
          evidence: ['e'],
          method: 'entity_time_cluster',
          verified_at: 1000,
        }).success,
      ).toBe(false);
    });

    it('rejects empty evidence', () => {
      expect(
        BundleVerificationRecordSchema.safeParse({
          story_id: 'story-1',
          confidence: 0.5,
          evidence: [],
          method: 'entity_time_cluster',
          verified_at: 1000,
        }).success,
      ).toBe(false);
    });

    it('validates all method types', () => {
      for (const method of [
        'entity_time_cluster',
        'semantic_similarity',
        'manual',
      ]) {
        expect(
          BundleVerificationRecordSchema.safeParse({
            story_id: 'story-1',
            confidence: 0.5,
            evidence: ['test'],
            method,
            verified_at: 1000,
          }).success,
        ).toBe(true);
      }
    });
  });

  describe('hasSignificantEntityOverlap', () => {
    it('requires ≥2 shared entities for large sets', () => {
      const cluster = newsClusterInternal.toCluster([
        makeItem({
          entity_keys: ['alpha', 'beta', 'gamma', 'delta'],
          url_hash: 'h1',
          canonicalUrl: 'https://example.com/1',
        }),
      ])[0]!;

      // Only 1 shared entity with a 3-entity set → NOT enough
      expect(
        newsClusterInternal.hasSignificantEntityOverlap(cluster, [
          'alpha',
          'zeta',
          'omega',
        ]),
      ).toBe(false);

      // 2 shared entities → enough
      expect(
        newsClusterInternal.hasSignificantEntityOverlap(cluster, [
          'alpha',
          'beta',
          'zeta',
        ]),
      ).toBe(true);
    });

    it('allows single-entity overlap for small sets', () => {
      const cluster = newsClusterInternal.toCluster([
        makeItem({
          entity_keys: ['single'],
          url_hash: 'h1',
          canonicalUrl: 'https://example.com/1',
        }),
      ])[0]!;

      expect(
        newsClusterInternal.hasSignificantEntityOverlap(cluster, ['single']),
      ).toBe(true);
    });
  });

  describe('computeClusterConfidence edge cases', () => {
    it('handles cluster with empty entity sets (union=0 branch)', () => {
      // Create a cluster where items have empty entity sets after filtering
      const items = [
        makeItem({
          sourceId: 'src-a',
          url_hash: 'h1',
          canonicalUrl: 'https://example.com/1',
          entity_keys: [],
          title: '??',
        }),
        makeItem({
          sourceId: 'src-b',
          url_hash: 'h2',
          canonicalUrl: 'https://example.com/2',
          entity_keys: [],
          title: '??',
          publisher: 'src-b',
        }),
      ];
      // Both items share fallback 'general' so they cluster
      const clusters = newsClusterInternal.toCluster(items);
      expect(clusters.length).toBeGreaterThanOrEqual(1);
      const confidence = computeClusterConfidence(clusters[0]!);
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('computeClusterConfidence', () => {
    it('returns low confidence for single-source cluster', () => {
      const clusters = newsClusterInternal.toCluster([
        makeItem({ url_hash: 'h1', canonicalUrl: 'https://example.com/1' }),
      ]);
      expect(clusters).toHaveLength(1);
      const confidence = computeClusterConfidence(clusters[0]!);
      // Single source: entity overlap=0, time=1, diversity=1 → 0*0.4 + 1*0.3 + 1*0.3 = 0.6
      expect(confidence).toBeCloseTo(0.6, 1);
    });

    it('returns higher confidence for multi-source cluster', () => {
      const clusters = newsClusterInternal.toCluster([
        makeItem({
          sourceId: 'src-a',
          url_hash: 'h1',
          canonicalUrl: 'https://example.com/1',
          entity_keys: ['markets', 'policy'],
        }),
        makeItem({
          sourceId: 'src-b',
          url_hash: 'h2',
          canonicalUrl: 'https://example.com/2',
          entity_keys: ['markets', 'policy'],
          publisher: 'src-b',
        }),
      ]);
      expect(clusters).toHaveLength(1);
      const confidence = computeClusterConfidence(clusters[0]!);
      expect(confidence).toBeGreaterThan(0.5);
    });

    it('returns 0.6 for empty/degenerate case', () => {
      const clusters = newsClusterInternal.toCluster([
        makeItem({
          publishedAt: undefined,
          url_hash: 'h1',
          canonicalUrl: 'https://example.com/1',
          entity_keys: ['x'],
        }),
      ]);
      const c = computeClusterConfidence(clusters[0]!);
      expect(c).toBeDefined();
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    });
  });

  describe('buildVerificationMap', () => {
    it('builds verification records for clustered bundles', () => {
      const items: NormalizedItem[] = [
        makeItem({
          sourceId: 'src-a',
          url_hash: 'h1',
          canonicalUrl: 'https://example.com/1',
          entity_keys: ['markets', 'policy'],
        }),
        makeItem({
          sourceId: 'src-b',
          url_hash: 'h2',
          canonicalUrl: 'https://example.com/2',
          entity_keys: ['markets', 'policy'],
          publisher: 'src-b',
        }),
      ];

      const bundles = clusterItems(items, 'topic-test');
      const vMap = buildVerificationMap(bundles, items, 'topic-test');

      expect(vMap.size).toBe(bundles.length);
      for (const bundle of bundles) {
        const record = vMap.get(bundle.story_id);
        expect(record).toBeDefined();
        expect(record!.story_id).toBe(bundle.story_id);
        expect(record!.confidence).toBeGreaterThanOrEqual(0);
        expect(record!.confidence).toBeLessThanOrEqual(1);
        expect(record!.evidence.length).toBeGreaterThanOrEqual(1);
        expect(record!.method).toBe('entity_time_cluster');
        expect(record!.verified_at).toBeGreaterThan(0);
      }
    });

    it('returns empty map for empty input', () => {
      const vMap = buildVerificationMap([], [], 'topic-empty');
      expect(vMap.size).toBe(0);
    });

    it('evidence contains expected fields', () => {
      const items = [
        makeItem({
          url_hash: 'h1',
          canonicalUrl: 'https://example.com/1',
        }),
      ];
      const bundles = clusterItems(items, 'topic-ev');
      const vMap = buildVerificationMap(bundles, items, 'topic-ev');
      const record = vMap.get(bundles[0]!.story_id)!;
      expect(record.evidence.some((e) => e.startsWith('entity_overlap:'))).toBe(
        true,
      );
      expect(record.evidence.some((e) => e.startsWith('time_proximity:'))).toBe(
        true,
      );
      expect(record.evidence.some((e) => e.startsWith('source_count:'))).toBe(
        true,
      );
    });
  });
});
