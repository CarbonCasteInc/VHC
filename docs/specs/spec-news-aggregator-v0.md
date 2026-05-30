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
2. source-health release evidence must remain fresh and pass over the complete configured recent run window; consolidated release gates treat source-health `warn` evidence as non-green until the latest run returns to `pass`;
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

`story_id` and `topic_id` must be stable for the same cluster window and event
identity. `story_id` MUST NOT be derived from the complete current source URL
set: source-set growth changes `provenance_hash` / `source_set_revision`, not
the public story card identity.
`storyline_id`, when present, identifies a broader narrative grouping and must not widen canonical event-bundle membership.

Canonical publication contract:
- `StoryBundle` publication may represent a single-source story when only one readable canonical report exists;
- `StoryBundle` publication may also represent a single-source publisher-hosted video/watch story from an admitted source when no corroborating article bundle exists yet;
- later corroborating coverage may widen the bundle if and only if it is the same incident or same developing episode;
- adding later sources must not churn the existing `story_id`;
- in production mode, the remote StoryCluster service is the same-event
  authority for publication. The runtime MUST NOT silently apply an additional
  local title-overlap heuristic that drops a remote multi-source `StoryBundle`
  before raw story publication. Heuristic publication filters may still protect
  local/non-production fallback clustering;
- raw publication failures MUST be scoped to the failing `story_id` and surfaced
  through daemon/runtime error telemetry. One failed story write MUST NOT abort
  publication of later selected singleton or multi-source bundles in the same
  tick. If every selected bundle fails to publish, the tick is failed rather
  than reported as a successful empty publication;
- single-source video/watch stories must bypass text synthesis/enrichment and preserve direct source access as the primary detail path;
- corroborated bundles may still synthesize normally even when one or more member sources are video/watch pages.

`created_at` contract:
- `created_at` is the initial publish timestamp for a `story_id`; when the earliest source publish time is available it should seed this value, otherwise the initial cluster publish time may seed it; it MUST remain immutable after initial publish.

