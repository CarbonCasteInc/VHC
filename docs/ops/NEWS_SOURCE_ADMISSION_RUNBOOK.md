# News Source Admission Runbook (Canonical)

> Status: Operational Runbook (Canonical)
> Owner: VHC Ops + Core Engineering
> Last Reviewed: 2026-03-16
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

## Review Workflow

Use this workflow whenever the source surface changes:

1. evaluate the candidate RSS feed and representative article URLs;
2. confirm article readability and accessibility;
3. run `pnpm report:news-sources:admission` and inspect the generated admission artifact;
4. run `pnpm report:news-sources:health` and inspect the generated health decision artifact;
5. update the source surface only if the source passes the readable-source contract;
6. confirm the latest stable source-health artifact is published at `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json`;
7. confirm the web runtime is prepared to autoload and enforce the latest health policy through `/Users/bldt/Desktop/VHC/VHC/apps/web-pwa/src/server/newsSourceHealthEnv.ts` and `/Users/bldt/Desktop/VHC/VHC/apps/web-pwa/src/store/newsRuntimeBootstrap.ts`;
8. run the blocking StoryCluster correctness and daemon-first browser gates;
9. record source-level evidence in the PR summary or lane note, including:
   - admission/health commands run;
   - latest artifact path;
   - keep/watch/remove outcome;
   - any rejection reasons.
10. if the source fails later in production-like testing, remove or disable it rather than weakening the readability contract.

## Required Validation

Source-surface changes should keep these in the loop:

1. `pnpm report:news-sources:admission`
2. `pnpm report:news-sources:health`
3. `pnpm test:storycluster:correctness`
4. `pnpm test:storycluster:gates`

Public smoke remains supplementary telemetry:

1. `pnpm test:storycluster:smoke`

Operational artifact expectations:

1. `pnpm report:news-sources:health` must publish:
   - a timestamped artifact under `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/<run-id>/`
   - a stable latest artifact under `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json`
2. release evidence should capture:
   - `readinessStatus`
   - `recommendedAction`
   - `keepSourceIds`
   - `watchSourceIds`
   - `removeSourceIds`
3. runtime evidence should identify the applied report source so operators can distinguish env overrides from the latest artifact autoload path.

## Operational Interpretation

The remaining release-readiness blocker is not generic StoryCluster correctness.

The remaining blocker is building and maintaining a source surface that is:

1. readable;
2. accessible;
3. operationally stable;
4. broad enough to make the feed useful without weakening canonical precision.

## Production-Readiness Next Steps

1. Converge starter-surface generation and runtime selection onto the same source-health-derived source set.
2. Make `pnpm report:news-sources:health` mandatory release evidence for feed/source-surface changes.
3. Codify watchlist escalation, removal, and re-admission thresholds so source decisions are deterministic.
4. Add source-health observability for:
   - readable success rate;
   - access-denied rate;
   - quality-too-low failures;
   - lifecycle instability;
   - actual feed contribution by source.
5. Expand source breadth only through this admission/health workflow, not by generic feed-surface growth.
