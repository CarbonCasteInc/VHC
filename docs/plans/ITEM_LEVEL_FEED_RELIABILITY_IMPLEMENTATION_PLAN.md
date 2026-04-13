# Item-Level Feed Reliability Implementation Plan

> Status: Implementation Plan
> Owner: News Aggregator + StoryCluster
> Branch: `coord/item-reliability-plan`
> Scope: make item-level disqualification a system rule while keeping soak feeds that are at least 50% article-reliable over an 8-item sample

## Goal

Make this an enforced system rule for soak/public-soak work:

1. A feed stays in the soak surface when its article-candidate links are at least 50% readable/reliable over an 8-item sample.
2. Specific bad-link articles from otherwise-keep feeds are identified, classified, persisted, and disqualified.
3. Disqualified article URLs must never be served to end users through article-text, bundle publication, snapshots, or UI-facing latest indexes.

## Executive Decision

Use a dual-level policy:

1. Source-level keep/watch/remove remains the authoritative starter-surface policy.
2. Item-level disqualification becomes a first-class policy underneath it.

This means:

- bad sources can still be removed;
- good-enough sources are preserved even when some feed entries are junk;
- bad URLs are quarantined individually instead of poisoning the whole source;
- publication and serving paths must consult the same canonical disqualification ledger.

## Why This Change Is Needed

Current behavior is too blunt.

Relevant current code:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/sourceAdmissionReport.ts`
- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/sourceHealthReport.ts`
- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/articleTextService.ts`
- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/removalLedger.ts`
- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/orchestrator.ts`

Current gaps:

1. Admission is source-level only.
   - `sourceAdmissionReport.ts` samples URLs and decides `admitted/rejected/inconclusive` at the source level.
   - It does not persist bad URLs as a reusable policy artifact.
2. The extraction layer already knows how to reject removed URLs.
   - `articleTextService.ts` checks `RemovalLedger` before fetch.
   - But admission and publication do not systematically write to or consume that policy.
3. Publication does not filter known-bad URLs before clustering.
   - `orchestrator.ts` currently does `ingestFeeds -> normalizeAndDedup -> runClusterBatch` with no disqualification filter in between.
4. The current threshold is not the user’s rule.
   - admission default is `0.75` in `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/sourceAdmissionReport.ts`
   - source-health keep default is `1.0` in `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/sourceHealthReport.ts`

## Rule Definition

### Source-level rule

A source is keep-eligible when all of these are true:

1. At least 4 article-candidate samples succeed.
2. Article-candidate success rate is at least `0.50` over an 8-item sample.
3. The source is not currently unstable for non-recovered lifecycle reasons.
4. The source still contributes or corroborates under the existing source-health and contribution gates.

### Item-level rule

An individual URL is disqualified when it is an article candidate and its failure is non-retryable and policy-relevant.

Disqualified URLs must:

1. be persisted by canonical URL hash;
2. be excluded from future admission scoring as successful candidates;
3. be dropped before normalize/cluster/publish;
4. be rejected by article-text fetch;
5. never appear in user-facing published `StoryBundle.sources`, snapshots, or latest-index-backed UI output.

### Counting rule

Count only article-candidate links in the denominator.

Do not count these as article-candidate failures:

- feed-carried video/watch entries already skipped today;
- explicit non-article hub links caught before extraction;
- transient 5xx/network/timeout failures that are retryable;
- links already disqualified and skipped before scoring.

## Sampling Math

The current 4-sample default cannot express the requested soak rule well.

- with `sampleSize = 4`, a single bad link moves the source too aggressively
- soak work needs a wider sample so mixed-quality feeds can be judged more honestly

### Proposed admission math

Change the admission defaults to:

- `sampleSize = 8`
- `minimumSuccessCount = 4`
- `minimumSuccessRate = 0.50`

This makes the rule real:

- `4/8 = 50%` passes
- `3/8 = 37.5%` fails
- a single bad link no longer distorts the source-level decision

### Inconclusive floor

If fewer than 4 article-candidate URLs are available after skipping obvious non-article entries, classify the source as `inconclusive`, not `rejected`.

That prevents thin feeds from being misclassified by too little evidence.

## Canonical Persistence Decision

Reuse the existing removal ledger instead of inventing a second competing store.

Canonical policy path:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/removalLedger.ts`
- mesh path: `vh/news/removed/<urlHash>`

