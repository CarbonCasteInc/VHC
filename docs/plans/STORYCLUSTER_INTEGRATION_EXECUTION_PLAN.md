# StoryCluster Integration Execution Plan (Canonical)

Status: Canonical execution plan
Owner: Core Engineering
Last Updated: 2026-03-16
Branch Baseline: `main` @ `746ac58`

Companion execution backlog:

1. `/Users/bldt/Desktop/VHC/VHC/docs/plans/STORYCLUSTER_IMPLEMENTATION_TICKET_STACK.md`

## 1. Mission

Build a production-grade StoryCluster service that is the sole authoritative news bundler for VHC.

The bundler must:

1. place reports about the same discrete story or event together across publishers;
2. keep same-topic but different-event coverage apart;
3. prevent roundups, explainers, opinion, liveblogs, and same-publisher derivative assets from polluting canonical event bundles;
4. preserve VHC production invariants:
   - remote-only, fail-closed StoryCluster in production;
   - daemon-first writer topology;
   - stable `story_id`;
   - `topic_id = sha256Hex("news:" + story_id)` for news stories;
   - `created_at` immutability;
   - monotonic `cluster_window_end`;
   - non-blocking analysis and bias-table enrichment.

This replaces the earlier broad pipeline-first plan as the canonical execution path.

## 2. Problem Statement

The repo already has strong production-path wiring, but the current bundler still behaves too much like a topic clusterer.

Validated live failure mode:

1. a Jan. 6 plaque article and a related CBS video were correctly bundled as the same incident;
2. a CBS report on a specific drone strike was incorrectly bundled with a broad Guardian Iran roundup.

That second case is the core defect.

The system must optimize for event precision, not generic topic similarity.

## 3. Canonical Principles

1. Canonical bundle membership is for the same incident or the same developing episode only.
2. Broader storyline grouping is a separate layer and must not determine `story_id`.
3. Precision is more important than aggressive bundling.
4. Under-bundling is preferable to false merges in the canonical feed.
5. Document type is authoritative for bundle seeding and attachment.
6. Event structure is required; embeddings alone are insufficient.
7. Release claims must be backed by deterministic corpus/replay evidence plus served semantic-gate evidence; live public semantic smoke is supplementary telemetry.
8. A single readable article may publish as a valid canonical feed story; later corroborating coverage should attach without changing story identity when it is the same incident or same developing episode.
9. Production-grade feed promises apply to onboarded readable, accessible, extraction-safe sources only; source admission is an operational contract, not a promise to ingest arbitrary feeds.

## 4. Core Architecture

StoryCluster must have two first-class clustering layers.

### 4.1 EventCluster

This is the canonical feed bundle.

Definition:

1. one discrete incident; or
2. one tightly coupled developing event sequence.

This layer owns:

1. `story_id`;
2. canonical bundle membership;
3. canonical source list;
4. `created_at`;
5. `cluster_window_end`;
6. coverage, velocity, confidence, and ranking features.

### 4.2 StorylineGroup

This is the broader narrative layer.

Definition:

1. the broader topic or narrative that may contain multiple discrete events.

This layer owns:

1. `storyline_id`;
2. related coverage grouping;
3. diversification inputs;
4. browse-related and "more on this storyline" UX.

`StorylineGroup` must never replace or override `EventCluster` identity.

Implementation state note:

1. `StorylineGroup` is now a published runtime contract in the codebase;
2. `main` includes publication, Gun/store hydration, storyline-aware ranking/diversification, and separated related-coverage presentation;
3. storyline publication, ranking, presentation, focused deep-link state, shell navigation semantics, archive-parent diversification, and archive-child deep-link restoration are already in force on `main`;
4. public semantic-soak density/trend diagnostics and promotion-assessment scaffolding are already in force on `main`;
5. the correctness-gate sufficiency lane is complete and in force on `main`;
6. the primary StoryCluster correctness proof is the deterministic known-event fixture corpus plus replay corpus, confirmed by the daemon-first semantic gate:
   - `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/benchmarkCorpusKnownEventOngoingFixtures.ts`
   - `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/benchmarkCorpusReplayKnownEventOngoingScenarios.ts`
   - `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemon-first-feed-semantic-audit.live.spec.ts`
