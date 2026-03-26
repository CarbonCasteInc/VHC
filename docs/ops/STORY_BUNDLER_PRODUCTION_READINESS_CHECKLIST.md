# Story Bundler Production-Readiness Checklist (Canonical)

> Status: Operational Scorecard (Canonical)
> Owner: VHC Core Engineering
> Last Reviewed: 2026-03-25
> Depends On: `/Users/bldt/Desktop/VHC/VHC/docs/specs/spec-news-aggregator-v0.md`, `/Users/bldt/Desktop/VHC/VHC/docs/foundational/STATUS.md`, `/Users/bldt/Desktop/VHC/VHC/docs/ops/LOCAL_LIVE_STACK_RUNBOOK.md`

This document turns the remaining story-bundler hard problems into measurable gates.

Use it for two different decisions:
- **Snapshot-ready**: is the current live publication model good enough to distribute without retained-feed publication?
- **Retained-feed-ready**: has the retained-window experiment proven enough uplift to justify a publication-model change?

This scorecard does not replace the canonical product/spec contract in `/Users/bldt/Desktop/VHC/VHC/docs/specs/spec-news-aggregator-v0.md`.
It defines the operational evidence required to call the current implementation release-ready.

## Current Read (2026-03-25)

Two separate facts are true right now:

1. **Bundler quality is materially better than it was before `#467` / `#468` / `#469`.**
   - Offline replay calibration moved from broad disagreement to near-complete assignment agreement on the saved capture surface.
   - Garbage false merges and the Florida split are removed from the current replay surface.

2. **Current-`main` live public yield is not yet revalidated cleanly on the newest tip.**
   - Fresh single-run soak attempt:
     - `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/1774494701169/semantic-soak-summary.json`
     - result: `artifact_missing`
     - direct cause:
       - `/Users/bldt/Desktop/VHC/VHC/.tmp/e2e-daemon-feed/semantic-soak-1774494706163-1/webserver-qdrant.log`
       - `listen EPERM: operation not permitted 127.0.0.1:6349`
   - Manual public-stack revalidation on current `main` also failed to produce a clean yield read in this session:
     - first clean attempt hit remote timeout at the local stack default `180000ms`
     - after stale-process cleanup and timeout override, the browser store remained empty and no `/cluster` request was observed

So the latest usable public live density evidence is still the post-`#467` artifact:
- `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/1774434542001/run-1.semantic-audit.json`
- `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/1774434542001/run-1.semantic-audit-failure-snapshot.json`

That usable run shows:
- `story_count: 7`
- `auditable_count: 1`
- one 3-source Florida bundle
- no semantic contamination in the sampled bundle

Interpretation:
- the bundler is no longer obviously wrong on the measured surface
- the active blockers are now operational and architectural:
  - live public yield
  - source-health readiness
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

## Scorecard

| Gate ID | Profile | Artifact Path | Threshold | Current Read (2026-03-25) | Status |
|---|---|---|---|---|---|
| `correctness.primary` | Snapshot, Retained | `/Users/bldt/Desktop/VHC/VHC/.tmp/storycluster-production-readiness/<run>/production-readiness-report.json` and `pnpm test:storycluster:correctness` | `correctness.status == "pass"` | authoritative gate path exists; not re-run in this turn | Unknown this session |
| `sources.health` | Snapshot, Retained | `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json` | `readinessStatus == "ready"` and `watchSourceCount == 0` | latest source health was `blocked` with recent non-ready window | Fail |
| `public.soak.operational` | Snapshot, Retained | `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/<run>/semantic-soak-trend.json` | latest complete run is not `artifact_missing`, `runner_failure`, or `report_parse_error`; required attachments present | latest fresh run `1774494701169` classified `artifact_missing` | Fail |
| `public.yield.floor` | Snapshot, Retained | `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/<run>/run-1.semantic-audit-failure-snapshot.json` | `story_count >= 12` and `auditable_count >= 3` | latest usable post-`#467` run `1774434542001` had `7 stories / 1 auditable` | Fail |
| `public.yield.sample` | Snapshot, Retained | `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/<run>/run-1.semantic-audit.json` | `sample_fill_rate >= 0.5` with default public sample count | latest usable run passed only because sample count was set to `1`; no current default-sample pass | Fail |
| `public.precision` | Snapshot, Retained | `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/<run>/run-1.semantic-audit.json` | `related_topic_only_pair_count == 0` and no failing bundle labeled semantic contamination | latest usable run had `related_topic_only_pair_count: 0` | Pass on latest usable run |
| `offline.calibration.assignment` | Snapshot, Retained | `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/<run>/offline-cluster-replay-report.json` | `sourceAssignmentAgreementRate >= 0.95` | branch-local replay after `#469` reached `1.0`; current `main` still needs the merged artifact refresh | Near-pass / pending on `main` |
| `offline.calibration.precision` | Snapshot, Retained | `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/<run>/offline-cluster-replay-report.json` | no remote mismatch samples caused by obvious false merges | Elvis/ballot and Cuba/fraud are gone; Mike Waltz guard closes next false-merge family | Near-pass / pending on `main` |
| `retained.continuity` | Retained only | `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/<run>/ghost-retained-mesh-report.json` and `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/ghost-retained-mesh-trend-index.json` | `topicRetentionRate >= 0.75` and `topicDriftRate <= 0.15` across spaced executions | identity anchoring improved adjacent-run retention, but no new clean post-fix spaced ghost report yet | Unknown |
| `retained.uplift` | Retained only | `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/<run>/ghost-retained-mesh-report.json` | `laterAttachmentCount > 0`, `singletonToAuditableCount > 0`, `growingTopicCount > 0` over spaced executions | latest valid ghost report still showed all three at `0` | Fail |
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

1. **Revalidate live public yield on current `main`.**
   - The latest fresh attempt failed operationally before attachment.
   - That must be cleared before claiming any public-yield improvement from the current tip.

2. **Keep spaced retained-mesh collection running.**
   - Identity stability appears materially better than it was before `#460`.
   - What is still missing is proof of hours-scale later attachment.

3. **Refresh offline replay on merged `main` after `#469`.**
   - The proxy is already good enough for input-quality iteration.
   - The next remaining parity delta is content eligibility, not generic merge behavior.

4. **Do not call retained publication production-ready from continuity alone.**
   - Stable ids are a prerequisite.
   - They are not the success condition.
