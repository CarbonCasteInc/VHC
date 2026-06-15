# StoryCluster Production Service

> Status: Operational Runbook
> Owner: VHC Ops
> Last Reviewed: 2026-06-15
> Depends On: docs/ops/news-aggregator-production-service.md

## Purpose

The production publisher offloads clustering to the StoryCluster HTTP service
before it creates the Gun client or starts the runtime. StoryCluster is therefore
a hard publisher dependency, not a canary-only surface.

This runbook installs two managed user units:

- `vh-storycluster-qdrant.service`: loopback-only Qdrant vector store with
  persistent storage.
- `vh-storycluster-engine.service`: loopback-only StoryCluster HTTP server on
  `127.0.0.1:4310`, running with `NODE_ENV=production` and
  `VH_STORYCLUSTER_VECTOR_BACKEND=qdrant`.

There is no memory-vector bootstrap mode in this production path.

## Env File Surface

Default env file:

```bash
~/.config/vhc/storycluster.env
```

Template:

```bash
docs/ops/storycluster.env.example
```

Required names:

```bash
OPENAI_API_KEY
VH_STORYCLUSTER_SERVER_AUTH_TOKEN
VH_STORYCLUSTER_VECTOR_BACKEND
VH_STORYCLUSTER_QDRANT_URL
```

The real file must be mode `600`. For operator evidence, print only mode, owner,
hash, and sorted variable names. Do not print secret values.

## Install / Start

These units run as `humble` user services. Enable and verify linger before
installing so Qdrant and StoryCluster survive logout and reboot:

```bash
loginctl enable-linger humble
loginctl show-user humble -p Linger --value
```

The verification command must print `yes`. The installer fails closed if
`loginctl` cannot confirm linger is enabled. After install, verify both units are
enabled:

```bash
systemctl --user is-enabled vh-storycluster-qdrant.service
systemctl --user is-enabled vh-storycluster-engine.service
```

Install units without starting:

```bash
cd /home/humble/VHC
./tools/scripts/install-storycluster-production-service.sh
```

Start both Qdrant and StoryCluster after provisioning
`~/.config/vhc/storycluster.env`:

```bash
./tools/scripts/install-storycluster-production-service.sh --start
systemctl --user status vh-storycluster-qdrant.service --no-pager
systemctl --user status vh-storycluster-engine.service --no-pager
journalctl --user -u vh-storycluster-qdrant.service -n 100 --no-pager
journalctl --user -u vh-storycluster-engine.service -n 200 --no-pager
```

The installer starts Qdrant first, waits for `GET /collections`, then starts
StoryCluster and waits for authenticated `GET /ready`. The StoryCluster start
wrapper also polls Qdrant before running the Node server, so unattended restarts
and reboots do not expose a transient memory-backed or Qdrant-unready service.
StoryCluster readiness must return `ok: true` and a `detail` beginning with
`qdrant:`.

## Health And Contract Checks

Use the same token configured as `VH_STORYCLUSTER_SERVER_AUTH_TOKEN` without
printing it:

```bash
set -a
. ~/.config/vhc/storycluster.env
set +a

curl -fsS \
  -H "authorization: Bearer ${VH_STORYCLUSTER_SERVER_AUTH_TOKEN}" \
  http://127.0.0.1:4310/ready
```

Expected non-secret response shape:

```json
{"ok":true,"service":"storycluster-engine","detail":"qdrant:storycluster_coarse_vectors"}
```

`GET /health` is a shallow process check. Use `/ready` for production gating
because it verifies the file store and Qdrant vector backend.

## Publisher Env Coupling

After StoryCluster is ready, the publisher env file should point at the local
managed service:

```bash
VH_STORYCLUSTER_REMOTE_URL=http://127.0.0.1:4310/cluster
VH_STORYCLUSTER_REMOTE_HEALTH_URL=http://127.0.0.1:4310/ready
VH_STORYCLUSTER_REMOTE_AUTH_TOKEN=<same value as VH_STORYCLUSTER_SERVER_AUTH_TOKEN>
VH_STORYCLUSTER_REMOTE_AUTH_HEADER=authorization
VH_STORYCLUSTER_REMOTE_AUTH_SCHEME=Bearer
```

The publisher start wrapper still runs the StoryCluster OpenAI preflight, and
the daemon still verifies StoryCluster health before creating the Gun client.

## Abort / Stop

Stopping StoryCluster is read/compute-only and does not write to the mesh:

```bash
systemctl --user stop vh-storycluster-engine.service
systemctl --user disable vh-storycluster-engine.service
```

Stopping Qdrant stops the local vector store container but preserves data under
`VH_STORYCLUSTER_QDRANT_STORAGE_DIR`:

```bash
systemctl --user stop vh-storycluster-qdrant.service
systemctl --user disable vh-storycluster-qdrant.service
```

Do not remove the Qdrant storage directory during Phase 5 evidence collection.
