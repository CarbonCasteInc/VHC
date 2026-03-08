import type { StoryClusterCoherenceAuditItem } from './coherenceAudit';
import type { StoryClusterCoverageRole } from './documentPolicy';

export function makeBenchmarkItem(
  expectedEventId: string,
  sourceId: string,
  title: string,
  urlHash: string,
  publishedAt: number,
  overrides: Partial<StoryClusterCoherenceAuditItem> & {
    coverage_role?: StoryClusterCoverageRole;
  } = {},
): StoryClusterCoherenceAuditItem {
  return {
    expected_event_id: expectedEventId,
    coverage_role: overrides.coverage_role ?? 'canonical',
    sourceId,
    publisher: overrides.publisher ?? sourceId.toUpperCase(),
    url: overrides.url ?? `https://example.com/${urlHash}`,
    canonicalUrl: overrides.canonicalUrl ?? `https://example.com/${urlHash}`,
    title,
    publishedAt,
    summary: overrides.summary ?? `${title} summary.`,
    url_hash: overrides.url_hash ?? urlHash,
    image_hash: overrides.image_hash,
    language: overrides.language ?? 'en',
    translation_applied: overrides.translation_applied ?? false,
    entity_keys: overrides.entity_keys ?? [expectedEventId],
    cluster_text: overrides.cluster_text,
  };
}