Why:

1. `articleTextService.ts` already enforces it.
2. `packages/gun-client/src/newsAdapters.ts` already understands `vh/news/removed/*`.
3. Reusing one path keeps extraction, publication, and moderation compatible.

### Ledger semantics

Use `RemovalLedger` as the canonical URL-disqualification ledger for system policy, not just manual moderation.

Add optional metadata fields:

- `sourceId`
- `reasonCategory`
- `observedBy`
- `firstSeenAt`
- `lastSeenAt`
- `recoverable`
- `policyScope`

Keep backward compatibility:

- existing readers must continue accepting the current minimal entry shape;
- new fields are additive.

## Failure Taxonomy

### Persist as item disqualifications

Persist only non-retryable, policy-significant failures:

- `removed`
- `access-denied`
- `domain-not-allowed`
- `quality-too-low`
- `invalid-url`
- `http-404`
- `http-410`
- `non_article_destination`
- `unsupported_link_shape`

### Do not persist as permanent disqualifications

Treat these as transient telemetry:

- timeout
- 429
- 5xx upstream failures
- temporary network failure
- retryable fetch failure

These should affect observability, but not permanently blacklist the URL.

## Implementation Shape

Create one new policy module and wire it through admission and publication.

### New module

Create:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/itemDisqualificationPolicy.ts`

Responsibilities:

1. canonicalize URL and compute `urlHash`;
2. classify article failures into `persistent_disqualification` vs `transient_failure`;
3. read/write `RemovalLedger` entries with system-policy metadata;
4. expose helpers to filter raw feed items before normalize/cluster/publish;
5. expose report helpers for admission and source-health artifacts.

This should be the single policy engine used by:

- source admission
- source health reporting
- orchestrator/publication filtering
- optional future moderation tooling

## File-by-File Implementation Plan

### 1. Admission contract and sampling

Update:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/sourceAdmissionReport.ts`

Changes:

1. Change defaults:
   - `DEFAULT_SAMPLE_SIZE` from `4` to `8`
   - `DEFAULT_MIN_SUCCESS_RATE` from `0.75` to `0.50`
   - `DEFAULT_MIN_SUCCESS_COUNT` from `2` to `4`
2. Extend `SourceAdmissionSampleResult` with explicit item classification:
   - `canonicalUrl`
   - `urlHash`
   - `candidateType: 'article' | 'video' | 'non_article'`
   - `outcome: 'passed' | 'disqualified' | 'failed_transient' | 'skipped'`
   - `disqualificationReason`
   - `persistedDisqualification`
3. Replace the current binary `passed/failed` sample model with policy-aware classification.
4. Only count article-candidate URLs in `sampleLinkCount`, `readableSampleCount`, and `readableSampleRate`.
5. Persist non-retryable bad article links through `itemDisqualificationPolicy.ts`.
6. Publish an additional artifact in the admission directory:
   - `disqualified-article-links.json`

Acceptance for this file:

- a source with `4/8` readable article candidates is `admitted`;
- a source with `3/8` is not;
- bad non-article links are skipped, not counted as source poison;
- non-retryable bad article URLs are persisted with URL hash and reason.

### 2. Source-health semantics

Update:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/sourceHealthReport.ts`

Changes:

1. Change `keepMinReadableSampleRate` default from `1.0` to `0.50`.
2. Base keep/watch/remove on article-candidate reliability, not raw mixed feed-link outcomes.
3. Add observability fields:
   - `disqualifiedArticleCount`
   - `transientArticleFailureCount`
   - `skippedNonArticleCount`
4. Ensure recovered retries do not count as persistent item disqualifications.
5. Keep the existing history/release-evidence model, but make it item-aware.

Acceptance for this file:

- a source with `>= 0.50` reliable article candidates over the 8-item soak sample can be `keep` if lifecycle and history are otherwise healthy;
- known disqualified URLs do not force the source to `watch/remove` by themselves.

### 3. Canonical URL disqualification ledger

Update:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/removalLedger.ts`
- `/Users/bldt/Desktop/VHC/VHC/packages/gun-client/src/newsAdapters.ts`

