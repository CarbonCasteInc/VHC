# Local Live Stack Runbook (Canonical)

> Status: Operational Runbook (Canonical)
> Owner: VHC Ops
> Last Reviewed: 2026-04-28
> Depends On: docs/foundational/STATUS.md, docs/ops/NEWS_SOURCE_ADMISSION_RUNBOOK.md, docs/ops/NEWS_UI_SOAK_LANE_SEPARATION.md, docs/ops/AUTOMATION_STACK_RUNBOOK.md, docs/CANON_MAP.md


This runbook locks local manual testing to the same production-like wiring used by live headless gates.

Lane boundary note:
- UI / UX product work and periodic soak measurement are intentionally separated.
- Use `/Users/bldt/Desktop/VHC/VHC/docs/ops/NEWS_UI_SOAK_LANE_SEPARATION.md` before combining UI work with feed-runtime or headline-soak changes.

## Purpose

Avoid drift between:
- manual browser validation
- live Playwright strict/smoke runs

All commands below use:
- local relay (`http://127.0.0.1:7777/gun`)
- local web app (`http://127.0.0.1:2048/`)
- `packages/e2e/.env.dev-small` profile
- analysis relay env (`ANALYSIS_RELAY_UPSTREAM_URL`, `ANALYSIS_RELAY_API_KEY`)

## Prerequisites

1. Export one of the following for the remote-analysis lane:
   - `ANALYSIS_RELAY_API_KEY`
   - `OPENAI_API_KEY` (used as fallback)
2. Node/pnpm installed.

The deterministic analysis-stub lane (`pnpm live:stack:up:analysis-stub`) does
not require a live model key.

## Related: Automation Stack

The automation stack (`docs/ops/AUTOMATION_STACK_RUNBOOK.md`) is a persistent `launchd`-managed local stack used by scheduled automation runs. It shares ports `7777` (relay) and `8790` (snapshot server) with this manual dev stack, so the two are mutually exclusive. Stop one before starting the other:

```bash
# If automation stack is running, stop it first:
pnpm automation:stack:stop

# Then start the manual dev stack:
pnpm live:stack:up
```

The automation stack uses port `2099` for its web preview, while this manual stack uses port `2048`. The web ports do not conflict.

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

Public/admitted-source variant:

```bash
pnpm live:stack:up:public
```

Rolling valid published-snapshot variant:

```bash
pnpm live:stack:up:validated-snapshot
```

Deterministic full-product analysis-lane variant:

```bash
pnpm live:stack:up:analysis-stub
```

Analysis-stub behavior:
- runs the same local web app, relay, StoryCluster server, fixture feed server,
  and news daemon used by `pnpm live:stack:up`;
- uses the fixture lane's immediate first daemon tick plus a long default poll
  interval, so manual/browser QA does not repeatedly rewrite the same curated
  corpus through the local mesh;
- enables publish-time bundle synthesis and points both Web PWA analysis relay
  health checks and the daemon bundle-synthesis worker at the deterministic
  local chat-completions stub;
- produces accepted `TopicSynthesisV2` records with non-empty frame/reframe
  rows and stable point IDs without depending on a live OpenAI key;
- is the preferred manual lane for testing multi-user stance/comment flows when
  release-like service wiring matters but live model credentials are absent,
  exhausted, or intentionally out of scope for the session.

Validated-snapshot behavior:
- uses a newest-first rolling stream assembled from recent passing
  publisher-canary artifacts, deduped by `story_id`
- re-resolves the latest passing artifacts while the stack is running, so a
  later passing automation canary can prepend fresh stories without restarting
  the stack
- the browser bootstrap refreshes the configured snapshot URL on an interval
  and mirrors updated `StoryBundle` output into discovery
- the feed store windows that rolling stream; scrolling reveals older retained
  stories, while reload or refresh receives the newest passing canary output
- keeps the stack in consumer mode for news
- avoids live ingest/runtime volatility while still showing recent, validity-envelope-approved `StoryBundle` output
- is the preferred manual mode when UI needs fresher realistic data than the deterministic fixture feed without depending on current public ingest luck

Refresh knobs:
- artifact root: `VH_VALIDATED_SNAPSHOT_ARTIFACT_ROOT` or
  `VH_DAEMON_FEED_PUBLISHER_CANARY_ARTIFACT_ROOT` points at
  `.tmp/daemon-feed-publisher-canary`; when unset, the local stack uses the
  current checkout artifact root if it has snapshots, otherwise the `main`
  worktree artifact root when available
- snapshot server: `VH_VALIDATED_SNAPSHOT_REFRESH_MS` (default `10000`; `0` freezes the initial artifact)
- rolling artifact window: `VH_VALIDATED_SNAPSHOT_ROLLING_ARTIFACT_LIMIT`
  (default `24` passing artifacts)
- rolling story cap: `VH_VALIDATED_SNAPSHOT_MAX_STORIES` (default `150`
  deduped stories)
- browser consumer: `VITE_NEWS_BOOTSTRAP_SNAPSHOT_REFRESH_MS` or `VH_NEWS_BOOTSTRAP_SNAPSHOT_REFRESH_MS` (default `60000`; `0` disables polling)

Status check:

```bash
pnpm live:stack:status
```

Full regression smoke (vote semantics + 3-user convergence + strict matrix N=1):

```bash
pnpm live:smoke
```

Local production preview against the running manual stack:

