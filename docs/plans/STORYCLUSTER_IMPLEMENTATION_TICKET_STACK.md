# StoryCluster Implementation Ticket Stack

Status: Canonical ticket stack
Owner: Core Engineering
Last Updated: 2026-03-08
Parent Plan: `/Users/bldt/Desktop/VHC/VHC/docs/plans/STORYCLUSTER_INTEGRATION_EXECUTION_PLAN.md`
Branch Baseline: `coord/storycluster-takeover`

## 1. Usage

This document turns the canonical StoryCluster execution plan into PR-sized work packages.

Rules:

1. land in order unless a later ticket explicitly says it is parallel-safe;
2. every ticket must preserve production fail-closed StoryCluster wiring;
3. every ticket must carry its own tests and evidence;
4. no ticket may introduce heuristic production fallback;
5. no ticket may weaken `story_id`, `topic_id`, `created_at`, `cluster_window_end`, analysis persistence, or vote convergence behavior.

## 2. Global Acceptance Rules

Every PR in this stack must:

1. keep changed executable files under `350` LOC;
2. keep changed executable files at `100%` coverage;
3. pass local package tests for touched areas;
4. attach an evidence note with:
   - commands run;
   - test results;
   - any benchmark deltas;
   - any live or replay artifacts added.

## 3. Ticket Stack

## SC-00: Benchmark Corpus and Ontology Freeze

Goal:

1. lock the canonical pair ontology and the benchmark corpus before more engine refactors.

Scope:

1. define the canonical labels in code and docs:
   - `duplicate`
   - `same_incident`
   - `same_developing_episode`
   - `related_topic_only`
   - `commentary_on_event`
   - `unrelated`
2. create a benchmark fixture suite covering:
   - same-event cross-publisher positives;
   - same-topic different-event negatives;
   - roundup versus incident negatives;
   - liveblog versus incident negatives;
   - opinion/explainer contamination negatives;
   - same-publisher article/video duplicate cases;
   - multilingual same-event positives;
   - evolving follow-up replay ticks;
   - verified live false merge cases;
   - verified live true-positive cases.
3. add the verified Iran roundup/drone-strike false merge as a permanent regression fixture.
4. add the Jan. 6 plaque true-positive case as a permanent regression fixture.

Likely files:

1. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/coherenceAudit.ts`
2. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/storyclusterQualityGate.test.ts`
3. new corpus files under `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/`
4. evidence references under `/Users/bldt/Desktop/VHC/VHC/docs/reports/evidence/storycluster/`

Acceptance:

1. benchmark corpus exists and is versioned;
2. ontology labels are referenced in tests and audit outputs;
3. CI can fail on false-merge regression using this corpus.

Dependencies:

1. none

## SC-01: Document-Type Authority and Seeding Rules

Goal:

1. make document type authoritative for whether a document may seed a canonical event bundle.

Scope:

1. implement or harden the document-type classifier with classes:
   - `wire`
   - `hard_news`
   - `breaking_update`
   - `liveblog`
   - `roundup`
   - `explainer`
   - `analysis`
   - `opinion`
   - `video_clip`
2. enforce seeding rules:
   - only `wire`, `hard_news`, `breaking_update` may seed `EventCluster`
3. enforce attachment rules:
   - `video_clip` may attach only as secondary asset
   - `roundup`, `explainer`, `analysis`, `opinion`, `liveblog` may attach only as related coverage
4. emit telemetry for document-type distribution and seed rejections.

Likely files:

1. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/stageHandlers.ts`
2. new `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/documentTypeClassifier.ts`
3. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/clusterLifecycle.ts`
4. classifier tests and coherence tests

Acceptance:

1. non-seeding classes cannot create canonical event bundles;
2. benchmark traps for roundups/opinion/liveblogs stop creating canonical event clusters;
3. same-publisher video assets no longer count as distinct canonical corroboration.

Dependencies:

1. SC-00

