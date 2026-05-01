# Story Bundler Production-Readiness Checklist (Canonical)

> Status: Operational Scorecard (Canonical)
> Owner: VHC Core Engineering
> Last Reviewed: 2026-03-28
> Depends On: `/Users/bldt/Desktop/VHC/VHC/docs/specs/spec-news-aggregator-v0.md`, `/Users/bldt/Desktop/VHC/VHC/docs/foundational/STATUS.md`, `/Users/bldt/Desktop/VHC/VHC/docs/ops/LOCAL_LIVE_STACK_RUNBOOK.md`

This document turns the remaining story-bundler hard problems into measurable gates.

Use it for two different decisions:
- **Snapshot-ready**: is the current live publication model good enough to distribute without retained-feed publication?
- **Retained-feed-ready**: has the retained-window experiment proven enough uplift to justify a publication-model change?

This scorecard does not replace the canonical product/spec contract in `/Users/bldt/Desktop/VHC/VHC/docs/specs/spec-news-aggregator-v0.md`.
It defines the operational evidence required to call the current implementation release-ready.

## Current Read (2026-03-28)

Two separate facts are true right now:

1. **Current `main` is operationally healthy enough to keep collecting real headline evidence again.**
   - Fresh combined readiness artifact:
     - `/Users/bldt/Desktop/VHC/VHC/.tmp/storycluster-production-readiness/latest/production-readiness-report.json`
     - `correctnessGate.status: "pass"`
     - `sourceHealthTrend.releaseEvidence.status: "pass"`
     - starter surface: `24` keep / `0` watch / `0` remove
   - Fresh source-health artifact:
     - `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json`
     - `readinessStatus: "ready"`
     - `releaseEvidence.status: "pass"`
     - AP Top News is now in the starter surface.

2. **Headline-soak release evidence is still the blocker, even though startup and source health recovered.**
   - Latest complete usable post-fix soak:
     - `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/1774695043848/run-1.semantic-audit.json`
     - `story_count: 4`
     - `auditable_count: 1`
     - `sample_fill_rate: 1`
     - `audited_pair_count: 1`
     - `related_topic_only_pair_count: 0`
     - `article_fetch_failure_count: 0`
   - Latest headline-soak trend execution:
     - `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/1774707755214/semantic-soak-summary.json`
     - `readinessStatus: "not_ready"`
     - classification: `artifact_missing`
   - Fresh combined readiness artifact still blocks on:
     - `headline_soak_release_evidence_failed`

Interpretation:
- the integrated app can move forward in constrained beta on current `main`
- the live corroborated-headlines lane is still not production-ready
- the active blockers are now:
  - headline-soak release evidence
  - live public yield
  - retained-window uplift proof

## Evidence Sources

Use the latest complete artifacts only.

Primary paths:
- Public semantic soak:
  - `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/<run>/semantic-soak-summary.json`
  - `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/<run>/semantic-soak-trend.json`
  - `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/<run>/run-1.semantic-audit.json`
  - `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/<run>/run-1.semantic-audit-failure-snapshot.json`
  - `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/<run>/run-1.retained-source-evidence.json`
  - `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/<run>/ghost-retained-mesh-report.json`
  - `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/ghost-retained-mesh-trend-index.json`
- Offline replay calibration:
  - `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/<run>/offline-cluster-replay-report.json`
  - `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/offline-cluster-replay-trend-index.json`
- Source health:
  - `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json`
  - `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/latest/source-health-trend.json`
- Unified readiness:
  - `/Users/bldt/Desktop/VHC/VHC/.tmp/storycluster-production-readiness/<run>/production-readiness-report.json`
- Analysis/eval artifacts:
  - `/Users/bldt/Desktop/VHC/VHC/.tmp/analysis-eval-artifacts/analysis-eval-artifacts.jsonl`
  - `/Users/bldt/Desktop/VHC/VHC/.tmp/analysis-eval-artifacts/artifacts/analysis-eval:<hash>.json`
  - See `/Users/bldt/Desktop/VHC/VHC/docs/ops/ANALYSIS_EVAL_ARTIFACTS.md` for the weak-label policy and review workflow.

## Release Profiles

### Profile A: Snapshot-Ready

Choose this profile if the current live snapshot publication model is good enough without retained-feed publication.

Required gates:
1. primary correctness
2. source-health readiness
3. public soak operational reliability
4. live public auditable yield
5. semantic precision cleanliness

Retained uplift is **not** required for this profile.

### Profile B: Retained-Feed-Ready

Choose this profile only if the product decision is to publish retained topics rather than treating retention as telemetry only.

Required gates:
1. everything in Snapshot-Ready
2. retained continuity stability
3. retained uplift over time
4. lifecycle/decay policy explicitly written and accepted

## Beta Distribution Posture

Current posture on `main`:

1. The integrated VENN/HERMES/AGORA application is available for constrained beta distribution.
2. The live corroborated-headlines lane remains beta-gated by `/Users/bldt/Desktop/VHC/VHC/.tmp/storycluster-production-readiness/latest/production-readiness-report.json`.
3. Do not make a production-grade live-news claim until:
   - source-health release evidence remains green;
   - headline-soak release evidence recovers;
   - the combined readiness artifact resolves to `release_ready`.

## Scorecard

