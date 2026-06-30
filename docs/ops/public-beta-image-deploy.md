# Public Beta Image Build and Deploy Recovery

> Status: Active
> Owner: VHC Ops + Core Engineering
> Last Reviewed: 2026-06-14
> Depends On: docs/ops/news-aggregator-production-service.md, docs/ops/analysis-backend-3001.md, docs/ops/public-feed-freshness-monitor.md, docs/ops/mesh-production-operator-runbook.md

This runbook makes the public beta origin and relay image path reproducible
after the ad-hoc `vhc-public-beta-{origin,relay}:20260611-prNNN` deploys. It is
not approval to restart production containers, start publisher writes, scrub
latest roots, run catch-up/republish, probe public latest-index routes, or
re-enable monitors.

## Invariants

- Build and deploy images for `linux/amd64`; do not rely on the local Docker
  default platform.
- Preserve relay data bind mounts exactly at each relay's `GUN_FILE`
  destination. Current A6 relays set `GUN_FILE=/data`, so the production-shape
  bind mounts are:
  - `/home/humble/.local/share/vhc/vhc-relay-a/data:/data`
  - `/home/humble/.local/share/vhc/vhc-relay-b/data:/data`
  - `/home/humble/.local/share/vhc/vhc-relay-c/data:/data`
- Preserve the three relay snapshot files in each relay `GUN_FILE` directory:
  - `news-latest-index-snapshot.json`
  - `news-synthesis-lifecycle-snapshot.json`
  - `topic-synthesis-latest-snapshot.json`
- Abort if any relay latest-index snapshot is missing, has schema other than
  `vh-news-latest-index-relay-snapshot-v1`, or has an empty/non-list `entries`
  array. Do not scrub or rewrite a valid latest-index snapshot solely because
  its preserved entry count differs from an older runbook example.
- A non-empty latest-index snapshot is the public latest-index stale-serving
  fallback after an empty live read. Do not delete a structurally valid snapshot
  solely because it is older than the freshness SLO; deploy validation should
  report the stale age, then let fresh publisher ticks move it forward.
- Run relays with a UID/GID that can write the existing host data dirs.
  Snapshot persistence can otherwise fail without surfacing as a user-facing
  deploy error.
- Set `NODE_ENV=production` on relays so snapshot-first latest-index serving
  and stale-on-empty latest-index serving stay enabled by default.
- Run relays with bounded self-recovery: `--restart on-failure:5`,
  `--memory 2304m --memory-swap 2304m`,
  `VH_RELAY_RESOURCE_WATCHDOG_ENABLED=true`,
  `VH_RELAY_RESOURCE_WATCHDOG_INTERVAL_MS=2000`,
  `VH_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES=1100000000`,
  `VH_RELAY_WATCHDOG_MAX_HEAP_GROWTH_BYTES=150000000`,
  `VH_RELAY_WATCHDOG_MAX_RSS_GROWTH_BYTES=250000000`,
  `VH_RELAY_DIAGNOSTIC_DIR=/data/diagnostics`, and
  `VH_RELAY_STARTUP_JITTER_MAX_MS=5000`. Relay watchdog exit is intentionally
  restartable; publisher fail-closed exit is intentionally not. The memory
  ceiling sits above the relay's graceful RSS watchdog and below host-exhaustion
  territory, so a fast off-heap spike is contained to one relay container.
  `VH_RELAY_WATCHDOG_HEAP_SNAPSHOT_ENABLED=true` is useful during attended soaks,
  but its `.heapsnapshot` files are host-private diagnostic artifacts, not
  shareable release evidence. The generated A6 deploy packet includes a safe
  relay-diagnostics evidence capture block that excludes `*.heapsnapshot` and
  `*.heapprofile`, then fails closed if either appears in the tar manifest; use
  that path for shareable diagnostics unless a separate secret-review approval
  authorizes raw heap artifacts.
