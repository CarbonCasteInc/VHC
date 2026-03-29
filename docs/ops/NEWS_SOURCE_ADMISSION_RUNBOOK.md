# News Source Admission Runbook (Canonical)

> Status: Operational Runbook (Canonical)
> Owner: VHC Ops + Core Engineering
> Last Reviewed: 2026-03-29
> Depends On: docs/foundational/STATUS.md, docs/specs/spec-news-aggregator-v0.md, docs/CANON_MAP.md


This runbook defines the operational contract for expanding or pruning the news-source surface.

## Purpose

The feed goal is not “ingest every source on the internet.”

The feed goal is:

1. admit readable, accessible article sources;
2. publish valid single-source stories when only one readable report exists;
3. attach later corroborating coverage to the same story when other outlets begin reporting on the same incident or developing episode;
4. remove or avoid sources that consistently fail readability, accessibility, or extraction safety.

## Authoritative Code Inputs

Source admission and readable-article behavior are currently implemented in:

1. `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/sourceRegistry.ts`
2. `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/articleTextService.ts`
3. `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/fullTextFetcher.ts`
4. `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/sourceLifecycle.ts`
5. `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/sourceAdmissionReport.ts`
6. `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/sourceHealthReport.ts`
7. `/Users/bldt/Desktop/VHC/VHC/apps/web-pwa/src/server/newsSourceHealthEnv.ts`
8. `/Users/bldt/Desktop/VHC/VHC/apps/web-pwa/src/store/newsRuntimeBootstrap.ts`
9. `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/sourceCandidateScout.ts`

## Product Contract

1. A single readable article is allowed in the feed even when no bundle exists yet.
2. Under-bundling is preferable to false canonical merges.
3. Later same-incident / same-developing-episode coverage should attach under stable story identity as source coverage grows.
4. A source does not count toward the production-grade feed promise unless its article path is readable in practice.
5. Paywalled, consistently truncated, robots-blocked, or chronically unreadable sources do not belong in the production-ready source surface.

## Admission Criteria

Before adding a source to the production-ready surface:

1. RSS reachability:
   - the feed URL responds reliably and produces usable items.
2. Article accessibility:
   - representative article URLs are fetchable without paywall or routine access denial.
3. Readable extraction:
   - article text clears the current extraction-quality bar implemented in `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/articleTextService.ts`.
   - feed-carried video/watch entries do not consume readability-sampling slots; the admission pass should keep scanning until it finds the required number of non-video article candidates or exhausts the feed.
4. Runtime compatibility:
   - the source can participate in the daemon-first feed path without destabilizing release gates.
5. Evidence:
   - the lane evidence must record the sources evaluated, the article-readability outcome, and any rejection reasons.

## Rejection / Removal Criteria

Reject or remove a source from the production-ready surface when one of these becomes the norm:

1. paywall or access denial
2. robots-blocked article fetches
3. persistent truncation or empty-body extraction
4. repeated `quality-too-low` failures
5. chronic fetch failure or source instability

Public semantic-smoke scarcity alone is not a removal reason. First determine whether the problem is:

1. source visibility;
2. source overlap;
3. readability/accessibility;
4. semantic correctness.

## Scout-First Workflow

Do not start each source review from scratch.

Start with the checked-in scout surface:

1. run `pnpm scout:news-sources:candidates` or inspect the latest scout artifact at `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-scout/latest/source-candidate-scout-report.json`;
2. use the scout report as the ranked candidate queue for manual review;
3. treat `promotable=true` as “ready for minimal promotion patch + validation”, not “safe to auto-merge”;
4. treat `blocked`, `rejected`, and `inconclusive` scout outcomes as explicit operator triage inputs, not noise;
5. only fall back to manual candidate discovery when the scout backlog is exhausted or intentionally being expanded.

## Review Workflow

Use this workflow whenever the source surface changes:

1. run `pnpm scout:news-sources:candidates` and inspect the ranked scout output;
2. evaluate the top-ranked candidate RSS feed and representative article URLs;
3. confirm article readability and accessibility;
4. run `pnpm report:news-sources:admission` and inspect the generated admission artifact;
5. run `pnpm report:news-sources:health` and inspect the generated health decision artifact;
6. update the source surface only if the source passes the readable-source contract, stays `keep`, and contributes/corroborates without degrading combined release evidence;
7. confirm the latest stable source-health artifact is published at `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json`;
8. confirm the compact latest trend index is published at `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/latest/source-health-trend.json`;
9. confirm the latest scout artifact is published at `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-scout/latest/source-candidate-scout-report.json`;
10. confirm the daemon starter surface remains the authoritative keep/watch/remove enforcement path and that web/server runtime surfaces can autoload the latest health artifact through `/Users/bldt/Desktop/VHC/VHC/apps/web-pwa/src/server/newsSourceHealthEnv.ts` and `/Users/bldt/Desktop/VHC/VHC/apps/web-pwa/src/store/newsRuntimeBootstrap.ts`;
11. run the blocking StoryCluster correctness and daemon-first browser gates;
12. run `pnpm check:storycluster:production-readiness` before a production-readiness claim and confirm the combined decision resolves to `release_ready`;
13. record source-level evidence in the PR summary or lane note, including:
   - admission/health commands run;
   - scout command/report used;
   - latest artifact path;
   - keep/watch/remove outcome;
   - any rejection reasons.
