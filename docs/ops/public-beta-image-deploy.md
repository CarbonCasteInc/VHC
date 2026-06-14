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
  `vh-news-latest-index-relay-snapshot-v1`, or has entries other than `15`.
- Run relays with a UID/GID that can write the existing host data dirs.
  Snapshot persistence can otherwise fail without surfacing as a user-facing
  deploy error.
- Set `NODE_ENV=production` on relays so snapshot-first latest-index serving
  stays enabled by default.
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
- `tools/scripts/emit-a6-public-beta-deploy-packet.sh` emits a secret-safe A6
  deploy packet from captured `docker inspect` JSON.

## Capture Provenance

Capture image/container evidence before any restart:

```bash
ssh humble@ccibootstrap
mkdir -p /tmp/vhc-public-beta-capture
sudo docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' \
  | grep -E 'vhc-relay|vhc-public-beta-origin'
sudo docker inspect vhc-public-beta-origin vhc-relay-a vhc-relay-b vhc-relay-c \
  >/tmp/vhc-public-beta-capture/containers.json
sudo docker image inspect \
  "$(sudo docker inspect -f '{{.Config.Image}}' vhc-public-beta-origin)" \
  "$(sudo docker inspect -f '{{.Config.Image}}' vhc-relay-a)" \
  >/tmp/vhc-public-beta-capture/images.json
sudo docker history --no-trunc \
  "$(sudo docker inspect -f '{{.Config.Image}}' vhc-public-beta-origin)" \
  >/tmp/vhc-public-beta-capture/origin-history.txt
sudo docker history --no-trunc \
  "$(sudo docker inspect -f '{{.Config.Image}}' vhc-relay-a)" \
  >/tmp/vhc-public-beta-capture/relay-history.txt
```

Record env var names only in tickets or PRs. Do not paste values. For the origin
build, create a private env file outside git from the current deployed image or
the operator that built it:

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
   three snapshot files still exist in the relay `GUN_FILE` directory.
5. After all relays prove the #638 image is running, run safe latest-index
   behavior probes:
   - `persist=true` returns JSON 400.
   - `persist=false` leaves snapshot hash, mtime, and content unchanged.
6. Deploy the origin image from the same `main` revision and repoint analysis to
   `http://127.0.0.1:3001`.
7. Verify local and public `/api/analyze/health` and `/api/analyze/config`.
8. Only after explicit operator approval, add
   `VH_NEWS_DAEMON_START_APPROVED=1` to the publisher env file and start the
   managed publisher.
9. Prove latest content advances and synthesis lifecycle/publication evidence
   is fresh.
10. Re-enable the public freshness monitor and begin soak/canary.

## No-Go Criteria

Abort the deploy if any of these are true:

- Any relay `GUN_FILE` data mount is not a bind mount to the existing host path.
- Any relay data dir is empty, unwritable by the intended UID/GID, or missing
  one of the three snapshot files.
- Any latest-index snapshot has entries other than `15`.
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