- For Scope A capped raw-only relays, keep snapshot verify/refresh disabled with
  `VH_RELAY_NEWS_INDEX_SNAPSHOT_VERIFY_STORY_BODIES=false` and
  `VH_RELAY_NEWS_INDEX_SNAPSHOT_REFRESH_STORY_STATES=false`. The latest-index
  snapshot and story-body REST caches are bounded in code, but those caps are
  not a bound on Gun's in-memory graph; verify/refresh can be re-enabled
  deliberately after a separate relay-memory soak.
- Keep relay critical write/readback admission bounded. The deploy packet adds
  `VH_RELAY_CRITICAL_WRITE_READBACK_MAX_CONCURRENCY=2`,
  `VH_RELAY_CRITICAL_WRITE_READBACK_QUEUE_LIMIT=16`, and
  `VH_RELAY_CRITICAL_WRITE_READBACK_QUEUE_TIMEOUT_MS=1000` unless A6 has an
  explicit reviewed override.
- Treat `vh_relay_radata_bytes` as a cached gauge. The relay refreshes it off
  the `/metrics` request path with `VH_RELAY_RADATA_BYTES_REFRESH_INTERVAL_MS`
  (default 30s), bounded by `VH_RELAY_RADATA_BYTES_SCAN_MAX_ENTRIES`,
  `VH_RELAY_RADATA_BYTES_SCAN_MAX_DEPTH`, and
  `VH_RELAY_RADATA_BYTES_SCAN_TIMEOUT_MS`. During soak, scrape the companion
  refresh age/error/truncation counters; a metrics scrape must not recursively
  walk the radata tree.
- Treat Gun graph metrics as opt-in diagnostics, not release blockers.
  `VH_RELAY_GUN_GRAPH_SCAN_ENABLED=false` by default. When enabled for an
  attended memory soak, the relay scans `gun._.graph` only from a background
  task and `/metrics` reads the cached result. Bound the scan with
  `VH_RELAY_GUN_GRAPH_SCAN_INTERVAL_MS` (default 60s),
  `VH_RELAY_GUN_GRAPH_SCAN_BATCH_SIZE` (default 1000),
  `VH_RELAY_GUN_GRAPH_SCAN_MAX_SOULS` (default 250000), and
  `VH_RELAY_GUN_GRAPH_SCAN_MAX_DURATION_MS` (default 5000). The shareable
  metric families report namespace/state counts and byte totals only:
  `vh_relay_gun_graph_souls_total`,
  `vh_relay_gun_graph_user_fields_total`, and
  `vh_relay_gun_graph_user_value_bytes`, plus scan age/duration/truncation and
  success/error counters. They must not be used as hard rollout blockers until
  a separate soak proves the signal. Missing or truncated graph scans mean the
  heap driver remains unknown.
- Leave relay `GUN_STATS` unset or explicitly `false`. The relay disables GUN's
  package-local stats writer by default; setting `GUN_STATS=true` makes GUN
  write `stats.<basename(GUN_FILE)>` beside `node_modules/gun`, which is not a
  production data mount and can produce persistent permission errors.
- Capture build-time Web PWA `VITE_*` provenance before rebuilding origin.
  Runtime env cannot repair a bundle built against the wrong peer config, CSP,
  system-writer pin, or local-peer policy.

## Files

- `infra/origin/Dockerfile` builds the Web PWA and origin server image.
- `infra/relay/Dockerfile` builds the relay image.
- `infra/docker/docker-compose.public-beta.yml` records the current A6
  production-shape topology with bind-mounted relay data dirs at `GUN_FILE=/data`
  and image tags supplied by env.
- `tools/scripts/build-public-beta-images.sh` builds origin and relay images
  with a pinned platform and records buildx metadata.
- `tools/scripts/export-public-beta-image-artifacts.sh` exports already-built
  images to private tarballs, writes checksums, and emits the approval-only A6
  image-load packet.
- `tools/scripts/recover-public-beta-origin-provenance.mjs` creates a private
  origin build provenance env template from captured origin static artifacts
  without printing recovered values.
