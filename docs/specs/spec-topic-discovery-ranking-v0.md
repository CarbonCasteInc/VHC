# Topic Discovery and Ranking Spec (v0)

> Status: Normative Spec
> Owner: VHC Spec Owners
> Last Reviewed: 2026-03-13
> Depends On: docs/foundational/System_Architecture.md, docs/CANON_MAP.md


Version: 0.5
Status: Canonical for Season 0
Context: Unified feed composition across News, Topics, Social, Articles, and Civic Action surfaces.

## 1. Scope

Compose and rank one feed from five source surfaces:

1. News (`StoryBundle` backed)
2. Topics/threads (`TopicSynthesisV2` + forum activity)
3. Linked-social notifications
4. Articles (long-form content, added Wave 2)
5. Civic Action Receipts (bridge action confirmations, added Wave 3)

## 2. Feed controls

Required controls:

- Filter chips: `All`, `News`, `Topics`, `Social`, `Articles`
- Sort modes: `Latest`, `Hottest`, `My Activity`

Note: `ACTION_RECEIPT` items appear under `All` only — no dedicated filter chip for Season 0.

## 3. Discovery item contract

```ts
type FeedKind =
  | 'NEWS_STORY'
  | 'USER_TOPIC'
  | 'SOCIAL_NOTIFICATION'
  | 'ARTICLE'           // Wave 2: long-form content
  | 'ACTION_RECEIPT';   // Wave 3: civic action confirmations

interface FeedItem {
  story_id?: string; // NEWS_STORY canonical identity when available
  storyline_id?: string;
  topic_id: string;
  kind: FeedKind;
  title: string;
  entity_keys?: string[];
  created_at: number;
  latest_activity_at: number;
  hotness: number;
  eye: number;
  lightbulb: number;
  comments: number;
  my_activity_score?: number;
}
```

### 3.1 NEWS_STORY identity contract (PR0 freeze)

- `StoryBundle.story_id` is the canonical story identity.
- When a `FeedItem.kind === "NEWS_STORY"` carries `story_id`, that value must equal the upstream `StoryBundle.story_id`.
- During migration windows, consumers must tolerate missing `story_id` and use this fallback de-dup key for NEWS_STORY:
  - `NEWS_STORY + topic_id + created_at + normalize(title)`

### 3.2 Filter-to-kind mapping

| Filter chip | Included kinds |
|-------------|---------------|
| `ALL` | All 5 kinds |
| `NEWS` | `NEWS_STORY` |
| `TOPICS` | `USER_TOPIC` |
| `SOCIAL` | `SOCIAL_NOTIFICATION` |
| `ARTICLES` | `ARTICLE` |

`ACTION_RECEIPT` is intentionally excluded from dedicated filter chips for Season 0. It surfaces only under `ALL`.

## 4. Ranking semantics

`Latest`:

- sort by `latest_activity_at` desc

`Hottest`:

- sort by `hotness` desc
- hotness should combine recency + engagement signals deterministically
- apply deterministic storyline-aware diversification in the top window:
  - cap same-`storyline_id` crowding in the hottest window;
  - prefer promoting tail candidates rather than allowing one storyline to dominate adjacent slots;
  - fallback grouping should prefer `storyline_id` and `entity_keys` over generic recap-title overlap.

`My Activity`:

- sort by user-local activity score (reads, comments, votes, follows)
- must not expose identity-linked state in public payloads

## 5. Hotness baseline formula

Reference formula (tunable coefficients):

```txt
hotness =
  w1 * log1p(eye) +
  w2 * log1p(lightbulb) +
  w3 * log1p(comments) +
  w4 * freshness_decay(latest_activity_at)
```

All coefficients and decay parameters must be config-driven and versioned.

## 6. Cohort threshold and privacy rules

- District or cohort-specific boosts require minimum cohort sizes before activation.
- No ranking payload may include person-level identifiers.
- If cohort requirements are unmet, system falls back to global ranking without district personalization.

## 7. Storage and paths

- `vh/discovery/items/<topicId>`
- `vh/discovery/index/<filter>/<sort>/<cursor>`

These objects must remain token-free and person/account-identity-free.
Content identity fields such as `story_id` are allowed where explicitly specified in this contract.

## 8. Synthesis enrichment (Wave 3)

`USER_TOPIC` feed cards are enriched with `TopicSynthesisV2` data when available.

**Rendering contract:**
- `facts_summary` displays as inline paragraph below title
- `frames` array renders as collapsible "N perspectives" toggle → `{frame} → {reframe}` list
- `warnings` render as amber callout when non-empty
- `divergence_metrics.disagreement_score > 0.5` shows "⚡ High divergence" badge

**Hydration strategy:**
- Lazy per-card via `useSynthesis(item.topic_id)` hook
- Viewport-contained: `useInView` defers Gun subscription until card is within 200px of viewport
- Fallback: when synthesis is unavailable (loading/error/absent), card renders original engagement-only layout

**Non-breaking:** TopicCard preserves all existing behavior when synthesis data is absent.

Cross-ref: `docs/specs/topic-synthesis-v2.md` for full `TopicSynthesisV2` schema.

## 9. Tests

1. Filter correctness for All/News/Topics/Social/Articles (including ACTION_RECEIPT under All only).
2. Sort correctness for Latest/Hottest/My Activity.
3. Deterministic hotness ranking given fixed inputs.
4. Cohort-threshold fallback behavior.
5. Privacy checks (no user identifiers in discovery payloads).
6. FeedItem schema validation: `title` required, `kind` must be one of the 5 defined kinds.

## 9. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | Wave 1 | Initial spec: 3 FeedKinds, 4 filter chips |
| 0.2 | Wave 2 | Added `ARTICLE` kind, `ARTICLES` filter chip, `title` field on FeedItem |
| 0.3 | Wave 3 | Added `ACTION_RECEIPT` kind (All filter only), documented filter-to-kind mapping |
| 0.4 | Wave 3 | Added synthesis enrichment for USER_TOPIC cards (§8), viewport-aware hydration |
| 0.5 | 2026-03-13 | Added optional `storyline_id`/`entity_keys` to `FeedItem` and documented storyline-aware HOTTEST diversification |