Changes:

1. Extend ledger entries with additive metadata fields for system-policy disqualifications.
2. Keep backward compatibility for current readers and tests.
3. Add convenience helpers for:
   - `writeSystemDisqualification(url, metadata)`
   - `readSystemDisqualification(urlHash)`
4. Do not rename the path in this implementation.
   - keep `vh/news/removed/<urlHash>` as the canonical wire/storage path
   - treat naming cleanup as out of scope

Acceptance for this file:

- article-text and publication can consult the same persisted URL-hash policy;
- old entries remain readable.

### 4. Article extraction enforcement

Update:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/articleTextService.ts`

Changes:

1. Keep the current pre-fetch `RemovalLedger` read.
2. Add richer logging/return context so downstream callers know when a failure came from system disqualification versus live fetch.
3. Do not make `ArticleTextService` the primary writer for policy in phase 1.
   - writing should remain centralized in `itemDisqualificationPolicy.ts` and admission/runtime callers

Acceptance for this file:

- disqualified URLs still fail fast with `removed`;
- callers can surface the disqualification reason cleanly in artifacts.

### 5. Publish-time enforcement before clustering

Update:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/orchestrator.ts`
- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/ingest.ts`
- optional new helper:
  - `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/publishableFeedItems.ts`

Changes:

1. After `ingestFeeds`, filter raw items against the canonical disqualification ledger.
2. Drop disqualified items before `normalizeAndDedup`.
3. Emit diagnostics for dropped items by source and reason.
4. Ensure the returned `PipelineResult` includes observability for filtered/disqualified item counts.

This is the critical “never served” enforcement point.

Acceptance for this file:

- a URL in `vh/news/removed/<urlHash>` never reaches `normalizeAndDedup`;
- it cannot appear in `StoryBundle.sources`;
- it cannot reach latest/hot publication through `writeStoryBundle`.

### 6. Contribution reporting

Update:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/sourceContributionReport.ts`

Changes:

1. Exclude disqualified items from normalized/bundle contribution counts.
2. Add item-policy observability:
   - `disqualifiedItemCount`
   - `transientDroppedItemCount`
3. Preserve current source contribution semantics while making the item drop behavior visible.

Acceptance for this file:

- contribution reflects publishable items, not raw feed junk.

### 7. Publication/runtime integration

Update:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/daemon.ts`
- `/Users/bldt/Desktop/VHC/VHC/packages/ai-engine/src/newsRuntime.ts`

Changes:

1. Wire the orchestrator’s new filtered-item observability into runtime logs.
2. Ensure the next runtime tick republishes bundles without disqualified sources.
3. Do not introduce a second filter after `writeStoryBundle`; keep the enforcement earlier in the pipeline.

Acceptance for this file:

- a previously published bad URL disappears on the next clean runtime tick after disqualification.

### 8. Test coverage

Update/create tests in:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/sourceAdmissionReport.test.ts`
- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/sourceHealthReport.test.ts`
- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/__tests__/articleTextService.test.ts`
- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/__tests__/removalLedger.test.ts`
- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/orchestrator.test.ts`
- `/Users/bldt/Desktop/VHC/VHC/packages/gun-client/src/newsAdapters.test.ts`

Required new cases:

1. `4/8` source admission passes.
2. `3/8` source admission fails.
3. skipped video/non-article URLs do not count against source reliability.
4. retryable failures are not permanently disqualified.
5. non-retryable failures are written to the ledger.
6. orchestrator drops ledgered URLs before normalization.
7. bundles and latest publication never contain disqualified URLs.
8. article-text rejects a disqualified URL without hitting the network.

### 9. Docs/spec updates after code lands