14. if the source fails later in production-like testing, remove or disable it rather than weakening the readability contract.

## Required Validation

Source-surface changes should keep these in the loop:

1. `pnpm report:news-sources:admission`
2. `pnpm report:news-sources:health`
3. `pnpm scout:news-sources:candidates`
4. `pnpm test:storycluster:correctness`
5. `pnpm test:storycluster:gates`
6. `pnpm check:storycluster:production-readiness` before a production-readiness claim

Public smoke remains supplementary telemetry:

1. `pnpm test:storycluster:smoke`

Operational artifact expectations:

1. `pnpm report:news-sources:health` must publish:
   - a timestamped artifact under `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/<run-id>/`
   - a stable latest artifact under `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json`
2. release evidence should capture:
   - `readinessStatus`
   - `releaseEvidence.status`
   - `releaseEvidence.reasons`
   - `recommendedAction`
   - `keepSourceIds`
   - `watchSourceIds`
   - `removeSourceIds`
   - `historySummary`
   - latest trend index path
3. `pnpm report:news-sources:health` must also publish a compact comparison surface at:
   - `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/latest/source-health-trend.json`
4. `pnpm scout:news-sources:candidates` must publish a stable latest scout artifact at:
   - `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-scout/latest/source-candidate-scout-report.json`
   - operators should review:
     - `runAssessment.globalFeedStageFailure`
     - `promotableCandidateIds`
     - `topPromotableCandidateId`
     - per-candidate `candidateOnlyStatus`
     - per-candidate `candidateDecision`
     - per-candidate `contributionStatus`
     - per-candidate blocking reasons
   - when `runAssessment.globalFeedStageFailure` is `true`, treat the timestamped run as scout infrastructure noise and do not interpret it as candidate-quality deterioration
5. use the trend index for operator review before opening raw run artifacts:
   - compare `releaseEvidence.status`
   - compare `releaseEvidence.reasons`
   - compare `readinessStatus`
   - compare enabled/keep/watch/remove counts
   - compare `historyEscalatedSourceCount`
   - compare `pendingReadmissionSourceCount`
6. runtime evidence should identify the applied report source so operators can distinguish env overrides from the latest artifact autoload path.
7. source-health is one required input to the combined production-readiness rule, not a standalone release claim:
   - StoryCluster correctness must pass;
   - source-health release evidence must pass and remain fresh;
   - headline-soak trend release evidence must pass and remain fresh.

## Operational Interpretation

The remaining release-readiness blocker is not generic StoryCluster correctness.

The remaining blocker is building and maintaining a source surface that is:

1. readable;
2. accessible;
3. operationally stable;
4. broad enough to make the feed useful without weakening canonical precision.

## Production-Readiness Next Steps

1. Keep source growth evidence-driven: only promote the next source if scout, admission, health, contribution, and combined production-readiness evidence all stay green.
2. Broaden fixture-backed local QA so the deterministic manual stack covers more of the admitted surface, not just the current subset.
3. Treat live public feed misses as bundler inputs:
   - accumulate candidate misses;
   - triage them;
   - promote true misses into deterministic fixtures or replay scenarios.
4. Continue tightening release-readiness automation until the remaining manual release-discipline surfaces are small, explicit, and reviewable.
5. Expand source breadth only through this admission/health workflow, not by generic feed-surface growth.

## Fixture Promotion Rubric

Validation findings should continuously improve the deterministic fixture and replay corpus, but promotion must stay curated.

Rules:

1. Only promote from evidence inside the validity envelope:
   - source-health is explicit and not a `globalFeedStageFailure` fallback;
   - the underlying soak/canary artifact is complete;
   - the finding is not derived from a startup, relay, or artifact-attachment failure.
2. Do not mirror the latest public news cycle into the deterministic fixture feed.
   - `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemon-feed-fixtures.mjs` exists for stable local/manual and served-stack QA, not for rolling live-news refresh.
3. Promote live findings into one of three targets, based on intent:
   - deterministic local fixture feed when the case is primarily about UI/manual stack contract coverage;
   - benchmark/replay corpus when the case is primarily about bundler correctness or continuity;
   - validated snapshot artifacts when the case is primarily about fresher manual UI inspection.
4. A candidate should be promoted only when the expected bundle membership is reviewable and specific.
   - “interesting recent article” is not enough;
   - “same incident should merge” or “analysis/recap should stay separate” is.
5. Preferred landing zones:
   - `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/benchmarkCorpusKnownEventOngoingFixtures.ts`
   - `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/benchmarkCorpusReplayKnownEventOngoingScenarios.ts`
   - `/Users/bldt/Desktop/VHC/VHC/packages/ai-engine/src/__tests__/newsCluster.test.ts`
   - `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemon-feed-fixtures.mjs` only when manual/UI stack coverage specifically needs it
6. Use `/Users/bldt/Desktop/VHC/VHC/.tmp/findings-executor/latest-fixture-candidate-intake.json` as the formal intake queue for live-derived fixture and replay candidates.
   - executor and human reviewers should work from that artifact instead of ad hoc notes.
