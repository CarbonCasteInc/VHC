# Local Live Stack Runbook (Canonical)

> Status: Operational Runbook (Canonical)
> Owner: VHC Ops
> Last Reviewed: 2026-03-18
> Depends On: docs/foundational/STATUS.md, docs/ops/NEWS_SOURCE_ADMISSION_RUNBOOK.md, docs/CANON_MAP.md


This runbook locks local manual testing to the same production-like wiring used by live headless gates.

## Purpose

Avoid drift between:
- manual browser validation
- live Playwright strict/smoke runs

All commands below use:
- local relay (`http://localhost:7777/gun`)
- local web app (`http://localhost:2048/`)
- `packages/e2e/.env.dev-small` profile
- analysis relay env (`ANALYSIS_RELAY_UPSTREAM_URL`, `ANALYSIS_RELAY_API_KEY`)

## Prerequisites

1. Export one of:
   - `ANALYSIS_RELAY_API_KEY`
   - `OPENAI_API_KEY` (used as fallback)
2. Node/pnpm installed.

## Canonical Commands

From repo root:

```bash
pnpm live:stack:up
```

Default behavior:
- fixture-backed bundled-feed mode
- local StoryCluster server
- local relay
- canonical news daemon serving the app headlines/stories
- current fixture mode is stable but only covers a representative subset of the admitted source surface, not all admitted sources

Public/admitted-source variant:

```bash
pnpm live:stack:up:public
```

Status check:

```bash
pnpm live:stack:status
```

Full regression smoke (vote semantics + 3-user convergence + strict matrix N=1):

```bash
pnpm live:smoke
```

Shutdown:

```bash
pnpm live:stack:down
```

## Browser Verification Policy

Browser-driven validation is part of distribution-readiness, not an optional add-on.

Rules:

1. Any lane that changes feed, discovery, storyline navigation, related-coverage presentation, or public semantic evidence must run at least one relevant Playwright/browser command.
2. StoryCluster semantic/integrity changes must continue to use the deterministic correctness gate plus the daemon-first semantic gate as the blocking proof:
   - `pnpm test:storycluster:correctness`
3. The authoritative correctness-gate inputs are:
   - `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/benchmarkCorpusKnownEventOngoingFixtures.ts`
   - `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/benchmarkCorpusReplayKnownEventOngoingScenarios.ts`
   - `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemon-first-feed-semantic-audit.live.spec.ts`
4. StoryCluster semantic/integrity changes must continue to use the daemon-first Playwright gates as the blocking browser proof:
   - `pnpm test:storycluster:gates`
5. Public semantic changes must continue to run the non-blocking public smoke lane and retain the artifacts:
   - `pnpm test:storycluster:smoke`
6. Browser commands and outcomes must be recorded in the lane evidence note or PR summary.
7. Unit coverage does not replace browser verification for user-facing feed/discovery/storyline changes.
8. If a daemon-first Playwright gate fails before browser assertions begin, treat it as an operational readiness failure and capture:
   - the exact failing command;
   - the health-timeout or startup error;
   - the trace/log paths from the failed run.

## DoD Validation Checklist

Use this checklist during manual browser validation:

1. Before merge/release, run `pnpm test:storycluster:gates` from repo root and require a clean pass.
2. Before merge/release of StoryCluster semantic changes, run `pnpm test:storycluster:correctness` from repo root and require a clean pass.
3. Feed loads with headlines visible.
4. Scrolling loads older headlines (infinite list behavior).
5. Pull-to-refresh / refresh button updates list.
6. Opening a previously analyzed story shows existing analysis.
7. Per-cell vote states are strictly tri-state per user: `+`, `-`, `none`.
8. Switching `+` to `-` removes prior state and applies new state.
9. Analysis persists across tabs/browsers.
10. Vote aggregates update and persist across users.
11. Opening storyline focus from the feed writes `?storyline=<id>` into route state and survives reload.
12. Route-driven storyline focus shows a clear action only.
13. Feed-opened storyline focus shows explicit `Back` and `Clear storyline` actions, and `Back` returns to the prior route state.
14. Archive-child selection inside the storyline archive writes route/search state and restores the selected child on reload.
15. Review the latest public semantic-soak artifact for:
   - `readinessStatus`
   - `promotionBlockingReasons`
   - `promotionAssessment`
16. If the lane changes source onboarding, extraction, or source reliability behavior, review `/Users/bldt/Desktop/VHC/VHC/docs/ops/NEWS_SOURCE_ADMISSION_RUNBOOK.md` and confirm the source contract still holds.
17. Confirm any newly admitted source is accessible and readable in practice:
   - no paywall-dependent article path;
   - no persistent truncation/robots-blocked behavior;
   - extraction succeeds at the required quality bar.
18. Confirm singleton-first publication remains acceptable for the changed lane:
   - single-source stories may appear in feed;
   - later same-incident / same-developing-episode coverage still attaches without identity churn where covered by the evidence set.

## Release Gate Wiring

Current release-gate split for StoryCluster and feed correctness:

1. Blocking pre-merge / pre-release gate:
   - `pnpm test:storycluster:correctness`
   - `pnpm test:storycluster:gates`
2. The authoritative correctness gate is:
   - deterministic known-event fixtures in `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/benchmarkCorpusKnownEventOngoingFixtures.ts`
   - deterministic replay scenarios in `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/benchmarkCorpusReplayKnownEventOngoingScenarios.ts`
   - served daemon-first semantic audit in `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemon-first-feed-semantic-audit.live.spec.ts`
