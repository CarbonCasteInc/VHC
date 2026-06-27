# News Aggregator Production Service

> Status: Operational Runbook
> Owner: VHC Ops
> Last Reviewed: 2026-06-24
> Depends On: docs/ops/NEWS_SOURCE_ADMISSION_RUNBOOK.md, docs/ops/public-feed-freshness-monitor.md, docs/ops/analysis-backend-3001.md, docs/ops/storycluster-production-service.md, docs/ops/public-beta-launch-readiness-closeout.md

## Purpose

This runbook packages the existing `@vh/news-aggregator` daemon as the managed
production publisher. It does not introduce a second publisher path.

The daemon is continuous, not one-shot: `services/news-aggregator/src/daemon.ts`
starts the news runtime after acquiring the ingestion lease, renews leadership on
an interval, keeps product-feed reconciliation and pending synthesis catch-up on
their own intervals, and exits only when the process receives SIGINT/SIGTERM or
startup fails closed.

## Current Launch State

Phase 5 Scope A is live on A6 as of 2026-06-24. The controlling closeout is
`docs/reports/phase5-scope-a-launch-closeout-2026-06-24.md`.

Current intended-live posture:

- `vh-news-aggregator.service` is expected to be active/running, enabled, and at
  `NRestarts=0`.
- Relays run `vhc-public-beta-relay:20260624-main-vb3da27a0-amd64` with Docker
  `on-failure:5`, 2304 MB memory ceilings, relay resource watchdogs, and bounded
  latest-index/story-body caches.
- Raw story, latest-index, hot-index, and pending synthesis-lifecycle writes use
  relay REST quorum with required success count 2.
- Accepted bundle synthesis, replay synthesis, topic synthesis, storyline writes,
  and stale storyline cleanup are disabled for the launched raw Scope A profile.
- Product-feed repair is deferred until after the first completed runtime tick
  and then paced through dedicated non-fatal maintenance lanes.
- Relay verify/refresh body maintenance is disabled for the launch profile;
  re-enabling it requires a separate attended soak and updated evidence.
- Publisher liveness, relay liveness, and relay snapshot freshness timers are
  intended to stay enabled during live operation.

This launch state proves raw-fresh, v4-signed, product-visible cards with
pending lifecycle rows. It does not prove accepted synthesis, frame tables,
storyline overlays, topic synthesis, full public-beta readiness, mesh
`release_ready`, production app canary readiness, or legal/commercial approval.

## Hard Boundaries

- Do not start production publisher writes without explicit operator approval.
- Public latest-index HTTP monitors must remain nonmutating (`persist=false` /
  safe relay GET path). Do not add a monitor or browser smoke that can refresh or
  rewrite relay snapshots as a side effect of reading.
- Keep public-feed monitors enabled during intended-live operation. Disable them
  only during an attended maintenance window or deliberate publisher stop, and
  record that suppression in the incident/runbook notes.
- Store secrets only in host env files outside git. Record env var names, host,
  port, and artifact paths only.

## Managed Units

Templates:

- `infra/systemd/user/vh-news-aggregator.service`
- `infra/systemd/user/vh-relay-snapshot-freshness-watch.service`
- `infra/systemd/user/vh-relay-snapshot-freshness-watch.timer`
- `infra/systemd/user/vh-news-aggregator-liveness-watch.service`
- `infra/systemd/user/vh-news-aggregator-liveness-watch.timer`
- `infra/systemd/user/vh-news-relay-liveness-watch.service`
- `infra/systemd/user/vh-news-relay-liveness-watch.timer`
- `infra/systemd/user/vh-phase5-scope-a-soak-archive.service`
- `infra/systemd/user/vh-phase5-scope-a-soak-archive.timer`

Installer:

```bash
cd /home/humble/VHC
./tools/scripts/install-news-aggregator-production-service.sh
```

The installer writes user units and reloads systemd. It does not start publisher
writes by default.

## User Service Durability

These production surfaces run as `humble` user services and require linger so
they survive operator logout and host reboot:

```bash
vh-analysis-backend-3001.service
vh-storycluster-qdrant.service
vh-storycluster-engine.service
vh-news-aggregator.service
```

Before installing or enabling any Phase 5 user unit, enable and verify linger:

```bash
loginctl enable-linger humble
loginctl show-user humble -p Linger --value
```

The verification command must print `yes`. The installers fail closed if
`loginctl` cannot confirm linger is enabled. After install, verify the intended
units are enabled:

```bash
systemctl --user is-enabled vh-analysis-backend-3001.service
systemctl --user is-enabled vh-storycluster-qdrant.service
systemctl --user is-enabled vh-storycluster-engine.service
systemctl --user is-enabled vh-news-aggregator.service
```

The publisher requires the managed StoryCluster service to be running before
publisher start. Install and verify the Qdrant-backed service first:

```bash
./tools/scripts/install-storycluster-production-service.sh --start
systemctl --user status vh-storycluster-qdrant.service --no-pager
systemctl --user status vh-storycluster-engine.service --no-pager
```

Host runtime prerequisite observed on A6 on 2026-06-14: `node` is available at
`/home/humble/.local/bin/node`, and `pnpm` is available through the
`/home/humble/.hermes/node/bin` Corepack shims. The installed user units set
`PATH=%h/.local/bin:%h/.hermes/node/bin:/usr/local/bin:/usr/bin:/bin` so both
the `node` and `pnpm` shims resolve under systemd. Verify before enabling
publisher services:

```bash
cd /home/humble/VHC
PATH="$HOME/.local/bin:$HOME/.hermes/node/bin:/usr/local/bin:/usr/bin:/bin" node -v
PATH="$HOME/.local/bin:$HOME/.hermes/node/bin:/usr/local/bin:/usr/bin:/bin" pnpm -v
```

Run the `pnpm -v` check from the repo root so Corepack applies the
`packageManager` pin from `package.json`.

Read-only relay snapshot watch timer:

