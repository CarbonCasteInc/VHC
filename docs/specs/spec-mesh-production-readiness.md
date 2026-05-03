# Mesh Production Readiness Spec

> Status: Execution Spec
> Owner: VHC Core Engineering
> Last Reviewed: 2026-05-03
> Depends On: docs/foundational/System_Architecture.md, docs/foundational/STATUS.md, docs/specs/spec-data-topology-privacy-v0.md, docs/specs/spec-civic-sentiment.md, docs/reports/MESH_HARDENING_PR2_2026-05-02.md

Version: 0.2

This spec defines the remaining path from the current hardened local-first mesh
implementation to a production-grade distributed mesh. It is project-grounded:
all completed items reference the current repo surfaces and merged PRs, and all
remaining work is phrased as slices with files, commands, acceptance gates, and
explicit non-goals.

This is not a replacement for the target architecture in
`docs/foundational/System_Architecture.md`. It is the execution contract for the
mesh reliability, relay, topology, and release-gate work needed before the app
can claim production-grade distributed mesh behavior.

## 1. Production-Ready Definition

The mesh is production-ready when all of the following are true on a release
commit:

1. Browser clients get an explicit signed peer configuration and connect to at
   least three production WSS relays.
2. Health surfaces named degradation reasons, not ambiguous "degraded" states or
   vacuous green values with zero samples.
3. Normal browser fan-out is bounded: no root namespace `.map().on()` leak can
   push connected browsers into sustained high Gun message rates.
4. Every critical user write has deterministic identity, bounded ack behavior,
   readback confirmation, terminal telemetry, and retry/fallback behavior
   appropriate for its trust class.
5. Every critical daemon write is queued by class, persisted until terminal
   success or DLQ, and replayed after restart.
6. Relay HTTP fallback routes are authenticated and replay-protected.
7. Relay processes expose `/healthz`, `/readyz`, and `/metrics`; enforce origin,
   body-size, rate-limit, active-connection, and bytes-per-second limits; and log
   structured drop/reject reasons.
8. A one-peer failure does not stop writes from confirming.
9. Restarted peers catch up within a stated SLA.
10. Forced websocket disconnects and reconnects do not duplicate user writes.
11. Network partition drills fail closed with a named health reason, then
    converge without data loss or duplicate writes after healing.
12. A 30-minute rolling restart soak passes with bounded p95 write latencies per
    write class.
13. CI or release automation runs the mesh canary and production topology drills
    as named commands, and failed drills flip both machine gates and user-visible
    health.

## 2. Current Implementation Truth

The mesh hardening series is implemented through PR #560 through PR #565 and is
tracked in `docs/reports/MESH_HARDENING_PR2_2026-05-02.md`.

Completed and verified:

- PR #560: diagnostic clarity and bounded pressure.
- PR #561: generic durable write contract and write-path migrations.
- PR #562: daemon-side persistence, write lanes, enrichment queue DLQ, and eval
  artifact replay.
- PR #563: production relay hardening.
- PR #564: topology and quorum config.
- PR #565: mesh hardening ledger closeout.

Current head at closeout:

- `main` includes the PR5 topology/quorum implementation and closeout ledger.
- `pnpm test:mesh:browser-canary` builds the app with three local relay peers,
  validates app boot/health against those healthy relays, and separately
  validates a raw browser Gun write/readback path with one intentionally
  unavailable peer in that test client's peer list.
- Full production relay topology drills remain queued because they require a
  real multi-relay deployment and relay-to-relay persistence/catch-up behavior,
  not just three local standalone relays.

Important boundary:

- The current canary validates multi-peer client configuration and one bad peer
  in a browser Gun peer list. It does not prove strict app boot with a dead
  configured peer, production relay federation, restarted-peer catch-up, network
  partition repair, or rolling-restart soak.

## 3. Core Runtime Surfaces

Browser mesh client:

- `apps/web-pwa/src/store/index.ts`
- `apps/web-pwa/src/store/peerConfig.ts`
- `apps/web-pwa/src/hooks/useHealthMonitor.ts`
- `apps/web-pwa/src/components/dev/HealthIndicator.tsx`

Browser bounded hydration:

- `apps/web-pwa/src/store/news/hydration.ts`
- `apps/web-pwa/src/store/forum/hydration.ts`
- `apps/web-pwa/src/store/forum/index.ts`
- `apps/web-pwa/src/store/synthesis/hydration.ts`

Generic durable writes:

- `packages/gun-client/src/durableWrite.ts`
- `packages/gun-client/src/newsAdapters.ts`
- `packages/gun-client/src/storylineAdapters.ts`
- `packages/gun-client/src/analysisAdapters.ts`
- `packages/gun-client/src/topicEngagementAdapters.ts`
- `packages/gun-client/src/sentimentEventAdapters.ts`
- `packages/gun-client/src/directoryAdapters.ts`
- `packages/gun-client/src/synthesisAdapters.ts`
- `packages/gun-client/src/forumAdapters.ts`
- `packages/gun-client/src/newsReportAdapters.ts`

User intent queues:

- `apps/web-pwa/src/hooks/intentQueue.ts`
- `apps/web-pwa/src/hooks/voteIntentQueue.ts`
- `apps/web-pwa/src/hooks/voteIntentMaterializer.ts`

Daemon mesh writes and persistence:

- `services/news-aggregator/src/daemon.ts`
- `services/news-aggregator/src/daemonWriteLane.ts`
- `services/news-aggregator/src/enrichmentQueue.ts`
- `services/news-aggregator/src/analysisEvalReplay.ts`
- `services/news-aggregator/src/bundleSynthesisWorker.ts`

Relay:

- `infra/relay/server.js`
- `infra/docker/docker-compose.yml`

Mesh canary:

- `packages/e2e/playwright.mesh-canary.config.ts`
- `packages/e2e/src/mesh/browser-mesh-canary.spec.ts`
- root script: `pnpm test:mesh:browser-canary`

Operational utilities:

- `tools/scripts/compact-health-probes.mjs`
- `tools/scripts/live-local-stack.sh`

## 4. Slice Ledger

### Slice 1 - Truthful Health And Bounded Browser Pressure

Status: Done and merged in PR #560.

Purpose:

- Make mesh health truthful before trying to diagnose transport failures.
- Remove browser fan-out pressure as a source of false transport degradation.

Implemented surfaces:

- `packages/gun-client/src/chain.ts`
- `apps/web-pwa/src/hooks/useHealthMonitor.ts`
- `apps/web-pwa/src/components/dev/HealthIndicator.tsx`
- `apps/web-pwa/src/store/news/hydration.ts`
- `apps/web-pwa/src/store/forum/hydration.ts`
- `apps/web-pwa/src/store/forum/index.ts`
- `apps/web-pwa/src/store/synthesis/hydration.ts`
- `apps/web-pwa/public/sw.js`
- `packages/e2e/src/mesh/browser-mesh-canary.spec.ts`

Required behavior:

- Caller ack timers start after the physical Gun `put` begins, not while
  `waitForRemote` is still consuming the budget.
- The health monitor runs from app bootstrap and is idempotent.
- Health reasons include:
  - `probe-ack-timeout`
  - `write-readback-failed`
  - `convergence-lagging`
  - `peer-quorum-missing`
  - `analysis-relay-unavailable`
  - `local-storage-hydration-failed`
  - `client-out-of-date`
  - `message-rate-high`
- Write health is `unknown` until enough samples exist.
- Health probes use a deterministic per-browser key and perform write plus
  readback.
- Historical `vh/__health/__vh_health_probe_*` keys can be tombstoned through
  `pnpm mesh:compact-health-probes`.
- News, forum, and synthesis subscriptions are bounded and tear down.
- Browser steady-state Gun message rate has a canary budget.

Acceptance gates:

- `pnpm test:mesh:browser-canary`
- `node tools/scripts/check-diff-coverage.mjs` for changed browser source files.
- Focused Vitest suites for health, hydration, and service worker changes.

Regression traps:

- Do not reintroduce root namespace `.map().on()` subscriptions without a cap,
  pagination strategy, and teardown.
- Do not show "100%" write health with zero samples.
- Do not write monotone health probe keys.

### Slice 2 - Durable User And Browser Write Contract

Status: Done and merged in PR #561.

Purpose:

- Generalize the vote path's deterministic, retryable, observable write
  contract across all critical browser/user write classes.

Implemented surfaces:

- `packages/gun-client/src/durableWrite.ts`
- `apps/web-pwa/src/hooks/intentQueue.ts`
- `apps/web-pwa/src/hooks/voteIntentQueue.ts`
- `packages/gun-client/src/newsAdapters.ts`
- `packages/gun-client/src/storylineAdapters.ts`
- `packages/gun-client/src/analysisAdapters.ts`
- `packages/gun-client/src/topicEngagementAdapters.ts`
- `packages/gun-client/src/sentimentEventAdapters.ts`
- `packages/gun-client/src/directoryAdapters.ts`
- `packages/gun-client/src/synthesisAdapters.ts`
- `packages/gun-client/src/forumAdapters.ts`
- `packages/gun-client/src/newsReportAdapters.ts`

Required behavior:

- Each migrated write uses bounded ack semantics.
- Ack timeout is not terminal by itself; the write attempts readback before
  falling back or failing.
- Relay fallbacks are explicit and typed by trust class.
- Terminal failure is returned and logged; no critical write path may silently
  proceed as success.
- User-intent classes that can reasonably be retried across reload use
  safeStorage-backed intent queues.

Migrated write classes:

- news stories, indexes, and ingestion leases
- storylines
- analysis latest pointer
- topic engagement actor and summary
- encrypted sentiment outbox
- directory publish
- synthesis latest pointer
- news reports and report status index
- forum moderation writes
- namespace initialization writes

Acceptance gates:

- `pnpm --filter @vh/gun-client test`
- `pnpm --filter @vh/gun-client typecheck`
- focused web tests for `intentQueue`, `voteIntentQueue`, sentiment state, and
  vote materializer
