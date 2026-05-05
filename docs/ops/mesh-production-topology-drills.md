# Mesh Production Topology Drills Runbook

> Status: Active
> Owner: VHC Core Engineering
> Last Reviewed: 2026-05-04
> Depends On: docs/specs/spec-mesh-production-readiness.md, docs/specs/spec-data-topology-privacy-v0.md, docs/specs/spec-signed-pin-custody-v0.md

This runbook covers the first local production-shaped mesh topology proof path.
It runs under `schema_epoch: pre_luma_m0b` and `luma_profile: none`.

## Command

Run the transport drill:

```sh
pnpm test:mesh:topology-drills
```

The command starts three local `NODE_ENV=production` relays with explicit
`VH_RELAY_ID` values, persistent per-relay radata directories, non-empty
`VH_RELAY_PEERS`, and `VH_RELAY_PEER_AUTH_MODE=private_network_allowlist`.

The report is written to:

```text
.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json
```

Each run also writes the same report under:

```text
.tmp/mesh-production-readiness/<run_id>/mesh-production-readiness-report.json
```

Run the signed browser peer-config canary:

```sh
pnpm test:mesh:signed-peer-config-canary
```

That command generates a local signed peer-config fixture with `schemaVersion`,
`configId`, `issuedAt`, `expiresAt`, `peers`, `minimumPeerCount`, and
`quorumRequired`; builds/previews the Web PWA with
`VITE_VH_STRICT_PEER_CONFIG=true`, `VITE_GUN_PEER_CONFIG_URL`,
`VITE_GUN_PEER_CONFIG_PUBLIC_KEY`, and
`VITE_VH_ALLOW_LOCAL_MESH_PEERS=true`; and asserts app boot used
`resolveGunPeerTopology` with `source: remote-config`, `strict: true`,
`signed: true`, three peers, and quorum two.

The signed canary writes its report to the same latest report path only when the
signed browser proof actually ran. Standalone `pnpm test:mesh:topology-drills`
remains transport-only and must not report `signed_peer_config: true`.

## Drill Scope

The drill writes synthetic records only. Drill records live under:

```text
vh/__mesh_drills/<run_id>/<write_id>
```

Drill records use `_drillWriterKind: 'mesh-drill'`. They do not use LUMA
`_writerKind`, `_authorScheme`, `SignedWriteEnvelope`, LUMA adapters, or LUMA
schema migrations.

The current drill proves:

- all-live relay peer fan-out from one writer relay to all three direct
  per-relay readers;
- one-peer-kill write/readback through the remaining two-relay quorum;
- direct per-relay readback evidence with `run_id`, `write_id`, and `trace_id`;
- relay-peer auth negative coverage for unauthorized WebSocket peer upgrades;
- TTL and tombstone cleanup accounting for the drill namespace.

The signed browser canary separately proves:

- strict app boot from a signed remote peer-config fixture, not direct
  `VITE_GUN_PEERS` injection;
- deterministic fail-closed behavior for unsigned config, expired config,
  missing lifecycle fields, impossible quorum, fewer than three peers, bad
  signature, missing public key, and local peers without
  `VITE_VH_ALLOW_LOCAL_MESH_PEERS=true`;
- no usable Gun client is initialized for those negative cases, as observed by
  the e2e-only topology proof hook.

`VH_RELAY_PEER_AUTH_MODE=private_network_allowlist` is a local/private-network
harness mode. Because Gun relay and browser clients share the `/gun` WebSocket
path in this server, public production WSS rollout still needs a trust path
that either separates relay-peer sockets from browser client sockets or uses a
client-compatible signed peer handshake.

## Review Boundary

The report status remains `review_required` for Slice 6A/7A because this command
does not claim restarted-relay catch-up, deployed WSS topology,
state-resolution drills, clock-skew drills, partition/heal drills, soak budgets,
evidence scrub promotion, or post-M0.B LUMA-gated write coverage. The transport
drill and signed browser canary may each pass while the overall readiness status
still remains `review_required`.

If direct restarted-relay readback is added later and remains brittle after the
bounded proof attempt, record the failure in the report instead of tuning Gun
peer behavior indefinitely.
