# Mesh Production Topology Drills Runbook

> Status: Active
> Owner: VHC Core Engineering
> Last Reviewed: 2026-05-05
> Depends On: docs/specs/spec-mesh-production-readiness.md, docs/specs/spec-data-topology-privacy-v0.md, docs/specs/spec-signed-pin-custody-v0.md

This runbook covers the local production-shaped mesh topology proof path.
Early transport/state proofs ran under `schema_epoch: pre_luma_m0b`; post-M0.B
commands may report `schema_epoch: post_luma_m0b`. The mesh drill profile stays
`luma_profile: none` unless a later slice explicitly exercises LUMA-gated write
classes through the LUMA reader path.

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
expected WSS relay and HTTPS peer-config origins, plus `'self'`, without dev
localhost sources or broad `https:`/`wss:` wildcards, and signed peer-config
rollover is fetched fresh instead of being pinned by service-worker cache.

Run the operator peer-config rollback drill:

```sh
pnpm test:mesh:peer-config-rollback-drill
```

That command uses the same hermetic local TLS/WSS profile with local peer
allowance disabled. It verifies signed config A, signed config B, fail-closed
rejection for expired, unsigned, bad-signature, wrong-key, and local-peer
configs, then rollback to the previous topology shape through a freshly issued
signed rollback config. Rollback evidence must not be based on accepting an old
cached config file.

Run the state-resolution drill:

```sh
pnpm test:mesh:state-resolution-drills
```

That command starts the same local three-relay production-shaped harness and
writes synthetic competing records under
`vh/__mesh_drills/<run_id>/state_resolution/*`. It covers the non-LUMA §5.10
state-resolution rows with direct single-relay readback after bounded one-relay
restart/heal windows: relay B down before relevant writes, relay B down during
the winning write window, and relay B down after competing writes have landed.

The drill computes winners from the records observed on each relay. It does not
use browser multi-peer readback as proof, does not subscribe product readers to
the drill namespace, and does not migrate LUMA schemas or adapters. The LUMA
directory-entry row is recorded as `skipped` while the report runs under
`schema_epoch: pre_luma_m0b` and `luma_profile: none`.

Run the disconnect and duplicate-write drill:

```sh
pnpm test:mesh:disconnect-drills
```

That command starts the local three-relay production-shaped harness, writes
synthetic duplicate/retry records under
`vh/__mesh_drills/<run_id>/disconnect/*`, forces WebSocket closes around
in-flight synthetic writes, retries against deterministic canonical keys, and
verifies direct per-relay readback has one canonical logical write per key. It
also runs a Web PWA browser canary through an e2e-only app hook that uses the
app-created Gun client, forces a socket close, reloads the app to prove a fresh
app-created client consumed the same topology, and retries the same canonical
key. The hook is gated by `VITE_VH_EXPOSE_MESH_DISCONNECT_DRILL=true` and
writes only to the drill namespace.

## Drill Scope

The drill writes synthetic records only. Drill records live under:

```text
vh/__mesh_drills/<run_id>/<write_id>
vh/__mesh_drills/<run_id>/state_resolution/<case_id>/writes/<write_id>
vh/__mesh_drills/<run_id>/disconnect/<case_id>/{attempts,canonical,indexes,projections}/*
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

The state-resolution drill separately proves:

- `state_resolution_drills[]` rows are populated for every non-LUMA §5.10 rule;
- per-relay observed winners match the expected winner write id for
  `tombstone-wins`, `hide-restore-latest`,
  `monotonic-supersession-version`, `monotonic-supersession-epoch`,
  `monotonic-status-transition`, `no-deletion-historical-artifact`, and
  `last-write-wins-deterministic-id`;
- the LUMA directory-entry `best-effort-tombstone` row is skipped with an
  explicit pre-M0.B reason;
- `state-resolution-violation` appears in `health.degradation_reasons_seen`
  if any class-specific rule is broken.

The disconnect drill separately proves:

- forced WebSocket close/retry evidence is recorded for synthetic non-LUMA
  duplicate-write rows;
- direct relay readback of `canonical`, `indexes`, and `projections` nodes
  observes one canonical logical write per deterministic key;
- `write_class_slos[].duplicate_count` remains zero for vote intent replay,
  aggregate voter node, aggregate snapshot, forum thread, forum comment,
  encrypted sentiment event, and topic engagement actor/summary rows;
- the Web PWA app-created Gun client can retry a synthetic drill write after
  forced socket close and app reload without creating a duplicate canonical
  key;
- `disconnect-duplicate-write-violation` appears in
  `health.degradation_reasons_seen` if a covered row duplicates or
  double-counts.

Run the bounded local partition/heal drill with:

```bash
pnpm test:mesh:partition-drills
```

The partition drill separately proves:

- local proxy controls isolate one relay from the remaining relay quorum while
  preserving explicit relay IDs and disabling Gun multicast in the relay
  process;
- a blocked single-peer client path fails closed and is classified as
  `peer-quorum-missing`;
- relay A/C remaining-quorum writes/readback continue during the isolated relay
  window;
- after heal, direct single-relay readback from relay A, B, and C attempts to
  observe the synthetic partition-period `canonical`, `indexes`, and
  `projections` records; if relay B misses them within SLA, the report marks
  partition heal `review_required` and names the topology strategy decision;
- duplicate counts remain zero for covered synthetic vote, thread, comment, and
  aggregate snapshot rows where post-heal index readback is complete; missing
  relay readback is recorded as `null` duplicate evidence and keeps the row
  `review_required`;
- one bounded stale relay user-signature timestamp probe is classified as
  `user-signature-stale` / `clock-skew-detected`.

This is still a local harness evidence path. It is not the full
`pnpm test:mesh:clock-skew-drills` matrix, public WSS partition proof, soak
proof, or LUMA-gated write proof.

Run the full local non-LUMA clock-skew/auth-window matrix with:

```bash
pnpm test:mesh:clock-skew-drills
```

The clock-skew drill starts the local three-relay harness and writes synthetic
records under `vh/__mesh_drills/<run_id>/clock_skew/*` with
`_drillWriterKind: 'mesh-drill'`. It proves stale and future relay
user-signature timestamps map to `user-signature-stale` /
`clock-skew-detected`, strict signed peer-config expired and future-issued
configs fail closed in the browser without accepted peer sockets, and skewed
writer timestamps on deterministic drill records do not create direct readback
LWW divergence across relays. Relay-peer timestamp auth is recorded as
`skipped`/`not_applicable` while v0 uses `private_network_allowlist` or token
auth without a timestamped signed peer handshake. LUMA session/envelope rows
remain explicitly skipped for LUMA reader gates.

Run the local synthetic conflict/protocol fixture matrix with:

```bash
pnpm test:mesh:conflict-drills
```

The conflict drill starts the local three-relay harness and writes only
synthetic records under `vh/__mesh_drills/<run_id>/conflict/*` with
`_drillWriterKind: 'mesh-drill'`. It proves same-key deterministic candidate
writes resolve to one canonical winner, stale overwrite attempts do not replace
the newer synthetic row, future `_protocolVersion` fixtures are rejected, and
unknown schema or missing/unsupported drill author-scheme fixtures are
quarantined without becoming canonical records. If no replayable legacy corpus
exists, the legacy replay row is `skipped` with `corpus-not-present`.

This command does not migrate LUMA public schemas, does not add LUMA
`_writerKind` or `_authorScheme` coverage, and does not prove public WSS
conflict behavior.

Run the bounded explicit read-repair strategy drill with:

```bash
pnpm test:mesh:read-repair-drills
```

The read-repair drill starts the same local three-relay topology and isolates
relay B from relay A/C. It writes synthetic partition-period `canonical`,
`indexes`, and `projections` records through the surviving quorum, heals the
partition, records relay B's bounded pre-repair direct-readback miss, then
repairs relay B by replaying the exact records observed through direct A/C
readback. The report writes `read_repair_drills[]` rows with
`selected_strategy: explicit_read_repair`, source relays, repaired relay,
pre-repair miss evidence, repair latency, post-repair direct readback, and
duplicate counts.

This command proves only the explicit repair strategy for synthetic
`vh/__mesh_drills/<run_id>/read_repair/*` records. It does not convert Slice 9's
automatic partition-heal `review_required` outcome into an automatic recovery
claim, and it does not exercise LUMA-gated write classes.

Run the bounded rolling restart soak with:

```bash
pnpm test:mesh:soak
```

The soak command starts the local three-relay harness, builds/previews the Web
PWA for a browser reconnect lane, runs deterministic two-user and five-user
synthetic mesh workload lanes, restarts relays one at a time, writes through the
remaining quorum while a relay is down, verifies direct per-relay readback after
restart, and records local relay resource/radata metrics. The default developer
duration may be shorter than the canonical 30-minute soak; the report records
`soak.full_duration_satisfied: false` for shortened runs and must not use that
run to claim thirty-minute production soak readiness. Use
`VH_MESH_SOAK_DURATION_MS=1800000 pnpm test:mesh:soak` when collecting the
canonical duration packet.

This command proves only bounded local synthetic soak behavior under
`vh/__mesh_drills/<run_id>/soak/*`. It does not exercise LUMA-gated write
classes, public WSS infrastructure, evidence promotion, or the full
`pnpm check:mesh:production-readiness` gate.

Run the aggregate production-readiness gate with:

```bash
pnpm check:mesh:production-readiness
```

The aggregate command reruns the implemented mesh proof commands, copies each
source `.tmp/mesh-production-readiness/latest/*` packet before the next command
overwrites it, builds a candidate aggregate in the current run directory, then
runs `pnpm check:mesh-evidence-scrub -- --source-dir <run-dir>` against that
explicit packet. The final aggregate is written only after the scrub source
report is recorded. The validator requires each copied source report to match
the expected gate command, run mode, commit, clean-state policy, and current
gate-run timestamp window. The packet includes
`mesh-production-readiness-report.json`, `mesh-production-readiness-evidence.md`,
and copied source reports under `source-reports/<gate>/`; after Slice 14A it has
12 source reports, including `source-reports/evidence_scrub/`.

For Slice 11A through Slice 14B, a successful aggregate command still reports
`status: review_required` while release blockers remain. Expected blockers after
Slice 14A include the canonical 30-minute soak, public WSS deployment proof,
downstream full-app canary, and LUMA-gated write coverage through the LUMA
reader path. After Slice 14B, the aggregate no longer treats the downstream
full-app canary as unimplemented, but the separate canary command still blocks
until the mesh report is `release_ready` and real downstream observation exists.
The aggregate command exits non-zero for missing, malformed, dirty, stale,
failed, command-mismatched, unscrubbed, or incomplete source evidence, and for
any overclaiming packet that would emit `release_ready` before the blockers are
gone.

After Slice 14B, `pnpm check:production-app-canary` is a separate fail-closed
downstream gate. It defaults to the latest mesh readiness report but accepts
`--mesh-report <path>` / `VH_PRODUCTION_APP_CANARY_MESH_REPORT`; while the mesh
packet remains `review_required`, the expected canary outcome is a blocked
`.tmp/production-app-canary/<run_id>/production-app-canary-report.json` with
`reason: mesh_not_release_ready` and a non-zero exit.

`VH_RELAY_PEER_AUTH_MODE=private_network_allowlist` is a local/private-network
harness mode. Because Gun relay and browser clients share the `/gun` WebSocket
path in this server, public production WSS rollout still needs a trust path
that either separates relay-peer sockets from browser client sockets or uses a
client-compatible signed peer handshake.

## Operator Runbook

The operator-facing rollback/deploy path is documented in
`docs/ops/mesh-production-operator-runbook.md`. The current rehearsed rollback
claim is local TLS/WSS only: reload/refetch accepts a fresh rollback config and
invalid configs fail closed. It is not a public WSS rollback proof and it does
not prove runtime signing-key rotation without rebuilding or otherwise
distributing a new trusted key.

## Review Boundary

The report status remains `review_required` for Slice
6B/7B/7C/8/9/9B/10/11A/12A/13A/13B/14A/14B even when the local restarted-relay
drill, deployed-WSS local TLS profile, state-resolution drill, disconnect
drill, partition/heal drill, read-repair drill, bounded rolling-restart soak,
peer-config rollback drill, and aggregate evidence packet are well formed. A
passing restarted-relay section means only that the restarted local relay directly read
the missed synthetic drill write inside this bounded harness. A passing
deployed-WSS section means only that the local TLS/WSS profile, signed WSS
peer-config boot, CSP allowlist, and service-worker rollover proof passed.
A passing state-resolution section means only that non-LUMA synthetic §5.10
winner rules were directly observed in the bounded local harness. A passing
disconnect section means only that covered synthetic non-LUMA duplicate/retry
rows did not create duplicate canonical drill writes or double-counted
projections inside this bounded harness. A passing partition/heal section means
only that one local isolated-relay partition healed for synthetic drill records
and one stale relay user-signature timestamp was classified correctly. A
`review_required` partition/heal section means the partition/fail-closed phases
completed but automatic relay catch-up after heal is not proven and must feed a
topology-strategy decision. A passing read-repair section means only that
synthetic drill records missed by relay B were repaired through explicit replay
from surviving-quorum direct readback. A passing bounded soak section means only
that deterministic synthetic local-harness restart/reconnect rows met their
recorded budgets; if `soak.full_duration_satisfied` is false it is not the
canonical 30-minute soak claim. A passing clock-skew section means only that
the local non-LUMA mesh clock/auth window matrix passed. A passing conflict
section means only that local synthetic conflict/protocol fixtures passed and
did not become LUMA schema migration evidence. A passing aggregate section
means only that the implemented source reports were collected, validated,
copied, and summarized in one operator packet. A passing evidence-scrub section
means only that the candidate aggregate packet was deterministically transformed
into `.tmp/mesh-production-readiness/promoted/<run_id>/` and the promoted output
was rescanned for raw tokens, private key material, unsafe origins, unsafe
absolute paths, stale placeholder evidence, overclaims, and disallowed writer
kinds. The Slice 14B downstream canary command is separate from mesh readiness;
on current `review_required` mesh evidence, its expected non-zero blocked report
proves only that the app-level readiness claim is fail-closed. None of these
outcomes proves
public WSS
infrastructure, automatic peer-federation recovery, runtime peer-config key
rotation without a new trusted-key distribution path, LUMA-gated write state
resolution, public WSS clock-skew or conflict behavior, or post-M0.B
LUMA-gated write coverage.

If direct restarted-relay readback is `blocked` or `review_required`, do not tune
Gun peer behavior indefinitely. The next branch must choose and drill one
strategy: explicit replication/read-repair, scoped Gun/AXE topology, or an
authoritative relay cluster with a narrower service-level failover claim.