```bash
VITE_E2E_MODE=false \
VITE_VH_ANALYSIS_PIPELINE=true \
VITE_NEWS_RUNTIME_ENABLED=false \
VITE_NEWS_RUNTIME_ROLE=consumer \
VITE_NEWS_BRIDGE_ENABLED=true \
VITE_GUN_PEERS='["http://127.0.0.1:7777/gun"]' \
VITE_VH_GUN_WAIT_FOR_REMOTE_TIMEOUT_MS=7500 \
VITE_VH_GUN_PUT_ACK_TIMEOUT_MS=3000 \
VITE_VH_GUN_READ_TIMEOUT_MS=4000 \
VITE_VH_ANALYSIS_MESH_READ_BUDGET_MS=8000 \
VITE_NEWS_BRIDGE_REFRESH_TIMEOUT_MS=90000 \
pnpm --filter @vh/web-pwa build

pnpm --filter @vh/web-pwa preview --host 127.0.0.1 --port 2050 --strictPort
```

Preview notes:
- Use this command when validating distribution assets locally; the default web build is intentionally feature-flag neutral and can render an empty feed even while the daemon stack is healthy.
- The local production preview must use the local relay peer only. Browser console attempts to `100.75.18.26:7777` during a localhost preview indicate peer-resolution drift.

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
16. In validated-snapshot mode, confirm `/meta.json` on the snapshot server
    points at the expected latest passing publisher-canary artifact, includes a
    `rollingWindow`, reports enough stories to exceed the initial feed page
    when artifacts are available, and that the visible feed updates after the
    browser snapshot refresh interval.
17. If the lane changes source onboarding, extraction, or source reliability behavior, review `/Users/bldt/Desktop/VHC/VHC/docs/ops/NEWS_SOURCE_ADMISSION_RUNBOOK.md` and confirm the source contract still holds.
18. Confirm any newly admitted source is accessible and readable in practice:
   - no paywall-dependent article path;
   - no persistent truncation/robots-blocked behavior;
   - extraction succeeds at the required quality bar.
19. Confirm singleton-first publication remains acceptable for the changed lane:
   - single-source stories may appear in feed;
   - later same-incident / same-developing-episode coverage still attaches without identity churn where covered by the evidence set.
20. For five-user local product engagement validation, run:
   - `pnpm live:stack:up:analysis-stub`
   - `pnpm test:live:five-user-engagement`
   This creates five beta-local identities in isolated browser contexts, opens
   analysis-ready singleton and bundled stories, records reads and point-level
   stances, posts story-thread replies, and verifies aggregate stance/read
   metrics plus comments are visible across users.
   For a faster two-account test-group smoke over the same product loop, run
   `pnpm test:live:two-user-engagement`; it uses the same Playwright spec with
   two isolated identities and requires at least one singleton plus one bundled
   analysis-ready story.

## Release Gate Wiring

Current release-gate split for StoryCluster and feed correctness:

1. `CI-enforced` correctness gate:
   - `pnpm check:storycluster:correctness`
   - scoped by change detection; this is the authoritative merge gate for StoryCluster correctness when the touched lane can affect bundling/feed semantics.
2. `Manual release discipline` combined production-readiness rule:
   - `pnpm check:storycluster:production-readiness`
   - this command combines:
     - StoryCluster correctness;
     - latest source-health release evidence;
     - latest headline-soak trend release evidence.
   - refresh the headline-soak input with `pnpm collect:storycluster:headline-soak` if the latest trend artifact is missing or stale before relying on the combined decision.
   - release owners should retain the latest artifact at `/Users/bldt/Desktop/VHC/VHC/.tmp/storycluster-production-readiness/latest/production-readiness-report.json`.
3. The combined rule is only `release_ready` when all three inputs are green and fresh:
   - correctness gate status = `pass`
   - source-health release evidence status = `pass`
   - headline-soak release evidence status = `pass`
   - anything else is either `review_required` or `blocked`
4. The authoritative correctness gate is:
   - deterministic known-event fixtures in `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/benchmarkCorpusKnownEventOngoingFixtures.ts`
   - deterministic replay scenarios in `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/benchmarkCorpusReplayKnownEventOngoingScenarios.ts`
   - served daemon-first semantic audit in `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemon-first-feed-semantic-audit.live.spec.ts`
5. The fixture-backed daemon-first browser gates remain the served-stack enforcement core:
   - `pnpm --filter @vh/e2e test:live:daemon-feed:integrity-gate`
   - `pnpm --filter @vh/e2e test:live:daemon-feed:semantic-gate`
6. These gates still exercise the production stack shape:
   - daemon
   - relay
   - StoryCluster
   - web app
7. Public semantic validation remains `telemetry / review only`:
   - `pnpm test:storycluster:smoke`
8. Public smoke failures caused by insufficient auditable live bundles do not block merge by themselves; they are consumed by the headline-soak trend and can still block production readiness through the combined rule if the recent window deteriorates.
9. If CI does not run the live daemon-first gates in a fully provisioned environment, the merge/release owner must run the blocking gate manually and retain the artifacts.
10. Feed/discovery/storyline presentation or navigation changes must also carry at least one relevant Playwright/browser validation command in the lane evidence, even when the fixture-backed gates are unchanged.
11. Distribution-ready feed claims also require readable-source review:
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
  - daemon: `/tmp/vh-local-news-daemon.log`
  - StoryCluster: `/tmp/vh-local-storycluster.log`
  - fixture feed: `/tmp/vh-local-fixture-feed.log`
- `pnpm live:stack:up` is the canonical manual browser path and defaults to fixture-backed bundled-headlines mode.
- `pnpm live:stack:up:validated-snapshot` is the canonical manual browser path when UI work wants the rolling publisher-canary snapshot stream instead of deterministic fixture data.
- `tools/scripts/manual-dev.sh` is now a compatibility wrapper around the same canonical stack launcher.
- The launcher script is:
  - `tools/scripts/live-local-stack.sh`
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