```bash
./tools/scripts/install-news-aggregator-production-service.sh --enable-watch
systemctl --user status vh-relay-snapshot-freshness-watch.timer --no-pager
journalctl --user -u vh-relay-snapshot-freshness-watch.service -n 100 --no-pager
```

Publisher liveness watch timer:

```bash
./tools/scripts/install-news-aggregator-production-service.sh --enable-publisher-liveness-watch
systemctl --user status vh-news-aggregator-liveness-watch.timer --no-pager
journalctl --user -u vh-news-aggregator-liveness-watch.service -n 100 --no-pager
```

Enable this only after the attended start has produced current runtime
diagnostics. It checks the publisher unit state, `NRestarts`, the current
per-start run marker, and the freshness of the runtime diagnostic artifact.

Relay liveness watch timer:

```bash
./tools/scripts/install-news-aggregator-production-service.sh --enable-relay-liveness-watch
systemctl --user status vh-news-relay-liveness-watch.timer --no-pager
journalctl --user -u vh-news-relay-liveness-watch.service -n 100 --no-pager
```

Enable this only after relays are intended-live. It checks `/readyz`, `/metrics`,
Docker restart count, watchdog trips, RSS/heap, event-loop lag, and queued
critical readbacks. The installed timer also restarts at most one eligible
unhealthy relay per run (`VH_RELAY_LIVENESS_RESTART_ON_FAIL=true`,
`VH_RELAY_LIVENESS_RESTART_MAX_PER_RUN=1`) with a 10 minute per-relay cooldown
so a fully wedged relay can recover without restarting all relays in lockstep. A
deliberately stopped relay with the timer still enabled is an alert condition.

Phase 5 Scope A soak archive timer:

```bash
./tools/scripts/install-news-aggregator-production-service.sh --enable-soak-archive
systemctl --user status vh-phase5-scope-a-soak-archive.timer --no-pager
journalctl --user -u vh-phase5-scope-a-soak-archive.service -n 100 --no-pager
```

This timer makes the post-launch watch a data product instead of a mutable
`latest.json` snapshot. Every hour it writes a timestamped sample under
`~/.local/state/vhc/phase5-scope-a-soak/YYYYMMDDTHHMMSSZ/` containing:

- `publisher-liveness.json` copied from
  `~/.local/state/vhc/news-aggregator/publisher-liveness/latest.json`;
- `relay-liveness.json` copied from
  `~/.local/state/vhc/relay-liveness/latest.json`;
- `relay-snapshot-watch.json` copied from
  `~/.local/state/vhc/relay-snapshot-watch/latest.json`;
- `public-feed-freshness/public-feed-freshness-summary.json`, generated by the
  same public freshness monitor used by GitHub Actions;
- `manifest.json`, which records the sample id, copied source paths, public
  monitor result, and blockers.

The archive service fails closed when any required host-local latest file is
missing, invalid, or reports non-`pass`, or when the public freshness monitor
fails. It does not restart relays, start the publisher, mutate mesh state, or
write public feed records. It exists to preserve baseline / 24h / 48h / 72h
evidence even though the individual liveness watches overwrite their
`latest.json` files.

Approved publisher start packet:

```bash
cd /home/humble/VHC
git fetch origin main
git checkout main
git pull --ff-only
./tools/scripts/install-news-aggregator-production-service.sh
VH_NEWS_DAEMON_START_APPROVED=1 ./tools/scripts/install-news-aggregator-production-service.sh --start-publisher
systemctl --user status vh-news-aggregator.service --no-pager
journalctl --user -u vh-news-aggregator.service -n 200 --no-pager
```

The installer imports `VH_NEWS_DAEMON_START_APPROVED=1` into the user systemd
manager before `enable --now`; a shell-only variable is not enough for
`ExecStart`. After an abort or deliberate stop, remove the approval from the
manager too:

Abort / kill switch:

```bash
systemctl --user stop vh-news-aggregator.service
systemctl --user disable vh-news-aggregator.service
systemctl --user unset-environment VH_NEWS_DAEMON_START_APPROVED
journalctl --user -u vh-news-aggregator.service -n 200 --no-pager
```

Rollback:

```bash
cd /home/humble/VHC
git fetch origin main
git checkout <known-good-commit>
./tools/scripts/install-news-aggregator-production-service.sh
systemctl --user restart vh-news-aggregator.service
```

## Startup Gates

`tools/scripts/start-news-aggregator-daemon-production.sh` is the only
`ExecStart` entrypoint for the managed publisher service. It fails closed unless:

1. `VH_NEWS_DAEMON_ENV_FILE` is readable.
2. Either live start approval or diagnostic no-write approval is present:
   - live publisher: `VH_NEWS_DAEMON_START_APPROVED=1`;
   - no-write diagnostic: `VH_NEWS_DAEMON_DIAGNOSTIC_NO_WRITE=1` and
     `VH_NEWS_DAEMON_DIAGNOSTIC_APPROVED=1`.
3. No existing `@vh/news-aggregator daemon` / `dist/daemon.js` runtime process
   is already running for the current user.
4. `pnpm check:news-sources:liveness` passes the operational restart gate.
5. `pnpm --filter @vh/storycluster-engine build` passes.
6. `preflightOpenAIStoryClusterProviderFromEnv` returns `status: "pass"`.
7. Authenticated StoryCluster `VH_STORYCLUSTER_REMOTE_HEALTH_URL` returns
   `ok: true` with a readiness `detail` beginning with `qdrant:`.
8. The raw publication readiness preflight passes without writing a canary:
   signer material names are present, `VH_GUN_PEERS` parses, relay health
   endpoints are reachable through read-only `/healthz`, StoryCluster config is
   present, and relay-REST synthesis config is complete when synthesis is
   enabled.

The liveness preflight writes a regular source-health artifact and a
`source-health-liveness-report.json`, but it does not enforce the rolling
release-evidence window. It fails on current operational blockers only:

- global feed-stage outage / latest publication preservation;
- enabled source count below the configured floor;
- live contributing source count below the configured floor;
- zero admitted sources.

Watch/remove candidates and release-evidence failures are reported as restart
warnings. They remain release/canary concerns unless the current liveness
blockers above are present.

