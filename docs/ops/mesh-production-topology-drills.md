# Mesh Production Topology Drills Runbook

> Status: Active
> Owner: VHC Core Engineering
> Last Reviewed: 2026-05-05
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

Run the deployed-WSS peer-config canary:

```sh
pnpm test:mesh:deployed-wss-peer-config
```

That command renders the deployable three-relay WSS compose profile, then starts
a hermetic local TLS/WSS profile: three production-mode HTTP relays behind local
TLS/WSS proxies, a HTTPS signed peer-config endpoint, and a built Web PWA
preview. The report records `run.mode: deployed_wss_topology` and
`deployment_scope: local_tls_wss_profile`.

This is a WSS trust-boundary proof, not a public infrastructure deployment. It
asserts app boot used `resolveGunPeerTopology` with `source: remote-config`,
`strict: true`, `signed: true`, three `wss://` peers, quorum two, and
`local_mesh_peers_allowed: false`. It also proves local/insecure peers fail
closed with local peer allowance disabled, CSP `connect-src` contains the
expected WSS relay and HTTPS peer-config origins without broad `https:`/`wss:`
wildcards, and signed peer-config rollover is fetched fresh instead of being
pinned by service-worker cache.

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
- bounded restarted-relay catch-up evidence by restarting the killed relay with
  the same relay id, peer list, auth mode, and radata directory, then reading
  the missed down-period write through that restarted relay only;
- direct per-relay readback evidence with `run_id`, `write_id`, and `trace_id`;
- relay-peer auth negative coverage for unauthorized WebSocket peer upgrades;
- TTL and tombstone cleanup accounting for the drill namespace.

The restarted-relay section distinguishes three outcomes:

- `pass`: the restarted relay directly reads the missed down-period drill write
  within the bounded local harness SLA;
- `review_required`: the bounded evidence completed but produced incomplete or
  ambiguous recovery evidence;
- `blocked`: the bounded direct restarted-relay readback did not observe the
  missed write, so relay peer fan-out cannot support an automatic recovery
  claim without a topology decision.

The command fails when the harness cannot complete, relay auth/readback/cleanup
fails, or restarted-relay evidence cannot be collected. A completed bounded
restart attempt may still produce a `review_required` report with
`topology.restarted_relay_catchup.status: "blocked"`; that is an architecture
decision signal, not a production-readiness pass.

Optional timing overrides:

```sh
VH_MESH_DRILL_RESTART_CATCHUP_TIMEOUT_MS=30000
VH_MESH_DRILL_RESTART_PEER_SETTLE_MS=1500
```

The signed browser canary separately proves:

- strict app boot from a signed remote peer-config fixture, not direct
  `VITE_GUN_PEERS` injection;
- deterministic fail-closed behavior for unsigned config, expired config,
  missing lifecycle fields, impossible quorum, fewer than three peers, bad
  signature, missing public key, and local peers without
  `VITE_VH_ALLOW_LOCAL_MESH_PEERS=true`;
- no usable Gun client is initialized for those negative cases, as observed by
  the e2e-only topology proof hook.

The deployed-WSS canary separately proves:

- the deployable compose profile renders with three explicit WSS relay IDs and
  persistent per-relay volumes;
- app boot consumes a signed three-peer `wss://` config with local peer
  allowance disabled;
- relay `/healthz`, `/readyz`, and `/metrics` are reachable through the WSS/TLS
  boundary;
- CSP and service-worker rollover checks pass before a WSS peer-config rollout
  is treated as valid evidence.

`VH_RELAY_PEER_AUTH_MODE=private_network_allowlist` is a local/private-network
harness mode. Because Gun relay and browser clients share the `/gun` WebSocket
path in this server, public production WSS rollout still needs a trust path
that either separates relay-peer sockets from browser client sockets or uses a
client-compatible signed peer handshake.

## Review Boundary

The report status remains `review_required` for Slice 6B/7B even when the local
restarted-relay drill and deployed-WSS local TLS profile pass. A passing
restarted-relay section means only that the restarted local relay directly read
the missed synthetic drill write inside this bounded harness. A passing
deployed-WSS section means only that the local TLS/WSS profile, signed WSS
peer-config boot, CSP allowlist, and service-worker rollover proof passed. It
does not prove public WSS infrastructure, state-resolution drills, clock-skew
drills, partition/heal drills, soak budgets, evidence scrub promotion, or
post-M0.B LUMA-gated write coverage.

If direct restarted-relay readback is `blocked` or `review_required`, do not tune
Gun peer behavior indefinitely. The next branch must choose and drill one
strategy: explicit replication/read-repair, scoped Gun/AXE topology, or an
authoritative relay cluster with a narrower service-level failover claim.
