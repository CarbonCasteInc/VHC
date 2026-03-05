# StoryCluster Integration Execution Plan (Refined)

Status: Final Draft for Engineering Handoff  
Owner: Core Engineering  
Last Updated: 2026-03-04  
Branch Baseline: `main` @ `37ca998`

## 1. Purpose

This plan defines the production-path integration of StoryCluster into VHC without mid-flight re-architecture.

Primary goals:

1. Fix feed correctness and stability first (identity, ordering, single-writer behavior).
2. Introduce StoryCluster behind a clean engine contract.
3. Move ingestion authority to a daemonized writer.
4. Deliver deterministic, explainable `Latest` and `Hot` ranking with narrative diversification.

## 2. Canonical Invariants (Must Hold)

1. Unified feed has two distinct headline surfaces: `NEWS_STORY` and `USER_TOPIC`.
2. Topic/thread semantics are preserved:
   - user-thread topic IDs remain deterministic and thread-derived (`sha256("thread:" + threadId)`).
   - news story topic IDs are story-derived and stable.
3. News publication contract remains `StoryBundle`-first.
4. `Latest` ordering must use latest activity, not first-seen timestamp.
5. `created_at` for a story is immutable after first publish.
6. Ingestion writes are single-writer at runtime (lease-enforced).
7. API relay remains default analysis path until local-agent capability thresholds are met.
8. Full analysis and bias-table generation must run as asynchronous enrichment and must not block StoryBundle publication, indexing, or headline renderability.

## 3. Current State of Play (Validated Against Code)

The following are true at baseline and directly inform sequencing:

1. `created_at` is currently regenerated in both clustering paths.
2. Latest index currently behaves as `created_at` index, not activity index.
3. No single-writer lease exists in runtime write path.
4. Feed/news card identity still depends on volatile fields (`created_at`, title), contributing to remount risk.
5. There are two clustering stacks (`services/news-aggregator` and `packages/ai-engine`) that must be unified behind one interface.
6. `BiasTable` is already always-on in current production wiring.
7. Default analysis model is `gpt-5-nano`; override UI can still change model.

## 4. Target Architecture (VHC-Correct)

Components and responsibilities:

1. StoryCluster Engine (new service): authoritative clustering intelligence.
2. News Aggregator Daemon (canonical writer): ingest/normalize/extract -> cluster engine -> publish StoryBundles and indexes.
3. Web PWA (consumer-first): hydrate/read/render unified feed; no default ingestion authority.
4. Gun adapters/topology: authoritative mesh path contracts for stories and ranking indexes.

## 5. Identity and Linking Contracts

### 5.1 Story identity

1. `story_id`: stable event cluster ID (authoritative).
2. `created_at`: first-seen timestamp for that `story_id` (immutable).
3. `cluster_window_end`: latest activity timestamp for that story (moves forward).

### 5.2 Topic identity

1. User threads: unchanged thread-derived topic ID.
2. News stories: `topic_id = sha256Hex("news:" + story_id)`.
3. Storyline identity is separate from `topic_id`; it remains a feature, not a replacement.

## 6. Mesh Publication Contract

### 6.1 Required

1. `vh/news/stories/<story_id>` -> canonical `StoryBundle`.
2. `vh/news/index/latest/<story_id>` -> `cluster_window_end` (activity index).
3. `vh/news/index/hot/<story_id>` -> deterministic hotness score.

### 6.2 Optional enrichment artifacts

Keep StoryBundle lean; publish deep analysis as separate artifacts keyed by `story_id`.

### 6.3 Async enrichment lane (required behavior)

1. StoryBundle publication path is the blocking lane and must remain independent of LLM enrichment latency/failure.
2. Full analysis + bias-table artifacts are generated in a background lane after StoryBundle publish.
3. Precompute policy (minimum required):
   - all newly published stories.
   - stories whose source set changed materially.
   - a rolling top window (`Latest`/`Hot`) for fast card-open UX.
4. Enrichment execution contract:
   - queue-based scheduling with bounded concurrency.
   - retry with backoff and dead-letter capture for persistent failures.
   - explicit daily/per-topic budget controls.
5. Enrichment identity contract:
   - stable analysis identity per story context.
   - stable point IDs for unchanged semantic points across refreshes.
   - alias/migration behavior when regenerated output changes wording but not point semantics.

## 7. Ranking Design

### 7.1 Modes

1. `Latest`: sorted by `cluster_window_end` descending.
2. `Hot`: deterministic score from coverage, velocity, diversity, confidence, and optional impact signals.
3. `Top` (optional later): long-horizon importance.

### 7.2 Deterministic hotness contract

Use a config-versioned function in writer path and make it reproducible in client diagnostics.

