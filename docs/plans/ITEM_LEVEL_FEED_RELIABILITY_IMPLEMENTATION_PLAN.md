# Item-Level Feed Reliability Implementation Plan

> Status: Implementation Plan
> Owner: News Aggregator + StoryCluster
> Branch: `coord/item-reliability-plan`
> Scope: define the system rule for source reliability and item eligibility without conflating soak evaluation with the product admission contract

Implementation note:

1. The current implementation sequence lands the eligibility ledger and the analysis boundary first.
2. `related_links` is now implemented as a data-model field plus a UI/runtime sidecar surfaced from article-text failures.
3. Publish-time bundle enrichment from the eligibility ledger is still a follow-on slice; until that lands, runtime-discovered `related_links` are display-only and must not widen canonical analyzed-source semantics.

## Goal

Make this an enforced system rule:

1. Soak/public-soak evaluation keeps a source when it is at least 50% article-reliable over an 8-item soak sample.
2. Product admission/readiness keeps a source only when it is at least 66% reliable over a larger rolling sample built from accumulated extraction outcomes.
3. Articles whose text cannot be extracted must never be treated as analyzed evidence or included in the framing table.
4. Legitimate source links that fail extraction may still be shown to users as raw related stories.
5. Truly bad links must be hard-blocked and never shown.

## Executive Decision

Use two separate policy layers and three item states.

### Reliability layers

1. `soak_reliability`
   - 8-item article-candidate sample
   - keep at `4/8` or better
   - only for canary, scout, consumer-smoke, and public-soak evaluation
2. `product_reliability`
   - rolling aggregate built from dozens of article extraction outcomes over time
   - keep at `>= 0.66`
   - governs real source admission, starter-surface retention, and production readiness

### Item eligibility states

1. `analysis_eligible`
   - text extraction succeeded
   - may be used in clustering provenance, synthesis, semantic audit, and framing tables
2. `link_only`
   - URL is legitimate and may still be shown to the user as a related story link
   - text extraction failed or was not good enough for analysis
   - must not be used in synthesis, framing, or canonical analysis claims
3. `hard_blocked`
   - invalid, dead, access-denied, or policy-forbidden URL
   - must not be analyzed or shown

This is the core design correction.

Do not collapse all extraction failures into a permanent never-serve ledger.

## Why This Change Is Needed

Current behavior is too blunt and uses the wrong boundary.

Relevant current code:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/sourceAdmissionReport.ts`
- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/sourceHealthReport.ts`
- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/articleTextService.ts`
- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/removalLedger.ts`
- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/orchestrator.ts`
- `/Users/bldt/Desktop/VHC/VHC/packages/data-model/src/schemas/hermes/storyBundle.ts`
- `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/bundleProjection.ts`
- `/Users/bldt/Desktop/VHC/VHC/apps/web-pwa/src/components/feed/NewsCard.tsx`

Current gaps:

1. Admission is source-level only and has no first-class item eligibility contract.
2. The extraction layer already supports hard blocks via `RemovalLedger`, but that is too strong a tool for every non-extractable article.
3. Publication currently has no explicit boundary between:
   - canonical analyzable sources
   - raw related links that are display-only
4. The existing `StoryBundle` contract has no field for “possible sources shown but not analyzed.”

## Correct System Rule

### Source-level rule

A source decision depends on two different measurements.

#### Soak rule

Use this only in soak/public-soak evaluation:

1. sample 8 article-candidate links
2. keep if at least 4 are extraction-successful
3. do not let soak math rewrite the canonical product admission thresholds

#### Product rule

Use this for starter-surface admission and production readiness:

1. aggregate extraction outcomes over a much larger rolling sample
2. keep only when reliable article outcomes are at least `66%`
3. include historical bad-link pressure in the decision, not just the latest run

### Item-level rule

Each URL must resolve to exactly one item-eligibility state:

1. `analysis_eligible`
2. `link_only`
3. `hard_blocked`

### Serving rule

1. `analysis_eligible`
   - may appear in canonical story provenance and analysis flows
2. `link_only`
   - may appear only in a bottom-of-card related stories section
   - must not be treated as evidence for synthesis or framing
3. `hard_blocked`
   - may not be served anywhere

## Canonical Persistence Decision

Keep two policy stores with different semantics.

### A. Hard-block ledger

Keep using the existing path for true never-serve entries:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/removalLedger.ts`
- mesh path: `vh/news/removed/<urlHash>`

Use this only for `hard_blocked` URLs.

Examples:

- invalid URL
- 404 / 410 dead link
- access denied
- explicit publisher/policy removal
- domain-not-allowed
- permanent non-article destination