After these pass, the wrapper writes
`VH_NEWS_DAEMON_LAST_SUCCESS_FILE` or
`$VH_NEWS_DAEMON_STATE_DIR/last-success.json`, then starts:

```bash
pnpm --filter @vh/news-aggregator daemon
```

Live publisher starts `exec` the daemon. No-write diagnostic starts wait for the
daemon process to exit and then recheck that no sibling daemon process remains.

The daemon itself still verifies StoryCluster health before creating the Gun
client and starting the runtime; the wrapper readiness check above exists to
reject shallow `/health` endpoints or memory-vector StoryCluster instances
before the preflight-success marker is written.

No-write diagnostic mode starts the same runtime path with all mesh mutations
suppressed: lease writes/releases, raw bundle writes/removes, storyline
writes/removes, latest/hot/lifecycle writes, relay-REST synthesis writes,
synthesis queue persistence, replay writes, and product-feed repair writes.
It still fetches feeds and calls StoryCluster so the tick summary can prove
nonzero ingest/normalize/cluster/select before a live start is approved.

No-write diagnostics are bounded by default. The wrapper exports
`VH_NEWS_DAEMON_DIAGNOSTIC_MAX_TICKS=1` unless the env file deliberately
overrides it, and the daemon self-stops after writing the tick summary and
cluster-capture artifact for that many ticks. The wrapper also applies
`VH_NEWS_DAEMON_DIAGNOSTIC_MAX_SECONDS=600` by default and, when `timeout` is
available, runs the diagnostic daemon under that hard wall-clock bound with a
30-second kill-after grace window. This covers hung ticks that never emit a
summary and therefore never reach the in-daemon max-ticks stop. If `timeout` is
not available, the wrapper logs the fallback, relies on the in-daemon max-ticks
stop, and still runs post-diagnostic sibling cleanup before returning.

After every no-write diagnostic run, the wrapper reaps any remaining sibling
daemon runtime process with SIGTERM, waits up to 10 seconds, escalates to
SIGKILL, and fails closed if the process still remains. The daemon also acquires
`$VH_NEWS_DAEMON_PID_FILE` or `$VH_NEWS_DAEMON_STATE_DIR/news-daemon.pid` before
creating the mesh client; a direct `pnpm --filter @vh/news-aggregator daemon`
launch refuses to start while another daemon process owns that pidfile.

The publisher unit must not turn a deliberate write-safety fail-close into an
unattended restart loop. The daemon exits with code `78` after a critical
runtime write violation, and `vh-news-aggregator.service` uses
`Restart=on-failure` plus `RestartPreventExitStatus=78` so that state stays down
for operator inspection. The unit also sets `StartLimitIntervalSec=10min` and
`StartLimitBurst=3` as a backstop for genuine process crashes or unexpected
non-78 failures. Verify the installed unit before an attended start:

```bash
systemctl --user show vh-news-aggregator.service \
  -p Restart -p RestartPreventExitStatus -p RestartSecUSec \
  -p StartLimitIntervalUSec -p StartLimitBurst -p NRestarts \
  --no-pager
```

Exit code `78` is also used by the production wrapper for guard refusals, such
as missing start approval. Both classes must remain stopped rather than
restarted. Distinguish them by journal text: fail-closed runtime errors include
`fail-closed runtime error` / `runtime error triggered fail-closed stop`, while
approval guards include the wrapper refusal line.

Pre-publication compute/orchestration failures are not write-safety failures by
themselves. If the runtime fails while the tick is still in the `orchestrating`
stage, before raw bundle publication begins, it emits a failed skipped tick
summary with `skipped=true`, `failed_stage=orchestrating`, and
`nonfatal_prewrite_failure_count=1`, reports the error through
`onNonFatalError`, and retries on the next interval. This covers transient
StoryCluster remote-stage failures without re-enabling heuristic fallback or
weakening relay quorum.

Critical publication-boundary failures remain fail-closed. Missing write
adapters/configuration after clustering, raw bundle publication failures, raw
pending lifecycle failures, and any error once the raw write stage has begun
must still flow through `onError`; in the production daemon that path blocks
later writes, stops the publisher, and parks the unit with exit code `78` for
operator inspection.

During the attended Scope A start, `active (running)` alone is not sufficient
evidence. `NRestarts` must remain `0`, and journals must not show repeated
`runtime error triggered fail-closed stop` lines. If `NRestarts` climbs, the unit
hits a start limit, or a fail-close line appears, stop and disable the publisher
before inspecting evidence:

```bash
systemctl --user stop vh-news-aggregator.service
systemctl --user disable vh-news-aggregator.service
journalctl --user -u vh-news-aggregator.service -n 200 --no-pager
```

The production wrapper applies bounded feed/StoryCluster workload defaults
unless the env file explicitly overrides them:

```bash
VH_NEWS_FEED_MAX_ITEMS_PER_SOURCE
VH_NEWS_FEED_MAX_ITEMS_TOTAL
VH_STORYCLUSTER_REMOTE_MAX_ITEMS_PER_REQUEST
VH_NEWS_RUNTIME_MAX_PUBLISHED_BUNDLES
VH_NEWS_RUNTIME_FIRST_TICK_MAX_PUBLISHED_BUNDLES
VH_NEWS_RUNTIME_RAW_BUNDLE_WRITE_CONCURRENCY
VH_NEWS_RUNTIME_TICK_WATCHDOG_MS
VH_BUNDLE_SYNTHESIS_QUEUE_DEPTH
```

These caps keep the first publisher tick from expanding a broad source set into
dozens of sequential remote StoryCluster requests or a large raw publication
blast before the first successful write can be observed. The steady-state
publication cap defaults to 96 bundles, while
`VH_NEWS_RUNTIME_FIRST_TICK_MAX_PUBLISHED_BUNDLES` defaults to 8 and applies
only to tick 1. That first-tick cap is intentionally narrow so the post-reset
live start lands a small, inspectable batch before the daemon opens to the
steady-state publication limit. Raw bundle writes default to bounded concurrency
2 through `VH_NEWS_RUNTIME_RAW_BUNDLE_WRITE_CONCURRENCY`, matching the daemon
write-lane capacity while keeping fail-closed exposure bounded to already
in-flight writes. The wrapper also keeps the first-tick watchdog at 420 seconds;
do not use a watchdog increase as the primary fix for raw publication
throughput. Override these values deliberately only when StoryCluster
throughput, first-tick quality review, steady-state publication fanout, and the
watchdog window have been recalibrated together.

