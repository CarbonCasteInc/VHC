import { describe, expect, it } from 'vitest';
import {
  STORYCLUSTER_PAIR_LABELS,
  isCanonicalBundlePairLabel,
  isStoryClusterPairLabel,
  normalizeStoryClusterPairLabel,
} from './pairOntology';

describe('pairOntology', () => {
  it('exposes the canonical pair label set', () => {
    expect(STORYCLUSTER_PAIR_LABELS).toEqual([
      'duplicate',
      'same_incident',
      'same_developing_episode',
      'related_topic_only',
      'commentary_on_event',
      'unrelated',
    ]);
  });

  it('normalizes valid pair labels and rejects unknown values', () => {
    expect(normalizeStoryClusterPairLabel(' Same_Incident ')).toBe('same_incident');
    expect(() => normalizeStoryClusterPairLabel('same_topic')).toThrow(
      /pair_label must be one of/,
    );
  });

  it('marks only canonical event-membership labels as bundle-eligible', () => {
    expect(isStoryClusterPairLabel('duplicate')).toBe(true);
    expect(isStoryClusterPairLabel('related_topic_only')).toBe(true);
    expect(isStoryClusterPairLabel('nonsense')).toBe(false);
    expect(isCanonicalBundlePairLabel('duplicate')).toBe(true);
    expect(isCanonicalBundlePairLabel('same_incident')).toBe(true);
    expect(isCanonicalBundlePairLabel('same_developing_episode')).toBe(true);
    expect(isCanonicalBundlePairLabel('related_topic_only')).toBe(false);
    expect(isCanonicalBundlePairLabel('commentary_on_event')).toBe(false);
    expect(isCanonicalBundlePairLabel('unrelated')).toBe(false);
  });
});