Public story-node storage contract:
- Product code continues to consume the `StoryBundle` DTO above.
- New writes to `vh/news/stories/<storyId>` MUST store the bundle inside the
  node's `__story_bundle_json` field and MUST carry `_protocolVersion:
  'luma-public-v1'`, `_writerKind: 'system'`, `_systemWriterId`,
  `_systemIssuedAt`, and `_systemSignature`.
- `_systemSignature` uses `jcs-ed25519-sha256-v1` over
  JCS-canonical(node minus `_systemSignature`) and MUST validate through the
  shared system-writer validator in `packages/gun-client/src/systemWriter.ts`.
- The signed story node MUST NOT carry `_authorScheme` or
  `SignedWriteEnvelope`; story bundles are system-published, not user-authored.
- Legacy bare `story-bundle-v0` nodes remain read-compatible. A node carrying
  `_writerKind: 'system'` but failing system-writer validation is rejected and
  MUST NOT route through the legacy reader.
- Latest/hot index entries under `vh/news/index/latest/<storyId>` and
  `vh/news/index/hot/<storyId>` migrate through their own M0.B index-entry
  contract below. They are written after the story node by `writeNewsBundle`.
- Public latest-index readers MUST NOT expose an index entry as feed-visible
  until the corresponding `vh/news/stories/<storyId>` body route is readable.
  If an index entry is discovered without a readable body, the relay/origin
  read path must either repair the index record from the readable story body or
  suppress the row and record a bounded repair/tombstone reason. A missing
  story body outside that explicit repair window is a public-beta release gate
  failure, not a normal empty-feed state.
- Relay/origin latest-index consistency repair MUST also synthesize a
  product-metadata-complete response row from the readable story body when the
  stored latest row is a legacy scalar/object or carries stale/mismatched
  `vh-news-product-feed-index-v1` metadata. The repair reason must be explicit;
  daemon reconciliation remains responsible for durable mesh rewrite.
- Feed hydration must parse signed system-writer index records with the same
  acceptance semantics as the shared Gun client adapter. Direct subscriptions
  and relay REST fallback must agree on `story_id` and `latest_activity_at`
  before the Web PWA tries to hydrate a story card.
- Product visibility is a downstream state of a readable, eligible story body
  and source-set admission. It MUST NOT require accepted synthesis. Eligible
  singleton stories and corroborated multi-source bundles both remain valid
  feed rows while synthesis is pending, retrying, terminally unavailable, or
  suppressed by correction. Relay/latest-index responses MUST expose the public
  synthesis lifecycle and frame-table state rather than silently filtering rows.
- The daemon MUST reconcile durable raw stories back into product feed indexes
  after acquiring the ingestion lease. If an eligible `vh/news/stories/<storyId>`
  body exists but latest index rows are missing/stale or hot index rows are
  missing/legacy metadata-only-insufficient, the daemon rewrites those product
  rows with system-writer readback. Missing lifecycle records are initialized to
  `pending`; lifecycle records for an unchanged `source_set_revision` are
  preserved.

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

Analysis frame/reframe output contract:
- generated article and bundle analyses must emit non-empty frame/reframe rows for every eligible analysis artifact;
- bias arrays may use the explicit `No clear bias detected` / `N/A` fallback when the article is straight reporting, but frame/reframe rows must not use those placeholders;
- when explicit outlet bias is sparse, frame/reframe rows must be inferred as terse debate-style issue-side claims and counterclaims grounded in the story subject: public opinion splits, political divides, stakeholder tradeoffs, legal/institutional tensions, cost/risk disputes, rights/safety debates, or accountability arguments;
- frame/reframe rows are issue-side claims, not publication-by-publication summaries, and should not prefix publisher names unless the publisher itself is materially part of the dispute.
- publish-time bundle synthesis must analyze extracted full text for each readable canonical primary source before producing accepted `TopicSynthesisV2`; headline/source metadata alone is not a sufficient synthesis basis for eligible text stories.
- per-source generated analyses must persist key facts, direct quote evidence, and bias-claim justifications on the hidden candidate/audit record. The public story card renders the accepted `facts_summary` plus frame/reframe rows by default and must not expose quote justifications unless an explicit audit/operator surface asks for them.
- accepted `facts_summary` must be derived from merged per-source key facts. Source framing, blame, advocacy, and interpretation belong in frame/reframe rows rather than in the facts summary.

## 5. Mesh/storage paths

- `vh/news/stories/<storyId>`
- `vh/news/index/latest/<storyId>`
- `vh/news/index/hot/<storyId>`
- `vh/news/storylines/<storylineId>`
- optional: `vh/news/source/<sourceId>/<itemId>` for debug snapshots
- analysis artifacts: `vh/news/stories/<storyId>/analysis/<analysisKey>`
- latest analysis pointer: `vh/news/stories/<storyId>/analysis_latest`
- synthesis lifecycle latest record: `vh/news/stories/<storyId>/synthesis_lifecycle/latest`

Storyline publication contract:

1. `StorylineGroup` objects may be published alongside canonical `StoryBundle`s;
2. storyline groups are separate related-coverage artifacts and must not widen `StoryBundle.sources`;
3. canonical source basis remains the `StoryBundle` event-bundle projection.

Public storyline-node storage contract:
- Product code continues to consume the `StorylineGroup` DTO above.
- New writes to `vh/news/storylines/<storylineId>` MUST store the storyline
  group inside the node's `__storyline_group_json` field and MUST carry
  `_protocolVersion: 'luma-public-v1'`, `_writerKind: 'system'`,
  `_systemWriterId`, `_systemIssuedAt`, and `_systemSignature`.
- `_systemSignature` uses `jcs-ed25519-sha256-v1` over
  JCS-canonical(node minus `_systemSignature`) and MUST validate through the
  shared system-writer validator in `packages/gun-client/src/systemWriter.ts`.
- The signed storyline node MUST NOT carry `_authorScheme` or
  `SignedWriteEnvelope`; storyline groups are system-published, not
  user-authored.
- Legacy bare `storyline-group-v0` nodes remain read-compatible. A node
  carrying `_writerKind: 'system'` but failing system-writer validation is
  rejected and MUST NOT route through the legacy reader.
- The `vh/news/storylines/` root map and removal tombstones are not part of
  this M0.B storyline-node migration and do not gain system-writer metadata in
  this slice.

### 5.1 Latest-index migration contract (PR0 freeze)

Canonical target semantics for `vh/news/index/latest/<storyId>` are **latest activity** timestamps.

- Target write shape: system-writer signed child node with `story_id`,
  `latest_activity_at` (activity, aligned with `cluster_window_end`), and when
  the publishing path has the `StoryBundle`, product feed metadata:
  `product_state_schema_version: 'vh-news-product-feed-index-v1'`, `topic_id`,
  `source_set_revision`, `source_count`, `canonical_source_count`,
  `story_created_at`, and `cluster_window_start`.
- Transitional read compatibility (must be supported):
  - scalar timestamp string/number
  - object payloads carrying `cluster_window_end` or `latest_activity_at`
  - legacy object payloads carrying `created_at`
  - explicit `_writerKind: 'legacy'` entries when they carry no downgraded
    system/user-author fields
- Canonical mixed-object precedence (when multiple keys are present):
  1. `cluster_window_end`
  2. `latest_activity_at`
  3. `created_at`
- Migration discipline: readers validate `_writerKind: 'system'` entries with
  the shared system-writer validator and fail closed on invalid system-marked
  entries rather than downgrading them through the legacy parser.

Public latest/hot index-entry storage contract:
- Product code continues to consume `Record<string, number>` DTOs from
  `readNewsLatestIndex` and `readNewsHotIndex`.
- Relay REST reads of `vh/news/index/latest` MUST support bounded older windows
  using an exclusive `before=<latest_activity_at>` cursor. Web PWA load-more
  must use this cursor/window path and merge the returned older rows into the
  existing feed state rather than relying only on a larger initial top-N window.
  The initial public latest refresh should be bounded to the visible feed page
  size; revealing rows from a larger in-memory first window is not sufficient
  scroll/load-more evidence.
- New writes to `vh/news/index/latest/<storyId>` MUST store an object carrying
  `story_id`, `latest_activity_at`, `_protocolVersion: 'luma-public-v1'`,
  `_writerKind: 'system'`, `_systemWriterId`, `_systemIssuedAt`, and
  `_systemSignature`. Story publication and accepted-synthesis republish paths
  MUST include the product feed metadata above so public readers and release
  gates can audit singleton versus multi-source composition without relying on
  in-memory daemon state. When a write includes `StoryBundle` metadata, durable
  write readback must verify the metadata fields as well as the timestamp; a
  timestamp-only readback does not prove product feed row persistence. Older
  minimal signed latest entries remain read-compatible but are insufficient as
  new publication output.
- New writes to `vh/news/index/hot/<storyId>` MUST store an object carrying
  `story_id`, `hotness`, `_protocolVersion: 'luma-public-v1'`,
  `_writerKind: 'system'`, `_systemWriterId`, `_systemIssuedAt`, and
  `_systemSignature`. When the writer has the `StoryBundle`, hot index writes
  MUST include the same product feed metadata as latest index writes and
  readback-confirm those metadata fields. Scalar hotness readback remains
  transitional-reader compatible but is not sufficient proof for new
  story-backed product hot rows.
- `_systemSignature` uses `jcs-ed25519-sha256-v1` over
  JCS-canonical(node minus `_systemSignature`) and MUST validate through the
  shared system-writer validator in `packages/gun-client/src/systemWriter.ts`.
- Signed latest/hot index entries MUST NOT carry `_authorScheme` or
  `SignedWriteEnvelope`; they are system-published, not user-authored.
- Legacy scalar, string, object, and explicit legacy-marked entries remain
  read-compatible. Entries carrying `_writerKind: 'system'` but failing
  system-writer validation are rejected and MUST NOT route through the legacy
  reader.
- The `vh/news/index/latest/` and `vh/news/index/hot/` root maps plus removal
  tombstones are not part of this M0.B index-entry migration and do not gain
  system-writer metadata in this slice.

### 5.2 Analysis migration contract (PR0 freeze)

Canonical target semantics for story analysis persistence remain unchanged:
analysis artifacts are keyed by the tuple `story_id`, `provenance_hash`,
`pipeline_version`, `model_scope`, and `schema_version`, and the latest pointer
identifies the latest compatible `analysisKey` for a story.

Public analysis storage contract:
- Product code continues to consume `StoryAnalysisArtifact` DTOs from
  `readAnalysis`, `readLatestAnalysis`, and `listAnalyses`.
- New writes to `vh/news/stories/<storyId>/analysis/<analysisKey>` MUST store
  the existing encoded artifact wrapper and MUST carry `_protocolVersion:
  'luma-public-v1'`, `_writerKind: 'system'`, `_systemWriterId`,
  `_systemIssuedAt`, and `_systemSignature`.
- New writes to `vh/news/stories/<storyId>/analysis_latest` MUST store an
  object carrying the latest-pointer fields plus `story_id`,
  `_protocolVersion: 'luma-public-v1'`, `_writerKind: 'system'`,
  `_systemWriterId`, `_systemIssuedAt`, and `_systemSignature`.
- `_systemSignature` uses `jcs-ed25519-sha256-v1` over
  JCS-canonical(node minus `_systemSignature`) and MUST validate through the
  shared system-writer validator in `packages/gun-client/src/systemWriter.ts`.
- Signed analysis artifacts and latest pointers MUST NOT carry `_authorScheme`
  or `SignedWriteEnvelope`; generated analysis is system-published, not
  user-authored.
- Legacy bare and explicit safe legacy-marked analysis artifacts/pointers
  remain read-compatible. Records carrying `_writerKind: 'system'` but failing
  system-writer validation are rejected and MUST NOT route through the legacy
  reader. Records carrying protected system/user fields under `_writerKind:
  'legacy'` are rejected as downgrade attempts.
- A system-marked `analysis_latest` record that fails validation blocks list
  fallback for that read. Legacy missing or malformed latest pointers may still
  fall back to `listAnalyses`.
- The `vh/news/stories/<storyId>/analysis/` root map, `analysis_pending`, and
  removal tombstones are not part of this M0.B analysis-node migration and do
  not gain system-writer metadata in this slice.

### 5.3 Synthesis lifecycle contract

Accepted synthesis is a downstream state of a published story/source-set
revision. Raw story publication and product feed visibility MUST NOT depend on
accepted synthesis.

Public lifecycle storage contract:
- New writes to `vh/news/stories/<storyId>/synthesis_lifecycle/latest` MUST
  store an object carrying `schemaVersion: 'vh-news-synthesis-lifecycle-v1'`,
  `story_id`, `topic_id`, `source_set_revision`, `status`,
  `frame_table_state`, `retryable`, optional `reason`, optional `synthesis_id`,
  optional `epoch`, `updated_at`, `_protocolVersion: 'luma-public-v1'`,
  `_writerKind: 'system'`, `_systemWriterId`, `_systemIssuedAt`, and
  `_systemSignature`.
- Relay/origin daemon write surfaces MAY accept the same lifecycle record at
  `POST /vh/news/synthesis-lifecycle` and MUST durably write/readback-confirm it
  to `vh/news/stories/<storyId>/synthesis_lifecycle/latest` without adding user
  identity, token, or private author fields.
- `status` is one of `pending`, `in_progress`, `accepted_available`,
  `retryable_failure`, `terminal_unavailable`, or `suppressed`.
- `frame_table_state` is one of `frame_table_pending`, `frame_table_ready`, or
  `frame_table_unavailable`.
- `source_set_revision` is the StoryBundle provenance/source-set revision. If
  a singleton story gains corroborating sources, the existing `story_id`
  remains stable, `source_set_revision` advances, and synthesis lifecycle
  returns to `pending`/`in_progress` until the revised source set reaches an
  accepted or terminal state.
- Republishing the same story/source-set revision MUST preserve the existing
  lifecycle record. Routine daemon refreshes MUST NOT downgrade
  `accepted_available`, `terminal_unavailable`, `suppressed`,
  `retryable_failure`, or `in_progress` back to `pending` unless
  `source_set_revision` has changed.
- `accepted_available` means accepted `TopicSynthesisV2` exists for the
  current story/source-set revision. `frame_table_ready` additionally requires a
  non-empty facts summary, non-empty frames, and persisted `frame_point_id` and
  `reframe_point_id` for every visible row.
- Public relay and app readers MUST NOT treat a topic latest synthesis as
  accepted for a visible story unless the story's latest lifecycle record is
  `accepted_available`, its `source_set_revision` equals the current
  `StoryBundle.provenance_hash`, its `synthesis_id`/`epoch` match the accepted
  `TopicSynthesisV2`, and the synthesis inputs include the current
  `story_id`. If a singleton grows into a bundle and lifecycle returns to
  `pending`/`in_progress`, any older topic latest synthesis remains non-votable
  historical data until the new source-set revision reaches accepted or
  terminal state.
- Public relay readers SHOULD reread lifecycle scalar fields before declaring
  an accepted topic synthesis stale when the parent lifecycle object appears
  older than the current accepted synthesis; the accepted-state rule above still
  applies to the reread record.
- `terminal_unavailable` is product-visible and must carry an auditable reason.
  It is not a silent feed filter. `retryable_failure` is also product-visible
  and must not enable point-stance controls.
- Signed lifecycle records MUST NOT carry `_authorScheme`,
  `SignedWriteEnvelope`, identity fields, tokens, private proof material, or
  local vote-intent fields.

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
