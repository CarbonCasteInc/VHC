# News Aggregator Production Service

> Status: Operational Runbook
> Owner: VHC Ops
> Last Reviewed: 2026-06-15
> Depends On: docs/ops/NEWS_SOURCE_ADMISSION_RUNBOOK.md, docs/ops/public-feed-freshness-monitor.md, docs/ops/analysis-backend-3001.md, docs/ops/storycluster-production-service.md, docs/ops/public-beta-launch-readiness-closeout.md

## Purpose

This runbook packages the existing `@vh/news-aggregator` daemon as the managed
production publisher. It does not introduce a second publisher path.

The daemon is continuous, not one-shot: `services/news-aggregator/src/daemon.ts`
starts the news runtime after acquiring the ingestion lease, renews leadership on
an interval, keeps product-feed reconciliation and pending synthesis catch-up on
their own intervals, and exits only when the process receives SIGINT/SIGTERM or
startup fails closed.

## Hard Boundaries

- Do not start production publisher writes without explicit operator approval.
- Do not run public latest-index HTTP reads until the #638 relay code is proven
  deployed on the host.
- Keep public-feed monitors disabled until relay deploy proof, safe validation,
  analysis health/config, publisher freshness, and canary/soak gates are green.
- Store secrets only in host env files outside git. Record env var names, host,
  port, and artifact paths only.

## Managed Units

Templates:

- `infra/systemd/user/vh-news-aggregator.service`
- `infra/systemd/user/vh-relay-snapshot-freshness-watch.service`
- `infra/systemd/user/vh-relay-snapshot-freshness-watch.timer`

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

Abort / kill switch:

```bash
systemctl --user stop vh-news-aggregator.service
systemctl --user disable vh-news-aggregator.service
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
cluster-capture artifact for that many ticks. The daemon also acquires
`$VH_NEWS_DAEMON_PID_FILE` or `$VH_NEWS_DAEMON_STATE_DIR/news-daemon.pid` before
creating the mesh client; a direct `pnpm --filter @vh/news-aggregator daemon`
launch refuses to start while another daemon process owns that pidfile.

The production wrapper applies bounded feed/StoryCluster workload defaults
unless the env file explicitly overrides them:

```bash
VH_NEWS_FEED_MAX_ITEMS_PER_SOURCE
VH_NEWS_FEED_MAX_ITEMS_TOTAL
VH_STORYCLUSTER_REMOTE_MAX_ITEMS_PER_REQUEST
VH_NEWS_RUNTIME_MAX_PUBLISHED_BUNDLES
VH_NEWS_RUNTIME_FIRST_TICK_MAX_PUBLISHED_BUNDLES
VH_NEWS_RUNTIME_TICK_WATCHDOG_MS
```

These caps keep the first publisher tick from expanding a broad source set into
dozens of sequential remote StoryCluster requests or a large raw publication
blast before the first successful write can be observed. The steady-state
publication cap defaults to 96 bundles, while
`VH_NEWS_RUNTIME_FIRST_TICK_MAX_PUBLISHED_BUNDLES` defaults to 24 and applies
only to tick 1. That first-tick cap is intentionally lower so the post-reset
live start lands a small, inspectable batch before the daemon opens to the
steady-state publication limit. The wrapper also gives the first-tick watchdog
enough headroom for the bounded cold-start batch to finish before a warning
becomes an operator abort signal. Override these values deliberately only when
StoryCluster throughput, first-tick quality review, steady-state publication
fanout, and the watchdog window have been recalibrated together.

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
VH_BUNDLE_SYNTHESIS_RELAY_WRITE_ORIGINS
VH_BUNDLE_SYNTHESIS_RELAY_WRITE_REQUIRE_ALL
VH_BUNDLE_SYNTHESIS_WRITE_RELAY_REST
VH_RELAY_DAEMON_TOKEN
VH_NEWS_DAEMON_HOLDER_ID
VH_NEWS_RUNTIME_LEASE_TTL_MS
VH_NEWS_INGESTION_LEASE_SCOPE
VH_NEWS_DAEMON_STATE_DIR
VH_DAEMON_FEED_ARTIFACT_ROOT
VH_NEWS_DAEMON_LAST_SUCCESS_FILE
VH_NEWS_RUNTIME_DIAGNOSTIC_FILE
VH_NEWS_RUNTIME_TICK_WATCHDOG_MS
VH_NEWS_FEED_MAX_ITEMS_PER_SOURCE
VH_NEWS_FEED_MAX_ITEMS_TOTAL
VH_NEWS_RUNTIME_MAX_PUBLISHED_BUNDLES
VH_STORYCLUSTER_REMOTE_MAX_ITEMS_PER_REQUEST
VH_NEWS_SYSTEM_WRITER_ID
VH_NEWS_SYSTEM_WRITER_PIN_JSON
VH_NEWS_SYSTEM_WRITER_PUBLIC_KEY_SPKI_BASE64URL
VH_NEWS_SYSTEM_WRITER_PRIVATE_KEY_PKCS8_BASE64URL
```

Do not paste values into tickets, PRs, or evidence docs.

## Lease / Lock Behavior

The daemon writes and renews the shared `NewsIngestionLease` before starting the
runtime. If another holder has a live lease, this daemon stops its runtime and
waits for the next leadership tick. On shutdown it attempts to release its lease.

Recommended production holder:

```bash
VH_NEWS_DAEMON_HOLDER_ID=vh-news-daemon:a6-public
```

## Relay Snapshot Freshness Watch

`tools/scripts/relay-latest-index-snapshot-watch.mjs` reads files only. It does
not call public HTTP latest-index routes.

Defaults:

- files:
  - `/home/humble/.local/share/vhc/vhc-relay-a/data/news-latest-index-snapshot.json`
  - `/home/humble/.local/share/vhc/vhc-relay-b/data/news-latest-index-snapshot.json`
  - `/home/humble/.local/share/vhc/vhc-relay-c/data/news-latest-index-snapshot.json`
- schema: `vh-news-latest-index-relay-snapshot-v1`
- expected entries: `15`
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
schema, entry count, JSON parseability, size, mtime sanity, and timestamp
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

The precheck must show schema `vh-news-latest-index-relay-snapshot-v1`, `15`
entries for every relay snapshot, and sane size/mtime. A stale newest-entry age
is recorded as the baseline during publisher recovery; after first-publish
proof, default freshness mode must show newest-entry age under the 6-hour SLO.
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
- relay REST write fanout is below the configured `require_all` target;
- snapshot watch reports stale newest-entry age above 6 hours;
- latest content does not advance after approved start and expected ingest
  cadence.

After an approved start, release evidence still requires
`pnpm check:news-sources:health`, fresh content advance, synthesis
lifecycle/publication evidence, public canary, and soak. The service starting
successfully is not a release-ready claim.