### 7.3 Diversification

Post-sort diversification for top-N:

1. storyline cap per top window.
2. adjacent entity-overlap penalty.

## 8. Delivery Sequencing (No Mid-Flight Re-architecture)

## PR0 (Contract Freeze and Test Harness Alignment)

Goal: lock interfaces before behavior changes.

1. Freeze `StoryBundle` and discovery identity contracts for NEWS_STORY.
2. Add implementation notes for latest-index migration shape.
   - Notes: `docs/plans/STORYCLUSTER_PR0_CONTRACT_FREEZE_NOTES.md`
3. Add migration test fixtures for old index payloads.

Exit criteria:

1. Contract tests pass with both legacy and target latest-index reads.
2. Team has final approved API/adapter signatures for PR1.

## PR1 (Feed Correctness Hardening - Must Ship First)

Goal: eliminate instability and ordering drift.

Scope:

1. Add NEWS_STORY identity field to discovery pipeline (`story_id`) and propagate end-to-end.
2. Freeze `created_at` semantics (first-write-wins by `story_id`).
3. Switch latest-index semantics to activity (`cluster_window_end`) with legacy read fallback.
4. Introduce and enforce single-writer lease for ingestion writers.
5. Re-key feed and card identity to stable story identity, not `created_at`.

Acceptance criteria:

1. Re-ingest same evolving story: `created_at` unchanged, `cluster_window_end` advances.
2. Latest sort follows activity updates.
3. Two ingesters started concurrently -> one lease holder writes.
4. Open cards do not remount from timestamp churn.

## PR2 (ClusterEngine Abstraction + Dual-Stack Unification)

Goal: remove duplicate clustering behavior paths.

1. Add `ClusterEngine` interface:
   - `clusterBatch(normalizedItems) -> { bundles, features, indexes }`.
2. Implement:
   - `HeuristicClusterEngine` (current behavior).
   - `StoryClusterRemoteEngine` (HTTP client).
   - `AutoEngine` (remote preferred, heuristic fallback).
3. Route runtime and service orchestration through this single interface.

Acceptance criteria:

1. Remote down -> deterministic fallback works.
2. No duplicated clustering logic path remains active in production path.

## PR3 (Aggregator Daemon Becomes Canonical Writer)

Goal: move default ingest authority out of browser runtime.

1. Add daemon entrypoint in `services/news-aggregator` for scheduled ingest+publish.
2. Daemon acquires lease before writes.
3. Browser defaults to consumer mode for normal runs; explicit dev override remains for local testing only.
4. Add daemon-managed async enrichment queue wiring (non-blocking from publish path).

Acceptance criteria:

1. PWA shows live headlines without browser ingest authority.
2. Daemon continuously updates StoryBundles and indexes.
3. StoryBundle + index publish latency is not coupled to enrichment completion.

## PR4 (StoryCluster Engine Service - Phase 1)

Goal: deploy stable clustering quality improvements quickly.

Implement first-phase StoryCluster capabilities:

1. language detect + selective translation gate.
2. near-dup collapse (text + image where available).
3. embeddings + retrieval + hybrid assignment.
4. stable incremental cluster assignment.
5. canonical 2-3 sentence summary generation.
6. emit coverage/velocity/confidence features.
7. emit enrichment work items for full analysis/bias-table generation without blocking cluster publish.

Acceptance criteria:

1. stable `story_id` across updates.
2. duplicate collapse improves source grouping quality.
3. generated summaries populate `summary_hint` reliably.
4. enrichment failures/timeouts do not block story publication or ordering updates.

## PR5 (SOTA Sorting: Hot Index + Diversification)

Goal: make hot feed behavior production-grade and editorially coherent.

1. Publish `vh/news/index/hot/<story_id>`.
2. Compute deterministic hotness in writer path.
3. Apply deterministic diversification in feed rendering.

Acceptance criteria:

1. Hot feed stable across refreshes.
2. breaking stories rise quickly and decay predictably.
3. top window is not monopolized by one storyline.

## PR6+ (Advanced Pipeline Completion)

Roll in deeper StoryCluster features incrementally:

1. ME tuple extraction + entity linking + temporal normalization.
2. rerank/adjudication gates.
3. GDELT grounding and impact blending.
4. periodic cluster refinement and drift metrics.
5. timeline/sub-event graph outputs.

## 9. PR1 Detailed File Scope (Immediate Team Start)

Required implementation touchpoints (initial target list):