3. The blocking gate is sequential and fixture-backed:
   - `pnpm --filter @vh/e2e test:live:daemon-feed:integrity-gate`
   - `pnpm --filter @vh/e2e test:live:daemon-feed:semantic-gate`
4. These gates still exercise the production stack shape:
   - daemon
   - relay
   - StoryCluster
   - web app
5. Public semantic validation remains non-blocking smoke:
   - `pnpm test:storycluster:smoke`
6. Public smoke failures caused by insufficient auditable live bundles do not block merge/release by themselves; they must still be reviewed as secondary distribution telemetry artifacts.
7. If CI does not run the live daemon-first gates in a fully provisioned environment, the merge/release owner must run the blocking gate manually and retain the artifacts.
8. Feed/discovery/storyline presentation or navigation changes must also carry at least one relevant Playwright/browser validation command in the lane evidence, even when the fixture-backed gates are unchanged.
9. Distribution-ready feed claims also require readable-source review:
   - use `/Users/bldt/Desktop/VHC/VHC/docs/ops/NEWS_SOURCE_ADMISSION_RUNBOOK.md` for source admission, source-health review, and removal criteria;
   - do not treat public semantic smoke scarcity by itself as proof of semantic failure when the source surface is the limiting factor.

## Source Admission Review

Source operations are now a first-class release-readiness concern.

Rules:

1. The production-grade feed promise applies only to onboarded readable, accessible, extraction-safe sources.
2. Source admission and removal are governed by `/Users/bldt/Desktop/VHC/VHC/docs/ops/NEWS_SOURCE_ADMISSION_RUNBOOK.md`.
3. If a lane changes `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/sourceRegistry.ts`, `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/articleTextService.ts`, `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/fullTextFetcher.ts`, or `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/sourceLifecycle.ts`, the evidence note must mention the source/readability impact explicitly.
4. Run `pnpm report:news-sources:health` and retain the latest stable artifact path in the evidence note.
5. Confirm the latest stable source-health artifact exists at `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json`.
6. Confirm the latest stable source-health trend index exists at `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/latest/source-health-trend.json`.
7. Use the trend index first to compare recent runs without opening raw full artifacts:
   - `releaseEvidence.status`
   - `releaseEvidence.reasons`
   - `readinessStatus`
   - enabled/keep/watch/remove counts
   - `historyEscalatedSourceCount`
   - `pendingReadmissionSourceCount`
8. Confirm runtime bootstrap applied the intended source-health policy:
   - if artifact-backed, runtime evidence should identify `artifact:/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json`;
   - if env-backed, evidence should explicitly note the override source.
9. Review keep/watch/remove outcomes from runtime evidence and confirm no unexpected source was filtered or silently retained.
10. Public semantic smoke remains useful operational telemetry, but it does not replace direct readable-source admission checks.

### StoryCluster Replay Evidence Interpretation

When reviewing StoryCluster release evidence:

1. Read `replay_continuity.continuous` as the uninterrupted identity signal.
2. Read `replay_continuity.reappearance` as the gap-return identity signal.
3. Read `replay_topology_pressure` separately:
   - it reports replay scenarios that exercised merge/split lineage
   - it is the topology-repair pressure signal, not a substitute for semantic precision
4. Do not treat low aggregate `persistence_rate` as a failure by itself if the affected scenarios are gap-return reappearance scenarios and `reappearance_rate` remains within threshold.
5. The active deterministic replay corpus now includes explicit topology-pressure scenarios:
   - zero `replay_topology_pressure.total_split_pair_activation_count` is a regression in replay coverage
   - zero `replay_topology_pressure.reactivated_scenario_count` means repeated split-pair pressure was not exercised and should be treated as a release-evidence failure

## Notes

- Logs:
  - web: `/tmp/vh-local-web.log`
  - relay: `/tmp/vh-local-relay.log`
- `pnpm live:stack:up` is the canonical manual browser path and defaults to fixture-backed bundled-headlines mode.
- use `pnpm live:stack:up` for deterministic/manual QA and `pnpm live:stack:up:public` when you need to sample the admitted public source surface.
- `tools/scripts/manual-dev.sh` is now a compatibility wrapper around the same canonical stack launcher.
- The launcher script is:
  - `tools/scripts/live-local-stack.sh`
- Gate classification:
  - CI-enforced today: `Source Health` on source-surface changes
  - manual release discipline: `pnpm test:storycluster:correctness`, `pnpm test:storycluster:gates`
  - telemetry/review only: `pnpm test:storycluster:smoke`
- Public semantic soak remains non-blocking smoke:
  - `pnpm test:storycluster:smoke`
  - inspect the soak trend/report artifacts for the explicit promotion assessment before arguing that public-feed evidence is ready to move beyond smoke-only
- Source-health evidence:
  - `pnpm report:news-sources:health`
  - inspect `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json`
  - inspect `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/latest/source-health-trend.json`
  - treat `releaseEvidence.status=fail` as a release blocker and `releaseEvidence.status=warn` as an explicit review item
  - confirm runtime evidence identifies the applied source-health report source
- If you need a different profile:
  - `ENV_FILE=/path/to/.env pnpm live:stack:up`