`VH_BUNDLE_SYNTHESIS_QUEUE_DEPTH` defaults to 256 in production. This leaves
room for deferred publish-time synthesis candidates plus replayed `queue_full`
dead letters while the first raw-publication tick completes. A `queue_full`
dead-letter spike means the worker did not get a chance to drain before the
bounded queue filled; it is distinct from `worker_failed`, which is the signal
for a synthesis worker or relay-write defect.

The production wrapper defaults the watchdog to 420 seconds. That budget is
based on the bounded A6 no-write diagnostic path with 96 feed items and a 96
bundle steady-state publication cap; it should leave room for normal cold-start
StoryCluster/OpenAI variance while still surfacing a genuinely stuck first
tick during an attended start.

Every daemon tick writes an always-on diagnostic artifact at
`$VH_DAEMON_FEED_ARTIFACT_ROOT/news-runtime-diagnostics.json` unless
`VH_NEWS_RUNTIME_DIAGNOSTIC_FILE` overrides it. The journal also logs
`[vh:news-runtime] tick summary` and `[vh:news-runtime] first tick outcome`
outside `VH_NEWS_RUNTIME_TRACE`; use those fields for first-publish evidence.
Set `VH_NEWS_RUNTIME_TICK_WATCHDOG_MS` to emit an in-flight warning with elapsed
time and last known stage if a tick exceeds the threshold.

The production wrapper generates `VH_DAEMON_FEED_RUN_ID` when the env file does
not set it, writes the preflight-passed run marker to
`$VH_NEWS_DAEMON_CURRENT_RUN_FILE` or
`$VH_NEWS_DAEMON_STATE_DIR/current-run.json`, and exports that run id into the
runtime diagnostics. `tools/scripts/news-aggregator-publisher-liveness-watch.mjs`
requires the diagnostic `runId` to match the current run marker once the startup
grace expires. If no current run marker exists, it falls back to requiring the
diagnostic `generatedAt` to be after the unit active-enter timestamp.

Production starts defer publish-time bundle synthesis until the first completed
runtime tick by default. `VH_NEWS_DAEMON_DEFER_SYNTHESIS_UNTIL_FIRST_TICK_COMPLETE`
keeps synthesis candidates queued while the raw story/latest/hot/lifecycle batch
lands and emits its first-publish summary, then starts the synthesis queue
immediately after that completed summary. Set it to `false` only when first-tick
caps, synthesis throughput, relay fanout, and the watchdog window have been
recalibrated together.

The first product-feed repair pass is also deferred until after the first
completed raw runtime tick. This is production default behavior and does not
depend on accepted synthesis being enabled or on the synthesis-defer flag. The
daemon logs one safe `first_runtime_tick_pending` skip with the holder id while
that first tick is still pending, leaves the repair timer eligible, and runs
product-feed reconciliation on the next maintenance pass after a completed tick.
This prevents startup product-feed repair from colliding with the first raw
bundle plus raw pending lifecycle writes.

Product-feed repair writes are paced separately from raw publication. Story-body,
latest-index, hot-index, and repair lifecycle maintenance writes use dedicated
`product_feed_repair_*` write lanes with concurrency 1. Those lanes preserve the
configured relay REST quorum for each write, but their failures are maintenance
telemetry: they are logged and counted by the repair result and must not call the
fatal runtime `onError` path, stop raw publication, or set the daemon's
runtime-write block. The startup deferral and the paced repair lanes solve
different windows: deferral removes the startup write collision, while pacing
protects steady-state repair runs from becoming a maintenance burst.

Current Phase 5 Scope A is raw-fresh, v4-signed, product-visible news cards.
Raw bundle publication and the publish-time pending lifecycle row
(`synthesis_pending` / `frame_table_pending`) are critical and fail-closed
because they ride the relay REST write-through path with the configured 2-of-3
quorum. Accepted synthesis, frame tables, storyline overlays, and stale storyline
cleanup are post-launch enrichment for Scope A. Their failures must be counted in
tick summaries and logged with safe identifiers and reasons, but they must not
halt raw publication.

Live mode also fail-closes runtime errors by default through
`VH_NEWS_DAEMON_FAIL_CLOSED_ON_RUNTIME_ERROR=true`, but runtime write criticality
is an explicit allow-list. Only raw bundle publication and the raw pending
lifecycle write route to the fatal runtime `onError` path. Future write surfaces
default to non-fatal telemetry unless they are deliberately added to that
critical set. A critical runtime error blocks further runtime writes, stops the
daemon loop, shuts down the process handle, and leaves systemd to report the
service stopped instead of allowing the write lane to drain more public stories.
Do not set it to `false` in production unless the incident commander has chosen
an attended degraded-write experiment and the public-feed rollback plan is
already active.

The launched capped raw-only Scope A operating profile is:

```bash
VH_BUNDLE_SYNTHESIS_ENABLED=0
VH_ANALYSIS_EVAL_REPLAY_ON_START=0
VH_NEWS_STORYLINES_ENABLED=0
VH_NEWS_RUNTIME_RAW_BUNDLE_WRITE_CONCURRENCY=1
VH_NEWS_RUNTIME_FIRST_TICK_MAX_PUBLISHED_BUNDLES=8
VH_NEWS_RUNTIME_MAX_PUBLISHED_BUNDLES=8
VH_NEWS_PRODUCT_FEED_REPAIR_SAMPLE_LIMIT=8
VH_NEWS_PRODUCT_FEED_REPAIR_INTERVAL_MS=86400000
```

