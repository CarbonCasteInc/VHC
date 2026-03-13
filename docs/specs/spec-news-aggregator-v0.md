# News Aggregator Spec (v0)

> Status: Normative Spec
> Owner: VHC Spec Owners
> Last Reviewed: 2026-03-13
> Depends On: docs/foundational/System_Architecture.md, docs/CANON_MAP.md


Version: 0.2
Status: Canonical for Season 0
Context: RSS ingest, normalization, clustering, and story bundle publication.

## 1. Scope

Convert many source URLs into one story object for feed consumption and V2 synthesis inputs.

Pipeline:

1. RSS ingest
2. normalization and dedupe
3. story clustering
4. `StoryBundle` publish with provenance

## 2. Inputs and ingest

```ts
interface FeedSource {
  id: string;
  name: string;
  rssUrl: string;
  trustTier?: 'primary' | 'secondary';
  enabled: boolean;
}

interface RawFeedItem {
  sourceId: string;
  url: string;
  title: string;
  publishedAt?: number;
  summary?: string;
  author?: string;
}
```

Normalization requirements:

- canonicalize URLs and hash to `url_hash`
- strip tracking params
- dedupe exact URL and near-duplicate title+time windows

## 3. Story clustering contract

```ts
interface StoryBundle {
  schemaVersion: 'story-bundle-v0';
  story_id: string;
  topic_id: string;
  storyline_id?: string;
  headline: string;
  summary_hint?: string;
  cluster_window_start: number;
  cluster_window_end: number;
  sources: Array<{
    source_id: string;
    publisher: string;
    url: string;
    url_hash: string;
    published_at?: number;
    title: string;
  }>;
  primary_sources?: Array<{
    source_id: string;
    publisher: string;
    url: string;
    url_hash: string;
    published_at?: number;
    title: string;
  }>;
  secondary_assets?: Array<{
    source_id: string;
    publisher: string;
    url: string;
    url_hash: string;
    published_at?: number;
    title: string;
  }>;
  cluster_features: {
    entity_keys: string[];
    time_bucket: string;
    semantic_signature: string;
    coverage_score?: number;
    velocity_score?: number;
    confidence_score?: number;
    primary_language?: string;
    translation_applied?: boolean;
  };
  provenance_hash: string;
  created_at: number;
}
```

`story_id` and `topic_id` must be stable for the same cluster window and feature set.
`storyline_id`, when present, identifies a broader narrative grouping and must not widen canonical event-bundle membership.

`created_at` contract:
- `created_at` is the first-seen publish timestamp for a `story_id` and MUST remain immutable after initial publish.

PR0 identity wiring freeze:
- `StoryBundle.story_id` is the canonical NEWS_STORY identity key.
- Discovery NEWS_STORY projections should forward this value as `FeedItem.story_id` when available.

## 4. Provenance requirements

Every story must preserve source-level provenance:

- publisher and source ID
- canonical URL and URL hash
- publication time when available
- deterministic provenance hash over sorted source list

No source URLs should be dropped from provenance if used in clustering/synthesis.
Canonical event-bundle publication must remain strict even when related coverage is grouped elsewhere.

## 5. Mesh/storage paths

- `vh/news/stories/<storyId>`
- `vh/news/index/latest/<storyId>`
- `vh/news/storylines/<storylineId>`
- optional: `vh/news/source/<sourceId>/<itemId>` for debug snapshots

Storyline publication contract:

1. `StorylineGroup` objects may be published alongside canonical `StoryBundle`s;
2. storyline groups are separate related-coverage artifacts and must not widen `StoryBundle.sources`;
3. canonical source basis remains the `StoryBundle` event-bundle projection.

### 5.1 Latest-index migration contract (PR0 freeze)

Canonical target semantics for `vh/news/index/latest/<storyId>` are **latest activity** timestamps.

- Target write shape: scalar timestamp (activity, aligned with `cluster_window_end`).
- Transitional read compatibility (must be supported):
  - scalar timestamp string/number
  - object payloads carrying `cluster_window_end` or `latest_activity_at`
  - legacy object payloads carrying `created_at`
- Canonical mixed-object precedence (when multiple keys are present):
  1. `cluster_window_end`
  2. `latest_activity_at`
  3. `created_at`
- Migration discipline: reader dual-compat first; writer cutover to activity semantics in PR1.

## 6. Privacy and safety

- News artifacts are public and must not include identity fields.
- OAuth/social tokens are out-of-scope and forbidden in this subsystem.

## 7. Tests

1. URL normalization and dedupe behavior.
2. Stable story ID generation for equivalent clusters.
3. Provenance hash determinism.
4. Multi-source cluster generation from overlapping feed items.
5. Optional `storyline_id` and `StorylineGroup` publication do not widen canonical bundle membership.
