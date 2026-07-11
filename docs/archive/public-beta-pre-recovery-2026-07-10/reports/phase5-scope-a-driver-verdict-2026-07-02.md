# Phase 5 Scope A Driver Verdict - 2026-07-03

> Document Role: Historical diagnostic report (non-authoritative)
> Archived: 2026-07-11
> Superseded By: `docs/ops/public-beta-operational-state.md`

> Status: Off-Graph Heap Driver Likely - Early Capture Missing
> Owner: VHC Launch Ops
> Last Reviewed: 2026-07-03
> Depends On: docs/archive/public-beta-pre-recovery-2026-07-10/reports/phase5-scope-a-recovery-current-state-2026-07-02.md, docs/ops/news-aggregator-production-service.md

## Scope

This is the read-only Scope A heap-growth driver verdict for the post-outage #2
instrumented window. It changes no relay, publisher, A6, retention, compaction,
watchdog, or deploy behavior.

## Inputs Checked

- A6 host-local soak archive:
  `~/.local/state/vhc/phase5-scope-a-soak`.
- Read-only sample range with graph metrics present:
  `2026-07-02T10:59:59.943Z` to `2026-07-03T12:33:59.937Z`
  (`25.57h`, 26 samples per relay).
- Public feed freshness, publisher liveness, relay liveness, relay snapshot
  watch, and relay graph/heap metrics from the archive.
- The slope figures below use first-to-last deltas over that read-only sample
  range. They are trend estimates for driver selection, not a regression model
  or a ceiling-crossing forecast.
- Relay diagnostic directories were checked only for aggregate-safe heap summary
  files. Raw `.heapsnapshot` files remain host-private and were not copied or
  inspected.

## Live State At Read

- Publisher: `active/running`, `ExecMainStatus=0`, `NRestarts=0`.
- Relays: all pass, graph scans enabled, no graph truncation, graph errors `0`,
  watchdog trips `0`.
- Latest graph scan duration: `4-5ms`; latest graph age under one scan interval.
- Early-capture artifact: no `.heap-summary.json` or
  `.heapsnapshot-error.json` found under relay data diagnostics. Existing raw
  `.heapsnapshot` files are only the older 0-byte trip-time failures from
  2026-06-25, 2026-06-29, and 2026-06-30.
- This absence is expected for this sample because the latest observed heap was
  about `300 MiB`, below the `~800 MiB` early-capture trigger; it is not another
  trip-time capture failure.
- Staleness caveat: this document reflects the read-only archive/live read at
  the timestamps above. Later relay restarts, slope changes, or early-capture
  artifacts can supersede the operational threshold math without changing this
  window's driver classification.

## Evidence

| Relay | Heap first -> latest | Heap slope | RSS slope | Graph live bytes first -> latest | Graph live-byte slope | Tombstoned souls |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `vhc-relay-a` | `30.0 MiB -> 290.5 MiB` | `10.98 MiB/h` | `11.15 MiB/h` | `97,162 -> 282,006` | `0.0083 MiB/h` | `0 -> 0` |
| `vhc-relay-b` | `42.9 MiB -> 299.8 MiB` | `10.99 MiB/h` | `11.09 MiB/h` | `97,162 -> 282,006` | `0.0083 MiB/h` | `0 -> 0` |
| `vhc-relay-c` | `29.1 MiB -> 297.7 MiB` | `11.33 MiB/h` | `11.49 MiB/h` | `97,162 -> 282,006` | `0.0083 MiB/h` | `0 -> 0` |

Latest graph shape is identical across relays:

| Namespace | Latest live bytes | Slope |
| --- | ---: | ---: |
| `news_story` | `207,806` | `6,351 B/h` |
| `news_lifecycle` | `25,780` | `824 B/h` |
| `news_hot_index` | `25,200` | `769 B/h` |
| `news_latest_index` | `23,220` | `742 B/h` |
| `aggregate`, `forum`, `topic_synthesis`, `other` | `0` | `0 B/h` |

Total graph souls rose from `46` to `326` at about `10.07 souls/h`. That is
expected publication growth, but the retained live payload bytes are tiny
relative to the heap slope. The graph live-byte slope is less than `0.1%` of
the heap slope on every relay.

The packet used for this verdict did not include a cached link-only soul-count
time series. It did include total souls, live bytes, tombstoned souls, scan
success, scan duration, truncation, and error state. Because tombstoned souls
remained `0`, live bytes ended at only `282,006`, and total souls ended at only
`326`, any unreported link-only remainder is too small to explain hundreds of
MiB of heap growth in this window.

## Verdict

`heap_driver_off_graph_likely`.

The graph scan is present, complete, and non-truncated. It does not support
publisher-visible retention, tombstone skeleton accumulation, or link-only
graph structure as the primary heap driver for this window. Heap/RSS are still
rising linearly while graph `userValueBytes` are effectively flat at heap scale.

The missing early-capture heap summary prevents naming the exact off-graph
retainer. The candidate set remains RADISK staging/reload behavior, Gun peer
sync state, buffers, duplicate/HAM state, or other non-`root.graph` retainers.

## Decision Tree Position

| Candidate | Current evidence | Decision |
| --- | --- | --- |
| Live graph bytes track heap | Graph live bytes slope `~0.008 MiB/h`; heap slope `~11 MiB/h` | Rejected |
| Soul count or link/tombstone structure climbs while bytes stay flat | Souls rise, tombstones stay `0`, link-only series not present, and total graph scale is too small to explain heap | Not primary |
| Graph bytes stay flat while heap climbs | Observed across all three relays | Selected |
| Heap plateaus below staggered ceilings | No staggered ceiling was reached in this sample; a plateau was not yet testable from this window | Not selected |

## Recommended Next Scope A PR

Do not build publisher retention or relay compaction from this evidence. The
next Scope A development PR should target off-graph diagnosis:

- make early heap capture operationally asserted in the relay environment
  (`VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_ENABLED=true` plus the intended
  heap threshold) and add a liveness/watch check that fails if early capture is
  expected but no `.heap-summary.json` appears by threshold;
- add a secret-safe heap-summary analyzer for early-capture artifacts if one is
  not already present on the host;
- keep graph metrics as a negative control during the next climb;
- keep all retention/compaction/eviction work gated until a secret-safe
  retainer summary names the off-graph owner.

## Alerting Enablement Note

A6 alert enablement was authorized but not completed during this read because
the host has no `~/.config/vhc/public-feed-alert.env`, no existing
webhook/email alert env to reuse, and no visible `sendmail`/`mail` binary.
Enabling the timer without a delivery channel would recreate the silence gap
under a different name. The repo unit/runbook now require an explicit delivery
channel before enablement.

## Non-Goals

- No retention or story clearing.
- No relay-side compaction or Gun eviction.
- No publisher/relay restart or recreate from this verdict.
- No raw heap snapshot copying or inspection.
- No broad public-beta, Mesh `release_ready`, or production freshness claim.