`VH_NEWS_PRODUCT_FEED_REPAIR_SAMPLE_LIMIT=8` is a launch operating value, not a
permanent ceiling. Raise it deliberately only after paced repair has soaked
cleanly. Scope A live config keeps accepted synthesis disabled: the raw runtime
may still enqueue local synthesis candidates and log an inactive local queue, but
`VH_BUNDLE_SYNTHESIS_ENABLED=0` and `VH_ANALYSIS_EVAL_REPLAY_ON_START=0` must not
publish accepted/topic synthesis relay writes to `/vh/topics/synthesis-candidate`
or `/vh/topics/synthesis`. `VH_NEWS_STORYLINES_ENABLED=0` omits the direct-Gun
storyline overlay adapters for the raw-only profile; the runtime counts generated
storylines as suppressed in tick summaries, and stale storyline cleanup remains
parked until storyline overlays are deliberately re-enabled and soaked as
post-launch enrichment.

## Env File Surface

Default env file:

```bash
~/.config/vhc/news-aggregator.env
```

Template:

```bash
docs/ops/news-aggregator.env.example
```

Required or commonly used names:

```bash
VH_GUN_PEERS
VH_NEWS_DAEMON_START_APPROVED
VH_NEWS_DAEMON_DIAGNOSTIC_NO_WRITE
VH_NEWS_DAEMON_DIAGNOSTIC_APPROVED
VH_STORYCLUSTER_REMOTE_URL
VH_STORYCLUSTER_REMOTE_AUTH_TOKEN
VH_STORYCLUSTER_REMOTE_HEALTH_URL
OPENAI_API_KEY
VH_BUNDLE_SYNTHESIS_ENABLED
VH_ANALYSIS_EVAL_REPLAY_ON_START
VH_NEWS_STORYLINES_ENABLED
VH_NEWS_RELAY_REST_WRITE_FIRST
VH_NEWS_RELAY_REST_WRITE_ORIGINS
VH_NEWS_RELAY_REST_WRITE_TOKENS
VH_NEWS_RELAY_REST_WRITE_REQUIRE_ALL
VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS
VH_NEWS_RELAY_REST_WRITE_TIMEOUT_MS
VH_BUNDLE_SYNTHESIS_RELAY_WRITE_ORIGINS
VH_BUNDLE_SYNTHESIS_RELAY_WRITE_TOKENS
VH_BUNDLE_SYNTHESIS_RELAY_WRITE_REQUIRE_ALL
VH_BUNDLE_SYNTHESIS_RELAY_WRITE_MIN_SUCCESS
VH_BUNDLE_SYNTHESIS_WRITE_RELAY_REST
VH_RELAY_DAEMON_TOKEN
VH_NEWS_DAEMON_HOLDER_ID
VH_NEWS_RUNTIME_LEASE_TTL_MS
VH_NEWS_INGESTION_LEASE_SCOPE
VH_NEWS_DAEMON_LEASE_BACKEND
VH_NEWS_DAEMON_LOCAL_LEASE_FILE
VH_NEWS_DAEMON_STATE_DIR
VH_DAEMON_FEED_ARTIFACT_ROOT
VH_NEWS_DAEMON_LAST_SUCCESS_FILE
VH_NEWS_RUNTIME_DIAGNOSTIC_FILE
VH_NEWS_RUNTIME_TICK_WATCHDOG_MS
VH_NEWS_DAEMON_DEFER_SYNTHESIS_UNTIL_FIRST_TICK_COMPLETE
VH_NEWS_DAEMON_FAIL_CLOSED_ON_RUNTIME_ERROR
VH_NEWS_PRODUCT_FEED_REPAIR_INTERVAL_MS
VH_NEWS_PRODUCT_FEED_REPAIR_SAMPLE_LIMIT
VH_NEWS_FEED_MAX_ITEMS_PER_SOURCE
VH_NEWS_FEED_MAX_ITEMS_TOTAL
VH_NEWS_RUNTIME_MAX_PUBLISHED_BUNDLES
VH_NEWS_RUNTIME_FIRST_TICK_MAX_PUBLISHED_BUNDLES
VH_NEWS_RUNTIME_RAW_BUNDLE_WRITE_CONCURRENCY
VH_STORYCLUSTER_REMOTE_MAX_ITEMS_PER_REQUEST
VH_NEWS_SYSTEM_WRITER_ID
VH_NEWS_SYSTEM_WRITER_PIN_JSON
VH_NEWS_SYSTEM_WRITER_PUBLIC_KEY_SPKI_BASE64URL
VH_NEWS_SYSTEM_WRITER_PRIVATE_KEY_PKCS8_BASE64URL
```

Do not paste values into tickets, PRs, or evidence docs.

For production Phase 5 publisher starts, keep `VH_NEWS_RELAY_REST_WRITE_FIRST`
enabled. The daemon still signs story bodies, latest-index rows, hot-index rows,
and synthesis lifecycle rows with the public news system writer, but it submits
those records to the relay REST write-through routes before attempting any
direct Gun publication.

Phase 5 production policy is explicit 2-of-3 relay REST quorum for raw
public-news rows, the raw pending lifecycle row, and bundle synthesis rows:

```bash
VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS=2
VH_BUNDLE_SYNTHESIS_RELAY_WRITE_MIN_SUCCESS=2
```

When a `*_MIN_SUCCESS` value is set, it takes precedence over the legacy
`*_WRITE_REQUIRE_ALL` boolean. The value is a true minimum over the resolved,
normalized, deduped relay endpoint set. It must be an integer from `1` through
the resolved endpoint count; invalid values, zero endpoints, or impossible
thresholds fail closed before publisher start or before the write fanout. It is
never interpreted as a fallback to one successful relay. If `*_MIN_SUCCESS` is
absent, legacy behavior is unchanged: `*_WRITE_REQUIRE_ALL=true` requires every
resolved relay endpoint, while `false` accepts any single validated relay
success.