- `pnpm test:mesh:browser-canary`
- `node tools/scripts/check-diff-coverage.mjs`

Regression traps:

- Do not add a public mesh write without `writeWithDurability` or an explicit
  exemption documented in this spec.
- Do not let encrypted sentiment event writes become plaintext public writes.
- Browser-callable fallback endpoints must not require daemon-only credentials.

### Slice 3 - Daemon-Side Durability And Replay

Status: Done and merged in PR #562.

Purpose:

- Ensure accepted daemon work survives queue pressure, process restart, and
  transient relay/Gun failures.

Implemented surfaces:

- `services/news-aggregator/src/daemon.ts`
- `services/news-aggregator/src/daemonWriteLane.ts`
- `services/news-aggregator/src/enrichmentQueue.ts`
- `services/news-aggregator/src/analysisEvalReplay.ts`
- `services/news-aggregator/src/bundleSynthesisDaemonConfig.ts`
- `services/news-aggregator/src/bundleSynthesisWorker.ts`

Required behavior:

- Daemon `createNodeMeshClient` defaults to `gunRadisk: true` with a
  deterministic per-daemon file path.
- Write classes use named bounded lanes with structured telemetry:
  `enqueued`, `started`, `completed`, `failed`.
- Enrichment queue state persists to `pending.json`.
- In-flight candidates remain in pending state until terminal worker completion.
- Queue overflow writes displaced candidates to `dead-letter.jsonl`.
- DLQ entries replay on restart.
- Accepted eval artifacts can republish latest accepted synthesis after daemon
  leadership acquisition.
- Daemon handles expose:
  - `enrichmentQueueStats()`
  - `enrichmentQueueDeadLetterCount()`
  - `writeLaneStats()`

Acceptance gates:

- `pnpm --filter @vh/news-aggregator test`
- `pnpm --filter @vh/news-aggregator typecheck`
- `pnpm test:storycluster:correctness`
- `pnpm test:mesh:browser-canary`
- `pnpm typecheck`
- `pnpm lint`

Regression traps:

- Do not drop queue overflow candidates without durable DLQ.
- Do not remove an in-flight candidate from persisted state before terminal
  completion.
- Do not bypass write lanes for runtime bundle, storyline, lease, or accepted
  synthesis publication writes.

### Slice 4 - Hardened Production Relay

Status: Done and merged in PR #563.

Purpose:

- Replace a permissive local relay with a production-shaped relay surface that
  can be measured, rate-limited, and protected against unauthenticated graph
  injection.

Implemented surfaces:

- `infra/relay/server.js`
- `infra/docker/docker-compose.yml`
- `packages/gun-client/src/aggregateAdapters.ts`
- `packages/gun-client/src/synthesisAdapters.ts`
- `packages/gun-client/src/forumAdapters.ts`
- web forum and aggregate fallback callers
- mesh browser canary relay assertions

Required behavior:

- Relay exposes:
  - `GET /healthz`
  - `GET /readyz`
  - `GET /metrics`
- Relay auth is required when `VH_RELAY_AUTH_REQUIRED=true` or
  `NODE_ENV=production`.
- User-callable fallback endpoints require device signatures with nonce and
  timestamp replay protection.
- Daemon-only synthesis fallback requires `VH_RELAY_DAEMON_TOKEN`.
- Relay enforces:
  - origin allowlist
  - HTTP token bucket
  - JSON body size cap
  - active connection cap
  - websocket bytes-per-second cap
- Relay emits metrics for:
  - HTTP requests and responses
  - auth rejects
  - rate limits
  - body-too-large rejects
  - origin rejects
  - websocket upgrade rejects
  - byte-drop disconnects
  - write attempts/success/failure by route
  - health-probe compaction runs and tombstones
- Health probe compaction can run at startup and on interval.

Acceptance gates:

- `pnpm --filter @vh/e2e exec vitest run src/live/relay-server.vitest.mjs --reporter=dot`
- `pnpm --filter @vh/gun-client test`
- `pnpm --filter @vh/e2e typecheck`
- `pnpm --filter @vh/web-pwa typecheck`
- `pnpm test:mesh:browser-canary`
- `VH_RELAY_DAEMON_TOKEN=dummy VH_RELAY_ALLOWED_ORIGINS=https://allowed.example docker compose -f infra/docker/docker-compose.yml config`

Regression traps:

- Do not expose unauthenticated `faith: true` write routes in production mode.
- Do not let browser fallback paths use daemon bearer tokens.
- Do not allow `*` CORS in production relay config.

### Slice 5 - Peer Topology And Quorum Configuration

Status: Done and merged in PR #564.

Purpose:

- Remove hardcoded peer fallback behavior and move production peer topology to a
  signed, explicit, quorum-aware configuration path.

Implemented surfaces:

- `apps/web-pwa/src/store/peerConfig.ts`
- `apps/web-pwa/src/store/index.ts`
- `apps/web-pwa/src/hooks/useHealthMonitor.ts`
- `apps/web-pwa/src/components/dev/HealthIndicator.tsx`
- `packages/e2e/playwright.mesh-canary.config.ts`
- `packages/e2e/src/mesh/browser-mesh-canary.spec.ts`
- root `test:mesh:browser-canary` script

