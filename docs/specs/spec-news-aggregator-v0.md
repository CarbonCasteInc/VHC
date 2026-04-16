# News Aggregator Spec (v0)

> Status: Normative Spec
> Owner: VHC Spec Owners
> Last Reviewed: 2026-04-16
> Depends On: docs/foundational/System_Architecture.md, docs/CANON_MAP.md


Version: 0.4
Status: Canonical for Season 0
Context: RSS ingest, normalization, clustering, and story bundle publication.

## 1. Scope

Convert many source URLs into one story object for feed consumption and V2 synthesis inputs.

Pipeline:

1. RSS ingest
2. normalization and dedupe
3. story clustering
4. `StoryBundle` publish with provenance

Season 0 source contract:

1. the production-ready feed promise applies only to onboarded readable, accessible, extraction-safe sources;
2. source admission/removal is governed operationally by `/Users/bldt/Desktop/VHC/VHC/docs/ops/NEWS_SOURCE_ADMISSION_RUNBOOK.md`;
3. a single readable article may publish as a valid story even when no corroborating outlet exists yet;
4. later same-incident / same-developing-episode coverage should attach under stable story identity as source coverage grows;
5. under-bundling is preferable to false canonical merges.

Season 0 production-readiness contract:

1. StoryCluster correctness must pass through the deterministic corpus/replay gate plus the daemon-first semantic gate;
2. source-health release evidence must remain fresh and pass over the recent run window;
3. headline-soak release evidence must remain fresh and pass over the recent run window;
4. headline-soak release evidence currently passes the recent run window only when all of these are true:
   - at least 4 recent executions are present;
   - at least 2 recent executions are promotable;
   - at most 1 recent execution is `not_ready`;
   - average corroborated bundle rate is at least `0.5`;
   - average unique visible source count is at least `2`;
5. the combined release-decision artifact at `/Users/bldt/Desktop/VHC/VHC/.tmp/storycluster-production-readiness/latest/production-readiness-report.json` must resolve to `release_ready` before a production-readiness claim.

Changing the headline-soak release thresholds requires a spec update and a matching implementation change in `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemon-feed-semantic-soak-report.mjs`.

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
  imageUrl?: string;
}
```

Normalization requirements:

- canonicalize URLs and hash to `url_hash`
- strip tracking params
- dedupe exact URL and near-duplicate title+time windows
- extract an optional source image URL from RSS/Atom media, enclosure, or HTML summary metadata when the feed provides one
- preserve source image URLs as presentation/provenance metadata only; they must not change clustering semantics by themselves

Readable-article eligibility requirements:

- sources are admitted from an explicit onboarded source set, not arbitrary feed URLs
- article extraction must clear the readable-text quality bar
- paywalled, truncated, robots-blocked, empty, or chronically unreadable article paths must not count toward production-ready source coverage
- feed-carried video/watch entries from an admitted source must not count against article-readability sampling; admission should continue scanning feed items until it finds the required number of non-video article candidates or exhausts the feed

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
    imageUrl?: string;
  }>;
  primary_sources?: Array<{
    source_id: string;
    publisher: string;
    url: string;
    url_hash: string;
    published_at?: number;
    title: string;
    imageUrl?: string;
  }>;
  secondary_assets?: Array<{
    source_id: string;
    publisher: string;
    url: string;
    url_hash: string;
    published_at?: number;
    title: string;
    imageUrl?: string;
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

Canonical publication contract:
- `StoryBundle` publication may represent a single-source story when only one readable canonical report exists;
- `StoryBundle` publication may also represent a single-source publisher-hosted video/watch story from an admitted source when no corroborating article bundle exists yet;
- later corroborating coverage may widen the bundle if and only if it is the same incident or same developing episode;
- adding later sources must not churn the existing `story_id`.
- single-source video/watch stories must bypass text synthesis/enrichment and preserve direct source access as the primary detail path;
- corroborated bundles may still synthesize normally even when one or more member sources are video/watch pages.

`created_at` contract:
- `created_at` is the initial publish timestamp for a `story_id`; when the earliest source publish time is available it should seed this value, otherwise the initial cluster publish time may seed it; it MUST remain immutable after initial publish.

PR0 identity wiring freeze:
- `StoryBundle.story_id` is the canonical NEWS_STORY identity key.
- Discovery NEWS_STORY projections should forward this value as `FeedItem.story_id` when available.

## 4. Provenance requirements

Every story must preserve source-level provenance for the canonical event-bundle projection:

- publisher and source ID
- canonical URL and URL hash
- publication time when available
- source image URL when available
- deterministic provenance hash over sorted source list

No source URLs should be dropped from canonical event-bundle provenance if they remain part of published `StoryBundle.sources`, `primary_sources`, or `secondary_assets`.
No source image URLs should be dropped from canonical event-bundle provenance when present on those source entries, though they are non-semantic presentation metadata.
Related-coverage sources may be projected separately through `StorylineGroup` and do not need to widen canonical `StoryBundle` provenance.
Canonical event-bundle publication must remain strict even when related coverage is grouped elsewhere.

Analysis persistence identity:
- generated story analyses are keyed by `story_id + provenance_hash + pipeline_version + model_scope + schema_version`;
- new generated analysis artifacts must also persist `bundle_identity.bundle_revision`, `bundle_identity.source_article_ids`, `bundle_identity.source_count`, and the bundle cluster window;
- `bundle_revision` is the bundle provenance revision used for the analysis key;
- `source_article_ids` are stable `source_id:url_hash` identifiers sorted across the accepted source set;
- latest-analysis pointers must not be reused across bundle revision/source-set drift; old artifacts remain readable by their exact analysis key, and regenerated bundles must create a fresh analysis rather than overwriting or silently reusing stale analysis.

## 5. Mesh/storage paths

- `vh/news/stories/<storyId>`
- `vh/news/index/latest/<storyId>`
- `vh/news/storylines/<storylineId>`
- optional: `vh/news/source/<sourceId>/<itemId>` for debug snapshots
- analysis artifacts: `vh/news/stories/<storyId>/analysis/<analysisKey>`
- latest analysis pointer: `vh/news/stories/<storyId>/analysis_latest`

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
4. Single-source publication remains valid when only one readable report exists.
5. Multi-source cluster generation from overlapping feed items.
6. Later source growth attaches to an existing story without changing `story_id` when coverage belongs to the same incident or same developing episode.
7. Optional `storyline_id` and `StorylineGroup` publication do not widen canonical bundle membership.
8. Optional source image URLs survive ingest, normalization, clustering, and `StoryBundle` primary/secondary-source projection without affecting clustering identity.