Keep `VH_NEWS_RELAY_REST_WRITE_REQUIRE_ALL=true` and
`VH_BUNDLE_SYNTHESIS_RELAY_WRITE_REQUIRE_ALL=true` in the env file as the
legacy fallback posture, but treat the explicit `*_MIN_SUCCESS=2` fields as the
production quorum source of truth. A successful write counts only relay
responses that pass the route's existing payload validation and readback
contract where that route provides one; plain HTTP acceptance is not enough.
The preflight and write logs report `endpoint_count`, `required_success_count`,
`relay_required_success_count`, and failed relay origin labels without printing
tokens, pins, or key material.

Relay write readback is intentionally stricter than public latest-index serving.
The critical write routes (`/vh/news/story`, `/vh/news/latest-index`,
`/vh/news/hot-index`, and `/vh/news/synthesis-lifecycle`) must confirm the
write through their live relay readback path. A latest-index snapshot is
downstream read-through evidence and must not be treated as proof that the
in-flight write durably landed. The same relay-side admission discipline now
protects every write->readback surface, including topic synthesis and forum
writes, so optional lanes cannot stampede the single relay event loop while raw
publication is proving durability. Topic-synthesis backpressure or readback
failure remains optional/non-fatal to the publisher under Scope A; relay-side
bounding does not add it to the publisher fail-closed allow-list.

When the per-relay critical readback admission gate is saturated, the relay
returns `503` with `error=relay-critical-readback-backpressure` (or
`relay-critical-readback-queue-timeout`) and `Retry-After`. The gun client
classifies that response as `relay-backpressure`: it is a failed relay for the
current fanout and never counts as quorum success, but it is distinct from a
hard readback-failed `500` for diagnostics. The 2-of-3 quorum requirement is
unchanged.

Snapshot body verification, story-state refresh, topic synthesis maintenance,
and other optional background work are maintenance work: they are
concurrency-capped and pause while a critical write readback is active or queued
so they cannot starve the single relay event loop and turn a locally landed
write into a false readback timeout. The current safety caps default to
`VH_RELAY_NEWS_INDEX_SNAPSHOT_STORY_VERIFY_MAX_CONCURRENCY=2` and
`VH_RELAY_NEWS_INDEX_SNAPSHOT_REFRESH_MAX_CONCURRENCY=1`; leave
`VH_RELAY_NEWS_INDEX_SNAPSHOT_PAUSE_DURING_WRITE_READBACK=true` unless an
attended rollback explicitly needs the old behavior for diagnosis.

Relays also run a resource watchdog in production. It uses
`perf_hooks.monitorEventLoopDelay()`, RSS, and heap usage thresholds. On breach
it writes a secret-safe diagnostic bundle under the relay data mount, attempts a
short best-effort CPU profile, and exits `1` so Docker can restart that relay.
Deploy packets should recreate relays with bounded `--restart on-failure:5`,
`--memory 2304m --memory-swap 2304m`, `VH_RELAY_STARTUP_JITTER_MAX_MS=5000`,
`VH_RELAY_DIAGNOSTIC_DIR=/data/diagnostics`,
`VH_RELAY_RESOURCE_WATCHDOG_INTERVAL_MS=2000`,
`VH_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES=1100000000`,
`VH_RELAY_WATCHDOG_MAX_HEAP_GROWTH_BYTES=150000000`,
`VH_RELAY_WATCHDOG_MAX_RSS_GROWTH_BYTES=250000000`, and
`VH_RELAY_WATCHDOG_EXIT_GRACE_MS=30000` so repeated overload does not become an
unbounded synchronized restart loop. The Docker memory ceiling is a
host-protection backstop above the 1.8 GB RSS watchdog; the lower heap threshold
plus faster polling and growth-rate trips should capture and exit before V8
reaches its heap ceiling, while the cgroup prevents a fast off-heap spike from
exhausting A6 memory across all three co-located relays. If
`VH_RELAY_WATCHDOG_HEAP_SNAPSHOT_ENABLED=true`,
heap snapshots are written as host-private `0600` artifacts only; do not attach
or publish `.heapsnapshot` files without explicit secret-review approval.

For the capped raw-only Scope A operating profile, run all three relays with
`VH_RELAY_NEWS_INDEX_SNAPSHOT_VERIFY_STORY_BODIES=false` and
`VH_RELAY_NEWS_INDEX_SNAPSHOT_REFRESH_STORY_STATES=false`. The relay still
serves write-through latest-index snapshots and story bodies, but avoids the
verify/refresh heap path that reads and retains full story bodies. The relay
also bounds its latest-index snapshot entry cache and story-body cache; watch
`vh_relay_news_latest_index_snapshot_cache_entries`,
`vh_relay_news_latest_index_story_body_cache_entries`, and their eviction
counters during sustained operation and any future verify/refresh re-enable
soak.

Operators should watch `/metrics` counters
`vh_relay_critical_write_readbacks_started_total`,
`vh_relay_critical_write_readbacks_queued`,
`vh_relay_critical_write_readback_backpressure_total`,
`vh_relay_resource_watchdog_trips_total`,
`vh_relay_snapshot_background_pauses_total`, and
`vh_relay_snapshot_background_concurrency_caps_total`, plus
`vh_relay_news_latest_index_snapshot_entry_evictions_total` and
`vh_relay_news_latest_index_story_body_cache_evictions_total`, during any
post-merge soak.

During the post-#675 soak, a single relay returning `503`
`relay-critical-readback-backpressure` is expected graceful load shedding when
the other two relays satisfy quorum. It must not be counted as success, and it
must not be treated like a readback `500`. Abort or investigate on any critical
route `500`, any fail-close, any watchdog trip, two relays shedding at once such
that quorum falls below 2, or queues that do not drain in idle gaps.

For Scope A launch gating, fail-closed only applies to the quorum-durable raw
path: `/vh/news/story`, `/vh/news/latest-index`, `/vh/news/hot-index`, and the
pending `/vh/news/synthesis-lifecycle` write created during raw publication.
Storyline writes/removes still use direct Gun durability/readback and are
therefore optional telemetry in this phase. Accepted synthesis writes keep their
ledger, dead-letter, and audit behavior, but accepted synthesis availability is
not a Scope A raw-feed gate. Migrating storyline persistence to relay REST quorum
is a separate post-launch durability task.

