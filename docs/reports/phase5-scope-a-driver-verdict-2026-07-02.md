# Phase 5 Scope A Driver Verdict - 2026-07-02

> Status: Driver Unknown - Evidence Packet Missing
> Owner: VHC Launch Ops
> Last Reviewed: 2026-07-02
> Depends On: docs/reports/phase5-scope-a-recovery-current-state-2026-07-02.md, docs/ops/news-aggregator-production-service.md

## Scope

This is the read-only Scope A heap-growth driver verdict for the post-outage #2
program window. It does not change relay, publisher, A6, retention, compaction,
watchdog, or deploy behavior.

## Inputs Checked

- The recovery report records that #691 graph metrics and #692 early heap
  capture are enabled, and that the current gate is the 12-24 hour instrumented
  climb from the post-deploy floor.
- The repository contains the graph/heap ingestion code and the pre-outage
  2026-06-28 closure evidence.
- No post-#694 operator packet with the 12-24 hour graph-scan trend or
  early-capture retainer summary is committed in the repo.
- The documented local soak archive path,
  `~/.local/state/vhc/phase5-scope-a-soak`, is absent on this workstation.

## Verdict

`heap_driver_unknown`.

The required evidence for the four-way decision tree is not locally available:
there is no complete post-#694 time series for relay heap/RSS against graph
`userValueBytes`, tombstoned souls, link-only souls, and namespace live bytes,
and there is no secret-safe early-capture retainer summary. The correct action
is to hold all Scope A driver fixes.

## Decision Tree Position

| Candidate | Current evidence | Decision |
| --- | --- | --- |
| Live graph bytes track heap | Missing post-#694 graph/heap trend | Not selected |
| Soul count or link/tombstone structure climbs while bytes stay flat | Missing post-#694 graph/heap trend | Not selected |
| Graph bytes stay flat while heap climbs | Missing post-#694 graph/heap trend and early-capture retainer summary | Not selected |
| Heap plateaus below staggered ceilings | Missing post-#694 heap/RSS trend across the staggered ceilings | Not selected |

## Recommended Next Scope A PR

No retention, publisher clearing, relay compaction, eviction, watchdog, or
publisher/relay behavior PR is recommended from the current evidence. The next
Scope A development PR should be selected only after the operator supplies a
secret-safe packet containing:

- hourly or finer relay heap/RSS samples;
- graph scan success/truncation/error/age data;
- graph `userValueBytes` by namespace and state;
- total, live, tombstoned, and link-only soul counts;
- the #692 early-capture aggregate retainer summary, with no raw heap snapshot
  content.

If those packet inputs remain unavailable, the next repo-side PR should be an
offline packet validator/verdict generator for the existing soak archive shape,
not a heap-driver fix.

## Non-Goals

- No retention or story clearing.
- No relay-side compaction or Gun eviction.
- No A6 service action, restart, env edit, monitor enable, or deploy.
- No broad public-beta, Mesh `release_ready`, or production freshness claim.