Update:

- `/Users/bldt/Desktop/VHC/VHC/docs/ops/NEWS_SOURCE_ADMISSION_RUNBOOK.md`
- `/Users/bldt/Desktop/VHC/VHC/docs/specs/spec-news-aggregator-v0.md`

Required doc changes:

1. soak source readiness threshold is 50% article-candidate reliability over an 8-item sample, not 100% pristine extraction;
2. item-level disqualification is now canonical policy;
3. bad links from otherwise-good sources are quarantined individually;
4. end-user serving path must exclude disqualified URLs.

## Migration / Rollout

### Phase 1: Contract and artifacts

Implement:

- `itemDisqualificationPolicy.ts`
- admission artifact changes
- ledger metadata extensions

Checkpoint:

- admission artifacts include disqualified-item output;
- no publication behavior changed yet.

### Phase 2: Source-health threshold update

Implement:

- `0.50` keep threshold
- `8`-sample admission math
- source-health observability updates

Checkpoint:

- known feeds with up to four bad links out of eight can still remain `keep` if the readable half is healthy and non-retryable bad links are quarantined individually.

### Phase 3: Publish-time enforcement

Implement:

- orchestrator disqualification filter
- runtime logging
- contribution-report updates

Checkpoint:

- a disqualified URL cannot enter a freshly published bundle.

### Phase 4: Migration sweep

Add a one-time backfill script:

- `/Users/bldt/Desktop/VHC/VHC/tools/scripts/backfill-disqualified-article-links.mjs`

Purpose:

1. read latest admission artifacts;
2. seed the ledger with already-known non-retryable bad URLs;
3. run a fresh publish tick to republish bundles without those URLs.

Checkpoint:

- latest snapshot and canary artifacts no longer contain backfilled disqualified URLs.

### Phase 5: Production-readiness confirmation

Validation commands:

1. `pnpm report:news-sources:admission`
2. `pnpm report:news-sources:health`
3. `pnpm test:storycluster:publisher-canary`
4. `pnpm test:storycluster:consumer-smoke`
5. `pnpm check:storycluster:correctness`
6. `pnpm check:storycluster:production-readiness`

Checkpoint:

- source health stays `ready/pass` under the new threshold;
- public soak still passes;
- no disqualified URL appears in user-facing story sources.

## Acceptance Criteria

We are done when all of these are true:

1. A source with `4/8` readable article candidates is kept when otherwise healthy.
2. A source with `3/8` readable article candidates is not kept.
3. Specific bad links from a keep-eligible source are written to the canonical URL-hash disqualification ledger.
4. `ArticleTextService` rejects those URLs without live fetch.
5. `orchestrateNewsPipeline()` filters those URLs before normalize/cluster/publish.
6. Published `StoryBundle.sources` and latest-index-backed consumer artifacts never contain a disqualified URL.
7. Source-health artifacts expose both source-level and item-level policy outcomes clearly enough for operator review.

## Non-Goals

This plan does not:

1. weaken the article-text quality bar;
2. auto-keep every non-paywalled source regardless of contribution or instability;
3. rename `vh/news/removed/*` to a different mesh path;
4. solve all publisher-specific HTML-hub quirks.

## Risks

1. Over-disqualification
   - If failure classification is too aggressive, we can suppress valid articles.
   - Mitigation: persist only non-retryable policy failures in phase 1.
2. Under-filtering
   - If publication filtering misses a path, bad URLs can still leak to bundles.
   - Mitigation: enforce before normalization and verify in canary/snapshot tests.
3. Artifact drift
   - If admission and source-health compute different denominators, operators will lose trust.
   - Mitigation: centralize item classification in `itemDisqualificationPolicy.ts`.

## Recommendation

Implement this as a fix-first systems rule, not as a one-off BBC-style exception.

The right architecture is:

1. keep good-enough soak sources at `50%+` article reliability across an 8-item sample;
2. quarantine bad URLs individually;
3. persist the URL-hash decision once;
4. enforce it consistently in extraction, publication, and user-facing output.
