# Phase 5 Scope A 24h/48h Watch Closure Packet

> Document Role: Historical watch packet (non-authoritative)
> Archived: 2026-07-11
> Superseded By: `docs/ops/public-beta-operational-state.md`

> Status: In-Progress Evidence Packet
> Generated: 2026-06-28T14:09:30Z
> Evidence: `docs/reports/evidence/phase5-scope-a-watch-closure-2026-06-28.json`
> Scope: read-only host and public-feed observation; no deploy, restart, env
> change, scrub, or live mesh write.

## Verdict

The Scope A raw path remains clean after the #687 overlap tick, but the watch is
not closed yet.

| Gate | Status | Reason |
| --- | --- | --- |
| 24h checkpoint | `not_ready` | clean window is 12.79h / 24h |
| 48h proven-sustained | `not_ready` | clean window is 12.79h / 48h |
| Raw Scope A signals | `clean_so_far` | 76 clean ticks, 608/608 raw writes, zero failed/skipped ticks, zero raw write failures |
| StoryCluster truncation/degeneracy | `clean_so_far` | zero new OpenAI failure artifacts and zero degeneracy warnings after the clean-start boundary |
| Relay memory slope | `not_extrapolation_safe_yet` | relays B/C project to heap/RSS limits before the 7-day trend horizon if the current slope persists |

The packet therefore supports: **Scope A is still healthy in the current bake
window.** It does not yet support: **24h closed**, **48h proven-sustained**,
**multi-day memory trend safe**, **single-host A6 topology resilience**,
**weekly-cycle stability**, or **Scope B enrichment readiness**.

## Window Boundary

- Watch observation start: `2026-06-27T22:30:00Z`
- Clean-start boundary: `2026-06-28T01:22:24Z`
- Reason for boundary: tick 77 was the expected restart-overlap prewrite skip.
- Clean runtime range: ticks 78 through 153.
- Clean elapsed time at packet generation: 12.79h.

## Runtime Evidence

Read-only journal summary for the clean window:

| Signal | Value |
| --- | ---: |
| Ticks | 76 |
| Failed ticks | 0 |
| Skipped ticks | 0 |
| Raw writes attempted | 608 |
| Raw writes completed | 608 |
| Raw write failures | 0 |
| `nonfatal_prewrite_failure_count` | 0 |

Latest publisher liveness sample:

| Signal | Value |
| --- | --- |
| Unit | `vh-news-aggregator.service` |
| Active state | `active/running` |
| `NRestarts` | `0` |
| `ExecMainStatus` | `0` |
| Failure class | `none` |

## StoryCluster Evidence

- OpenAI failure artifacts after `2026-06-28T01:22:24Z`: `0`.
- Rerank degeneracy warnings after `2026-06-28T01:22:24Z`: `0`.
- Latest runtime diagnostics retained tick 153 as completed with
  `raw_write_attempted_count=8`, `raw_wrote_count=8`, and
  `nonfatal_prewrite_failure_count=0`.

## Hourly Archive

The hourly archive contributed 12 clean samples in the packet window:

- first sample: `2026-06-28T01:54:59.953Z`;
- latest sample: `2026-06-28T13:08:59.948Z`;
- pass count: `12`;
- fail count: `0`.

The latest archived public freshness monitor passed at
`2026-06-28T13:09:00.461Z` with no blockers.

## Relay Evidence

Latest relay liveness is pass for all three relays. Restart counters and
watchdog counters did not increase within the archived packet window.

| Relay | Restart counter | Watchdog trips | Latest heap | Heap slope | Heap limit projection | Latest RSS | RSS slope | RSS limit projection |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `vhc-relay-a` | `0 -> 0` | `0 -> 0` | 385.6 MiB | 13.74 MiB/h | 48.3h | 448.5 MiB | 12.60 MiB/h | 100.7h |
| `vhc-relay-b` | `1 -> 1` | `0 -> 0` | 485.5 MiB | 21.17 MiB/h | 26.6h | 569.6 MiB | 22.85 MiB/h | 50.2h |
| `vhc-relay-c` | `1 -> 1` | `0 -> 0` | 479.4 MiB | 24.11 MiB/h | 23.6h | 543.8 MiB | 26.12 MiB/h | 44.9h |

Interpretation: current relay memory is below threshold, but the heap projection
must be read against the production watchdog ceiling (`1.1 GB` by default in the
public-beta relay compose), not the older `1.3 GB` watch-tool default. The
corrected projection is a clean-window risk, not a raw Scope A availability
failure: a watchdog trip gracefully restarts one relay and quorum should absorb
it, but the restart aborts the 48h proven-sustained claim.

## Closure Rule

The watch closes only when both are true:

1. the 24h and 48h thresholds have enough elapsed clean time with all runtime,
   StoryCluster, archive, relay, and public freshness signals clean;
2. relay heap/RSS slope is flat or extrapolation-safe across the closure
   horizon.

The closure packet proves only raw Scope A publication health for the observed
clean window. It does not prove single-host A6 topology resilience, a full
weekly traffic cycle, or Scope B accepted/topic synthesis and storyline
readiness.

Until then, the correct state is **healthy bake in progress**, not
**proven-sustained**.
