# Phase 5 Scope A Launch Closeout - 2026-06-24

> Document Role: Historical launch report (non-authoritative)
> Archived: 2026-07-11
> Superseded By: `docs/ops/public-beta-operational-state.md`

> Status: Launched
> Owner: VHC Launch Ops
> Commit: `b3da27a09f683b7933f169bdd77c03f101681663`
> Depends On: `docs/ops/news-aggregator-production-service.md`, `docs/ops/public-beta-image-deploy.md`, `docs/ops/public-feed-freshness-monitor.md`

Post-launch stability addendum: the first extended post-#687 bake is recorded
in `docs/archive/public-beta-pre-recovery-2026-07-10/reports/phase5-scope-a-stability-bake-2026-06-28.md`. That addendum
does not change the original launch scope; it records the later StoryCluster
rerank truncation fix and the first seven-plus-hour clean production window.

## Verdict

Phase 5 Scope A is live on A6 as a controlled raw-only public news feed.

The launched scope is intentionally narrow:

- raw-fresh, v4-signed, product-visible news cards;
- relay REST write-first publication with 2-of-3 quorum;
- raw pending synthesis lifecycle rows (`synthesis_pending`) on the same
  critical quorum path;
- accepted synthesis, frame tables, storyline overlays, and topic synthesis
  enrichment disabled or treated as post-launch enrichment, not Scope A gates.

This launch does not claim full public-beta product readiness, accepted
synthesis readiness, Scope B enrichment readiness, LUMA Silver, verified-human
assurance, public WSS mesh release readiness, native app readiness, or broad
production-grade news operations.

## Deployed State

- Repo truth: local `main`, A6 `main`, and `origin/main` matched commit
  `b3da27a09f683b7933f169bdd77c03f101681663`.
- Relay image: `vhc-public-beta-relay:20260624-main-vb3da27a0-amd64`.
- Publisher unit: `vh-news-aggregator.service` active/running, enabled,
  `NRestarts=0`.
- Monitor timers enabled after the successful attended soak:
  - `vh-news-aggregator-liveness-watch.timer`;
  - `vh-news-relay-liveness-watch.timer`;
  - `vh-relay-snapshot-freshness-watch.timer`.

Launch publisher configuration:

```bash
VH_BUNDLE_SYNTHESIS_ENABLED=0
VH_ANALYSIS_EVAL_REPLAY_ON_START=0
VH_NEWS_STORYLINES_ENABLED=0
VH_NEWS_RUNTIME_FIRST_TICK_MAX_PUBLISHED_BUNDLES=8
VH_NEWS_RUNTIME_MAX_PUBLISHED_BUNDLES=8
VH_NEWS_RUNTIME_RAW_BUNDLE_WRITE_CONCURRENCY=1
VH_NEWS_PRODUCT_FEED_REPAIR_SAMPLE_LIMIT=8
VH_NEWS_PRODUCT_FEED_REPAIR_INTERVAL_MS=86400000
VH_NEWS_RUNTIME_PRUNE_STALE_BUNDLES=0
VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS=2
VH_BUNDLE_SYNTHESIS_RELAY_WRITE_MIN_SUCCESS=2
```

Launch relay posture:

- all three public-news relays remain on A6;
- Docker restart policy is bounded (`on-failure:5`);
- Docker memory ceiling is `2304m` with swap disabled;
- relay resource watchdog is enabled;
- latest-index snapshot and story-body caches are bounded;
- snapshot story-body verification and story-state refresh are disabled for
  Scope A raw-only operation;
- heap snapshots are host-private diagnostic artifacts and must not be shared
  without explicit secret review.

## Launch Evidence

Before publisher start:

- StoryCluster reset completed with backup-first handling.
- Qdrant collection `storycluster_coarse_vectors` was recreated and verified at
  `0` points.
- Raw publication readiness preflight passed with `synthesis_enabled:false`,
  relay news min-success `2`, and synthesis required-success `0`.

Attended soak:

- First runtime tick completed cleanly.
- A single attended soak passed beyond the 60-minute mark.
- Final observed tick count: `8`.
- Abort count: `0`.
- Repeated tick summaries showed:
  - `raw_wrote_count: 8`;
  - `raw_write_failed_count: 0`;
  - storyline writes suppressed;
  - `storyline_wrote_count: 0`.
- No fail-close.
- No critical readback `500`.
- No relay backpressure `503`.
- No watchdog trips.
- No relay OOM.
- Relay Docker restarts stayed `0/0/0`.

Public feed proof:

- Public latest-index returned `ok:true`.
- Public latest-index returned `record_count=20`.
- Public composition was raw-only pending state:
  - `pending_synthesis=20`;
  - `accepted_synthesis_available=0`.
- Relay snapshot freshness passed on all three relays after publication.
- Publisher liveness watch passed.
- Relay liveness watch passed.

## What This Proves

The launched path proves the Scope A contract:

1. current RSS content can pass through source health, StoryCluster, raw bundle
   publication, latest/hot indexes, and pending lifecycle rows;
2. critical raw writes remain fail-closed and quorum-durable;
3. pre-publication compute/orchestration failures skip the current tick
   non-fatally and retry on the next interval, while critical raw bundle writes
   and pending lifecycle writes remain fail-closed;
