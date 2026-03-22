# Retained Feed Ghost Scorer Design

Status: Exploratory design and validation plan
Owner: Core Engineering
Last Updated: 2026-03-21
Branch Baseline: `main` @ `547d598`

## 1. Mission

Validate whether a retained-evidence feed model would measure the actual product more honestly than the current isolated-run headline soak, without changing runtime publication or UI identity yet.

This design intentionally does **not** change production behavior. It adds a proof surface that answers three questions before any runtime architecture shift:

1. are `entity_keys` stable enough across source growth and headline drift for `topic_id` to be a viable retained-feed identity anchor;
2. does a deduped retained-evidence window materially improve auditable supply compared with isolated executions;
3. can that improvement happen without increasing contamination, stale-singleton noise, or source-governance drift.

## 2. Problem Statement

Current state on `main` is internally consistent but structurally mismatched with the intended product.

1. the product is a continuous feed that users return to and expect to grow over time;
2. the current headline soak measures whether one isolated execution can produce enough auditable bundles inside a narrow window;
3. source-health evidence already shows healthy aggregate overlap across the admitted source surface;
4. fresh headline-soak evidence still fails because in-run auditable supply is thin, even though the broader feed state is healthy.

That mismatch is visible in code:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/cluster.ts`
  - `story_id` is derived from `entity_keys + timeBucket + semantic_signature`
  - `topic_id` is derived from `entity_keys` only
- `/Users/bldt/Desktop/VHC/VHC/packages/ai-engine/src/newsRuntime.ts`
  - current publication is latest-batch authoritative and prunes previously published `story_id`s that are absent from the next batch
- `/Users/bldt/Desktop/VHC/VHC/apps/web-pwa/src/store/discovery/index.ts`
  - current NEWS_STORY identity is `story_id`-first
- `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemonFirstFeedHarness.ts`
  - the soak explicitly waits for enough current auditable bundles within one execution window

The key design implication is:

- the experiment must retain **evidence**, not **formed bundles**;
- bundle shape must be regenerated from retained evidence each cycle, otherwise contamination and split repair become much harder.

## 3. Design Principles

1. retain evidence, not bundles
2. dedupe with the existing machine identity primitive: `source_id + url_hash`
3. preserve `canonical_url` alongside the dedup key for operator/debug visibility
4. do not change runtime publication, UI identity, or the release gate in this phase
5. treat retained-state scoring as telemetry until it proves itself
6. require contamination non-regression, not just corroboration improvement

## 4. Non-Goals

This design does not:

1. change `/Users/bldt/Desktop/VHC/VHC/packages/ai-engine/src/newsRuntime.ts`
2. change `/Users/bldt/Desktop/VHC/VHC/apps/web-pwa/src/store/discovery/index.ts`
3. change current production-readiness thresholds
4. auto-promote retained-state scoring into the release gate
5. solve source-policy removal or retained-topic retraction in production yet

Those become relevant only if the experiment proves the retained model is worth building for real.

## 5. Working Assumptions

### 5.1 Topic identity

`topic_id` is already composition-independent in current code:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/cluster.ts:123`

So bundle growth alone should not change `topic_id`.

The real prerequisite question is narrower and more important:

- are `entity_keys` stable enough under headline drift, source growth, and source variation that `topic_id = hash(entity_keys)` remains stable for the same story.

### 5.2 Dedup identity

The machine dedup key for retained evidence should be:

- `source_id::url_hash`

Why:

1. `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/normalize.ts` already canonicalizes URLs and derives deterministic `url_hash`
2. `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/coherenceAudit.ts` already uses `source_id::url_hash` as source-event identity
3. `canonical_url` is still retained for debugging, but it should not be the machine key

### 5.3 Experiment boundary

The retained experiment should live entirely in the soak/report lane first.

That means:

1. capture evidence from real soak runs
2. build a ghost retained mesh off to the side
3. score it separately from the isolated-run soak
4. only then decide whether runtime publication and UI identity should change

## 6. Piece 1: Entity-Key Stability Test

### 6.1 Goal

Prove or disprove that the current entity-key extraction path is stable enough for retained topic identity.

This is the prerequisite to any real retained-feed model.

### 6.2 Placement

