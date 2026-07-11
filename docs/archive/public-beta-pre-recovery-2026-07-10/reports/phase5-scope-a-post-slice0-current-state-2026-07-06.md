# Phase 5 Scope A Post-Slice-0 Current State - 2026-07-06

> Document Role: Historical operational snapshot (non-authoritative)
> Archived: 2026-07-11
> Superseded By: `docs/ops/public-beta-operational-state.md`

> Status: Evidence-Accrual Phase
> Owner: VHC Launch Ops
> Last Reviewed: 2026-07-06
> Current main: `47ba218db2e882f07c84f952ac6802d624a7a5f0`
> Depends On: `docs/ops/news-aggregator-production-service.md`, `docs/ops/public-feed-freshness-monitor.md`, `docs/ops/vhc-incident-response.md`

## Verdict

Slice 0 is complete and the stale-feed incident that immediately followed it is
recovered. The correct posture is now wait/watch, not change.

A6 should continue publishing untouched while freshness, relay liveness, relay
snapshot freshness, and watch-closure alerting remain green. Do not restart the
publisher, restart relays, enable Codex live execution, deploy the custom pager,
or start retention/compaction/memory remediation merely because the system is
in the proof window.

The next engineering action is triggered by either:

1. a new alert email from the host-local alert watch; or
2. the first post-recovery 500 MB -> 700 MB early heap-capture summary pair.

## Current Repo And A6 State

- PR #722 is merged. The repo contains the custom pager service, GitHub
  incident bridge, responder/reviewer/verifier tools, pull-executor code, and
  pager dead-man workflow. Those components are not the active live alert path
  yet.
- PR #723 is merged. `main@47ba218d` bounds the StoryCluster production timeout
  path that caused the post-Slice-0 stale-feed incident.
- A6 was updated to `main@47ba218d`.
- `vh-news-aggregator.service` is active/running.
- `vh-storycluster-engine.service` is active/running.
- The interim email alert channel is configured in host-private env and has
  delivered both failure and recovery state changes.
- `vh-public-feed-alert-watch.timer` is enabled and active.
- `vh-phase5-scope-a-watch-closure.timer` is enabled and active.
- Codex execution/autonomy is not enabled. The executor remains a repo-side,
  dry-run-first implementation until a later approved proof window and drill
  sequence authorizes live use.

## Recovery Evidence

The failing state after Slice 0 was not alert delivery. Alerting worked and
reported a real stale-feed condition. Read-only diagnosis showed:

- publisher active/running but not completing clean publication;
- relay auth/readiness/liveness healthy;
- failure before raw relay writes with `failed_stage="orchestrating"`;
- `raw_write_attempted_count=0`;
- StoryCluster remote request timeout after 300 seconds.

PR #723 fixed the hot production path by bounding StoryCluster fallback
candidate expansion and changed-cluster topology reconciliation. After A6 was
updated, the normal production tick completed:

- started: `2026-07-06T22:41:36.892Z`;
- completed: `2026-07-06T22:44:08.567Z`;
- duration: `151675` ms;
- ingested: `24`;
- normalized: `23`;
- selected bundles: `8`;
- raw relay writes: `8` attempted, `8` wrote, `0` failed;
- public feed freshness: `pass`;
- relay liveness: `pass`;
- relay snapshot watch: `pass`;
- alert watch: `pass`, with recovery email sent.

The clean evidence window starts at `2026-07-06T22:44:08.567Z`.

## Proof Targets

| Target | Time |
| --- | --- |
| 48-hour sustained proof target | `2026-07-08T22:44:08Z` |
| 14-day unattended target, assuming no operator touch or anomaly | `2026-07-20T22:44:08Z` |

Before those targets, the watch-closure verdict is expected to remain
`in_progress` with `window_short` blockers. That is not an incident by itself.

## Heap Evidence Boundary

No post-recovery 500 MB -> 700 MB early heap-capture pair exists yet. The latest
post-recovery relay heap readback was roughly 45-57 MB, far below the first
capture threshold.

When the pair exists, run only the secret-safe analyzer summaries. Do not move
raw `.heapsnapshot` or `.heapprofile` artifacts through GitHub, email, pager
issues, or model prompts. A classified analyzer result is input to a focused
memory-remediation design; it is not authorization to run retention, compaction,
eviction, publisher clear, relay remediation, or pruning.

## Watch Item

One `system-writer-validation-failed` warning was observed during the normal
recovery tick. Because raw writes, readbacks, freshness, relay liveness, and
snapshot watch all passed, this is a watch item only. If it repeats across
normal ticks, open a focused repo-side investigation. Do not restart services or
change production state because of a single warning.

## Guardrails

- No publisher restart while feed freshness remains green.
- No relay restart while relay liveness and snapshot freshness remain green.
- No Codex executor/autonomy on live A6.
- No pager/PWA cutover before the interim email path continues to prove itself
  and the pager is deployed outside A6 with its own dead-man.
- No retention, compaction, eviction, publisher clear, or relay memory fix until
  secret-safe heap summaries name the retainer.
- Treat a new alert email as an incident, not as setup noise.