- `tools/scripts/emit-a6-public-beta-deploy-packet.sh` emits a secret-safe A6
  deploy packet from captured `docker inspect` JSON.

## Capture Provenance

Capture image/container evidence before any restart:

```bash
ssh humble@ccibootstrap
mkdir -p /tmp/vhc-public-beta-capture
sudo docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' \
  | grep -E 'vhc-public-origin|vhc-relay-a|vhc-relay-b|vhc-relay-c'
sudo docker inspect vhc-public-origin vhc-relay-a vhc-relay-b vhc-relay-c \
  >/tmp/vhc-public-beta-capture/containers.json
sudo docker image inspect \
  "$(sudo docker inspect -f '{{.Config.Image}}' vhc-public-origin)" \
  "$(sudo docker inspect -f '{{.Config.Image}}' vhc-relay-a)" \
  >/tmp/vhc-public-beta-capture/images.json
sudo docker history --no-trunc \
  "$(sudo docker inspect -f '{{.Config.Image}}' vhc-public-origin)" \
  >/tmp/vhc-public-beta-capture/origin-history.txt
sudo docker history --no-trunc \
  "$(sudo docker inspect -f '{{.Config.Image}}' vhc-relay-a)" \
  >/tmp/vhc-public-beta-capture/relay-history.txt
```

Record env var names only in tickets or PRs. Do not paste values. For the origin
build, first capture the currently deployed static artifact without using public
HTTP:

```bash
ssh humble@ccibootstrap
mkdir -p /tmp/vhc-public-beta-capture
STATIC_DIR="$(
  sudo docker inspect vhc-public-origin --format '{{range .Config.Env}}{{println .}}{{end}}' \
    | awk -F= '/^VH_PUBLIC_ORIGIN_STATIC_DIR=/{print $2; found=1} END{if(!found) print "/app/dist"}'
)"
sudo docker exec vhc-public-origin tar -C "${STATIC_DIR}" -cf - . \
  >/tmp/vhc-public-beta-capture/origin-dist.tar
exit

mkdir -p ~/.config/vhc
scp humble@ccibootstrap:/tmp/vhc-public-beta-capture/origin-dist.tar \
  ~/.config/vhc/origin-dist.tar
scp humble@ccibootstrap:/tmp/vhc-public-beta-capture/containers.json \
  ~/.config/vhc/containers.json
rm -rf ~/.config/vhc/a6-origin-dist
mkdir -p ~/.config/vhc/a6-origin-dist
tar -C ~/.config/vhc/a6-origin-dist -xf ~/.config/vhc/origin-dist.tar
```

Then create a private env file outside git from the captured static artifact:

```bash
node tools/scripts/recover-public-beta-origin-provenance.mjs \
  --dist ~/.config/vhc/a6-origin-dist \
  --inspect-json ~/.config/vhc/containers.json \
  --output ~/.config/vhc/public-beta-origin-build-provenance.env
```

The recovery helper writes recovered values to the private env file but prints
only names, file mode, and hashes. With both `--dist` and `--inspect-json`, it
recovers:

- signed peer config public key, minimum peer count, and quorum from
  `mesh-peer-config.json`;
- `VITE_VH_CSP_CONNECT_SRC` from the current origin container's
  `VH_PUBLIC_ORIGIN_CSP_CONNECT_SRC`;
- `VITE_NEWS_SYSTEM_WRITER_PIN_JSON` from captured Vite JS chunks.

It does not print those values. It intentionally leaves any non-recoverable
required values commented as `TODO(operator)`, and
`build-public-beta-images.sh` will refuse an incomplete provenance file. Even
when the helper reports `build_ready=yes`, review any reported `default_names`
and `blank_names`; those are behavior-preserving defaults, not proof of the
exact previous build.

If the deployed origin image path differs from `/app/dist`, identify it from:

```bash
sudo docker inspect vhc-public-origin --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -E '^VH_PUBLIC_ORIGIN_STATIC_DIR='
```

