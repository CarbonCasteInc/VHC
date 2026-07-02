# StoryCluster Production Service

> Status: Operational Runbook
> Owner: VHC Ops
> Last Reviewed: 2026-07-02
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

Current deployed Scope A posture:

- #687 at `baf1dd5f41958473c93db04e4d6007e4df7b074f` is the first deployed
  durable fix for the recurring `cross_encoder_rerank` truncation class;
- current `main` is `eab5d3c6`, with later #691-#694 diagnostics,
  publisher-priority, heap-capture, and relay-stagger changes layered on top;
- rerank requests use strict fixed-key object structured output instead of an
  array/max-items shape;
- recoverable rerank output failures omit supplemental rerank results so the
  deterministic prior score remains the gate-feeding value;
- provider/config/auth/transport failures still surface as stage failures and
  must not be converted into successful empty rerank output;
- the first extended bake after #687 recorded zero new OpenAI failure artifacts
  and zero rerank degeneracy warnings;
- the current post-#694 watch is primarily a relay-memory/availability
  diagnostic window, not a new StoryCluster correctness hypothesis.

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

## Rerank Failure Capture And Watch

The OpenAI provider writes a local diagnostic artifact when the
`cross_encoder_rerank` stage receives malformed or truncated chat JSON from
OpenAI. Since #687, the known overproduction/truncation class is prevented by a
strict per-call fixed-key object schema. New artifacts after the #687 restart
therefore mean a residual model-output failure or a new provider behavior, not
the expected steady state.

Default artifact directory:

```bash
$VH_STORYCLUSTER_STATE_DIR/openai-failures
```

If `VH_STORYCLUSTER_STATE_DIR` is unset, the provider falls back to:

```bash
~/.local/state/vhc/storycluster-engine/openai-failures
```

Override or disable:

```bash
VH_STORYCLUSTER_OPENAI_FAILURE_ARTIFACT_DIR=/absolute/path
VH_STORYCLUSTER_OPENAI_FAILURE_ARTIFACTS_ENABLED=0
```

The production start wrapper exports
`VH_STORYCLUSTER_OPENAI_FAILURE_ARTIFACT_DIR` to
`$VH_STORYCLUSTER_STATE_DIR/openai-failures` when it is not set, creates the
directory, and verifies it is writable before starting StoryCluster. The path
must be absolute and writable by the `humble` user. This prevents a root-owned
repo `.tmp` fallback from silently swallowing the only rerank failure artifact.

Each artifact includes stage, provider, model, chunk index, pair count, pair
IDs, request hash/byte length, response hash/byte length, bounded response
preview, parse error, parse context, and OpenAI `finish_reason`. It does not
persist full rerank pair text or API credentials. Artifact writes are
best-effort and must not replace the original provider error.

Scope A rerank failure semantics:

- recoverable model-output failures, including parse/truncation, omit rerank
  results for that chunk and keep prior deterministic `rerank_score` values;
- missing, unknown, duplicate, or non-finite pair IDs are ignored defensively;
- exactly-identical scores across a nontrivial successful chunk are treated as
  degraded quality, omitted, and warned;
- no failure path may fabricate score `0`;
- critical provider/config/auth/transport errors must rethrow and surface as
  StoryCluster stage/model failures.

Read-only watch commands:

```bash
since="<deploy restart timestamp>"
find "$HOME/.local/state/vhc/storycluster-engine/openai-failures" \
  -type f -newermt "$since"

journalctl --user -u vh-storycluster-engine.service --since "$since" --no-pager \
  | grep -E "cross_encoder_rerank|degenerate|parse failure|finish_reason.?length|truncat"
```

For healthy Scope A operation, both checks should stay empty after the latest
StoryCluster restart. A persistent degeneracy warning stream is gate-safe but
indicates rerank quality loss and should be treated as a product-quality
incident, not as a launch write-safety failure.

## Reset Persistent State

StoryCluster persists derived topic state in `VH_STORYCLUSTER_STATE_DIR` and
cluster vectors in the configured Qdrant collection. A publisher no-write
diagnostic suppresses mesh writes, but it still calls the StoryCluster service,
so it can change this derived StoryCluster state. Reset StoryCluster state
before any live publisher path that must start from current RSS only.

Use the gated reset script. It refuses to run while
`vh-news-aggregator.service` is active, stops and restarts the StoryCluster
engine to drop in-memory state, backs up the file store before clearing it,
deletes the configured Qdrant collection, verifies authenticated `/ready`
returns `qdrant:...`, and verifies the recreated collection has `0` points.
It prints only redacted proof.

```bash
cd /home/humble/VHC
VH_STORYCLUSTER_RESET_APPROVED=1 \
  ./tools/scripts/reset-storycluster-production-state.sh
```

Default backup location:

```bash
~/.local/state/vhc/storycluster-reset-backups/<timestamp>/storycluster-state.tgz
```

For Phase 5 publisher recovery, use this cadence unless the diagnostic is
explicitly pointed at an ephemeral StoryCluster state dir and Qdrant collection:

1. Reset StoryCluster state.
2. Run the capped, self-terminating publisher no-write diagnostic with a fresh
   `VH_DAEMON_FEED_RUN_ID`; the production wrapper defaults this diagnostic to
   one runtime tick via `VH_NEWS_DAEMON_DIAGNOSTIC_MAX_TICKS=1`.
3. Inspect tick shape, not only `selected > 0`: completed tick, no watchdog,
   sane bundle count, fresh cluster window, no singleton explosion, and recent
   first selected story IDs.
4. Reset StoryCluster state again.
5. Proceed to the gated live publisher start only after the explicit
   `start Phase 5 now` approval and the publisher preflight gates pass.

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
