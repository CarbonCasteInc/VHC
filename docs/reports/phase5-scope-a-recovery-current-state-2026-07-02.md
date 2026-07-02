# Phase 5 Scope A Recovery Current State - 2026-07-02

> Status: Recovery Evidence
> Owner: VHC Launch Ops
> Last Reviewed: 2026-07-02
> Depends On: docs/ops/news-aggregator-production-service.md, docs/ops/public-feed-freshness-monitor.md, docs/ops/public-beta-image-deploy.md, docs/reports/phase5-scope-a-launch-closeout-2026-06-24.md, docs/reports/phase5-scope-a-stability-bake-2026-06-28.md

## Scope

This report records the current Phase 5 Scope A state after outage #2 recovery.
It is a dated evidence pointer. Operational rules still live in
`docs/ops/news-aggregator-production-service.md`; current implementation status
still lives in `docs/foundational/STATUS.md`.

## Incident Read

Outage #2 began at `2026-06-29T15:50:53Z` when the publisher fail-closed on a
lost relay quorum during tick 307. The correlated relay-b/relay-c trip left the
publisher with only one successful vote on the critical latest-index write. The
publisher exited `78` by design and did not restart; `NRestarts=0` confirmed the
non-restarting fail-closed posture.

The safety architecture worked: the publisher refused to continue after losing
critical write quorum, so no partial-publication recovery path was required. The
availability architecture failed: the public feed stayed frozen until recovery
and exceeded the 6-hour public freshness SLO for roughly 67 hours.

The trip-time raw heap snapshots were unusable. The observed pattern was a
zero-byte `.heapsnapshot` with no heap-snapshot error JSON and no diagnostic
summary, consistent with a hard process death during V8 serialization rather
than a caught JavaScript exception. #692 moved the useful capture point earlier
in the climb so the process has cgroup headroom to serialize a one-shot snapshot.

## Recovered Posture

Recovery was verified on 2026-07-02 after #691, #692, #693, and #694 were merged
and deployed.

- `main`: `eab5d3c6` (`Stagger public beta relay watchdog heap limits (#694)`).
- Relay image: `vhc-public-beta-relay:20260702-main-v96488ca0-amd64`.
- Publisher path: #693 prioritizes fresh bundles for publication and the raw
  write lane runs with concurrency `2`.
- Relay diagnostics: #691 graph scan metrics are deployed and enabled on A6 for
  the current memory climb; they remain diagnostic and non-blocking.
- Relay snapshots: #692 early heap capture is enabled at
  `VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES=800000000`.
- Relay phase-lock breaker: #694 deploys per-relay heap watchdog ceilings:
  relay-a `850000000`, relay-b `1000000000`, relay-c `1150000000`.

Post-recovery checks reported:

- publisher liveness `pass`, service active/running, `NRestarts=0`;
- relay liveness `pass`, watchdog trips `0`, graph scan errors `0`, graph scan
  truncation `0`;
- relay snapshot freshness `pass`, all three relays serving 120 latest rows;
- public freshness `pass` for `https://venn.carboncaste.io/`,
  `https://gun-a.carboncaste.io/`, `https://gun-b.carboncaste.io/`, and
  `https://gun-c.carboncaste.io/`, with newest activity
  `2026-07-02T11:10:30.789Z`.

## Current Gate

The system is recovered and fresh, but the clean-window ledger is not restored.
The next gate is the 12-24 hour instrumented memory climb from the post-deploy
floor:

- graph `userValueBytes` by namespace/state tracks heap growth: choose the fix
  by the dominant namespace and live/tombstone shape;
- graph bytes stay flat while heap grows: treat the driver as off-graph and use
  the early heap snapshot as the primary retainer artifact;
- heap plateaus safely below the staggered watchdog ceilings: stand down from
  retention/compaction and keep monitoring;
- any critical readback `500`, raw write failure, fail-close, stale public
  freshness result, or quorum loss is a live incident, not bake noise.

Retention, publisher clearing, and relay-side compaction remain gated until this
instrumented evidence exists.

## Claim Boundary

The 2026-06-24 launch closeout and 2026-06-28 StoryCluster stability bake remain
historical evidence. They do not prove current sustained operation after outage
#2. Do not claim 48-hour stability, production-grade live headline freshness,
accepted synthesis readiness, Mesh `release_ready`, production app readiness,
LUMA production-attestation/Silver, host-failure-tolerant relay quorum, or broad
public-beta readiness from this recovery alone.
