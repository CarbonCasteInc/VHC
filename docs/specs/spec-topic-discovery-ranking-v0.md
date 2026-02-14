# Topic Discovery and Ranking Spec (v0)

Version: 0.3
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
  topic_id: string;
  kind: FeedKind;
  title: string;
  created_at: number;
  latest_activity_at: number;
  hotness: number;
  eye: number;
  lightbulb: number;
  comments: number;
  my_activity_score?: number;
}
```

### 3.1 Filter-to-kind mapping

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

These objects must remain token-free and identity-free.

## 8. Tests

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