When relays have different daemon tokens, set `VH_NEWS_RELAY_REST_WRITE_TOKENS`
to a JSON object mapping each relay origin to its token, for example:

```bash
VH_NEWS_RELAY_REST_WRITE_TOKENS='{"https://gun-a.carboncaste.io":"<gun-a-token>","https://gun-b.carboncaste.io":"<gun-b-token>","https://gun-c.carboncaste.io":"<gun-c-token>"}'
```

Raw story/index/lifecycle publication uses the per-origin token for each relay
before falling back to `VH_RELAY_DAEMON_TOKEN`. Bundle synthesis REST writes use
`VH_BUNDLE_SYNTHESIS_RELAY_WRITE_TOKENS` when set, then
`VH_NEWS_RELAY_REST_WRITE_TOKENS`, then the single `VH_RELAY_DAEMON_TOKEN`
fallback. A single `VH_RELAY_DAEMON_TOKEN` is safe only when all configured
relays share that same daemon token.

The raw publication readiness preflight also performs an authenticated no-write
relay REST probe when write-first publication is enabled: it POSTs an empty JSON
body to `/vh/news/story` with each relay's configured bearer token and requires
the relay to reject the body as a validation error after auth. A missing
per-origin token, or a 401/403/503 response, means the publisher token does not
match the relay daemon token, so live start must fail before the first real story
write.

## Lease / Lock Behavior

The daemon writes and renews the shared `NewsIngestionLease` before starting the
runtime. If another holder has a live lease, this daemon stops its runtime and
waits for the next leadership tick. On shutdown it attempts to release its lease.
Lease renewal is intentionally isolated from post-leadership maintenance:
accepted synthesis replay, product-feed reconciliation, and pending synthesis
catch-up run as non-overlapping background work after the heartbeat and runtime
start. Product-feed reconciliation additionally skips until the first completed
runtime tick so startup maintenance cannot race the first raw publish tick. A
slow or wedged maintenance pass must be skipped on later heartbeats rather than
blocking lease renewal. Treat `news daemon lease expired` during a healthy relay
soak as a publisher bug in that isolation contract, not as relay quorum loss.

Recommended production holder:

```bash
VH_NEWS_DAEMON_HOLDER_ID=vh-news-daemon:a6-public
```

Production A6 can use an explicit local-file lease backend:

```bash
VH_NEWS_DAEMON_LEASE_BACKEND=local-file
VH_NEWS_DAEMON_LOCAL_LEASE_FILE=/home/humble/.local/state/vhc/news-aggregator/news-ingestion-lease.json
```

This keeps the existing daemon lease guard and heartbeat behavior, but stores the
lease in the daemon state directory instead of relying on direct public GUN
durable-write readback. It is intended for the single A6 publisher deployment
where the production wrapper sibling scan, daemon pidfile, and `systemd` unit
already provide host-level writer exclusion. Public story/latest/hot/lifecycle
publication remains relay REST write-first with explicit 2-of-3
`*_MIN_SUCCESS` quorum; the local lease backend does not weaken the public feed
write fanout.

## Relay Snapshot Freshness Watch

`tools/scripts/relay-latest-index-snapshot-watch.mjs` reads files only. It does
not call public HTTP latest-index routes.

Defaults:

- files:
  - `/home/humble/.local/share/vhc/vhc-relay-a/data/news-latest-index-snapshot.json`
  - `/home/humble/.local/share/vhc/vhc-relay-b/data/news-latest-index-snapshot.json`
  - `/home/humble/.local/share/vhc/vhc-relay-c/data/news-latest-index-snapshot.json`
- schema: `vh-news-latest-index-relay-snapshot-v1`
- entries: non-empty by default; set `VH_RELAY_SNAPSHOT_WATCH_EXPECTED_ENTRIES`
  only when an exact count is intentionally part of a specific recovery packet
- newest-entry age SLO: `21600000` ms (6 hours)
- timer cadence: 15 minutes

Manual run:

```bash
VH_RELAY_SNAPSHOT_WATCH_OUTPUT_FILE="$HOME/.local/state/vhc/relay-snapshot-watch/latest.json" \
node tools/scripts/relay-latest-index-snapshot-watch.mjs
```

Pre-start publisher recovery baseline:

```bash
VH_RELAY_SNAPSHOT_WATCH_OUTPUT_FILE="$HOME/.local/state/vhc/relay-snapshot-watch/pre-start-baseline.json" \
node tools/scripts/relay-latest-index-snapshot-watch.mjs --baseline
```

`--baseline` and `--structural-only` still validate snapshot file paths,
schema, non-empty entries, JSON parseability, size, mtime sanity, and timestamp
sanity. They do not fail solely because `newest_entry_stale` is already beyond
the 6-hour SLO; instead they record that stale age under `freshnessBaseline`.
Use this before publisher start to prove the snapshots are structurally safe and
to preserve the stale baseline. After publisher start, run the default watcher
with no mode flag; default freshness mode must still fail hard on
`newest_entry_stale` until new signed stories move the snapshots below the 6h
SLO.

Config knobs:

```bash
VH_RELAY_SNAPSHOT_WATCH_FILES
VH_RELAY_SNAPSHOT_WATCH_MODE
VH_RELAY_SNAPSHOT_WATCH_MAX_AGE_MS
VH_RELAY_SNAPSHOT_WATCH_EXPECTED_ENTRIES
VH_RELAY_SNAPSHOT_WATCH_MAX_FILE_BYTES
VH_RELAY_SNAPSHOT_WATCH_OUTPUT_FILE
VH_RELAY_SNAPSHOT_WATCH_SYSLOG
```

Failures exit nonzero and are logged to the user journal; by default the script
also sends a compact failure line to syslog via `logger`.

## Relay #638 Deploy Gate Packet

These commands are read-only until the final restart/deploy line. Do not run any
public latest-index HTTP probe before this packet proves the #638 relay image is
running.

Read-only precheck:

```bash
ssh ccibootstrap
sudo docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' | grep -E 'vhc-relay|vhc-public-beta-origin'
sudo docker inspect vhc-relay-a vhc-relay-b vhc-relay-c >/tmp/vhc-relay-inspect.json
python3 <<'PY'
import json, sys
with open('/tmp/vhc-relay-inspect.json', 'r', encoding='utf-8') as handle:
    containers = json.load(handle)
for container in containers:
    env_names = sorted((entry.split('=', 1)[0] for entry in container.get('Config', {}).get('Env', [])))
    networks = sorted((container.get('NetworkSettings', {}).get('Networks') or {}).keys())
    mounts = [
        {'source': mount.get('Source'), 'destination': mount.get('Destination'), 'mode': mount.get('Mode')}
        for mount in container.get('Mounts', [])
    ]
    print(json.dumps({
        'name': container.get('Name', '').lstrip('/'),
        'image': container.get('Config', {}).get('Image'),
        'env_names': env_names,
        'mounts': mounts,
        'networks': networks,
    }, sort_keys=True))
PY
rm -f /tmp/vhc-relay-inspect.json
node /home/humble/VHC/tools/scripts/relay-latest-index-snapshot-watch.mjs --baseline
```

The precheck must show schema `vh-news-latest-index-relay-snapshot-v1`,
non-empty entries for every relay snapshot, and sane size/mtime. A stale
newest-entry age is recorded as the baseline during publisher recovery; after
first-publish proof, default freshness mode must show newest-entry age under the
6-hour SLO.
Preserve the current relay image tags and inspect output for rollback before
restart.

Only after that direct disk precheck passes, use the existing host deploy pattern
for the relay image containing #638. If the host does not already have a clear
deploy command, stop and hand the operator the inspect output plus current image
tags rather than improvising.

Post-deploy safe proof:

```bash
sudo docker inspect vhc-relay-a vhc-relay-b vhc-relay-c --format '{{.Name}} image={{.Config.Image}}'
sha256sum /home/humble/.local/share/vhc/vhc-relay-{a,b,c}/data/news-latest-index-snapshot.json
stat -c '%n %s %Y' /home/humble/.local/share/vhc/vhc-relay-{a,b,c}/data/news-latest-index-snapshot.json
```

After host proof that #638 is actually running, then and only then run the safe
behavior probes from inside the host/network context:

```bash
curl -sS -i 'http://127.0.0.1:8765/vh/news/latest-index?limit=1&persist=true'
curl -sS -i 'http://127.0.0.1:8765/vh/news/latest-index?limit=1&persist=false'
sha256sum /home/humble/.local/share/vhc/vhc-relay-a/data/news-latest-index-snapshot.json
stat -c '%n %s %Y' /home/humble/.local/share/vhc/vhc-relay-a/data/news-latest-index-snapshot.json
```

Expected:

- `persist=true` returns JSON HTTP 400.
- `persist=false` returns JSON and leaves snapshot hash, mtime, and content
  unchanged.

Repeat equivalent `persist=false` hash/mtime proof for relay B and C.

## Analysis Repoint Packet

Do not repoint production origin until `docs/ops/analysis-backend-3001.md` local
and host checks are green and the operator approves the env change.

Approved host packet:

```bash
cd /home/humble/VHC
git fetch origin main
git checkout main
git pull --ff-only
./tools/scripts/install-analysis-backend-service.sh
curl -sS -i http://127.0.0.1:3001/api/analyze/health
curl -sS -i http://127.0.0.1:3001/api/analyze/config
curl -sS -i -X POST http://127.0.0.1:3001/api/analyze -H 'content-type: application/json' --data '{"prompt":"probe"}'
```

Then update the origin env var name only:

```bash
VH_PUBLIC_ORIGIN_ANALYSIS_TARGET=http://127.0.0.1:3001
```

Restart the origin through the existing host pattern and verify:

```bash
curl -sS -i http://127.0.0.1:<origin-port>/api/analyze/health
curl -sS -i http://127.0.0.1:<origin-port>/api/analyze/config
curl -sS -i https://venn.carboncaste.io/api/analyze/health
curl -sS -i https://venn.carboncaste.io/api/analyze/config
```

## Release Evidence Gate

`pnpm check:news-sources:health` remains the release-grade source-health gate.
It enforces the rolling release-evidence window and should stay in release
readiness, canary, and Phase 6 evidence chains. Pull-request CI and publisher
restart use `pnpm check:news-sources:liveness` so normal engineering validation
and incident recovery are not blocked on the live release-evidence window. The
release-grade command is intentionally not the publisher restart preflight
because a long publisher outage can otherwise create a deadlock: the feed cannot
restart until it has recent release-evidence runs, but it cannot generate those
runs while the publisher is stopped.

## Publisher Start Abort Criteria

Abort or stop the service if any of these occur:

- source-health liveness preflight fails;
- OpenAI preflight is not `pass`;
- StoryCluster health check fails;
- raw news or raw pending lifecycle relay REST write fanout is below the
  configured quorum target;
- `NRestarts` increments, systemd reports a start-limit hit, or the journal shows
  `runtime error triggered fail-closed stop`;
- `news-aggregator-publisher-liveness-watch.mjs` reports a failed unit state,
  increased `NRestarts`, stale diagnostics, or a diagnostic run id mismatch;
- `news-relay-liveness-watch.mjs` reports a relay restart-count increase,
  watchdog trip, hot RSS/heap/event-loop lag, or persistent queued critical
  readbacks;
- snapshot watch reports stale newest-entry age above 6 hours;
- latest content does not advance after approved start and expected ingest
  cadence.

After an approved start, Scope A live evidence requires fresh content advance,
pending lifecycle evidence, public latest-index/story-body readability, an
attended soak, and enabled liveness/freshness monitors. The 2026-06-24 closeout
records the first completed proof for that raw Scope A launch. Accepted
synthesis and storyline enrichment evidence remain post-launch quality checks,
not Scope A raw-feed gates. The service starting successfully by itself is never
a release-ready claim.