1. `packages/data-model/src/schemas/hermes/discovery.ts`
2. `apps/web-pwa/src/store/feedBridge.ts`
3. `apps/web-pwa/src/store/discovery/index.ts`
4. `apps/web-pwa/src/components/feed/FeedShell.tsx`
5. `apps/web-pwa/src/components/feed/NewsCard.tsx`
6. `packages/gun-client/src/newsAdapters.ts`
7. `apps/web-pwa/src/store/news/index.ts`
8. `apps/web-pwa/src/store/news/hydration.ts`
9. `apps/web-pwa/src/store/newsRuntimeBootstrap.ts`
10. `packages/gun-client/src/topology.ts`

Note: update tests in the same PR for any changed contract behavior.

## 10. Test and Benchmark Gates

### 10.1 Unit gates

1. `created_at` immutability.
2. latest index writes/reads use activity semantics.
3. lease acquisition/renewal/expiry behavior.
4. topic derivation non-collision (`thread:` vs `news:` prefixes).
5. hotness determinism and monotonic sanity expectations.

### 10.2 Integration gates

1. local stack: Gun + daemon + (optional) StoryCluster + web app.
2. stable story IDs across multiple ticks.
3. source list growth on same story without identity churn.
4. hot index updates observed and consumed.
5. UI `Latest` vs `Hot` behavioral differentiation.

### 10.3 E2E strict lane

1. keep existing strict preflight hardening.
2. add assertions for feed-empty recovery + stable identity behavior.
3. ensure setup failures are classified as harness failures, not convergence failures.

### 10.4 Enrichment lane gates

1. Card-open on top-window stories resolves precomputed analysis in expected latency budget when artifacts exist.
2. Missing/pending enrichment falls back gracefully without blocking interaction.
3. StoryBundle publish SLO is unchanged under simulated enrichment provider failures.
4. Vote context stability tests pass across enrichment refresh cycles (no point-ID churn regressions).

## 11. Migration and Compatibility Rules

1. Latest-index readers must accept legacy `{created_at: ...}` entries during migration.
2. Writers must emit only target activity value after PR1 cutover.
3. Discovery/store code must preserve behavior when old stories lacking new fields are present.
4. Old shared-topic story artifacts are tolerated read-time but new writes must follow story-derived topic IDs once cutover is enabled.

## 12. Risks and Controls

1. Risk: mixed old/new identity keys cause duplicate cards.
   - Control: explicit dual-read + canonical-write migration window and dedupe tests.
2. Risk: lease starvation or stale holder lock.
   - Control: heartbeat + TTL + failover test.
3. Risk: hot ranking oscillation from noisy features.
   - Control: config-versioned weights + bounded update cadence.
4. Risk: daemon/browser dual-writer during rollout.
   - Control: lease enforced in both paths with browser defaulting to consumer mode.

## 13. Handoff Checklist for Dev Team

1. Start with PR0 contract updates and tests.
2. Execute PR1 exactly before any StoryCluster service integration.
3. Do not introduce new ranking/index paths before latest-index migration lands.
4. Do not change thread/topic canonical derivation for user topics.
5. Keep relay-default analysis behavior intact during all phases.
6. Maintain strict e2e artifacts and setup-vs-convergence classification integrity.

## 14. Definition of Done (Program-Level)

1. Headlines stable and lazily loaded with deterministic ordering.
2. Pull-to-refresh and pagination behavior are stable and non-destructive.
3. Story analyses persist and are reusable across sessions/users.
4. Bias-table vote semantics remain strict tri-state and converge across users.
5. Story identity and topic identity are deterministic and collision-safe.
6. Single-writer ingestion authority enforced at runtime.
7. `Latest` and `Hot` semantics match spec and are reproducible.
8. Analysis/bias-table enrichment is precomputed opportunistically but never blocks headline publication, ordering, or card usability.

## 15. State of Play (Validated 2026-03-05)

This section supersedes assumptions in Section 3 where code has diverged.

### 15.1 What is currently true in code

1. The canonical daemon path still runs the ai-engine heuristic clustering runtime path by default.
2. Remote StoryCluster is optional and only used when explicitly configured via orchestrator options; it is not the enforced default execution path.
3. Heuristic clustering and same-event grouping are still active in production wiring (`storycluster-heuristic-engine`, token/entity overlap gates, heuristic action/location scoring).
4. Language detection and translation are lightweight lexical heuristics, not the specified FastText + NLLB/SeaLLM pipeline.
5. Embedding/similarity in clustering is lightweight local hashing math, not Matryoshka dimensions with ANN retrieval.
6. Story topic assignment in active clustering path is still mapping-driven (`defaultTopicId`/`sourceTopics`) rather than strictly derived from stable story identity.
7. The dedicated `services/storycluster-engine/` production service is not present in the repository state.

### 15.2 Why the original goal is not yet met

