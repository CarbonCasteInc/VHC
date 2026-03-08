export const STORYCLUSTER_PAIR_LABELS = [
  'duplicate',
  'same_incident',
  'same_developing_episode',
  'related_topic_only',
  'commentary_on_event',
  'unrelated',
] as const;

export type StoryClusterPairLabel = (typeof STORYCLUSTER_PAIR_LABELS)[number];

const STORYCLUSTER_CANONICAL_BUNDLE_LABELS = new Set<StoryClusterPairLabel>([
  'duplicate',
  'same_incident',
  'same_developing_episode',
]);

export function isStoryClusterPairLabel(value: string): value is StoryClusterPairLabel {
  return STORYCLUSTER_PAIR_LABELS.includes(value as StoryClusterPairLabel);
}

export function normalizeStoryClusterPairLabel(
  value: string,
  path = 'pair_label',
): StoryClusterPairLabel {
  const normalized = value.trim().toLowerCase();
  if (!isStoryClusterPairLabel(normalized)) {
    throw new Error(
      `${path} must be one of ${STORYCLUSTER_PAIR_LABELS.join(', ')}`,
    );
  }

  return normalized;
}

export function isCanonicalBundlePairLabel(label: StoryClusterPairLabel): boolean {
  return STORYCLUSTER_CANONICAL_BUNDLE_LABELS.has(label);
}