7. the active follow-on lane is source-readability admission and distribution-readiness hardening:
   - the feed promise is about onboarded readable sources, not arbitrary sources;
   - singleton-first publication and later bundle growth must remain explicit release invariants;
   - source onboarding/removal and readability review are governed operationally by `/Users/bldt/Desktop/VHC/VHC/docs/ops/NEWS_SOURCE_ADMISSION_RUNBOOK.md`;
8. browser-driven Playwright verification is now part of the expected release evidence for feed/discovery/storyline changes;
9. public semantic soak remains secondary distribution telemetry, not the primary clustering proof.

## 5. Canonical Pair Ontology

Every document-to-document or document-to-cluster decision must resolve to one of these labels:

1. `duplicate`
2. `same_incident`
3. `same_developing_episode`
4. `related_topic_only`
5. `commentary_on_event`
6. `unrelated`

Canonical `EventCluster` membership may only accept:

1. `duplicate`
2. `same_incident`
3. `same_developing_episode`

Canonical `EventCluster` membership must reject:

1. `related_topic_only`
2. `commentary_on_event`
3. `unrelated`

This ontology is mandatory in code, tests, metrics, and live audits.

## 6. Source Model

StoryCluster must stop treating all URLs as equal bundle members.

### 6.1 Primary sources

Canonical event-bundle sources.

Rules:

1. at most one canonical primary source per publisher in `StoryBundle.sources`;
2. only event-valid members may appear here;
3. these are the sources used for event-bundle analysis and feed presentation.

### 6.2 Secondary assets

Same-publisher derivative assets.

Examples:

1. video clip of the same report;
2. alternate URL for the same article;
3. live page fragment;
4. mobile or AMP variant.

Rules:

1. these do not count as distinct corroborating bundle members;
2. they may be retained as secondary metadata, not as separate canonical primary sources.

### 6.3 Related coverage

Coverage related to the storyline but not canonical event membership.

Examples:

1. roundups;
2. explainers;
3. opinion;
4. analysis;
5. liveblogs;
6. broad topic summaries.

Rules:

1. these must not be published into canonical event bundle membership;
2. they may attach to `storyline_id` or a separate related-coverage artifact.

## 7. Authoritative Document Types

Document type is a hard production signal, not a soft hint.

Required document classes:

1. `wire`
2. `hard_news`
3. `breaking_update`
4. `liveblog`
5. `roundup`
6. `explainer`
7. `analysis`
8. `opinion`
9. `video_clip`

Implementation taxonomy note:

1. the canonical planning vocabulary is the list above;
2. the current codebase normalizes a small number of historical aliases at provider/state boundaries:
   - `wire_report` = canonical `wire`
   - `explainer_recap` = canonical `explainer`
3. internal engine state, benchmark reports, release gates, and fixtures should use the canonical vocabulary;
4. no additional aliasing should be introduced without updating this section and the fixture corpus.

Seeding rules:

1. only `wire`, `hard_news`, and `breaking_update` may seed new `EventCluster`s;
2. `liveblog`, `roundup`, `explainer`, `analysis`, `opinion`, and low-information `video_clip` must not seed canonical event bundles.

Attachment rules:

1. `video_clip` may attach as a secondary asset when it is clearly the same incident and same publisher;
2. `roundup`, `explainer`, `analysis`, `opinion`, and `liveblog` may attach as related coverage only;
3. these classes must incur strong negative scoring against canonical event membership.

## 8. Pipeline Design

## 8.1 Ingest normalization

For every article:

1. normalize URL and canonical URL;
2. normalize publisher identity;
3. normalize pub date;
4. extract headline, lede, and article body;
5. preserve original text and metadata.

## 8.2 Language detection and translation

Implement real language detection and selective translation.

Requirements:

1. preserve original text;
2. preserve translated text separately;
3. translation is gated, not unconditional;
4. translated text may be used for retrieval and scoring, but original text remains available for evidence.

Telemetry:

