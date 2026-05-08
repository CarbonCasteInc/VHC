# Mesh Production Operator Runbook

> Status: Active for local TLS/WSS operator rehearsal
> Owner: VHC Core Engineering
> Last Reviewed: 2026-05-07
> Depends On: `docs/specs/spec-mesh-production-readiness.md`, `docs/ops/mesh-production-topology-drills.md`, `docs/feature-flags.md`

This runbook makes the mesh topology lifecycle executable by an operator. It is
not a public WSS deployment guide yet. The current rehearsed path uses the
hermetic local TLS/WSS profile and synthetic peer-config fixtures only.

## Operator Gates

Run the rollback drill before changing signed peer config in any production-like
environment:

```sh
pnpm test:mesh:peer-config-rollback-drill
```

Then refresh the aggregate packet:

```sh
pnpm check:mesh:production-readiness
```

The aggregate packet must remain `status: review_required` until the remaining
release blockers are actually implemented. A passing rollback drill only proves
that the local TLS/WSS Web PWA can accept signed config A, accept signed config
B, fail closed on invalid configs, and accept a freshly issued signed rollback
config for the previous topology shape.

## Required Build-Time Inputs

The Web PWA peer-config trust inputs are compile-time `VITE_*` values:

- `VITE_VH_STRICT_PEER_CONFIG=true`
- `VITE_GUN_PEER_CONFIG_URL=<https peer-config url>`
- `VITE_GUN_PEER_CONFIG_PUBLIC_KEY=<trusted signing public key>`
- `VITE_GUN_PEER_MINIMUM=3`
- `VITE_GUN_PEER_QUORUM_REQUIRED=2`
- `VITE_VH_ALLOW_LOCAL_MESH_PEERS=false`
- `VITE_VH_CSP_CONNECT_SRC="<expected wss origins> <peer-config origin>"`
- `VITE_VH_CSP_STRICT_CONNECT_SRC=true`

Because these are baked into the bundle, changing the trusted signing key or CSP
connect-src requires a new app build and rollout. Do not describe runtime key
rotation as proven unless a later slice implements trusted runtime key
distribution.

## Health Probes

For each relay origin, verify:

```sh
curl -fsS https://<relay-origin>/healthz
curl -fsS https://<relay-origin>/readyz
curl -fsS https://<relay-origin>/metrics | rg 'vh_relay_active_connections|vh_relay_ws_bytes'
```

Expected result:

- `/healthz` returns `{ "ok": true, "service": "vh-relay" }`.
- `/readyz` returns a successful readiness response.
- `/metrics` exposes connection and byte counters.

If quorum health fails, do not roll forward peer config. Use the latest
readiness report `health.degradation_reasons_seen[]` and the relay logs before
attempting rollback.

## Signed Peer-Config Lifecycle

Each signed config must include:

- `schemaVersion: "mesh-peer-config-v1"`
- `configId`
- `issuedAt`
- `expiresAt`
- `peers`
- `minimumPeerCount`
- `quorumRequired`

Strict mode fails closed for unsigned, expired, bad-signature, wrong-key,
insufficient-peer, impossible-quorum, and insecure/local-peer configs when local
peer allowance is disabled.

## Roll Forward

1. Generate signed config B with a new `configId`, current `issuedAt`, future
   `expiresAt`, expected three WSS peers, `minimumPeerCount: 3`, and
   `quorumRequired: 2`.
2. Confirm `connect-src` includes exactly `'self'`, the WSS relay origins, and
   the HTTPS peer-config origin.
3. Publish config B at the peer-config URL with `Cache-Control: no-store`.
4. Build and deploy the Web PWA with the intended trusted public key and CSP.
5. Verify the app proof hook or operator evidence shows:
   - `source: remote-config`
   - `strict: true`
   - `signed: true`
   - expected `configId`
   - `local_mesh_peers_allowed: false`
   - three WSS peers and quorum two

## Roll Back

Rollback is not accepting an old cached file. Rollback means issuing a fresh
signed rollback config with a new `configId`, current `issuedAt`, future
`expiresAt`, and the previous topology shape.

1. Generate signed rollback config R using the currently trusted signing key.
2. Publish R at the peer-config URL with `Cache-Control: no-store`.
3. Reload or otherwise force old tabs to refetch peer config.
4. Verify the app proof shows R's `configId` and previous peer topology shape.
5. Refresh `pnpm check:mesh:production-readiness` and confirm the rollback source
   report is present, command-matched, fresh, clean, and `review_required`.

Current old-tab claim boundary: the drilled behavior is reload/refetch. The app
does not yet claim live in-place topology replacement for already-open tabs.

## Signing-Key Rotation And Revocation

The current browser trust root is `VITE_GUN_PEER_CONFIG_PUBLIC_KEY`, so rotation
requires a new app build or another trusted key-distribution path in a later
slice.

Safe rotation procedure:

1. Generate the new signing key pair outside the repo.
2. Build a new app artifact with the new public key.
3. Publish a config signed by the new private key.
4. Verify old-key configs fail closed in the rollback drill equivalent.
5. Remove the compromised old public key from all deploy artifacts.

Do not serve a config signed by an unknown or removed key. The rollback drill
proves wrong-key configs fail closed; it does not prove runtime multi-key trust.

## Relay Credential Rotation

Relay daemon tokens and relay-to-relay credentials are operationally separate
from peer-config signing keys.

1. Rotate `VH_RELAY_DAEMON_TOKEN` on one relay at a time.
2. Verify `/readyz` and `/metrics`.
3. Rotate relay-to-relay credentials or allowlist settings.
4. Verify quorum remains healthy before moving to the next relay.

The local harness still uses `VH_RELAY_PEER_AUTH_MODE=private_network_allowlist`;
public WSS must use a production trust path before public deployment claims.

## Service Worker And CSP

Peer config must be fetched with `cache: "no-store"` and served with
`Cache-Control: no-store`. During rollout or rollback:

- update CSP before expecting the app to connect to new origins;
- reject broad `https:` or `wss:` wildcards;
- reject dev localhost connect-src entries in strict deployed canaries;
- reload old tabs after config changes;
- check the service-worker rollover/rollback evidence in the latest report.

## Trace Lookup

Use these IDs across artifacts:

- `run_id`: names the report directory under `.tmp/mesh-production-readiness/`
- `trace_id`: joins browser evidence to the report
- `configId`: identifies accepted/rejected peer-config payloads
- `write_id`: used by data drills; peer-config rollback does not write drill data

For aggregate evidence, inspect:

```text
.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json
.tmp/mesh-production-readiness/latest/mesh-production-readiness-evidence.md
.tmp/mesh-production-readiness/latest/source-reports/peer_config_rollback/
```

## Cleanup And Compaction

Peer-config rollback writes no `vh/__mesh_drills/*` records. Data drills still
write synthetic records and must clean or tombstone their namespaces. For health
probe compaction, use:

```sh
pnpm mesh:compact-health-probes
```

Never promote `.tmp` evidence into durable docs until a future evidence scrub
gate exists and passes.