Do not paste the value in tickets if it contains anything beyond host-local
paths; record only the env var name and the fact that it was verified.

If the static artifact is unavailable, fall back to a blank private template and
fill every value from the operator record:

```bash
tools/scripts/build-public-beta-images.sh --print-provenance-template \
  > ~/.config/vhc/public-beta-origin-build-provenance.env
chmod 600 ~/.config/vhc/public-beta-origin-build-provenance.env
```

Required build-time names:

```bash
VITE_GUN_PEERS
VITE_GUN_PEER_CONFIG_URL
VITE_GUN_PEER_CONFIG_PUBLIC_KEY
VITE_GUN_PEER_MINIMUM
VITE_GUN_PEER_QUORUM_REQUIRED
VITE_VH_STRICT_PEER_CONFIG
VITE_VH_ALLOW_LOCAL_MESH_PEERS
VITE_VH_CSP_CONNECT_SRC
VITE_VH_CSP_STRICT_CONNECT_SRC
VITE_NEWS_EXTRACTION_SERVICE_URL
VITE_NEWS_SYSTEM_WRITER_PIN_JSON
VITE_VH_ANALYSIS_PIPELINE
VITE_NEWS_RUNTIME_ENABLED
VITE_NEWS_RUNTIME_ROLE
VITE_NEWS_BRIDGE_ENABLED
VITE_SYNTHESIS_BRIDGE_ENABLED
VITE_VH_GUN_LOCAL_STORAGE
VITE_LUMA_PROFILE
VITE_LUMA_DEV_FALLBACK
VITE_ATTESTATION_URL
VITE_CONSTITUENCY_PROOF_REAL
VITE_E2E_MODE
```

Use shell-compatible quoting for values containing spaces or JSON. For example,
quote `VITE_VH_CSP_CONNECT_SRC` and `VITE_NEWS_SYSTEM_WRITER_PIN_JSON` in the
private provenance file.

Also capture the signed `mesh-peer-config.json` served by the current origin.
It is public trust material, not a secret, but keep the capture packet together
with the build provenance.

## Build Images

Dry-run first:

```bash
tools/scripts/build-public-beta-images.sh \
  --all \
  --platform linux/amd64 \
  --provenance-env ~/.config/vhc/public-beta-origin-build-provenance.env \
  --peer-config-file ~/.config/vhc/mesh-peer-config.json \
  --dry-run
```

Build locally:

```bash
tools/scripts/build-public-beta-images.sh \
  --all \
  --platform linux/amd64 \
  --provenance-env ~/.config/vhc/public-beta-origin-build-provenance.env \
  --peer-config-file ~/.config/vhc/mesh-peer-config.json
```

For registry publication, add `--push` and use immutable tags or digests in the
deploy packet. Do not bake relay daemon tokens, OpenAI keys, or system-writer
private keys into image layers.

## Export Image Artifacts

If A6 is receiving images by direct file transfer rather than a registry push,
export the locally loaded images with the committed exporter:

```bash
tools/scripts/export-public-beta-image-artifacts.sh \
  --origin-image vhc-public-beta-origin:<tag> \
  --relay-image vhc-public-beta-relay:<tag> \
  --output-dir .tmp/public-beta-image-artifacts/<tag>
```

The exporter refuses images whose Docker metadata platform is not
`linux/amd64`, and by default refuses images whose
`org.opencontainers.image.revision` label does not match the current checkout.
It writes:

- `vhc-public-beta-origin_<tag>.tar`
- `vhc-public-beta-relay_<tag>.tar`
- `SHA256SUMS`
- `artifact-manifest.json`
- `a6-image-load-packet.md`

All files are local artifacts. The emitted load packet contains `scp`,
`sha256sum -c`, `docker load`, and `docker image inspect` commands only. It is
not approval to restart containers, deploy relays, deploy origin, run
latest-index HTTP probes, start publisher writes, or re-enable monitors.