| Gate ID | Profile | Artifact Path | Threshold | Current Read (2026-03-28) | Status |
|---|---|---|---|---|---|
| `correctness.primary` | Snapshot, Retained | `/Users/bldt/Desktop/VHC/VHC/.tmp/storycluster-production-readiness/<run>/production-readiness-report.json` and `pnpm test:storycluster:correctness` | `correctness.status == "pass"` | fresh combined report records `correctnessGate.status: "pass"` | Pass |
| `sources.health` | Snapshot, Retained | `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json` | `readinessStatus == "ready"` and `watchSourceCount == 0` and `releaseEvidence.status == "pass"` | fresh latest source-health report is `ready/pass` with `24 keep / 0 watch / 0 remove` | Pass |
| `public.soak.operational` | Snapshot, Retained | `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/<run>/semantic-soak-trend.json` | latest complete run is not `artifact_missing`, `runner_failure`, or `report_parse_error`; required attachments present | latest headline-soak trend execution `1774707755214` classified `artifact_missing` | Fail |
| `public.yield.floor` | Snapshot, Retained | `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/<run>/run-1.semantic-audit-failure-snapshot.json` | `story_count >= 12` and `auditable_count >= 3` | latest usable complete run `1774695043848` had `4 stories / 1 auditable` | Fail |
| `public.yield.sample` | Snapshot, Retained | `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/<run>/run-1.semantic-audit.json` | `sample_fill_rate >= 0.5` with default public sample count | latest usable run passed with `requested_sample_count = 1`; default-sample evidence still missing | Fail |
| `public.precision` | Snapshot, Retained | `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/<run>/run-1.semantic-audit.json` | `related_topic_only_pair_count == 0` and no failing bundle labeled semantic contamination | latest usable run had `related_topic_only_pair_count: 0` and `article_fetch_failure_count: 0` | Pass on latest usable run |
| `offline.calibration.assignment` | Snapshot, Retained | `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/<run>/offline-cluster-replay-report.json` | `sourceAssignmentAgreementRate >= 0.95` | current `main` still needs a fresh merged replay artifact refresh after the latest source/batch changes | Pending refresh |
| `offline.calibration.precision` | Snapshot, Retained | `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/<run>/offline-cluster-replay-report.json` | no remote mismatch samples caused by obvious false merges | current `main` still needs a fresh merged replay artifact refresh after the latest source/batch changes | Pending refresh |
| `retained.continuity` | Retained only | `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/<run>/ghost-retained-mesh-report.json` and `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/ghost-retained-mesh-trend-index.json` | `topicRetentionRate >= 0.75` and `topicDriftRate <= 0.15` across spaced executions | latest continuity telemetry remains far below threshold on the available sample-backed run | Fail |
| `retained.uplift` | Retained only | `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/<run>/ghost-retained-mesh-report.json` | `laterAttachmentCount > 0`, `singletonToAuditableCount > 0`, `growingTopicCount > 0` over spaced executions | latest valid ghost report still shows all three at `0` | Fail |
| `retained.policy` | Retained only | explicit RFC/doc path once written | retained identity, update-in-place, and decay semantics approved in writing | not written yet | Fail |

## Why These Thresholds

### Public Yield Thresholds

`story_count >= 12` and `auditable_count >= 3` are the minimum release floor for the current live snapshot model because:
- fewer than 12 live stories is too sparse to call the feed operationally healthy
- fewer than 3 auditable stories does not provide enough multi-source overlap to trust the public story surface as distribution-grade

`sample_fill_rate >= 0.5` is the minimum evidence floor for the public semantic soak because:
- a smoke lane that can only sample one story on a default sample target is still too thin to act as meaningful release telemetry

### Retained Thresholds

Continuity without uplift is not enough.

Retained publication should not ship merely because identity is stable.
It must prove that topics actually grow over time:
- later attachments happen
- singletons become corroborated
- retained topics gain evidence rather than just persisting

## How To Use This Scorecard

### To Judge Snapshot-Ready

Run:

```bash
cd /Users/bldt/Desktop/VHC/VHC
pnpm test:storycluster:correctness
pnpm report:news-sources:health
VH_DAEMON_FEED_SOAK_RUNS=1 pnpm collect:storycluster:headline-soak
pnpm report:storycluster:production-readiness
```

Snapshot-ready is allowed only if:
- `correctness.primary` passes
- `sources.health` passes
- `public.soak.operational` passes
- `public.yield.floor` passes
- `public.yield.sample` passes
- `public.precision` passes

### To Judge Retained-Feed-Ready

Keep the spaced single-run automation active, then read:

```bash
cd /Users/bldt/Desktop/VHC/VHC
pnpm report:storycluster:offline-cluster-replay
pnpm report:storycluster:production-readiness
```

Retained-feed-ready is allowed only if:
- every Snapshot-Ready gate passes
- `retained.continuity` passes
- `retained.uplift` passes
- `retained.policy` passes

## Immediate Next Actions

In priority order:

1. **Recover headline-soak trend evidence, not just isolated successful runs.**
   - The latest combined readiness artifact is fresh and blocks only on `headline_soak_release_evidence_failed`.
   - The next milestone is promotable trend recovery, not another one-off source expansion.

2. **Keep spaced retained-mesh collection running.**
   - Identity stability appears materially better than it was before `#460`.
   - What is still missing is proof of hours-scale later attachment.

3. **Refresh offline replay on current `main` after the latest source/batch changes.**
   - The proxy is already good enough for input-quality iteration.
   - The next remaining parity delta is content eligibility, not generic merge behavior.

4. **Ship the integrated app only under the explicit beta posture until the scorecard clears.**
   - Stable ids and improved source breadth are prerequisites.
   - They are not the success condition for a production-grade live-news claim.