4. optional enrichment is not allowed to poison raw publication;
5. relay readback latency is bounded for the capped raw-only operating profile,
   while relay heap/RSS slope remains an explicit 24h/48h watch gate because
   cache caps do not by themselves prove the Gun in-memory graph is bounded;
6. host-local monitors are enabled after a successful attended run and can alert
   on publisher liveness, relay liveness, and latest-index snapshot freshness.

## What This Does Not Prove

The launch deliberately does not prove:

- accepted synthesis throughput;
- accepted synthesis lane isolation;
- topic synthesis publication under load;
- storyline overlay durability;
- snapshot verify/refresh under production load;
- higher raw publication caps;
- relay failure-domain independence;
- full public-beta umbrella gate readiness;
- native app or App Store readiness;
- LUMA Silver / production attestation / Sybil-resistant identity.

Those are post-launch or broader release tracks.

## Operating Watch

For the first 24-72 hours, the operational bar is:

- `vh-news-aggregator.service` remains active/running;
- publisher `NRestarts=0`;
- publisher liveness watch passes;
- relay liveness watch passes;
- relay snapshot freshness watch passes;
- relay Docker restarts remain stable;
- relay watchdog trips stay `0`;
- public latest-index newest-entry age remains under the 6-hour SLO;
- public composition remains honest raw pending state until enrichment is
  deliberately re-enabled.
- StoryCluster OpenAI failure artifacts do not reappear under the production
  state dir after the #687 restart;
- StoryCluster rerank degeneracy warnings remain absent or isolated enough to
  prove rerank is not silently degrading every nontrivial chunk.

A failed skipped tick with `failed_stage=orchestrating` and
`nonfatal_prewrite_failure_count=1` means the runtime stopped before raw
publication began and should retry on the next interval. Treat missing
write-adapter/configuration failures, raw bundle write failures, raw pending
lifecycle failures, or any failure after `writing_raw_bundles` begins as
fail-closed publisher stops; those remain operator-inspection events, not
automatic restart loops.

If a relay watchdog trips, collect the host-private diagnostic bundle and share
only redacted summaries unless secret review explicitly approves raw heap
artifacts.

## Post-Launch StoryCluster Stability Addendum - 2026-06-28

After launch, the raw Scope A path hit recurring pre-publication StoryCluster
`cross_encoder_rerank` failures caused by OpenAI `finish_reason=length`
truncation. The fix sequence is now recorded as part of the launch ledger:

1. #684 made pre-publication StoryCluster failures non-fatal skipped ticks.
2. #685 captured bounded OpenAI rerank artifacts and proved the truncation
   cause.
3. #687 fixed the failure at the source with strict fixed-key rerank structured
   output, omit/keep-prior rerank degradation, adjudication gate-safe fallback,
   and 5xx internal stage/model semantics.

The #687 deployment landed at
`baf1dd5f41958473c93db04e4d6007e4df7b074f`. The first extended bake showed:

- 42 consecutive clean post-overlap publisher ticks;
- 336/336 raw writes;
- latest observed tick with `nonfatal_prewrite_failure_count=0`;
- zero new StoryCluster OpenAI failure artifacts since the #687 restart;
- zero rerank degeneracy warnings since the #687 restart;
- passing hourly archive sample across publisher liveness, relay liveness,
  relay snapshot freshness, and public feed freshness.

This closes the StoryCluster truncation track for Scope A raw publication. It
does not complete the full 24-72 hour sustained-operation watch or expand the
launch claim beyond controlled raw Scope A.

## Post-Slice-0 Alert And Timeout Recovery Addendum - 2026-07-06

Slice 0 interim alerting is complete: the host-local email channel is configured
outside git, the test-fire reached the operator device, and both the public-feed
alert watch and Scope A watch-closure timers are enabled on A6.

The first real alert after enablement correctly reported a real stale-feed
condition. Read-only diagnosis showed the publisher active/running, relays
healthy, and failure before raw relay writes because the StoryCluster remote
request timed out. PR #723 bounded the production StoryCluster hot path, A6 was
updated to `main@47ba218d`, and the normal recovery tick completed at
`2026-07-06T22:44:08.567Z` with `raw_wrote_count=8` and
`raw_write_failed_count=0`. Public freshness, relay liveness, relay snapshot
freshness, watch closure, and alert watch passed afterward, including a recovery
email.

This addendum proves the alert channel can report a real stale-feed incident and
the #723 timeout fix restored raw publication under the current first-tick
budget. It does not prove unattended stability, heap boundedness, accepted
synthesis, broader public-beta launch readiness, pager/PWA deployment, or Codex
live execution. The clean evidence window starts at
`2026-07-06T22:44:08.567Z`; the next action is a new alert or the first
post-recovery 500 MB -> 700 MB heap-summary pair, not a service restart.

## Post-Launch Backlog

1. Re-enable relay snapshot verify/refresh on A/B only under a separate
   relay-memory soak, now that cache caps are in place.
2. Split accepted/topic synthesis enrichment off the raw pending lifecycle fatal
   lane, rate-limit it, and soak it separately before Scope B.
3. Reintroduce storyline overlays only after their durability path is migrated
   or separately bounded and soaked.
4. Raise raw publication caps only after monitor data shows sustained relay
   headroom.
5. Decide the failure-domain rebalance for broader beta or production: all
   three public-news relays currently share A6, so A6 loss still removes the
   origin and all relay votes.
6. Re-run broader public-beta release gates only when the launch claim expands
   beyond controlled raw Scope A.
