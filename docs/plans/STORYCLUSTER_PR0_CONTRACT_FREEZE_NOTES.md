# Storycluster PR0 — Contract Freeze Notes

_Date: 2026-03-04_

Scope: PR0 only (`contract freeze + test-harness alignment`).

## 1) StoryBundle identity contract (frozen)

Canonical identity remains:
- `StoryBundle.story_id` (non-empty string)
- `StoryBundle.schemaVersion = story-bundle-v0`

PR0 expectation:
- `created_at` is treated as first-seen identity timestamp and must not be mutated by adapter write/read boundaries.
- `cluster_window_end` represents latest activity and may move independently.

## 2) NEWS_STORY identity contract (frozen)

Discovery `FeedItem` now explicitly carries optional `story_id` for NEWS_STORY migration windows.

PR0 identity behavior:
- Canonical identity key when available: `NEWS_STORY + story_id`
- Legacy fallback key when `story_id` is absent: `NEWS_STORY + topic_id + created_at + normalized title`

This keeps legacy payloads readable while freezing the forward contract shape.

## 3) Latest-index migration semantics (frozen)

Reader compatibility in PR0 accepts all of:
- Scalar activity timestamp (`number` / numeric `string`) — target shape
- `{ cluster_window_end: ... }` — target transitional object shape
- `{ latest_activity_at: ... }` — target alias shape
- `{ created_at: ... }` — legacy shape

Precedence for mixed objects is frozen as:
1. `cluster_window_end`
2. `latest_activity_at`
3. `created_at`

Fixture source of truth:
- `packages/gun-client/src/__fixtures__/latestIndexMigrationFixtures.ts`

## 4) Lease semantics baseline (unchanged in PR0)

PR0 does **not** change runtime writer lease behavior.

Assumption baseline for PR0:
- Existing runtime write paths continue without introducing new lease acquisition/renewal/expiry mechanics.
- Lease enforcement and conflict handling remain planned for the next implementation phase.

This is intentionally documented so PR0 tests do not assert behavior that does not exist yet.
