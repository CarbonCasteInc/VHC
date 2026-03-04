/**
 * PR0 contract freeze fixtures for `vh/news/index/latest/*` reads.
 *
 * Legacy writers used `created_at` payloads.
 * Target activity writers use `cluster_window_end` (or `latest_activity_at` during rollout).
 */

export const LEGACY_LATEST_INDEX_PAYLOAD_FIXTURE: Record<string, unknown> = Object.freeze({
  _: { '#': 'meta' },
  'story-legacy-direct-number': 1_700_000_001_000,
  'story-legacy-direct-string': '1700000002000',
  'story-legacy-created-at-number': { created_at: 1_700_000_003_000 },
  'story-legacy-created-at-string': { created_at: '1700000004000' },
  'story-legacy-invalid': { created_at: 'nope' },
});

export const LEGACY_LATEST_INDEX_EXPECTED_FIXTURE: Record<string, number> = Object.freeze({
  'story-legacy-direct-number': 1_700_000_001_000,
  'story-legacy-direct-string': 1_700_000_002_000,
  'story-legacy-created-at-number': 1_700_000_003_000,
  'story-legacy-created-at-string': 1_700_000_004_000,
});

export const TARGET_LATEST_INDEX_PAYLOAD_FIXTURE: Record<string, unknown> = Object.freeze({
  _: { '#': 'meta' },
  'story-target-direct-number': 1_700_000_101_000,
  'story-target-direct-string': '1700000102000',
  'story-target-cluster-window-end': { cluster_window_end: 1_700_000_103_000 },
  'story-target-latest-activity-at': { latest_activity_at: '1700000104000' },
  'story-target-invalid': { cluster_window_end: -1 },
});

export const TARGET_LATEST_INDEX_EXPECTED_FIXTURE: Record<string, number> = Object.freeze({
  'story-target-direct-number': 1_700_000_101_000,
  'story-target-direct-string': 1_700_000_102_000,
  'story-target-cluster-window-end': 1_700_000_103_000,
  'story-target-latest-activity-at': 1_700_000_104_000,
});

export const MIXED_LATEST_INDEX_PRECEDENCE_PAYLOAD_FIXTURE: Record<string, unknown> = Object.freeze({
  'story-mixed-precedence': {
    cluster_window_end: 1_700_000_999_000,
    latest_activity_at: 1_700_000_888_000,
    created_at: 1_700_000_111_000,
  },
});

export const MIXED_LATEST_INDEX_PRECEDENCE_EXPECTED_FIXTURE: Record<string, number> = Object.freeze({
  'story-mixed-precedence': 1_700_000_999_000,
});
