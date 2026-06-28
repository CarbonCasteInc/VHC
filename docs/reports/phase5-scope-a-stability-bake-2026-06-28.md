# Phase 5 Scope A Stability Bake - 2026-06-28

> Status: Stability Evidence
> Owner: VHC Launch Ops
> Commit: `baf1dd5f41958473c93db04e4d6007e4df7b074f`
> Depends On: `docs/reports/phase5-scope-a-launch-closeout-2026-06-24.md`, `docs/ops/news-aggregator-production-service.md`, `docs/ops/storycluster-production-service.md`, `docs/ops/public-feed-freshness-monitor.md`

## Verdict

Phase 5 Scope A is live and stable under the post-launch watch as of the
2026-06-28 read-only bake check. The StoryCluster rerank truncation failure
track is closed for the launched raw Scope A path.

This report does not end the 24-72 hour sustained-operation watch. It records
the first extended clean production window after the durable StoryCluster fix
landed and was deployed.

## Incident And Fix Arc

The launch stabilization chain is:

1. Phase 5 Scope A launched as a capped raw-only public-news profile.
2. OpenAI `cross_encoder_rerank` truncation caused StoryCluster pre-publication
   failures before raw publication began.
3. #684 made those pre-publication StoryCluster failures non-fatal skipped
   ticks instead of publisher-killing write failures.
4. #685 captured bounded OpenAI rerank parse artifacts and proved the recurring
   failures were `finish_reason=length` overproduction/truncation.
5. #687 fixed the source of the truncation by moving rerank output to a strict
   fixed-key object schema, preserving prior deterministic rerank scores on
   recoverable rerank failure, keeping adjudication fallback gate-safe, and
   mapping internal StoryCluster stage/model failures to 5xx instead of 400.

## Production Readback

Read-only check time: `2026-06-28T04:37:24-0400`.

Repository and deployment truth:

- local `main`, `origin/main`, and deployed `/home/humble/VHC` were on
  `baf1dd5f41958473c93db04e4d6007e4df7b074f`;
- #687 was merged and deployed;
- only `vh-storycluster-engine.service` was restarted for the #687 deploy;
- publisher, relays, and origin were not restarted as part of this check.

Service state:

- `vh-storycluster-engine.service`: `active/running`, `NRestarts=0`;
- `vh-storycluster-qdrant.service`: `active/running`, `NRestarts=0`;
- `vh-news-aggregator.service`: `active/running`, `NRestarts=0`.

StoryCluster watch signals since the #687 engine restart at
`2026-06-27 21:22:18 EDT`:

- `artifacts_since_restart=0`;
- `storycluster_warning_lines_since_restart=0`;
- no new rerank truncation artifacts;
- no degeneracy warnings.

Publisher diagnostics after the restart-overlap tick:

- diagnostics generated at `2026-06-28T08:28:40.300Z`;
- latest tick: `119`;
- ticks since restart window: `43`;
- completed ticks: `42`;
- failed/skipped ticks: `1`;
- the single failed/skipped tick was the known StoryCluster engine
  restart-overlap tick;
- raw writes since restart window: `336/336`;
- raw write failures: `0`;
- latest tick `119` completed with `nonfatal_prewrite_failure_count=0`,
  `selected_bundle_count=8`, and `raw_wrote_count=8`.

Hourly archive:

- latest archive sample: `20260628T080000Z`;
- archive status: `pass`;
- publisher liveness: `pass`;
- relay liveness: `pass`;
- relay snapshot freshness: `pass`;
- public feed freshness: `pass`;
- public latest-index readbacks at `venn`, `gun-a`, `gun-b`, and `gun-c` each
  returned `status=pass` with `recordCount=80`;
- relay snapshot files for relays A/B/C each held `entryCount=120` and no
  freshness failures.

## Interpretation

The evidence is stronger than a single clean tick: it covers more than seven
hours, 42 consecutive clean post-overlap publisher ticks, 336 successful raw
writes, zero new OpenAI truncation artifacts, zero rerank degeneracy warnings,
and a passing hourly archive across the host-local and public read surfaces.

The zero degeneracy-warning result matters: it means the rerank stage is not
merely degrading every chunk to the prior deterministic scores. It is producing
non-identical usable rerank scores under the deployed strict-schema path.

The known restart-overlap skipped tick remains correctly classified as a
pre-publication non-fatal skipped tick. It did not start raw publication, did
not produce partial writes, and the next tick recovered normally.

## Still Not Proven

This stability bake does not prove:

- the full 24-72 hour sustained-operation window;
- accepted synthesis throughput or accepted synthesis isolation;
- topic synthesis publication under load;
- storyline overlay durability;
- higher raw publication caps;
- relay failure-domain independence;
- mesh `release_ready`;
- full public-beta or production app readiness;
- LUMA Silver / production attestation / Sybil-resistant identity;
- legal or commercial approval.

## Operating Decision

Keep the 24-72 hour watch running. Scope A raw-publication firefighting is
closed unless one of these watch signals regresses:

- new StoryCluster OpenAI failure artifacts appear after the #687 restart;
- rerank degeneracy warnings become persistent;
- publisher ticks resume `nonfatal_prewrite_failure_count > 0` outside an
  attended maintenance overlap;
- raw writes fall below selected bundle count;
- service `NRestarts` increments;
- the hourly archive fails publisher liveness, relay liveness, relay snapshot
  freshness, or public feed freshness.

Deferred work is no longer launch firefighting: relay serve-stale rolling
deploy, `.tmp` ownership cleanup, #687 telemetry polish, adjudicate/translate
structured-output prevention if telemetry shows truncation there, and the
post-watch enrichment phase.
