# Topic Discovery and Ranking Spec (v0)

Version: 0.1
Status: Canonical for Season 0
Context: Unified feed composition across News, Topics, and Social surfaces.

## 1. Scope

Compose and rank one feed from three source surfaces:

1. News (`StoryBundle` backed)
2. Topics/threads (`TopicSynthesisV2` + forum activity)
3. Linked-social notifications

## 2. Feed controls

Required controls:

- Filter chips: `All`, `News`, `Topics`, `Social`
- Sort modes: `Latest`, `Hottest`, `My Activity`

## 3. Discovery item contract

```ts
type FeedKind = 'NEWS_STORY' | 'USER_TOPIC' | 'SOCIAL_NOTIFICATION';

interface FeedItem {
  topic_id: string;
  kind: FeedKind;
  created_at: number;
  latest_activity_at: number;
  hotness: number;
  eye: number;
  lightbulb: number;
  comments: number;
  my_activity_score?: number;
}
```

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

1. Filter correctness for All/News/Topics/Social.
2. Sort correctness for Latest/Hottest/My Activity.
3. Deterministic hotness ranking given fixed inputs.
4. Cohort-threshold fallback behavior.
5. Privacy checks (no user identifiers in discovery payloads).