Required behavior:

- Production strict mode requires explicit peers or signed peer config.
- Strict mode requires at least three peers by default.
- Strict mode rejects insecure peers unless local mesh peers are explicitly
  allowed for local test harnesses.
- `globalThis.__VH_GUN_PEERS__` is ignored in strict production mode.
- Signed inline and remote peer configs are verified through Gun SEA against
  `VITE_GUN_PEER_CONFIG_PUBLIC_KEY`.
- Health monitor reports peer quorum as `healthy/configured (need required)`.
- Browser canary runs three local relay processes and validates one bad peer in
  the configured peer list does not prevent write/readback convergence.

Acceptance gates:

- `pnpm exec vitest run apps/web-pwa/src/store/peerConfig.test.ts apps/web-pwa/src/store/store.test.ts apps/web-pwa/src/hooks/useHealthMonitor.test.ts apps/web-pwa/src/components/dev/HealthIndicator.test.tsx --config vitest.config.ts --reporter=dot`
- `node tools/scripts/check-diff-coverage.mjs`
- `pnpm --filter @vh/web-pwa typecheck`
- `pnpm --filter @vh/e2e typecheck`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test:mesh:browser-canary`

Regression traps:

- Do not restore the hard-coded Tailscale peer fallback.
- Do not allow production builds to silently fall back to localhost.
- Do not trust runtime-mutable global peer overrides in strict mode.

### Slice 6 - Production Topology Harness And Deployment

Status: Queued.

Purpose:

- Move from a production-shaped local relay and preview canary to a repeatable
  three-relay topology that can be exercised locally before any release operator
  points the app at live WSS relays.
- Split the work into:
  - Slice 6A: local production-shaped topology harness.
  - Slice 6B: deployable three-relay WSS profile.

Scope, Slice 6A:

1. Add explicit relay peer configuration to `infra/relay/server.js`; the
   production-shaped harness must not leave `peers: []` as the only topology.
2. Start three local `NODE_ENV=production` relay processes with distinct
   persistent radata directories, auth enabled, origin allowlists enabled, and
   production limit env vars set.
3. Configure relay-to-relay peer lists for those processes unless the
   convergence decision gate below chooses a different strategy.
4. Generate and serve a signed peer-config fixture for the Web PWA.
5. Build/preview the Web PWA in strict peer-config mode against that signed
   config.
6. Emit a readiness report skeleton even before release-ready status exists.

Scope, Slice 6B:

1. Define the production relay deployment profile.
2. Stand up three WSS relay processes.
3. Configure persistent storage for each relay.
4. Generate and publish signed peer config.
5. Configure the Web PWA to fetch signed peer config at boot.
6. Configure relay origin allowlists and daemon auth.
7. Configure dashboard/metrics scraping for all three relays.

Primary files likely touched:

- `infra/docker/docker-compose.yml`
- `infra/relay/server.js`
- `infra/docker/.env.example` or a non-secret successor env template
- a new production relay deployment doc under `docs/ops/`
- a new signed peer-config generation utility under `tools/scripts/`
- `packages/e2e/playwright.mesh-canary.config.ts` if the canary harness grows a
  production-topology profile
- `packages/e2e/playwright.mesh-production.config.ts` for the production-shaped
  harness
- `packages/e2e/src/mesh/production-topology-drills.spec.ts`
- a small relay process helper under `packages/e2e/src/mesh/` if Playwright
  webServer config is not enough to express kill/restart drills

Required environment variables:

- `GUN_FILE`
- `GUN_RADISK=true`
- `VH_RELAY_PEERS` or the final implemented relay-peer-list env name
- `VH_RELAY_AUTH_REQUIRED=true`
- `VH_RELAY_DAEMON_TOKEN`
- `VH_RELAY_ALLOWED_ORIGINS`
- `VH_RELAY_HTTP_RATE_LIMIT_PER_MIN`
- `VH_RELAY_WS_BYTES_PER_SEC`
- `VH_RELAY_MAX_ACTIVE_CONNECTIONS`
- `VITE_GUN_PEER_CONFIG_URL`
- `VITE_GUN_PEER_CONFIG_PUBLIC_KEY`
- `VITE_GUN_PEER_MINIMUM=3`
- `VITE_GUN_PEER_QUORUM_REQUIRED=2`
- `VITE_VH_STRICT_PEER_CONFIG=true`
- signed peer-config private key input for the generation utility; this must be
  supplied from local secrets and must not be committed

Convergence decision gate:

- Relay-to-relay convergence is not established by the current `peers: []`,
  `axe: false` relay mode.
- The default Slice 6A strategy is explicit Gun relay-to-relay peer fan-out with
  `axe: false`; do not enable AXE as a side effect of this slice.
- The first topology drill must read directly from the restarted relay, not
  from a browser client that can silently satisfy reads from another healthy
  peer.
- If explicit relay peer fan-out does not prove catch-up, stop and record
  `status: blocked` or `review_required` in the readiness report. The next
  branch must then choose one documented strategy:
  - add an explicit replication/read-repair layer,
  - enable and validate a scoped Gun/AXE topology,
  - or define an authoritative relay cluster behind a load balancer and limit
    the claim to service-level failover rather than CRDT peer federation.
- No production topology release claim is allowed until one of those strategies
  is implemented and drilled.

Acceptance gates:

- Slice 6A local harness command exists:
  `pnpm test:mesh:topology-drills`
- The harness starts three production-mode local relays with distinct radata
  directories and non-empty relay peer lists.
- A production-topology config command renders without missing env:
  `docker compose -f infra/docker/docker-compose.yml config`
- Each relay returns healthy:
  - `GET /healthz`
  - `GET /readyz`
  - `GET /metrics`
- Browser app boot rejects unsigned or insufficient peer config in strict mode.
- Slice 6A browser app boot accepts a signed three-peer local config only when
  local mesh peers are explicitly allowed for the harness.
- Slice 6B browser app boot accepts a signed three-peer WSS config with local
  peer allowance disabled.
- Health panel reports quorum with actual peer health, not configured URL count.

Definition of done:

- Slice 6A is done when a local production-shaped three-relay harness can be
  started by a single named command and the app proves it is reading signed peer
  config.
- Slice 6B is done when a release operator can deploy the three-relay WSS
  topology from documented commands and can prove the app is reading signed peer
  config from that deployment.

### Slice 7 - Peer Failure, Restart, And Catch-Up Drills

Status: Queued.

Purpose:

- Prove writes continue with one peer unavailable and prove restarted peers
  catch up without operator repair.

Scope, Slice 7A:

1. Add an e2e production-topology drill harness.
2. Generate a deterministic test topic/story/thread context.
3. Write through the browser with all peers healthy.
4. Kill or firewall one relay.
5. Write votes, thread, comment, and topic engagement while quorum remains.
6. Verify browser write/readback through the remaining quorum.
7. Assert health state during failure: one of three peers down must not emit
   `peer-quorum-missing` while two healthy peers satisfy the configured quorum.

Scope, Slice 7B:

1. Restart the killed relay.
2. Verify the restarted relay catches up within SLA by reading through that
   relay path only.
3. Assert health returns to nominal after recovery.
4. Preserve a machine-readable comparison of per-relay observed objects.

Primary files likely touched:

- `packages/e2e/src/mesh/production-topology-drills.spec.ts` (new)
- `packages/e2e/playwright.mesh-production.config.ts` (new or extended)
- root `package.json` scripts
- `docs/ops/` runbook for topology drills

Minimum write classes under drill:

- health probe write/readback
- point aggregate voter node
- point aggregate snapshot
- topic engagement actor
- topic engagement summary
- forum thread
- forum comment
- news/story or synthetic public test artifact if daemon is part of the drill

Acceptance gates:

- New command: `pnpm test:mesh:topology-drills`
- Slice 7A: one relay down, browser write/readback still confirms within SLA.
- Slice 7B: restarted relay catches up within SLA.
- Health store shows `peer-quorum-missing` only when healthy peers fall below
  required quorum, not merely when one of three peers is down.
- No duplicate public writes after relay restart.
- Direct per-relay readback evidence is included in the drill artifact.

SLA defaults:

- quorum write/readback p95 under 5 seconds in local production-shaped harness
- restarted relay catch-up p95 under 30 seconds for test namespace writes
- health reason transition under 15 seconds

Regression traps:

- Do not count a write as successful only because one browser's localStorage has
  it.
- Do not use eval artifacts as proof of relay catch-up; drills must read from
  the restarted relay path.
- Do not count a peer as caught up through a multi-peer browser client; use a
  single-peer client or direct relay readback against the restarted relay.

### Slice 8 - Websocket Disconnect And Duplicate-Write Drills

Status: Queued.

Purpose:

- Prove Gun reconnect behavior and browser retry behavior do not duplicate
  canonical user writes.

Scope:

1. Force websocket close during an in-flight write.
2. Let the browser reconnect.
3. Confirm the local intent queue or durable write path retries as needed.
4. Confirm canonical mesh state has one logical write.
5. Confirm aggregate projections do not double-count.

Primary files likely touched:

- `packages/e2e/src/mesh/production-topology-drills.spec.ts`
- `apps/web-pwa/src/hooks/voteIntentMaterializer.ts` if a duplicate edge is
  found
- `packages/gun-client/src/aggregateAdapters.ts` if readback/dedup gaps appear
- `packages/gun-client/src/forumAdapters.ts` if forum duplicate handling is
  incomplete

Write classes under duplicate drill:

- vote intent replay
- aggregate voter node
- aggregate snapshot
- forum thread
- forum comment
- encrypted sentiment event
- topic engagement actor/summary

Acceptance gates:

- Forced websocket close mid-vote produces one final voter row per
  `(topic_id, synthesis_id, epoch, voter_id, point_id)`.
- Forced websocket close mid-comment produces one comment id and one index
  entry.
- Replayed encrypted sentiment events do not create duplicate event ids.
- UI does not show duplicate comment/thread rows after reload.
- Aggregate counts remain stable after reconnect.

Regression traps:

- Do not rely on timestamp ordering for deduplication where deterministic ids
  already exist.
- Do not treat duplicate UI rows as a rendering-only issue until the mesh
  storage path is inspected.

### Slice 9 - Network Partition And Healing Drill

Status: Queued.

Purpose:

- Prove that partitioned relay topology fails with truthful health and heals
  without data loss or duplicate writes.

Scope:

1. Partition one relay from the others or from the browser.
2. Continue writing through the remaining quorum.
3. Attempt writes from a browser configured to the partitioned peer.
4. Verify health degradation reasons.
5. Heal the partition.
6. Verify convergence and no duplicate writes.

Primary files likely touched:

- production topology e2e harness
- relay test utilities for blocking/unblocking ports or routes
- health monitor tests if degradation reason semantics need tightening

Acceptance gates:

- Below-quorum clients fail closed with `peer-quorum-missing`.
- Quorum clients continue writes.
- Heal converges all test namespace objects within SLA.
- No duplicate votes/comments/thread heads after heal.

SLA defaults:

- health degradation under 15 seconds
- recovery under 60 seconds for test namespace data

Regression traps:

- Do not hide below-quorum failure as "pending" indefinitely.
- Do not accept stale local readback as distributed convergence.

### Slice 10 - Rolling Restart Soak

Status: Queued.

Purpose:

- Prove the topology remains healthy under repeated production-like restarts and
  normal browser activity.

Scope:

1. Start three relays, app preview, and a deterministic test mesh workload.
2. Run two-user and five-user engagement lanes against the topology.
3. Restart relays one at a time on a schedule.
4. Force websocket reconnects during writes.
5. Collect p95 latencies and terminal failures by write class.
6. Fail the run on duplicate writes, silent drops, or sustained message rate
   breach.

Primary commands:

- Existing:
  - `pnpm test:mesh:browser-canary`
  - `pnpm test:live:two-user-engagement`
  - `pnpm test:live:five-user-engagement`
- New:
  - `pnpm test:mesh:soak`

Required metrics:

- write attempts by class
- acked writes by class
- readback-confirmed writes by class
- relay-fallback writes by class
- terminal failures by class
- p95 write latency by class
- browser Gun message rate
- peer quorum healthy/configured/required
- relay active connections
- relay dropped connections
- relay byte drops
- relay auth rejects
- relay radata size if available

Acceptance gates:

- 30-minute run passes.
- p95 write latency remains within per-class budgets.
- Zero silent drops.
- Zero duplicate canonical writes.
- Health returns to nominal after each restart.

Initial p95 budgets:

| Write class | p95 budget |
|---|---:|
| health probe write/readback | 3s |
| vote intent materialization | 5s |
| aggregate snapshot | 5s |
| topic engagement actor/summary | 5s |
| forum thread | 8s |
| forum comment | 8s |
| encrypted sentiment outbox | 5s |
| daemon story/synthesis publication | 15s |

Minimum release-ready sample floors:

| Write class | Minimum successful samples |
|---|---:|
| health probe write/readback | 30 |
| vote intent materialization | 20 |
| aggregate snapshot | 20 |
| topic engagement actor/summary | 20 |
| forum thread | 10 |
| forum comment | 20 |
| encrypted sentiment outbox | 10 |
| daemon story/synthesis publication | 5 |

`insufficient_samples` blocks `release_ready` unless the write class is
explicitly out of scope for that run and the gate records a `skipped` reason.

These budgets are starting values for local production-shaped topology. Tighten
or split them after the first real soak packet, but do not remove a budget
without replacing it with a more specific one.

### Slice 11 - Release Gate And Evidence Packet

Status: Queued.

Purpose:

- Convert production topology proof into a repeatable release gate, not a
  one-off manual exercise.

Scope:

1. Add named scripts for topology drills and soak.
2. Write a machine-readable report artifact.
3. Add a human-readable evidence packet.
4. Wire the report into the public-beta/release-readiness checklist.
5. Document how to rerun and interpret failures.

Primary files likely touched:

- root `package.json`
- `packages/e2e/src/mesh/*`
- a new mesh production topology runbook under `docs/ops/`
- `docs/reports/evidence/mesh-production/<timestamp>/` (generated evidence)
- `docs/ops/public-beta-launch-readiness-closeout.md` or successor release
  checklist if the production mesh claim becomes part of beta release copy

Required report schema:

```ts
interface MeshProductionReadinessReport {
  schema_version: 'mesh-production-readiness-v1';
  generated_at: string;
  repo: {
    branch: string;
    commit: string;
    base_ref: string;
    dirty: boolean;
  };
  run: {
    mode: 'local_production_topology' | 'deployed_wss_topology';
    started_at: string;
    completed_at: string;
    duration_ms: number;
    command: string;
  };
  status: 'release_ready' | 'review_required' | 'blocked';
  topology: {
    strategy: 'relay_peer_fanout' | 'explicit_replication' | 'authoritative_cluster';
    configured_peer_count: number;
    quorum_required: number;
    signed_peer_config: boolean;
    relay_urls_redacted: string[];
    relay_to_relay_peers_configured: boolean;
  };
  gates: Array<{
    name: string;
    status: 'pass' | 'fail' | 'skipped';
    command: string;
    duration_ms: number;
    exit_code: number | null;
    artifact_path?: string;
    reason?: string;
  }>;
  write_class_slos: Array<{
    write_class: string;
    attempts: number;
    successes: number;
    terminal_failures: number;
    duplicate_count: number;
    minimum_successful_samples: number;
    p95_ms: number | null;
    budget_ms: number;
    status: 'pass' | 'fail' | 'insufficient_samples';
  }>;
  per_relay_readback: Array<{
    relay_id: string;
    write_class: string;
    object_id: string;
    observed: boolean;
    latency_ms: number | null;
  }>;
  health: {
    peer_quorum_minimum_observed: number;
    sustained_message_rate_max_per_sec: number;
    degradation_reasons_seen: string[];
  };
  release_claims: {
    allowed: string[];
    forbidden: string[];
  };
}
```

Acceptance gates:

- New command: `pnpm check:mesh:production-readiness`
- Report writes to a stable latest path, for example:
  `.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json`
- Release-ready means:
  - report repo metadata identifies branch, commit, base ref, and dirty state
  - topology drills pass
  - disconnect/duplicate drill passes
  - partition/heal drill passes
  - 30-minute soak passes
  - no write class has terminal failures or duplicates
  - all required write classes meet sample floors
  - all write classes with sufficient samples meet p95 budgets
- The gate fails if a release commit claims production mesh without a passing
  report.

### Slice 12 - Operational Runbook And Rollback

Status: Queued.

Purpose:

- Make production operation, diagnosis, and rollback executable by an operator
  who did not write the implementation.

Scope:

1. Write a mesh production topology runbook.
2. Define startup, health-check, deploy, rollback, compaction, and incident
   response steps.
3. Define what health reasons mean and what the operator should do.
4. Define how to rotate relay daemon tokens and peer config signing keys.
5. Define how to compact health probe namespaces and inspect radata pressure.
6. Define how to run and interpret readiness reports.

Primary files likely touched:

- a new mesh production topology runbook under `docs/ops/`
- `docs/plans/CANARY_ROLLBACK_PLAN.md` or successor rollback doc
- `docs/feature-flags.md`
- `docs/foundational/STATUS.md`

Runbook must include:

- deploy commands
- required env var checklist
- signed peer-config generation and verification
- `curl` probes for `/healthz`, `/readyz`, `/metrics`
- expected health panel states
- rollback to previous peer config
- relay token rotation
- compaction command:
  `pnpm mesh:compact-health-probes`
- readiness command:
  `pnpm check:mesh:production-readiness`

Acceptance gates:

- A dry-run operator can follow the runbook against the production-shaped local
  topology and produce a readiness report.
- Missing env vars fail fast with actionable messages.
- Rollback steps are tested at least once in the topology harness.

## 5. Cross-Cutting Rules

### 5.1 Write Classes

No new critical write class may ship without being classified here.

| Write class | Owner surface | Trust class | Durability requirement |
|---|---|---|---|
| health probe | browser health monitor | public utility | ack + readback, deterministic key |
| news bundle/story | daemon/gun-client | public | write lane + durable write + replay |
| storyline | daemon/gun-client | public | write lane + durable write + replay |
| synthesis latest | daemon/gun-client | public-derived | write lane + durable write + replay |
| analysis latest | gun-client | public-derived | durable write |
| aggregate voter node | browser/gun-client | public aggregate input | deterministic id + readback/fallback |
| aggregate snapshot | browser/gun-client | public aggregate output | readback/fallback |
| topic engagement actor | browser/gun-client | public aggregate input | durable write |
| topic engagement summary | browser/gun-client | public aggregate output | durable write |
| encrypted sentiment event | browser/gun-client | encrypted user outbox | durable write, no public plaintext |
| forum thread | browser/gun-client | public | deterministic id + durable write |
| forum comment | browser/gun-client | public | deterministic id + durable write |
| forum moderation | operator/gun-client | public audit | durable write + operator auth |
| directory publish | browser/gun-client | identity-sensitive public pointer | durable write + topology guard |
| news report/status | browser/operator/gun-client | public workflow/audit | durable write |

### 5.2 Health Reasons

Production health must be reasoned, not binary. Valid mesh-related reasons:

- `probe-ack-timeout`
- `write-readback-failed`
- `convergence-lagging`
- `peer-quorum-missing`
- `analysis-relay-unavailable`
- `local-storage-hydration-failed`
- `client-out-of-date`
- `message-rate-high`

Each new reason must include:

- source signal
- threshold
- user-facing label
- operator interpretation
- test coverage

Non-blocking peer loss rule:

- One unavailable peer in a three-peer topology with two healthy peers and
  quorum required at two must remain non-blocking.
- The health surface must still show the actual healthy/configured/required peer
  counts.
- `peer-quorum-missing` is reserved for below-quorum clients.
- Add a new health reason only if the product needs a user-facing warning for
  non-blocking peer loss; do not overload `peer-quorum-missing`.

### 5.3 Security Rules

- No production graph-injection endpoint may accept unauthenticated writes.
- User-callable relay fallback writes require user/device signatures.
- Daemon-only writes require daemon bearer auth and must not be callable by
  browser fallback paths.
- Production origin allowlists must not be `*`.
- Production app builds must reject missing peer config.
- Production app builds must reject localhost and private test peers unless a
  local/test flag is explicitly set.

### 5.4 Privacy Rules

This spec inherits `docs/specs/spec-data-topology-privacy-v0.md` and
`docs/specs/spec-civic-sentiment.md`.

Specific mesh rules:

- Event-level sentiment remains local or encrypted outbox only.
- VoteIntentRecord remains local durable queue only.
- No nullifier, raw proof, district hash plus person identifier, API key, OAuth
  token, or provider secret may be written to public `vh/*` namespaces.
- Public aggregate objects must not be joinable back to person-level identity.

### 5.5 Documentation Rules

Implementation truth belongs in:

- `docs/foundational/STATUS.md`
- `docs/reports/MESH_HARDENING_PR2_2026-05-02.md`
- future readiness reports under `.tmp/mesh-production-readiness/latest/`
- promoted human-readable evidence summaries under
  `docs/reports/evidence/mesh-production/`

Normative mesh readiness contracts belong in this spec.

Run instructions belong in `docs/ops/`.

Generated `.tmp` packets are the machine proof source for a run. Tracked docs
must summarize those packets and link exact artifact paths; they must not invent
release claims that are absent from the generated report.

## 6. Required Commands

Current commands:

- `pnpm test:mesh:browser-canary`
- `pnpm typecheck`
- `pnpm lint`
- `node tools/scripts/check-diff-coverage.mjs`
- `pnpm --filter @vh/gun-client test`
- `pnpm --filter @vh/news-aggregator test`
- `pnpm test:storycluster:correctness`
- `pnpm check:storycluster:production-readiness`
- `pnpm check:mvp-release-gates`
- `pnpm check:public-beta-compliance`
- `pnpm check:public-beta-launch-closeout`
- `pnpm docs:check`
- `pnpm live:stack:up`
- `pnpm live:stack:down`
- `pnpm mesh:compact-health-probes`

Required new commands:

- `pnpm test:mesh:topology-drills`
- `pnpm test:mesh:disconnect-drills`
- `pnpm test:mesh:partition-drills`
- `pnpm test:mesh:soak`
- `pnpm check:mesh:production-readiness`

## 7. Release Claim Boundary

Allowed after PR #560 through PR #565:

- "The local-first mesh client, write paths, daemon queues, relay hardening, and
  peer topology config have been hardened and verified against local and CI
  canaries."

Not allowed yet:

- "The mesh is production-grade distributed infrastructure."
- "The app has production-ready multi-relay failover."
- "Peer restart and network partition recovery are proven."
- "Production users can rely on distributed quorum behavior."

Allowed after Slice 6A and Slice 7A pass:

- "The mesh has a local production-shaped three-relay topology harness with
  signed peer config and a passing one-peer-kill quorum write/readback drill."

Still not allowed after Slice 6A and Slice 7A:

- "Restarted peers catch up automatically."
- "The production WSS topology is deployed."
- "The mesh has production-ready multi-relay failover."

Allowed after Slices 6B through 12 pass:

- "The mesh has a production WSS three-relay topology with signed peer config,
  authenticated relay fallbacks, named health degradation, peer-failure and
  partition drills, websocket duplicate-write drills, and a passing 30-minute
  rolling restart soak."

## 8. Non-Goals For This Series

- Migrating away from Gun `0.2020.1237`.
- Enabling AXE without a scoped relay-to-relay design and drill evidence.
- Building a new transport layer.
- Adding multi-tab mesh-owner coordination unless tester evidence shows tab
  amplification is a release blocker.
- Treating StoryCluster semantic correctness as part of mesh topology readiness;
  StoryCluster remains governed by the existing correctness and production
  readiness gates.

## 9. Immediate Next Slice

The next implementation slice is Slice 6A plus Slice 7A:

1. Add a local production-shaped three-relay topology harness with production
   relay env, persistent per-relay radata dirs, auth/origin/limit settings, and
   explicit relay peer lists.
2. Add signed peer-config generation and verification for that harness.
3. Add `pnpm test:mesh:topology-drills`.
4. Prove one-peer-kill write/readback behavior through the remaining quorum.
5. Record direct per-relay readback evidence, even if restarted-peer catch-up is
   not claimed yet.
6. Record the result in a new ops runbook and readiness report skeleton.

This is the narrowest next step because it tests the only major unproven claim
left after PR #564: real distributed topology behavior beyond the local
three-peer preview canary. Do not start with a cloud WSS deployment until the
local harness produces the first report packet; otherwise the team will be
debugging deployment, signing, topology, and convergence at the same time.
