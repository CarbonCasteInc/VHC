# Topic Discovery and Ranking Spec (v0)

> Status: Normative Spec
> Owner: VHC Spec Owners
> Last Reviewed: 2026-04-16
> Depends On: docs/foundational/System_Architecture.md, docs/CANON_MAP.md


Version: 0.7
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

### 2.1 Product shell and card-density contract

The unified feed is the product home surface. Season 0 UI must not require a
primary `VENN` / `HERMES` / `AGORA` mode switcher in the app chrome:

- `VENN` is represented by the home feed itself.
- `HERMES Forum` topics surface through the `Topics` filter and through
  discussion affordances on expanded feed cards. Direct `/hermes` routes may
  remain for deep links and internal flows, but they are not the primary
  feed-discovery navigation.
- `AGORA` / governance affordances should be woven into card engagement,
  stance, nomination, and user/profile surfaces rather than exposed as a
  separate primary feed tab.

The `For You` explainer is an onboarding affordance, not a persistent masthead.
Clients may show it on first use, but returning sessions should land directly
on the compact feed controls and card stream.

Collapsed cards should optimize for scan density:

- several cards should be visible in a normal desktop viewport after onboarding
  chrome has been dismissed;
- one primary source image, when available, belongs beside the headline/title
  on the card face rather than as a full-width masthead image;
- additional distinct source images belong in the expanded detail/gallery;
- card summaries remain synthesized across sources, never split by
  publication;
- source presentation uses the overlapping source strip/badge treatment so
  singleton vs aggregate stories are legible at a glance.

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
  categories?: string[];
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
Top-window diversification parameters and future personalization weights are also config-driven; consumers must not hard-code storyline caps, entity-overlap penalties, or category preference defaults in card components.

Season 0 personalization scaffold:

```ts
interface FeedPersonalizationConfig {
  preferredCategories: string[];
  preferredTopics: string[];
  mutedCategories: string[];
  mutedTopics: string[];
}
```

## 6. Cohort threshold and privacy rules

- District or cohort-specific boosts require minimum cohort sizes before activation.
- No ranking payload may include person-level identifiers.
- If cohort requirements are unmet, system falls back to global ranking without district personalization.

## 7. Storage and paths

- `vh/discovery/items/<topicId>`
- `vh/discovery/index/<filter>/<sort>/<cursor>`

These objects must remain token-free and person/account-identity-free.
Content identity fields such as `story_id` are allowed where explicitly specified in this contract.

## 8. Synthesis enrichment and detail rendering

`NEWS_STORY` feed cards are `StoryBundle` backed and may represent either a singleton source or a clustered story. Card detail rendering must use the accepted `TopicSynthesisV2` object when present:

- `facts_summary` is the canonical story summary for singleton and aggregate stories.
- `frames` is the canonical frame/reframe table.
- Per-card or per-source analysis may appear only as a labeled provisional fallback when accepted synthesis is absent.
- Summaries must not be separated by publication. Source-specific opinions and framing belong in frame/reframe rows, not in the facts summary.

Required card affordances:

- source strip / overlapping source badges on the headline face
- related-coverage/storyline affordance
- synthesis summary
- frame/reframe table
- stance controls on frame/reframe rows
- engagement counts
- forum comments below frame/reframe content

News-created forum threads must link with `sourceSynthesisId` + `sourceEpoch` when available and preserve the feed `topic_id` as the thread `topicId`. Legacy `sourceAnalysisId` is read-only compatibility.

Continuous stream behavior:

- validated article-automation / publisher-canary snapshots feed the public news store through the configured snapshot bootstrap URL;
- the snapshot payload is the public feed projection of bundled output, preserving singleton vs aggregate source composition for headline-card source strips;
- refreshes surface newer clusters without requiring a tab switch or separate feed mode;
- lazy pagination reveals older stories as the user scrolls, without dropping the current filter, sort, or restored expanded-card route state.

### 8.1 Topic cards

`USER_TOPIC` feed cards are enriched with `TopicSynthesisV2` data when available.
User-created forum heads and news stories share the same expanded-card anatomy
once a topic has enough conversation depth for synthesis: synthesized summary,
frame/reframe table, stance controls, engagement counts, then forum
comments/replies below the table. Before that threshold, topic cards must keep
the thread-head and live conversation usable without pretending synthesis is
available.

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
7. Product-shell regression: no primary `VENN` / `HERMES` / `AGORA` mode switcher is required for feed use; the first-use orientation does not recur after reload.
8. Collapsed card density/media regression: compact card controls remain accessible, primary story media renders beside the headline when present, and additional source media remains detail-only.

## 10. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | Wave 1 | Initial spec: 3 FeedKinds, 4 filter chips |
| 0.2 | Wave 2 | Added `ARTICLE` kind, `ARTICLES` filter chip, `title` field on FeedItem |
| 0.3 | Wave 3 | Added `ACTION_RECEIPT` kind (All filter only), documented filter-to-kind mapping |
| 0.4 | Wave 3 | Added synthesis enrichment for USER_TOPIC cards (§8), viewport-aware hydration |
| 0.5 | 2026-03-13 | Added optional `storyline_id`/`entity_keys` to `FeedItem` and documented storyline-aware HOTTEST diversification |
| 0.6 | 2026-04-16 | Added NEWS_STORY synthesis precedence, source/detail affordance contract, `categories`, personalization scaffold, and V2 forum-thread linkage |
| 0.7 | 2026-04-16 | Added compact product-shell, first-use orientation, forum/governance navigation, and collapsed-card media-density contracts |