1. The SOTA pipeline is not the mandatory execution path; heuristic code remains the active path.
2. Fallback behavior still exists in engine resolution (`AutoEngine` remote -> heuristic), which violates no-fallback production intent.
3. Clustering quality and event coherence are constrained by heuristic merge logic, creating false merges/splits under real feeds.

### 15.3 Hard conclusion

Current system is improved and testable, but it is not yet the full StoryCluster end-to-end SOTA pipeline described in the research spec. Further implementation work is mandatory before claiming full completion.

## 16. Next Actionable Steps (No-Fallback Implementation Track)

This is the execution sequence the dev team should run now. It is strict and production-path only.

### 16.1 Non-negotiable guardrails

1. No heuristic fallback in production path.
2. No dual cluster authority in production path.
3. No "best effort" downgrade when StoryCluster is unavailable; fail closed with explicit operational error.
4. Analysis relay path remains default for card analysis generation until local-agent thresholds are explicitly met.

### 16.2 Sprint A: Enforce single authoritative clustering path

1. Remove `AutoEngine` fallback behavior from production runtime wiring.
2. Require remote StoryCluster endpoint for daemon startup in production mode.
3. Keep heuristic engine only for isolated test fixtures and explicit local debug mode (not default, not production flag path).
4. Add startup hard-fail checks:
   - StoryCluster endpoint reachable.
   - required auth/config present.
   - health endpoint green before ingestion starts.

Acceptance criteria:

1. Daemon refuses to run ingestion when StoryCluster is unavailable.
2. No published StoryBundle can originate from heuristic engine in production mode.
3. CI includes a test asserting production config rejects fallback.

### 16.3 Sprint B: Implement mandatory 3.2 pipeline stages in StoryCluster service

Implement these as required stages in the service, in order:

1. Language detection + selective translation (FastText gate + model translation path).
2. Near-duplicate collapse (MinHash + pHash fusion with explicit thresholds).
3. Document-type classification and centroid weighting.
4. Matryoshka embedding generation (192/384/768 outputs).
5. ME tuple extraction + NER/entity linking + temporal normalization.
6. Qdrant candidate retrieval with geo/time/entity pre-filters.
7. Hybrid scoring with learned weights contract.
8. Cross-encoder reranking gate.
9. LLM adjudication gate (<5% ambiguity lane).
10. Dynamic cluster assignment and centroid updates.
11. Cluster summarization and artifact publication payloads.

Acceptance criteria:

1. Service emits deterministic bundle outputs for fixed fixtures.
2. Service exposes per-stage telemetry (input counts, gate pass rates, latency).
3. Service contract tests validate all mandatory stage artifacts are present.

### 16.4 Sprint C: Correct identity semantics and topic derivation

1. Enforce `story_id` stability from StoryCluster output.
2. Enforce `topic_id = sha256Hex("news:" + story_id)` for news stories.
3. Preserve user-thread topic derivation unchanged.
4. Ensure `created_at` first-write-wins and immutable by `story_id`.

Acceptance criteria:

1. Re-ingest of evolving story keeps same `story_id` and `topic_id`.
2. `created_at` remains unchanged while `cluster_window_end` advances.
3. Collision tests pass across `thread:` and `news:` domains.

### 16.5 Sprint D: Publish complete ranking inputs and deterministic indexes

1. Publish required cluster features for hotness computation.
2. Publish `latest` index from `cluster_window_end`.
3. Publish `hot` index from deterministic writer-side function (versioned config).
4. Keep client diversification deterministic and reproducible.

Acceptance criteria:

1. Hot/Latest order stable across refresh for same underlying data snapshot.
2. Ranking reproducibility test passes with fixed clock + fixtures.
3. Storyline over-concentration constraints hold in top window.

### 16.6 Sprint E: Production wiring and CI enforcement

1. Add CI gates that fail if heuristic engine is reachable in production configuration.
2. Add integration tests that run daemon + StoryCluster + Gun and assert:
   - multi-source same-event coherence;
   - no cross-event false merges on curated fixtures;
   - stable identity under repeated ticks.
3. Add operational SLO alarms for:
   - cluster service health;
   - publish latency;
   - merge quality regressions (fragmentation/contamination metrics).

Acceptance criteria:

1. CI has explicit no-fallback contract checks.
2. Strict matrix includes story coherence checks, not only availability checks.
3. Merge to main is blocked on these gates.

### 16.7 Final release gate (before claiming full completion)

All items below must be true simultaneously:

1. Production ingestion path uses StoryCluster only.
2. All mandatory 3.2 stages are implemented and telemetry-verified.
3. Story bundles show high same-event coherence on live and fixture audits.
4. Latest/Hot ranking semantics match spec under deterministic replay.
5. Analysis and bias-table persistence/vote convergence behavior remains intact under this wiring.