1. `input_count`
2. `language_distribution`
3. `translated_doc_count`
4. `gate_pass_rate`
5. `latency_ms`

## 8.3 Duplicate detection

Implement duplicate detection before event clustering.

Signals:

1. normalized text near-duplicate signal;
2. lead-image duplicate signal when available;
3. canonical URL and publisher signal;
4. same-publisher derivative-asset signal.

Outputs:

1. duplicate groups;
2. primary-source candidate selection;
3. secondary-asset attachment.

Rules:

1. near-duplicates collapse before event assignment;
2. same-publisher article plus video must not inflate canonical corroboration count.

## 8.4 Event-frame extraction

Event-frame extraction is mandatory.

Per document, extract:

1. trigger or action;
2. primary actors;
3. actor roles;
4. target or object;
5. normalized location;
6. normalized date and time;
7. event type;
8. optional magnitude fields such as casualties or quantities.

This frame must be used in retrieval, scoring, adjudication, and audits.

## 8.5 Candidate retrieval

Candidate retrieval must combine semantic and symbolic constraints.

Required retrieval steps:

1. multilingual vector ANN retrieval using Qdrant;
2. time-window prefilter;
3. event-type compatibility prefilter;
4. actor overlap prefilter where available;
5. location compatibility prefilter where available.

A document must not become an event candidate solely because it shares a country, major actor, or war topic.

## 8.6 Pair scoring

Pair scoring must answer event sameness, not topic relatedness.

Required scoring inputs:

1. embedding similarity;
2. event-frame similarity;
3. actor-role alignment;
4. location similarity;
5. time proximity;
6. document-type compatibility;
7. duplicate pressure;
8. broadness penalty;
9. low-information penalty.

The scorer must strongly penalize:

1. broad roundups versus specific incident reports;
2. explainers versus hard-news incident reports;
3. opinion versus incident reports;
4. liveblogs versus incident reports unless already attached to a known developing episode.

## 8.7 Pair rerank

Ambiguous candidate sets must go through a dedicated rerank stage.

Requirements:

1. a real pair model or cross-encoder must rerank hard cases;
2. this stage must remain deterministic under fixed fixtures;
3. it must output explicit pair labels from the canonical ontology.

## 8.8 Adjudication lane

The LLM is the bounded ambiguity resolver, not the primary bundler.

Rules:

1. only candidates in the uncertainty band enter adjudication;
2. adjudication must output a canonical ontology label;
3. hard negative rules may override a soft LLM merge.

Targets:

1. ambiguity lane should stay bounded and observable;
2. routine traffic must resolve without LLM adjudication.

## 8.9 Dynamic cluster assignment

Cluster assignment must use persistent cluster state.

Responsibilities:

1. create new `EventCluster`s;
2. update existing clusters;
3. preserve stable identity under source growth;
4. support merge and split operations with lineage;
5. maintain confidence and representative event frame.

A cluster may only grow through documents labeled:

1. `duplicate`
2. `same_incident`
3. `same_developing_episode`

## 8.10 Storyline assignment

Storyline assignment happens after event clustering.

Responsibilities:

1. group related events into broader narratives;
2. attach related coverage that is not canonical event membership;
3. support feed diversification.

`StorylineGroup` may use looser thresholds than `EventCluster`, but it must never rewrite event identity.

## 8.11 Summary generation

Canonical summaries must be generated from canonical event members only.

Rules:

1. `summary_hint` comes from the `EventCluster`, not the `StorylineGroup`;
2. related coverage must not contaminate event summaries;
3. generated summaries must be actual event summaries, not count text.

## 9. State Model and Identity Contracts

## 9.1 Event identity

1. `story_id` is the durable `EventCluster` identifier;
2. `created_at` is first-write-wins for that `story_id`;
3. `cluster_window_end` is monotonic and reflects latest validated event activity.

## 9.2 Topic identity

1. news `topic_id = sha256Hex("news:" + story_id)`;
2. user-thread topic IDs remain thread-derived and unchanged;
3. storyline identity remains separate from topic identity.

## 9.3 Cluster persistence

Persistent cluster state must store:

1. representative event frame;
2. canonical primary sources;
3. secondary assets;
4. related coverage links;
5. `storyline_id`;
6. confidence;
7. merge and split lineage;
8. timestamps and activity fields.

## 10. Publication Contract

## 10.1 Canonical StoryBundle

`StoryBundle` remains the authoritative published feed artifact.

It must contain:

1. stable `story_id`;
2. stable `topic_id`;
3. canonical event headline;
4. canonical event summary;
5. immutable `created_at`;
6. monotonic `cluster_window_end`;
7. canonical `sources` from distinct publishers only;
8. deterministic provenance metadata.

## 10.2 Separate related artifacts

Related coverage, secondary assets, and storyline data must publish separately.

At minimum, split out:

1. secondary assets;
2. related coverage;
3. storyline metadata;
4. enrichment artifacts.

## 10.3 Non-blocking enrichment

Analysis and bias-table generation remain asynchronous.

Rules:

1. StoryBundle publish must not wait on enrichment;
2. missing enrichment must not block feed or card renderability;
3. analysis for a story should be computed from canonical event members, not topic-only attachments.

## 11. Ranking Contracts

Ranking is downstream of event correctness.

## 11.1 Latest

1. sort strictly by `cluster_window_end` descending.

## 11.2 Hot

1. compute from event-cluster features only;
2. use deterministic, config-versioned scoring;
3. use publisher diversity, coverage, velocity, and confidence;
4. do not treat topic-only roundups or commentary as event corroboration.

## 11.3 Diversification

Client diversification may use `storyline_id`, but only after event bundles are correct.

## 12. Benchmark-First Refactor Program

## Phase 0: Freeze ontology and benchmark corpus

Deliverables:

1. canonical pair ontology in code and docs;
2. benchmark corpus containing:
   - same-event cross-publisher pairs;
   - same-topic different-event traps;
   - roundup versus incident traps;
   - explainer versus incident traps;
   - opinion contamination traps;
   - same-publisher article/video duplicate traps;
   - multilingual same-event pairs;
   - evolving follow-up ticks;
   - verified live false merges;
   - verified live true positives.

Exit criteria:

1. every future bundling change runs through this corpus;
2. the Guardian Iran roundup versus CBS drone-strike case is a permanent regression fixture.

## Phase 1: Make document type authoritative

Deliverables:

1. production doc-type classifier;
2. canonical seeding rules;
3. secondary-asset and related-coverage routing rules.

Exit criteria:

1. non-seeding document classes cannot create canonical event bundles;
2. same-publisher article plus video does not count as distinct corroboration.

## Phase 2: Event-frame extraction and duplicate model

Deliverables:

1. event-frame extractor;
2. duplicate detector;
3. primary-source and secondary-asset projection.

Exit criteria:

1. event-frame fields are present for benchmark fixtures where possible;
2. duplicate collapse works before cluster assignment.

## Phase 3: Retrieval and pair scoring rewrite

Deliverables:

1. Qdrant retrieval with symbolic prefilters;
2. pair scorer centered on event sameness;
3. dedicated rerank stage;
4. bounded LLM adjudication lane.

Exit criteria:

1. false-merge rate falls materially on benchmark corpus;
2. related-topic-only traps no longer enter canonical event bundles.

## Phase 4: Persistent EventCluster state

Deliverables:

1. durable cluster repository;
2. merge and split lineage support;
3. stable identity under repeated ticks and source growth.

Exit criteria:

1. `story_id` persistence target met;
2. `created_at` and `cluster_window_end` contracts preserved.

## Phase 5: Storyline layer and clean bundle projection

Deliverables:

1. separate storyline assignment;
2. canonical event bundle projection;
3. separate related-coverage artifacts.

Exit criteria:

1. `StoryBundle.sources` contains canonical event members only;
2. broad roundups and commentary move out of canonical bundle membership.

## Phase 6: Ranking retune and live feed validation

Deliverables:

1. event-correct `Latest` and `Hot` validation;
2. deterministic replay tests;
3. live daemon-first semantic audit over served feed.

Exit criteria:

1. no audited canonical bundle contains `related_topic_only` members;
2. ranking remains deterministic and meaningful on corrected event clusters.

## 13. Required Code Refactor Targets

Primary modules to split or replace:

1. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/stageHandlers.ts`
2. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/clusterLifecycle.ts`
3. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/clusterJudgement.ts`
4. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/stageRunner.ts`
5. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/remoteContract.ts`
6. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/openaiProvider.ts`
7. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/coherenceAudit.ts`

New engine modules expected:

1. `documentTypeClassifier.ts`
2. `eventFrameExtractor.ts`
3. `duplicateDetector.ts`
4. `candidateRetriever.ts`
5. `pairScorer.ts`
6. `pairDecisionPolicy.ts`
7. `clusterRepository.ts`
8. `clusterAssignment.ts`
9. `storylineAssignment.ts`
10. `bundleProjection.ts`
11. `semanticAudit.ts`
12. benchmark corpus modules and replay harnesses.

Downstream integration targets:

1. `/Users/bldt/Desktop/VHC/VHC/packages/ai-engine/src/clusterEngine.ts`
2. `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/daemon.ts`
3. `/Users/bldt/Desktop/VHC/VHC/packages/gun-client/src/newsAdapters.ts`
4. `/Users/bldt/Desktop/VHC/VHC/apps/web-pwa/src/store/discovery/ranking.ts`
5. daemon-first live e2e suites under `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/`

## 14. CI and Release Gates

StoryCluster is not releasable unless all of the following are true.

### 14.1 Production path gates

1. production mode cannot reach heuristic clustering;
2. production mode requires remote StoryCluster health before ingest;
3. daemon remains the sole default writer.

### 14.2 Identity gates

1. `story_id` persistence rate >= `0.99` on replay suite;
2. `created_at` immutability always holds;
3. `cluster_window_end` monotonicity always holds;
4. news `topic_id` derivation remains correct.

### 14.3 Semantic bundling gates

1. fixture false-merge rate <= `0.01`;
2. fixture false-split rate <= `0.05`;
3. event-bundle precision >= `0.97`;
4. replay coherence score >= `0.90`;
5. live audited canonical bundles contain zero `related_topic_only` or `commentary_on_event` members.

### 14.4 Feed and enrichment gates

1. `Latest` and `Hot` remain deterministic under fixed replay;
2. StoryBundle publication remains non-blocking with enrichment failures;
3. analysis and bias-table persistence and vote convergence continue to pass.

### 14.5 Quality gates

1. changed executable files stay under `350` LOC;
2. changed executable files keep `100%` coverage;
3. strict headless daemon-first feed audits are green.

## 15. Explicit De-Prioritization

The following are not the immediate blockers to production-grade event bundling and must not outrank the precision program above:

1. GDELT grounding;
2. Neo4j timeline graphing;
3. Leiden refinement;
4. active learning loop;
5. broad SOTA ranking work before event coherence is strong.

These may be added later, but only after canonical event precision is proven.

## 16. Program Definition of Done

StoryCluster reaches program DoD only when all of the following are simultaneously true:

1. the production ingest path uses StoryCluster only;
2. canonical bundles contain only same-incident or same-developing-episode reports;
3. same-topic different-event reports are kept out of canonical bundles;
4. roundups, explainers, opinion, liveblogs, and same-publisher derivative assets do not pollute canonical bundle membership;
5. `story_id` remains durable across repeated ticks and source growth;
6. `Latest` and `Hot` operate on correct event bundles;
7. StoryBundle publication remains independent of analysis and bias-table latency;
8. live daemon-first semantic audits find no real false merges in sampled canonical bundles;
9. CI blocks regression on all of the above.

## 17. Hard Conclusion

The right path is not to keep adding more stages until the system looks sophisticated.

The right path is:

1. define the event ontology;
2. freeze the trap corpus;
3. make document type authoritative;
4. extract event structure;
5. score event sameness rather than topic relatedness;
6. separate event clusters from storyline groups;
7. publish only canonical event members into `StoryBundle`;
8. block release on semantic precision, not on wiring completeness.