## SC-02: Duplicate Detection and Source Model Split

Goal:

1. split canonical primary sources from same-publisher secondary assets.

Scope:

1. implement duplicate detection before cluster assignment;
2. group same-publisher article/video/alt-URL/live-page variants;
3. project canonical `primary_sources`;
4. project `secondary_assets`;
5. ensure `StoryBundle.sources` contains one canonical source per publisher only.

Likely files:

1. new `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/duplicateDetector.ts`
2. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/bundleProjection.ts`
3. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/contracts.ts`
4. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/remoteContract.ts`

Acceptance:

1. same-publisher duplicates collapse before canonical bundle projection;
2. `StoryBundle.sources` is publisher-normalized;
3. duplicate-detection tests and replay cases pass.

Dependencies:

1. SC-00
2. SC-01

## SC-03: Event-Frame Extraction

Goal:

1. make event structure a first-class signal.

Scope:

1. extract per-document event frame fields:
   - trigger
   - actors
   - actor roles
   - target/object
   - location
   - normalized time
   - event type
   - optional magnitude fields
2. persist extracted frames in StoryCluster internal state;
3. expose frame-derived telemetry and artifact fields for audits.

Likely files:

1. new `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/eventFrameExtractor.ts`
2. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/stageHandlers.ts`
3. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/stageDocumentHelpers.ts`

Acceptance:

1. benchmark corpus docs produce stable event-frame outputs where applicable;
2. event frames are available to retrieval and scoring layers;
3. extraction tests cover actor, location, time, and trigger normalization behavior.

Dependencies:

1. SC-00

## SC-04: Candidate Retrieval Rewrite

Goal:

1. make retrieval event-aware instead of topic-loose.

Scope:

1. keep Qdrant ANN retrieval;
2. add symbolic prefilters:
   - time window
   - event-type compatibility
   - actor overlap where available
   - location compatibility where available
3. prevent candidates from entering pair scoring solely due to broad topic overlap.

Likely files:

1. new `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/candidateRetriever.ts`
2. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/vectorBackend.ts`
3. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/clusterLifecycle.ts`

Acceptance:

1. same-topic different-event traps are filtered down before final scoring;
2. retrieval telemetry shows prefilter hits and retained candidates;
3. benchmark false-merge rate improves versus baseline.

Dependencies:

1. SC-00
2. SC-03

## SC-05: Pair Scorer and Canonical Decision Policy

Goal:

1. score event sameness, not generic semantic relatedness.

Scope:

1. implement hybrid pair scoring from:
   - embedding similarity
   - event-frame similarity
   - actor-role alignment
   - location similarity
   - time proximity
   - document-type compatibility
   - duplicate pressure
   - broadness penalty
   - low-information penalty
2. implement canonical decision policy that returns ontology labels;
3. hard negative rules must explicitly push broad roundups and explainers away from canonical event membership.

Likely files:

1. new `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/pairScorer.ts`
2. new `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/pairDecisionPolicy.ts`
3. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/clusterJudgement.ts`

Acceptance:

1. the Iran roundup/drone-strike case resolves to `related_topic_only`;
2. same-incident positives remain accepted;
3. scorer outputs deterministic labelled decisions on fixed fixtures.

Dependencies:

1. SC-00
2. SC-01
3. SC-03
4. SC-04

## SC-06: Rerank and Bounded Adjudication Lane

Goal:

1. keep ambiguity handling, but make it subordinate to event-precision rules.

Scope:

1. implement a dedicated rerank stage for ambiguous candidate sets;
2. keep LLM adjudication only for the uncertainty band;
3. ensure adjudication outputs canonical ontology labels;
4. ensure hard negatives can override soft same-topic merges.

Likely files:

1. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/openaiProvider.ts`
2. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/clusterJudgement.ts`
3. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/modelProvider.ts`

Acceptance:

1. ambiguity lane remains bounded and measurable;
2. benchmark corpus improves on hard edge cases;
3. `related_topic_only` cases do not get promoted into canonical event bundles by adjudication.

Dependencies:

1. SC-05

## SC-07: Persistent EventCluster Repository

Goal:

1. move from transient grouping to durable event-cluster state.

Scope:

1. introduce a cluster repository abstraction;
2. persist:
   - representative frame
   - canonical primary sources
   - secondary assets
   - related coverage links
   - confidence
   - storyline linkage
   - merge/split lineage
   - timestamps
3. keep `story_id` stable through repeated ticks and source growth.

Likely files:

1. new `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/clusterRepository.ts`
2. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/clusterAssignment.ts`
3. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/clusterLifecycle.ts`
4. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/clusterRecords.ts`

Acceptance:

1. replay suite shows `story_id` persistence >= target;
2. `created_at` remains immutable;
3. `cluster_window_end` remains monotonic;
4. merge/split lineage is recorded and testable.

Dependencies:

1. SC-02
2. SC-05
3. SC-06

## SC-08: Separate Storyline Layer

Goal:

1. stop using event bundling to solve broader narrative grouping.

Scope:

1. implement `StorylineGroup` assignment after event clustering;
2. attach related coverage to storyline, not canonical bundle;
3. expose `storyline_id` for diversification and related-coverage UX only.

Likely files:

1. new `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/storylineAssignment.ts`
2. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/bundleProjection.ts`
3. downstream ranking and feed metadata files

Acceptance:

1. broad roundups remain discoverable without contaminating canonical bundles;
2. `storyline_id` is available for diversification;
3. canonical bundle membership is no longer widened by storyline similarity.

Dependencies:

1. SC-07

## SC-09: Clean Bundle Projection and Mesh Publication

Goal:

1. project only canonical event members into published `StoryBundle`s.

Scope:

1. ensure `StoryBundle.sources` contains distinct-publisher canonical event members only;
2. publish secondary assets and related coverage as separate artifacts;
3. preserve `story_id`, `topic_id`, `created_at`, and `cluster_window_end` contracts.

Likely files:

1. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/bundleProjection.ts`
2. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/remoteContract.ts`
3. `/Users/bldt/Desktop/VHC/VHC/packages/gun-client/src/newsAdapters.ts`
4. `/Users/bldt/Desktop/VHC/VHC/packages/ai-engine/src/clusterEngine.ts`

Acceptance:

1. published bundles no longer include topic-only coverage as canonical members;
2. bundle projection tests cover publisher-normalized source lists;
3. downstream consumers continue to render correctly.

Dependencies:

1. SC-02
2. SC-07
3. SC-08

## SC-10: Ranking Retune on Correct Event Bundles

Goal:

1. make `Latest` and `Hot` operate on corrected event clusters.

Scope:

1. keep `Latest` strictly tied to `cluster_window_end`;
2. retune `Hot` only after corrected event-cluster features are available;
3. use `storyline_id` for deterministic diversification;
4. ensure topic-only volume does not masquerade as event corroboration.

Likely files:

1. `/Users/bldt/Desktop/VHC/VHC/apps/web-pwa/src/store/discovery/ranking.ts`
2. `/Users/bldt/Desktop/VHC/VHC/packages/gun-client/src/newsAdapters.ts`
3. StoryCluster feature projection files

Acceptance:

1. deterministic replay ordering passes;
2. `Hot` no longer promotes noisy topic blobs above real event bundles;
3. top window remains diversified without hiding the actual event.

Dependencies:

1. SC-09

## SC-11: Daemon-First Live Semantic Audit Gate

Goal:

1. turn live semantic verification into a release blocker.

Scope:

1. extend daemon-first live headless flow to audit published multi-source bundles semantically;
2. verify canonical bundle members are same incident or same developing episode;
3. fail if audited bundles contain `related_topic_only` or `commentary_on_event` members;
4. keep current analysis and vote persistence assertions intact.

Likely files:

1. `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemon-first-feed-integrity.live.spec.ts`
2. additional live audit helpers under `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/`
3. CI workflow files

Acceptance:

1. daemon-first semantic audit is reproducible;
2. audited live bundles contain zero known false merges;
3. current analysis and vote convergence live tests still pass.

Dependencies:

1. SC-09
2. SC-10

## SC-12: Analysis and Bias-Table Integrity Pass

Goal:

1. ensure corrected event bundling does not regress the rest of VHC.

Scope:

1. ensure analysis generation uses canonical event members only;
2. ensure missing enrichment remains non-blocking;
3. ensure point identity remains stable under rebundling and refreshed analysis;
4. keep strict tri-state vote semantics and convergence across users.

Likely files:

1. `/Users/bldt/Desktop/VHC/VHC/apps/web-pwa/src/components/feed/useAnalysisMesh.ts`
2. `/Users/bldt/Desktop/VHC/VHC/apps/web-pwa/src/components/feed/newsCardAnalysis.ts`
3. related live tests and unit tests

Acceptance:

1. analysis remains available and persistent;
2. vote aggregation and per-user persistence remain correct;
3. no point-ID churn regression appears after canonical bundle cleanup.

Dependencies:

1. SC-09

## SC-13: Final Release Gate and Closure Packet

Goal:

1. declare StoryCluster production-ready only when the machine has earned it.

Scope:

1. run full benchmark suite;
2. run replay suite;
3. run the blocking fixture-backed daemon-first gates via `pnpm test:storycluster:gates`;
4. run the public semantic smoke lane via `pnpm test:storycluster:smoke`;
5. run analysis and vote persistence suite;
6. publish final evidence packet and strict requirement matrix.

Workflow notes:

1. the authoritative pre-merge / pre-release gate is the fixture-backed daemon-first pair:
   - integrity gate
   - semantic gate
2. public-feed semantic soak is required evidence, but not the sole blocker while live public bundle density remains volatile;
3. if CI cannot execute the live daemon-first gate stack in a provisioned environment, the release owner must run `pnpm test:storycluster:gates` manually and attach the resulting artifact paths.

Acceptance:

1. all gates in the canonical execution plan pass;
2. closure packet maps requirement -> file -> test -> artifact -> PASS/FAIL;
3. no docs overstate completion;
4. the release packet explicitly distinguishes:
   - blocking fixture-backed gate evidence
   - non-blocking public smoke/soak evidence

Dependencies:

1. SC-11
2. SC-12

## 4. Parallelization Notes

Safe parallel work is limited.

Parallel-safe after SC-00:

1. SC-01 and SC-03 may overlap if ownership is clean.
2. SC-11 test harness prep may begin before SC-09, but final gate wiring depends on SC-09.

Not parallel-safe:

1. SC-04, SC-05, SC-06 should land in order.
2. SC-07, SC-08, SC-09 should land in order.
3. SC-10 depends on corrected canonical bundle projection and should not start early.

## 5. Recommended PR Sequence

Recommended PR series:

1. PR1 -> SC-00
2. PR2 -> SC-01
3. PR3 -> SC-02
4. PR4 -> SC-03
5. PR5 -> SC-04
6. PR6 -> SC-05
7. PR7 -> SC-06
8. PR8 -> SC-07
9. PR9 -> SC-08
10. PR10 -> SC-09
11. PR11 -> SC-10
12. PR12 -> SC-11
13. PR13 -> SC-12
14. PR14 -> SC-13

## 6. Hard Stop Rules

Stop and do not claim completion if any of these are still true:

1. production can still publish heuristic bundles;
2. benchmark fixtures still show verified false merges;
3. broad topic roundups still appear in canonical event bundles;
4. same-publisher derivative assets still inflate canonical corroboration;
5. daemon-first live semantic audits still pass only because they are not reading authoritative bundle membership;
6. analysis or vote persistence regresses while clustering is being corrected.