## Emit Deploy Packet

Copy `/tmp/vhc-public-beta-capture/containers.json` from A6 to the build
machine, then generate the secret-safe packet:

```bash
tools/scripts/emit-a6-public-beta-deploy-packet.sh \
  --inspect-json ./containers.json \
  --new-origin-image vhc-public-beta-origin:<tag-or-digest> \
  --new-relay-image vhc-public-beta-relay:<tag-or-digest> \
  --output .tmp/a6-public-beta-deploy-packet.md
```

This emits read-only prechecks and env capture commands only. After explicit
operator approval, include recreate commands:

```bash
tools/scripts/emit-a6-public-beta-deploy-packet.sh \
  --inspect-json ./containers.json \
  --new-origin-image vhc-public-beta-origin:<tag-or-digest> \
  --new-relay-image vhc-public-beta-relay:<tag-or-digest> \
  --include-recreate-commands \
  --output .tmp/a6-public-beta-deploy-packet-approved.md
```

The packet corrects only:

```bash
VH_PUBLIC_ORIGIN_ANALYSIS_TARGET=http://127.0.0.1:3001
```

All other runtime values are captured to env files on the host without printing
their values.

## Deploy Order

1. Install and verify the local `:3001` analysis backend.
2. Run the direct on-disk relay snapshot precheck for every relay.
3. Deploy one relay at a time with the existing host data bind mount preserved.
4. After each relay restart, prove the running image tag/digest and verify the
   three snapshot files still exist in the relay `GUN_FILE` directory. Confirm
   the relay env includes the watchdog/admission defaults and Docker shows
   `RestartPolicy.Name=on-failure` with `MaximumRetryCount=5`.
5. After all relays prove the #638 image is running, run safe latest-index
   behavior probes:
   - `persist=true` returns JSON 400.
   - `persist=false` leaves snapshot hash, mtime, and content unchanged.
6. Deploy the origin image from the same `main` revision and repoint analysis to
   `http://127.0.0.1:3001`.
7. Verify local and public `/api/analyze/health` and `/api/analyze/config`.
8. Only after explicit operator approval, run the publisher installer with
   `VH_NEWS_DAEMON_START_APPROVED=1`; the installer imports that approval into
   the user systemd manager before starting `vh-news-aggregator.service`.
9. Prove latest content advances and synthesis lifecycle/publication evidence
   is fresh.
10. Re-enable the relay liveness, publisher liveness, and public freshness
   monitors in that order, then begin soak/canary. The relay liveness timer is
   an active remediation timer once enabled: it can restart one unhealthy relay
   per run with cooldown, so leave it disabled during intentional relay
   maintenance.

## No-Go Criteria

Abort the deploy if any of these are true:

- Any relay `GUN_FILE` data mount is not a bind mount to the existing host path.
- Any relay data dir is empty, unwritable by the intended UID/GID, or missing
  one of the three snapshot files.
- Any latest-index snapshot has an empty or non-list `entries` array.
- The new image platform is not `linux/amd64`.
- The origin image lacks `apps/web-pwa/dist/index.html` or
  `apps/web-pwa/dist/mesh-peer-config.json`.
- The captured build provenance is incomplete or contains a local-peer policy
  that differs from production intent.
- The relay image proof does not show code containing the #638 nonmutating
  latest-index behavior.
- The operator has not explicitly approved production restarts, publisher
  writes, monitor re-enable, or canary/soak.

## Rollback

The deploy packet records current image tags and emits rollback commands when
run with `--include-recreate-commands`. Rollback must preserve the same env-file
captures and bind mounts. Removing `VH_NEWS_DAEMON_START_APPROVED=1` prevents
future publisher starts, but aborting an already running publisher still
requires:

```bash
systemctl --user stop vh-news-aggregator.service
```

Then remove the approval flag before any restart.
Also remove the user-manager approval if it was imported:

```bash
systemctl --user unset-environment VH_NEWS_DAEMON_START_APPROVED
```