### B. Item eligibility store

Add a separate canonical store for `analysis_eligible` vs `link_only` decisions.

Create:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/itemEligibilityLedger.ts`

Suggested shape:

- key by `urlHash`
- include:
  - `canonicalUrl`
  - `sourceId`
  - `eligibilityState`
  - `reason`
  - `firstSeenAt`
  - `lastSeenAt`
  - `observationCount`
  - `lastObservedOutcome`
  - `recoverable`

Do not overload `vh/news/removed/*` for `link_only` items.

## Failure Taxonomy

### `analysis_eligible`

Examples:

- article extraction succeeded
- quality passed

### `link_only`

Examples:

- legitimate article URL but extraction quality too low
- readable shell but insufficient body text
- temporary extractor miss on a valid article page

These links may still be shown as related stories.

### `hard_blocked`

Examples:

- invalid URL
- `http-404`
- `http-410`
- `access-denied`
- `domain-not-allowed`
- `unsupported_link_shape`
- `non_article_destination`

These must not be shown.

## Counting and Metrics

### Soak metrics

For soak/public-soak only:

1. denominator is 8 article-candidate URLs
2. success means `analysis_eligible`
3. `link_only` counts as non-success for analysis reliability
4. `hard_blocked` counts as non-success and must be recorded separately

### Product metrics

Do not derive product readiness from soak math.

Product reliability must use accumulated extraction outcomes over time:

1. rolling article attempt count
2. rolling `analysis_eligible` rate
3. rolling `link_only` rate
4. rolling `hard_blocked` rate
5. source-level trend and contribution evidence

### Historical pressure

Do not let persisted entries disappear from the health picture.

The system needs both:

1. current-run reliability
2. rolling bad-link pressure

That prevents the source from appearing healthier just because old bad links were already classified once.

## Thin-Feed Rule

The previous draft’s inconclusive floor was too strict.

For specialist or thin feeds:

1. if at least 3 article-candidate URLs exist and all 3 are `analysis_eligible`, allow `provisional_keep_for_soak`
2. do not automatically promote that into product keep
3. require larger rolling evidence before product admission uses the source as a true keep

This keeps useful narrow feeds from being stranded forever while preserving a higher production bar.

## Canonical Publication Contract

This is the most important boundary.

### Canonical analysis inputs

Only `analysis_eligible` items may enter:

- `StoryBundle.sources`
- `StoryBundle.primary_sources`
- synthesis prompts in `/Users/bldt/Desktop/VHC/VHC/packages/ai-engine/src/bundlePrompts.ts`
- semantic audit canonical source sets
- framing table inputs in the UI analysis pipeline

### Raw related-link display

`link_only` items may be shown only through a new display-only field.

Do not overload:

- `sources`
- `primary_sources`
- `secondary_assets`

Instead add a distinct field, for example:

- `related_links`

Suggested schema entry:

- `source_id`
- `publisher`
- `url`
- `url_hash`
- `title`
- `eligibility_state`
- `display_reason`

### Hard-blocked items

`hard_blocked` items must appear nowhere in published bundles or UI-facing snapshots.

## Data Model Changes

Update:

- `/Users/bldt/Desktop/VHC/VHC/packages/data-model/src/schemas/hermes/storyBundle.ts`

Add a new optional field:

- `related_links`

This should be display-only, not canonical source provenance.

Do not change the meaning of:

- `sources`
- `primary_sources`
- `secondary_assets`

## File-by-File Implementation Plan

### 1. Item eligibility policy

Create:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/itemEligibilityPolicy.ts`

Responsibilities:

1. classify item outcomes into `analysis_eligible | link_only | hard_blocked`
2. decide whether a failed extraction is displayable or forbidden
3. write `hard_blocked` entries to `RemovalLedger`
4. write `analysis_eligible/link_only` observations to `itemEligibilityLedger`
5. expose helpers for soak metrics and product metrics

This module must become the single policy engine.

### 2. Soak admission evaluation

Update:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/sourceAdmissionReport.ts`

Changes:

1. add an explicit soak-evaluation mode instead of replacing canonical defaults globally
2. use:
   - `sampleSize = 8`
   - `minimumSuccessCount = 4`
   - `minimumSuccessRate = 0.50`
   only when the soak mode is selected
3. extend `SourceAdmissionSampleResult` to record:
   - `canonicalUrl`
   - `urlHash`
   - `candidateType`
   - `eligibilityState`
   - `reason`
   - `persistedToHardBlockLedger`
   - `persistedToEligibilityLedger`
4. allow `3/3` thin-feed provisional soak keep
5. publish separate soak artifacts for:
   - `analysis-eligible-links.json`
   - `link-only-links.json`
   - `hard-blocked-links.json`

Acceptance:

- soak evaluation can keep a source at `4/8`
- this does not rewrite the repo-wide product default thresholds

### 3. Product reliability aggregation

Update:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/sourceHealthReport.ts`

Changes:

1. keep the product rule separate from the soak rule
2. add rolling metrics derived from accumulated item observations:
   - `analysisEligibleRate`
   - `linkOnlyRate`
   - `hardBlockedRate`
   - `rollingAttemptCount`
3. make the product keep decision depend on:
   - `analysisEligibleRate >= 0.66`
   - enough rolling attempts to be meaningful
   - existing lifecycle/history gates
4. add source-health observability for both soak and product measurements

Acceptance:

- source-health no longer treats the soak threshold as the canonical product threshold
- product keep remains a higher bar than soak keep

### 4. Hard-block ledger

Update:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/removalLedger.ts`
- `/Users/bldt/Desktop/VHC/VHC/packages/gun-client/src/newsAdapters.ts`

Changes:

1. keep backward compatibility
2. use this path only for `hard_blocked`
3. add optional metadata fields needed for system-policy provenance

Acceptance:

- hard-blocked URLs are truly never served
- `link_only` items are not accidentally swallowed by the removal path

### 5. Item eligibility ledger

Create:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/itemEligibilityLedger.ts`

Changes:

1. persist `analysis_eligible` and `link_only` observations separately from hard blocks
2. aggregate repeated observations over time
3. support rolling product reliability calculations

Acceptance:

- the system can distinguish between “not analyzable” and “must never show”

### 6. Orchestrator / publication boundary

Update:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/orchestrator.ts`
- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/ingest.ts`
- optional helper:
  - `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/publishableFeedItems.ts`

Changes:

1. after ingest, classify raw items with `itemEligibilityPolicy.ts`
2. allow only `analysis_eligible` items into normalize/cluster/publish
3. collect `link_only` items into a sidecar related-links list by story/topic where possible
4. drop `hard_blocked` items completely
5. expose diagnostics in `PipelineResult`

Acceptance:

- canonical story bundles are built only from analyzable evidence
- legitimate non-extractable links can still be preserved for display

### 7. Story bundle contract

Update:

- `/Users/bldt/Desktop/VHC/VHC/packages/data-model/src/schemas/hermes/storyBundle.ts`
- any dependent type exports in `/Users/bldt/Desktop/VHC/VHC/packages/ai-engine/src/newsTypes.ts`

Changes:

1. add optional `related_links`
2. keep `sources` and `primary_sources` as analysis-only
3. keep `secondary_assets` for its current role, not for extraction-failed article links

Acceptance:

- the data model distinguishes analyzed evidence from raw related links

### 8. StoryCluster projection and runtime

Update:

- `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/bundleProjection.ts`
- `/Users/bldt/Desktop/VHC/VHC/packages/ai-engine/src/newsRuntime.ts`

Changes:

1. preserve canonical-source semantics for `primary_sources`
2. never widen canonical bundle evidence with `link_only` items
3. ensure runtime publication carries `related_links` separately if available

Acceptance:

- framing and semantic audit continue to rely only on analyzable sources

### 9. Analysis and framing boundary

Update:

- `/Users/bldt/Desktop/VHC/VHC/packages/ai-engine/src/bundlePrompts.ts`
- `/Users/bldt/Desktop/VHC/VHC/apps/web-pwa/src/components/feed/useAnalysis.ts`
- any news-card analysis helpers under `/Users/bldt/Desktop/VHC/VHC/apps/web-pwa/src/components/feed/`

Changes:

1. ensure synthesis prompts use only canonical analyzable sources
2. ensure the framing/analysis table never claims coverage from `link_only` URLs
3. if the UI displays related links, render them separately from analyzed source badges

Acceptance:

- analysis output is honest about what was and was not actually read

### 10. UI related-stories surface

Update:

- `/Users/bldt/Desktop/VHC/VHC/apps/web-pwa/src/components/feed/NewsCard.tsx`
- `/Users/bldt/Desktop/VHC/VHC/apps/web-pwa/src/components/feed/SourceBadgeRow.tsx`
- add a new component, for example:
  - `/Users/bldt/Desktop/VHC/VHC/apps/web-pwa/src/components/feed/RelatedStoriesLinks.tsx`

Changes:

1. keep `SourceBadgeRow` for analyzed canonical sources
2. add a bottom-of-card related stories section for `related_links`
3. label the section clearly so it is not mistaken for analysis evidence

Acceptance:

- end users can still see useful raw source links without the app claiming those links informed the analysis

### 11. Immediate scrub semantics

If a URL transitions to `hard_blocked`, the system must scrub already-published surfaces immediately.

Update:

- publication helpers and snapshot builders used by:
  - `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemon-feed-validated-snapshot-server.mjs`
  - latest published bundle refresh paths

Required behavior:

1. remove hard-blocked URLs from published bundles on the next scrub pass
2. rebuild latest snapshot artifacts after a hard-block write
3. do not require waiting for a normal runtime tick to stop serving a hard-blocked URL

This is the real fix for the earlier “never served” gap.

### 12. Tests

Update/create tests in:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/sourceAdmissionReport.test.ts`
- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/sourceHealthReport.test.ts`
- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/__tests__/articleTextService.test.ts`
- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/__tests__/removalLedger.test.ts`
- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/orchestrator.test.ts`
- `/Users/bldt/Desktop/VHC/VHC/packages/data-model/src/schemas/hermes/storyBundle.test.ts`
- relevant UI tests under `/Users/bldt/Desktop/VHC/VHC/apps/web-pwa/src/components/feed/`

Required new cases:

1. soak `4/8` keep passes without changing product defaults
2. product keep still requires rolling `>= 0.66`
3. `3/3` thin-feed provisional soak keep works
4. extraction-failed but legitimate URLs become `link_only`
5. dead/forbidden URLs become `hard_blocked`
6. `link_only` URLs do not enter synthesis/framing inputs
7. `link_only` URLs can still render in the related stories UI section
8. `hard_blocked` URLs are absent from both analysis and display surfaces

## Migration / Rollout

### Phase 1: Policy separation

Implement:

- `itemEligibilityPolicy.ts`
- `itemEligibilityLedger.ts`
- soak vs product rule separation in docs and code

Checkpoint:

- no more ambiguity between soak thresholds and product thresholds

### Phase 2: Publication boundary

Implement:

- analysis-only canonical sources
- `related_links` sidecar path
- hard-block filtering

Checkpoint:

- analysis and framing only use extractable sources
- related links are display-only

### Phase 3: Safe backfill

Do not backfill from a single latest admission artifact.

Instead add a guarded script:

- `/Users/bldt/Desktop/VHC/VHC/tools/scripts/backfill-item-eligibility.mjs`

Rules:

1. only backfill `hard_blocked` from a strict whitelist of reasons
2. require repeated observation or manual approval for permanent hard-block entries
3. allow softer historical entries to seed `link_only`, not `hard_blocked`

Checkpoint:

- no one-off noisy run can create a permanent never-serve entry by itself

### Phase 4: Production-readiness confirmation

Validation commands:

1. `pnpm report:news-sources:admission`
2. `pnpm report:news-sources:health`
3. `pnpm test:storycluster:publisher-canary`
4. `pnpm test:storycluster:consumer-smoke`
5. `pnpm check:storycluster:correctness`
6. `pnpm check:storycluster:production-readiness`

Checkpoint:

- source health reports the correct product rule
- public soak reports the correct soak rule
- canonical analysis never claims non-extractable URLs as evidence
- related raw links still show where allowed

## Acceptance Criteria

We are done when all of these are true:

1. Soak/public-soak can keep a source at `4/8` without rewriting the canonical product rule.
2. Product source-health still requires rolling `>= 0.66` analyzable reliability over a larger sample.
3. The system distinguishes `analysis_eligible`, `link_only`, and `hard_blocked` item states.
4. `analysis_eligible` items alone drive synthesis, semantic audit, framing, and canonical source badges.
5. `link_only` items may appear only in a clearly separate related stories section.
6. `hard_blocked` items are never shown or analyzed.
7. Safe backfill rules prevent single noisy runs from creating permanent never-serve entries.

## Non-Goals

This plan does not:

1. lower the canonical product admission bar to the soak threshold;
2. claim every non-paywalled URL is analyzable;
3. overload `secondary_assets` with extraction-failed article links;
4. use a single ledger for both display-only links and hard-blocked links.

## Recommendation

Implement this as a contract split, not as a threshold tweak.

The right architecture is:

1. soak keeps feeds at `50% over 8` for operational evaluation;
2. product keeps feeds at `66%+` over a larger rolling extraction record;
3. non-extractable but legitimate links become `link_only`;
4. truly bad links become `hard_blocked`;
5. only analyzable links inform analysis and framing;
6. raw related links can still be shown without misrepresenting them as analyzed evidence.