Extend:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/cluster.test.ts`

Optional companion coverage if needed:

- `/Users/bldt/Desktop/VHC/VHC/packages/ai-engine/src/__tests__/newsCluster.test.ts`

The news-aggregator test should own the contract because `topic_id` is generated there today.

### 6.3 Required scenarios

Add deterministic test cases that model the same event evolving over time.

#### Scenario A: Source growth, stable event

Sequence:

1. singleton A
2. A + B
3. A + B + C

Constraints:

- same event
- different URLs
- slightly different headlines
- same time bucket

Assertions:

1. `topic_id` is stable across all three snapshots
2. `cluster_features.entity_keys` remain materially the same set
3. `story_id` behavior is explicitly documented by the test output instead of assumed

#### Scenario B: Headline drift, same event

Sequence:

1. initial straight-news headline
2. later update headline with more detail
3. later headline with evolving phrasing

Assertions:

1. `topic_id` remains stable if the event is unchanged
2. entity-key extraction does not collapse to unrelated keys because of superficial wording shifts

#### Scenario C: Source growth with one noisy variant

Sequence:

1. clean singleton
2. corroborating second article
3. third article with noisier headline structure

Assertions:

1. `topic_id` remains stable when one source is noisier but still the same event
2. failure, if any, is attributable to entity-key extraction drift and not bundle composition

#### Scenario D: Same topic, different event

Sequence:

1. event 1 article
2. event 2 article on same broader topic

Assertions:

1. `topic_id` must differ
2. the stability test must not reward over-sticky entity extraction

### 6.4 Pass criteria

The stability lane passes only if:

1. same-event scenarios keep the same `topic_id`
2. different-event scenarios do not collapse into one `topic_id`
3. failures are explainable by entity extraction, not by hidden composition dependence

### 6.5 Output

The tests should leave behind a clear answer to this question:

- can a retained feed anchor topic continuity directly on current `topic_id`, or is a topic-merge layer required first.

## 7. Piece 2: Ghost Retained-Mesh Scorer

### 7.1 Goal

Build an off-to-the-side retained-state scorer that uses deduped source evidence across a rolling window and regenerates a provisional canonical bundle view each cycle.

This scorer is telemetry only. It does not publish to the app.

### 7.2 Core rule

Retain this:

- deduped source/article evidence

Do **not** retain this:

- previously formed bundles as authoritative state

The retained bundle view must be rebuilt each cycle from the retained evidence window.

### 7.3 Required capture artifact

The current soak artifacts are not rich enough to regenerate bundle view from evidence alone. Existing artifacts mostly preserve:

1. sampled audited bundles
2. failure snapshots with counts and topic/story identity
3. current store snapshots without full per-source clusterable input

So the experiment needs a new per-run artifact written alongside the existing soak artifacts.

Proposed file:

- `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/<execution>/run-<n>.retained-source-evidence.json`

Proposed schema:

```json
{
  "schemaVersion": "daemon-feed-retained-source-evidence-v1",
  "generatedAt": "2026-03-21T00:00:00.000Z",
  "run": 1,
  "sources": [
    {
      "source_id": "guardian-us",
      "publisher": "Guardian",
      "url": "https://example.com/article",
      "canonical_url": "https://example.com/article",
      "url_hash": "abcd1234",
      "title": "Headline",
      "published_at": 1700000000000,
      "summary": "optional summary if available",
      "observed_story_id": "story-1234",
      "observed_topic_id": "topic-5678",
      "observed_headline": "Observed bundle headline",
      "is_dom_visible": true,
      "is_auditable_observed_story": false
    }
  ]
}
```

This capture is intentionally source-level, not bundle-level. It should include every visible or store-present source observed during the soak run, not just the audited sample.

### 7.4 Evidence normalization path

The ghost scorer should convert retained source evidence into a clusterable input shape using existing normalization primitives.

Preferred path:

1. materialize `RawFeedItem`-like entries from retained source evidence
2. canonicalize and dedupe with the existing normalization logic
3. derive cluster text and `entity_keys` with the existing normalization path where possible
4. regenerate provisional bundle view from that retained evidence set

The experiment should reuse existing primitives where practical:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/normalize.ts`
- `/Users/bldt/Desktop/VHC/VHC/packages/ai-engine/src/newsNormalize.ts`
- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/cluster.ts`
- `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/coherenceAudit.ts`

### 7.5 Retained evidence window

The ghost scorer should keep a rolling window of retained evidence with decay.

Initial proposed policy:

1. retain evidence for 24 hours by default
2. evict older evidence from the ghost mesh
3. record whether an evidence item is still represented by a currently visible topic
4. allow shorter retention for singleton-only evidence in later phases if needed

The purpose of the first experiment is not to perfect decay. It is to prove whether retained accumulation reveals real feed quality that isolated runs miss.

### 7.6 Regeneration pipeline

For each new soak execution:

1. read recent `run-<n>.retained-source-evidence.json` artifacts inside the lookback window
2. merge them into a retained source-evidence map keyed by `source_id::url_hash`
3. drop expired evidence by age
4. regenerate a provisional bundle/topic view from the retained evidence set
5. score that regenerated view
6. write a retained-state artifact and retained-state trend artifact

Proposed files:

- `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemon-feed-semantic-soak-retained.mjs`
- `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemon-feed-semantic-soak-retained.vitest.mjs`

Proposed artifact outputs:

- per execution:
  - `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/<execution>/ghost-retained-mesh-report.json`
- stable latest trend:
  - `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/ghost-retained-mesh-trend-index.json`

### 7.7 Contamination and revalidation

Retained state is only useful if it does not preserve bad merges longer than the current system.

So the ghost scorer must explicitly measure contamination.

Required approach:

1. identify auditable regenerated bundles from the retained view
2. run the existing canonical-pair semantic audit logic on a bounded sample of those bundles
3. carry forward `related_topic_only` / contamination counts into the retained-state report

This keeps contamination measurement grounded in the same audit mechanism already used for headline soak.

### 7.8 Source governance visibility

The ghost scorer is telemetry only in phase 1, but it still needs to surface source-governance tension.

At minimum it should record:

1. retained evidence counts by source decision state at scoring time (`keep`, `watch`, `remove`)
2. whether a retained auditable topic includes evidence from a source that is no longer `keep`

This is not yet an enforcement rule. It is observability for the later product design.

## 8. Piece 3: Comparison Metrics and Decision Framework

### 8.1 Goal

Decide whether retained-state scoring is materially better aligned with product reality than isolated-run soak scoring.

This is not just “more corroboration is better.”

The experiment should compare uplift against cost and risk.

### 8.2 Baseline comparison surfaces

For the same observation window, compare three things:

1. isolated-run headline-soak trend
2. ghost retained-mesh trend
3. source-health aggregate evidence

The retained mesh is useful only if it closes the gap between 1 and 3 without introducing new contamination risk.

### 8.3 Required metrics

#### Supply and density

1. visible story count
2. auditable story count
3. sample fill rate
4. corroborated bundle rate
5. unique visible source count
6. promotable execution count under retained-state scoring

#### Continuity and growth

1. retained topic count
2. topic retention rate
3. singleton-to-corroborated transition count
4. singleton-to-corroborated transition rate
5. later attachment count
6. average source diversity gain per retained topic

#### Contamination and safety

1. audited pair count
2. `related_topic_only` pair count
3. contamination rate
4. retained contaminated topic count
5. stale singleton count beyond decay threshold

#### Source governance

1. retained evidence count by source decision state
2. retained topic count that includes non-`keep` sources
3. retained auditable topic count that depends on non-`keep` sources

### 8.4 Decision rule

The retained-feed architecture is justified only if the ghost scorer shows all of the following over the same recent window used for headline soak review:

1. materially better supply than the isolated-run soak
   - more retained auditable stories
   - higher fill rate
   - more promotable windows
2. no contamination regression
   - contamination rate does not worsen materially relative to the isolated-run soak
3. real continuity signal
   - retained topic count and singleton-to-corroborated transitions are non-trivial
4. sane freshness behavior
   - stale singleton accumulation remains bounded by the decay policy
5. no hidden dependence on downgraded sources
   - retained quality is not being propped up by evidence that current source policy would reject

If those conditions are **not** met, the retained runtime redesign should not proceed. The bottleneck would then be somewhere else:

1. source breadth
2. soak timing
3. extraction consistency
4. clustering precision
5. the smoke surface budget

### 8.5 Initial success threshold for architecture work

Before touching runtime publication or UI identity, require at least one review window where the ghost retained mesh demonstrates all of the following versus the isolated-run soak over the same executions:

1. retained-state quality is promotable when isolated-run quality is not;
2. retained contamination is not worse than isolated contamination;
3. retained topic continuity is observable, not zeroed out;
4. the uplift is attributable to deduped retained evidence, not duplicated source observations.

This is intentionally comparative, not absolute. The point is to validate the hypothesis before expanding scope.

## 9. Sequencing

### Phase 1: prove topic identity viability

1. extend `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/cluster.test.ts`
2. answer whether current `topic_id` can be trusted as a retained anchor

### Phase 2: add retained evidence capture

1. write `run-<n>.retained-source-evidence.json`
2. keep this additive to the current soak artifacts
3. do not change production gating

### Phase 3: build ghost retained scorer

1. dedupe retained evidence by `source_id::url_hash`
2. apply decay
3. regenerate provisional retained bundle view
4. emit retained-state report + trend index

### Phase 4: compare without publishing

1. compare isolated-run soak vs retained ghost mesh over the same window
2. explicitly compare contamination, continuity, and stale-singleton behavior
3. decide whether a runtime retention design is justified

### Phase 5: only if justified

Then, and only then, write the real runtime design for:

1. retained topic-state publication
2. topic-scoped UI identity
3. update-in-place feed semantics
4. source-policy downgrade/retraction handling

## 10. Open Questions

1. Is title-plus-summary normalization sufficient for the ghost scorer, or does the experiment need richer retained text for better entity stability?
2. Should the ghost scorer regenerate with `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/cluster.ts`, or should it use the ai-engine hybrid assignment path as the closer proxy to production behavior?
3. What decay split should exist between singleton-only evidence and corroborated evidence after the initial experiment?
4. How much retained semantic auditing is enough to measure contamination without making the experiment too expensive to run routinely?

## 11. Definition of Done for This Design

This design is complete when the implementation lane can start with no ambiguity about:

1. what must be tested to prove topic identity viability;
2. what source-level evidence must be retained and how it must be deduped;
3. what artifacts the ghost scorer must emit;
4. what metrics decide whether retained-state architecture is worth building for real.
