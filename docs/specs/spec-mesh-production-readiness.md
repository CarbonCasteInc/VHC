# Mesh Production Readiness Spec

> Status: Execution Spec
> Owner: VHC Core Engineering
> Last Reviewed: 2026-05-04
> Depends On: docs/foundational/System_Architecture.md, docs/foundational/STATUS.md, docs/specs/spec-data-topology-privacy-v0.md, docs/specs/spec-civic-sentiment.md, docs/specs/spec-luma-service-v0.md, docs/specs/spec-signed-pin-custody-v0.md, docs/reports/MESH_HARDENING_PR2_2026-05-02.md

Version: 0.4

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
7. Relay-to-relay traffic has an explicit trust path; the topology does not
   reopen unauthenticated graph injection through peer sockets.
8. Relay processes expose `/healthz`, `/readyz`, and `/metrics`; enforce origin,
   body-size, rate-limit, active-connection, and bytes-per-second limits; and log
   structured drop/reject reasons.
9. Every drill uses bounded test namespaces, correlation IDs, and cleanup rules.
10. A one-peer failure does not stop writes from confirming.
11. Restarted peers catch up within a stated SLA.
12. Forced websocket disconnects and reconnects do not duplicate user writes.
13. State-resolution rules per §5.10 hold after peer restart or partition
    healing; no class relies on a generic "delete wins" rule.
14. Deliberate clock skew produces named bounded auth/health failures without
    causing LWW divergence or false mesh-transport failures.
15. Network partition drills fail closed with a named health reason, then
    converge without data loss or duplicate writes after healing.
16. Same-key concurrent write fixtures pass the documented conflict-resolution
    matrix.
17. A 30-minute rolling restart soak passes with bounded p95 write latencies,
    resource budgets, and storage-growth budgets per write class and relay.
18. Production peer-config lifecycle is explicit: issue, expiry, stale rejection,
    rollback, key rotation, compromised-key revocation, and old-tab behavior.
19. Production WSS peers and peer-config URLs are represented in CSP/connect-src,
    and the service worker cannot cache stale peer config across topology rollout.
20. CI or release automation runs the mesh canary and production topology drills
    as named commands, and failed drills flip both machine gates and user-visible
    health.
21. A downstream full-app production canary passes after mesh readiness before
    any "test group ready" claim.
22. LUMA-owned write classes (any class whose canonical record carries
    `_writerKind === 'luma'`) are claim-valid only when both transport readiness
    and LUMA gate verification pass. Mesh readiness alone never validates LUMA
    gate behavior.
23. Any LUMA public-schema epoch change (changes to `_protocolVersion`,
    `_writerKind` semantics, public-id derivation, `_authorScheme`, or any
    schema in `vh/*` owned by `spec-luma-service-v0.md`) invalidates prior
    canonical mesh readiness for affected write classes. Old reports remain
    transport evidence only and MUST NOT be reused as release-claim evidence
    after the epoch change.
24. The mesh drill harness signs and writes drill data through a separate test
    writer contract (§5.9) that is bounded to `vh/__mesh_drills/*` and to
    test-only mesh profiles. The drill writer is not a LUMA `_writerKind` and
    does not carry `SignedWriteEnvelope` shapes; product readers reject drill
    writes if they encounter them.

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
2. Add an explicit relay-to-relay authentication mode for the harness. The
   accepted first implementation may be a peer bearer token, private-network
   allowlist, mTLS, or signed peer handshake, but it must be documented and
   exercised by a negative auth test.
3. Start three local `NODE_ENV=production` relay processes with distinct
   persistent radata directories, auth enabled, origin allowlists enabled, and
   production limit env vars set.
4. Configure relay-to-relay peer lists for those processes unless the
   convergence decision gate below chooses a different strategy.
5. Generate and serve a signed peer-config fixture for the Web PWA with
   `issuedAt`, `expiresAt`, and `configId`.
6. Build/preview the Web PWA in strict peer-config mode against that signed
   config.
7. Write all drill data under `vh/__mesh_drills/<run_id>/...`.
8. Emit a readiness report skeleton even before release-ready status exists.

Scope, Slice 6B:

1. Define the production relay deployment profile.
2. Stand up three WSS relay processes.
3. Configure persistent storage for each relay.
4. Generate and publish signed peer config.
5. Configure the Web PWA to fetch signed peer config at boot.
6. Configure relay origin allowlists and daemon auth.
7. Configure dashboard/metrics scraping for all three relays.
8. Add production WSS peers and peer-config URLs to Web PWA `connect-src` CSP.
9. Ensure service-worker update/caching rules cannot pin stale peer config or a
   stale app shell through topology rollout.

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
- `apps/web-pwa/index.html` and `apps/web-pwa/src/csp.test.ts` if CSP remains
  meta-delivered for this release shape
- `apps/web-pwa/public/sw.js` and service-worker registration tests for
  peer-config cache behavior

Required environment variables:

- `GUN_FILE`
- `GUN_RADISK=true`
- `VH_RELAY_PEERS` or the final implemented relay-peer-list env name
- `VH_RELAY_PEER_AUTH_MODE` or the final implemented relay-peer-auth mode name
- relay peer credential material for the chosen auth mode; this must be supplied
  from local secrets, secret manager, mTLS volume, or private network policy and
  must not be committed
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
- This is a time-boxed proof path, not an architecture commitment. If direct
  restarted-relay readback is still failing after the bounded Slice 6A/7B proof
  attempt, stop tuning Gun peer behavior and move to explicit
  replication/read-repair unless a short written exception is approved in the
  readiness report.
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
- Relay-to-relay auth rejects an unauthorized peer connection without weakening
  browser/user fallback auth or daemon bearer auth.
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
- Peer-config fetch is not served from stale service-worker cache during config
  rollover.
- Production CSP allows only the expected WSS relay and peer-config origins.

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

Scope, Slice 7C:

1. Write deterministic drill objects per the §5.10 State-Resolution Matrix.
2. Apply the deletion semantics each class actually has (tombstone, hide/
   restore latest-state, supersession by version/epoch, or no-op for
   historical artifacts) — not a generic "delete wins" rule.
3. Take one relay down before, during, and after the relevant write across
   separate drill cases.
4. Restart or heal the relay.
5. Assert the §5.10 winning rule for each class on every relay; emit
   `state-resolution-violation` if any rule is broken.

Primary files likely touched:

- `packages/e2e/src/mesh/production-topology-drills.spec.ts` (new)
- `packages/e2e/playwright.mesh-production.config.ts` (new or extended)
- root `package.json` scripts
- `docs/ops/` runbook for topology drills
- removal/tombstone adapter tests if any write class has ambiguous delete
  semantics

Minimum write classes under drill:

- health probe write/readback
- point aggregate voter node
- point aggregate snapshot
- topic engagement actor
- topic engagement summary
- forum thread
- forum comment
- moderated forum comment
- deleted/tombstoned health probe
- removed or superseded synthetic story object
- stale aggregate snapshot
- news/story or synthetic public test artifact if daemon is part of the drill

Acceptance gates:

- New command: `pnpm test:mesh:topology-drills`
- Slice 7A: one relay down, browser write/readback still confirms within SLA.
- Slice 7B: restarted relay catches up within SLA.
- Slice 7C: every class in §5.10 State-Resolution Matrix passes its
  class-specific winning rule after relay restart or partition healing; no
  generic "delete wins" assertion is allowed in the drill code.
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
- Do not rely on a missing read as proof of deletion; drills must assert the
  class-specific state-resolution rule from §5.10.
- Do not let old relay state win over the §5.10 winning state because its local
  clock is ahead or because it missed the relevant update.

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
6. Exercise same-key concurrent writes from two tabs/devices against the
   conflict-resolution matrix.

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

Conflict-resolution fixtures:

| Fixture | Expected result |
|---|---|
| Same voter toggles stance from two tabs | One final voter row per deterministic voter/point key; aggregate projection reflects the winning final stance exactly once |
| Same forum comment index replayed from two clients | One comment id and one index entry; UI reload shows one row |
| Aggregate snapshot recomputed from stale and fresh voter rows | Snapshot version/source window advances monotonically; stale recomputation cannot overwrite fresher aggregate counts |
| Topic engagement summary replayed after actor update | Summary does not double-count actor contribution and does not regress below the latest actor state |

Acceptance gates:

- Forced websocket close mid-vote produces one final voter row per
  `(topic_id, synthesis_id, epoch, voter_id, point_id)`.
- Forced websocket close mid-comment produces one comment id and one index
  entry.
- Replayed encrypted sentiment events do not create duplicate event ids.
- UI does not show duplicate comment/thread rows after reload.
- Aggregate counts remain stable after reconnect.
- Same-key concurrent write fixtures match the conflict-resolution matrix.

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
7. Run one partition case with deliberate browser or relay clock skew.
8. Distinguish clock-skew auth/write failures from mesh transport failures in
   health and report output.

Primary files likely touched:

- production topology e2e harness
- relay test utilities for blocking/unblocking ports or routes
- health monitor tests if degradation reason semantics need tightening

Acceptance gates:

- Below-quorum clients fail closed with `peer-quorum-missing`.
- Quorum clients continue writes.
- Heal converges all test namespace objects within SLA.
- No duplicate votes/comments/thread heads after heal.
- Deliberate clock skew causes named bounded failures such as
  `clock-skew-detected` or `user-signature-stale`, not generic mesh transport
  failure.
- LWW-sensitive paths do not diverge when a skewed relay/browser participates in
  the drill.

SLA defaults:

- health degradation under 15 seconds
- recovery under 60 seconds for test namespace data

Regression traps:

- Do not hide below-quorum failure as "pending" indefinitely.
- Do not accept stale local readback as distributed convergence.
- Do not classify timestamp-skew signature rejects as relay outage.
- Do not trust wall-clock ordering alone for deterministic conflict resolution.

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
7. Collect relay process resource metrics and storage-growth metrics.

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
- relay RSS and heap usage
- relay event-loop lag p95
- relay open sockets/file descriptors where available
- relay radata growth rate by run phase
- test namespace object count and cleanup count

Acceptance gates:

- 30-minute run passes.
- p95 write latency remains within per-class budgets.
- Zero silent drops.
- Zero duplicate canonical writes.
- Health returns to nominal after each restart.
- Relay resource budgets are met.
- Radata growth is bounded for the test namespace and cleanup removes or
  tombstones all drill-owned data that the runbook says is disposable.

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

Initial relay resource budgets:

| Resource | Budget |
|---|---:|
| relay RSS per local harness process | 512 MB |
| relay JS heap used per local harness process | 256 MB |
| relay event-loop lag p95 | 100 ms |
| active sockets per 5-user local soak | 250 |
| radata growth per 30-minute local soak | 250 MB |

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
5. Add a downstream full-app production canary that runs after mesh readiness.
6. Document how to rerun and interpret failures.

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
  run_id: string;
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
  schema_epoch: 'pre_luma_m0b' | 'post_luma_m0b' | string;
  luma_profile: 'public-beta' | 'production-attestation' | 'none';
  luma_dependency_status: Record<string, 'landed' | 'in-progress' | 'pending' | 'n/a'>;
  drill_writer_kind_by_class: Record<string, 'mesh-drill' | 'luma' | 'system'>;
  topology: {
    strategy: 'relay_peer_fanout' | 'explicit_replication' | 'authoritative_cluster';
    configured_peer_count: number;
    quorum_required: number;
    signed_peer_config: boolean;
    relay_urls_redacted: string[];
    relay_to_relay_peers_configured: boolean;
    relay_to_relay_auth_mode: 'mtls' | 'peer_bearer_token' | 'private_network_allowlist' | 'signed_peer_handshake';
    relay_to_relay_auth_negative_test: 'pass' | 'fail' | 'skipped';
    peer_config_id: string;
    peer_config_issued_at: string;
    peer_config_expires_at: string;
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
  resource_slos: Array<{
    resource: string;
    observed: number | null;
    budget: number;
    unit: string;
    status: 'pass' | 'fail' | 'insufficient_samples';
  }>;
  per_relay_readback: Array<{
    relay_id: string;
    write_class: string;
    object_id: string;
    write_id: string;
    trace_id: string;
    observed: boolean;
    latency_ms: number | null;
  }>;
  state_resolution_drills: Array<{
    object_id: string;
    object_class: string;
    state_rule:
      | 'tombstone-wins'
      | 'best-effort-tombstone'
      | 'hide-restore-latest'
      | 'monotonic-supersession-version'
      | 'monotonic-supersession-epoch'
      | 'monotonic-status-transition'
      | 'no-deletion-historical-artifact'
      | 'last-write-wins-deterministic-id';
    expected_winner_write_id: string;
    observed_winner_write_id: string | null;
    competing_write_ids: string[];
    down_relay_id: string | null;
    violation_reason: string | null;
    status: 'pass' | 'fail' | 'skipped';
    reason?: string;
  }>;
  conflict_fixtures: Array<{
    fixture: string;
    trace_id: string;
    status: 'pass' | 'fail' | 'skipped';
    reason?: string;
  }>;
  luma_gated_write_drills: Array<{
    write_class: string;
    trace_id: string;
    status: 'pass' | 'fail' | 'skipped';
    reason?: string;
  }>;
  clock_skew: {
    skewed_actor: 'browser' | 'relay' | 'daemon' | null;
    skewed_layer: 'luma-clock' | 'os-clock' | 'mixed' | null;
    skew_ms: number;
    named_failure: string | null;
    lww_diverged: boolean;
    status: 'pass' | 'fail' | 'skipped';
  };
  cleanup: {
    namespace: string;
    objects_written: number;
    objects_cleaned_or_tombstoned: number;
    retained_objects: number;
    status: 'pass' | 'fail';
  };
  health: {
    peer_quorum_minimum_observed: number;
    sustained_message_rate_max_per_sec: number;
    degradation_reasons_seen: string[];
  };
  release_claims: {
    allowed: string[];
    forbidden: string[];
    invalidated_by_luma_epoch_change: boolean;
  };
  downstream_canary?: {
    command: string;
    status: 'pass' | 'fail' | 'skipped';
    report_path?: string;
    reason?: string;
  };
}
```

Acceptance gates:

- New command: `pnpm check:mesh:production-readiness`
- Report writes to a stable latest path, for example:
  `.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json`
- Release-ready means:
  - report repo metadata identifies branch, commit, base ref, and dirty state
  - report has a `run_id` and every drill write has a joinable `write_id` and
    `trace_id`
  - report carries `schema_epoch`, `luma_profile`,
    `luma_dependency_status`, and `drill_writer_kind_by_class` (§5.13)
  - `release_claims.invalidated_by_luma_epoch_change` is `false`
  - topology drills pass
  - disconnect/duplicate drill passes
  - state-resolution matrix (§5.10) passes class-by-class, recorded in `state_resolution_drills`
  - clock-skew drill passes with `clock_skew.skewed_layer` recorded (§5.12)
  - partition/heal drill passes
  - 30-minute soak passes
  - conflict-resolution fixtures pass
  - no write class has terminal failures or duplicates
  - all required write classes meet sample floors
  - all write classes with sufficient samples meet p95 budgets
  - relay resource budgets pass
  - test namespace cleanup passes
  - any LUMA-gated write class (drill_writer_kind `'luma'`) was exercised
    against the LUMA reader path, not bypassed via drill writer contract
  - any promoted evidence under `docs/reports/evidence/mesh-production/`
    passed `pnpm check:mesh-evidence-scrub` (§5.7.1)
- The gate fails if a release commit claims production mesh without a passing
  report.
- `pnpm check:mesh:production-readiness` is necessary but not sufficient for
  "test group ready"; that claim also requires the downstream full-app canary to
  pass.

Downstream full-app canary:

- New command: `pnpm check:production-app-canary`
- Runs only after `pnpm check:mesh:production-readiness` passes.
- Covers production WSS relay config, app preview/deploy shape, `/api/analyze`,
  news synthesis publication, point stance write/readback, and story-thread
  creation/comment flow.
- Fails if it cannot consume the latest mesh readiness report or if that report
  is not `release_ready`.
- Emits a separate report; it may depend on mesh readiness but must not be
  folded into the mesh readiness status.

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
7. Define peer-config lifecycle: `issuedAt`, `expiresAt`, stale rejection,
   rollback to previous config, signing-key rotation, compromised-key
   revocation, and old-tab behavior.
8. Define CSP/connect-src updates for WSS relays and peer-config URLs.
9. Define service-worker cache behavior for topology rollout and rollback.
10. Define correlation ID lookup from browser logs through relay/daemon/report
   artifacts.

Primary files likely touched:

- a new mesh production topology runbook under `docs/ops/`
- `docs/plans/CANARY_ROLLBACK_PLAN.md` or successor rollback doc
- `docs/feature-flags.md`
- `docs/foundational/STATUS.md`
- `apps/web-pwa/index.html`
- `apps/web-pwa/src/csp.test.ts`
- `apps/web-pwa/public/sw.js`

Runbook must include:

- deploy commands
- required env var checklist
- signed peer-config generation and verification
- peer-config expiry and stale-config rejection canary
- old-tab behavior when the active config expires or is revoked
- rollback to previous signed peer config
- signing-key rotation and compromised-key revocation procedure
- `curl` probes for `/healthz`, `/readyz`, `/metrics`
- expected health panel states
- rollback to previous peer config
- relay token rotation
- relay-to-relay credential rotation
- CSP/connect-src update checklist
- service-worker cache-bust/rollout checklist
- trace lookup procedure using `run_id`, `write_id`, and `trace_id`
- test namespace cleanup and retained-object inspection
- compaction command:
  `pnpm mesh:compact-health-probes`
- readiness command:
  `pnpm check:mesh:production-readiness`

Acceptance gates:

- A dry-run operator can follow the runbook against the production-shaped local
  topology and produce a readiness report.
- Missing env vars fail fast with actionable messages.
- Rollback steps are tested at least once in the topology harness.
- Peer-config expiry, stale rejection, rollback, key rotation, and revoked-key
  canaries pass.
- Service-worker and CSP rollout checks pass before a WSS peer-config rollout is
  marked operator-ready.

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

### 5.2 Traceability And Test Namespace Rules

Every production-topology drill must create:

- `run_id`: one id for the whole readiness run.
- `write_id`: one deterministic id per logical write attempt.
- `trace_id`: one join key carried through browser logs, gun-client telemetry,
  relay fallback/auth logs, daemon write-lane logs, and the readiness report.

Drill data must live under `vh/__mesh_drills/<run_id>/...` unless a specific
write class cannot be tested there. Any exception must record the production
namespace touched, cleanup plan, and retained-object reason in the report.

Cleanup rules:

- Disposable drill data must be tombstoned or compacted by the run cleanup step.
- Cleanup itself must be measured; a report with unknown cleanup state cannot be
  `release_ready`.
- Retained drill data must be bounded by run count or TTL and excluded from
  production product reads.

### 5.3 Health Reasons

Production health must be reasoned, not binary. Valid mesh-related reasons:

- `probe-ack-timeout`
- `write-readback-failed`
- `convergence-lagging`
- `peer-quorum-missing`
- `clock-skew-detected`
- `analysis-relay-unavailable`
- `local-storage-hydration-failed`
- `client-out-of-date`
- `message-rate-high`
- `mesh-drill-record-out-of-namespace` (drill record observed outside
  `vh/__mesh_drills/*`; see §5.9)
- `mesh-drill-signer-unknown` (drill record `_drillSignerId` does not
  resolve to a pinned drill signer; see §5.9)
- `mesh-drill-signature-suite-unsupported` (drill record names a signature
  suite outside the v0-permitted set; see §5.9)
- `mesh-drill-payload-digest-mismatch` (drill record `_drillPayloadDigest`
  does not match `hex(JCS-hash(payload))`; see §5.9)
- `mesh-author-scheme-unsupported` (record carries an `_authorScheme` the
  reader does not implement; see §5.11)
- `mesh-author-scheme-missing` (record class requires `_authorScheme` but it
  is absent; see §5.11)
- `mesh-schema-version-unknown` (record-level `schemaVersion` unknown to
  reader; see §5.11)
- `system-writer-validation-failed` (`_writerKind === 'system'` record
  failed one of the LUMA §15 read-time validation conditions; carries the
  failing condition tag from `spec-luma-service-v0.md` §15)
- `state-resolution-violation` (a drill observed a state-resolution rule
  from §5.10 being broken)

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

Clock-skew rule:

- Timestamp-window failures from relay user-signature auth, peer handshake auth,
  or signed peer-config validation must be named as clock/config/auth failures.
- They must not be collapsed into generic write-readback or relay-unavailable
  transport failures.

### 5.4 Security Rules

- No production graph-injection endpoint may accept unauthenticated writes.
- User-callable relay fallback writes require user/device signatures.
- Daemon-only writes require daemon bearer auth and must not be callable by
  browser fallback paths.
- Relay-to-relay Gun peer sockets require their own trust path: mTLS, peer
  bearer token, private-network allowlist, or signed peer handshake.
- A relay-to-relay trust path must have a negative test proving unauthorized
  peers cannot join the production fan-out topology.
- Any trust path implemented on the shared `/gun` WebSocket route must state
  whether browser clients are also subject to that rule. Private-network
  allowlists are valid for the local/private harness only unless production
  WSS separates relay-peer sockets from browser client sockets or moves to a
  browser-compatible signed peer handshake.
- Production origin allowlists must not be `*`.
- Production app builds must reject missing peer config.
- Production app builds must reject localhost and private test peers unless a
  local/test flag is explicitly set.

### 5.5 Peer-Config Lifecycle Rules

Signed peer configs must include:

- `configId`
- `issuedAt`
- `expiresAt`
- peer URL list
- minimum peer count
- quorum required
- signing key id or signer public key

Production behavior:

- Missing, expired, revoked, or unsigned config fails closed in strict mode.
- Old tabs with expired or revoked config must refetch and revalidate before
  continuing mesh writes.
- Rollback uses a newly signed previous peer set, not an unsigned runtime
  override.
- Compromised signing-key revocation must be represented in the runbook and in
  at least one canary.

### 5.6 Privacy Rules

This spec inherits `docs/specs/spec-data-topology-privacy-v0.md`,
`docs/specs/spec-civic-sentiment.md`, and `docs/specs/spec-luma-service-v0.md`.

Specific mesh rules:

- Event-level sentiment remains local or encrypted outbox only.
- VoteIntentRecord remains local durable queue only.
- No nullifier, raw proof, district hash plus person identifier, API key, OAuth
  token, or provider secret may be written to public `vh/*` namespaces.
- Public aggregate objects must not be joinable back to person-level identity.
- LUMA-owned write classes inherit envelope/audience/scheme/public-id
  derivation requirements from `spec-luma-service-v0.md`. Mesh readiness
  asserts transport behavior (durability, readback, convergence, conflict,
  catch-up, partition heal, soak budgets) for those records; it does not
  assert LUMA gate behavior. LUMA gate behavior is asserted by
  `pnpm check:luma-production-profile` and the LUMA acceptance tests.

### 5.7 Documentation Rules

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

#### 5.7.1 Evidence-promotion scrub gate

`.tmp` readiness packets are unredacted machine proof. Promoting any field from
a `.tmp` packet into a tracked artifact under `docs/reports/evidence/` requires
running a scrub step. The scrub step MUST remove or redact:

- raw mesh paths (replace with `redactedPathHash` per
  `spec-luma-service-v0.md` §16.1)
- raw `SignedWriteEnvelope` JSON or any envelope field other than
  `idempotencyKey` and `audience`
- relay daemon tokens, daemon bearer credentials, peer-config private key
  material, drill writer signing key material, safety-bulletin signing material
- raw `principalNullifier`, raw `verifierId` (use `verifierIdHash`), raw
  device public key, raw session token
- unredacted relay URLs (allowed: scheme + redacted host hash)
- evidence vector material, biometric features, raw camera/IMU buffers
- private contact information, support correspondence, personal abuse evidence

A new release gate `pnpm check:mesh-evidence-scrub` MUST run against any
candidate promotion; the gate fails if any forbidden field is present. The
scrub script is the only sanctioned promotion path; manual copy-paste into
`docs/reports/evidence/` is forbidden.

Opaque correlation identifiers (`run_id`, `write_id`, `trace_id`,
`drill_run_id`) are explicitly permitted in promoted evidence.

### 5.8 LUMA Coherence Rules

This section names cross-spec rules between mesh readiness and
`spec-luma-service-v0.md`. It exists so neither spec drifts into the other's
scope and so a release operator can tell at a glance which gate covers which
behavior.

Boundary:

- Mesh owns transport, relay topology, peer-config lifecycle, durability,
  readback, conflict resolution, partition behavior, soak budgets, drill
  harness, and the readiness report.
- LUMA owns identity, sessions, envelopes, public-id derivation, audience
  binding, policy decisions, verifier transparency, safety bulletin, and
  forbidden-claims discipline.
- Reads of public mesh records are not gated by LUMA `canPerform`; mesh
  readiness drills MAY exercise read paths without a session (`spec-luma-
  service-v0.md` §10).
- LUMA-gated writes (records carrying `_writerKind === 'luma'`) are
  release-claim-valid only when readback passes through the LUMA reader path
  AND mesh transport drills pass for that write class.
- The drill harness MUST NOT bypass LUMA envelope verification for product
  write paths; if a drill needs to exercise a LUMA-gated write class without a
  real session, it uses the test writer contract in §5.9 under the drill
  namespace, not the product namespace.

Schema-epoch invalidation:

- A LUMA public-schema epoch change is any change to `_protocolVersion`
  semantics, `_writerKind` enum membership, public-id derivation
  (`forumAuthorId`, `identityDirectoryKey`, `voterId`, future domains),
  `_authorScheme` membership, or any `vh/*` schema migration owned by LUMA.
- After a LUMA epoch change, prior canonical mesh readiness reports for
  affected write classes are invalidated as release-claim evidence. The
  reports remain valid as historical transport evidence and may be cited as
  such, but a new readiness run is required before the affected write classes
  may be re-claimed for release.
- The mesh readiness report records the LUMA dependency state under which it
  was generated (`luma_dependency_status`, §5.13 report schema) so a future
  reader can tell whether a green report is still claim-valid.

Profile coupling:

- Mesh readiness profiles (`local_production_topology`, `deployed_wss_topology`)
  are orthogonal to LUMA profiles (`dev`, `e2e`, `public-beta`,
  `production-attestation`). A `deployed_wss_topology` run may be either
  `public-beta` or `production-attestation` and the gate set differs.
- The mesh readiness report records `luma_profile` so a downstream reader
  knows which LUMA gates were assumed.
- The downstream production-app canary (`pnpm check:production-app-canary`)
  MUST assert that the LUMA profile in scope matches the mesh report's
  `luma_profile`, and that the LUMA profile gates (
  `pnpm check:luma-production-profile`, forbidden-claims gate, telemetry
  redaction red test, adversarial harness corpus where required) pass.

LUMA profile disablement:

- If `production-attestation` is disabled by a LUMA `SignedSafetyBulletin`
  `profileDisablements` entry (`spec-luma-service-v0.md` §18.1), mesh transport
  may still be healthy and the mesh readiness gate may still pass; mesh and
  transport are not the failure source.
- The downstream production-app canary MUST fail closed in this state with a
  LUMA-named reason (`profile_forbidden` or `session_revoked_by_bulletin`),
  not a mesh transport reason. The canary may not silently degrade to
  `public-beta`.
- The canary report records the bulletin id and the disablement reason.

### 5.9 Mesh Drill Test Writer Contract

The mesh drill harness needs to author canonical-shaped records (forum
threads, comments, aggregate snapshots, etc.) without a real LUMA session and
without participating in LUMA's product `_writerKind` contract. This section
defines the only sanctioned way to do that.

Drill record shape:

```ts
interface MeshDrillRecord<TPayload> {
  _drillRunId: string;             // joins to readiness report run_id
  _drillWriterKind: 'mesh-drill';  // not in LUMA PublicProtocolFields union
  _drillSignerId: string;          // pinned drill-signer key id from
                                   // packages/e2e/fixtures/mesh-drill/
  _drillSignatureSuite: 'jcs-ed25519-sha256-v1';
  _drillAuthorScheme: string;      // e.g. 'mesh-drill-forum-author-v1';
                                   // namespaced under 'mesh-drill-*' to
                                   // keep disjoint from LUMA §15.1 schemes
  _drillPayloadDigest: string;     // hex(JCS-hash(payload)); enables
                                   // payload verification independent of
                                   // record envelope
  _drillSignature: string;         // signed by mesh drill signer (see
                                   // §5.9.2). Coverage rule: signature
                                   // is over JCS(record minus
                                   // _drillSignature) under the named
                                   // _drillSignatureSuite.
  _drillIssuedAt: number;
  _drillExpiresAt: number;         // bounded TTL; expired drill records
                                   // are GC-eligible
  _drillProfile: 'local_production_topology' | 'deployed_wss_topology' | 'e2e';
  payload: TPayload;
}
```

Signature verification rules:

- A drill reader MUST resolve `_drillSignerId` against the pinned drill
  signer set checked into `packages/e2e/fixtures/mesh-drill/`. An
  unrecognized signer id rejects the record with
  `mesh-drill-signer-unknown` (a new health reason; see §5.3).
- A drill reader MUST verify `_drillSignature` over JCS(record minus
  `_drillSignature`) under the suite named in `_drillSignatureSuite`. The
  only suite permitted in v0 is `jcs-ed25519-sha256-v1`; other suites
  reject with `mesh-drill-signature-suite-unsupported`.
- A drill reader MUST verify that `_drillPayloadDigest === hex(JCS-hash(
  payload))` and reject with `mesh-drill-payload-digest-mismatch`
  otherwise.
- All comparisons (signer id membership, digest equality, signature
  verification) MUST be constant-time per the discipline mirrored from
  `spec-luma-service-v0.md` §6.4.
- The drill `_drillAuthorScheme` namespace is `'mesh-drill-*'`. Drill
  schemes are NOT registered in LUMA's linkability-domain registry §9.3
  and MUST NOT collide with LUMA-side `_authorScheme` values (LUMA
  §15.1).

Namespace and visibility:

- Drill records MUST live under `vh/__mesh_drills/<run_id>/...`. No drill
  record may appear in `vh/forum/*`, `vh/aggregates/*`, `vh/news/*`,
  `vh/topics/*`, `vh/civic/*`, `vh/discovery/*`, or `vh/directory/*`.
- The mesh drill namespace is added to the data-topology spec's allowed
  public namespace list under the explicit profile-scoped rule (see
  `spec-data-topology-privacy-v0.md` §2 and §8).
- Product readers (`apps/web-pwa/src/store/{news,forum,topics,aggregates,
  directory,civic}/**`) MUST NOT subscribe to `vh/__mesh_drills/*` and MUST
  reject any drill record encountered through a product read path.
- Test-profile readers under `packages/e2e/src/mesh/**` MAY subscribe to
  `vh/__mesh_drills/*`.

Profile scope:

- Drill records are valid only in `local_production_topology` and `e2e` mesh
  profiles. `deployed_wss_topology` MAY accept drill records only when the
  LUMA profile is `dev` or `e2e`; production LUMA profiles MUST reject them
  at relay level via origin/authority rules.
- `_drillExpiresAt - _drillIssuedAt` MUST NOT exceed 7 days. Longer retention
  requires a documented retained-object reason in the readiness report's
  `cleanup.retained_objects` accounting and still cannot make drill data visible
  to product readers.
- Drill records carry their own `_drillExpiresAt`; relays running in
  `production-attestation` LUMA profile MUST refuse new drill writes
  regardless of namespace.

Production reader rejection:

- Any product reader that observes `_drillWriterKind` set on a record outside
  `vh/__mesh_drills/*` MUST reject the record and log
  `mesh-drill-record-out-of-namespace` (a new health reason; see §5.3).
- Any product reader that observes a record under `vh/__mesh_drills/*` MUST
  drop it without surfacing it to UI.

LUMA enum is not widened:

- `MeshDrillRecord._drillWriterKind` is intentionally a separate field from
  LUMA's `PublicProtocolFields._writerKind`. The LUMA enum
  (`'luma' | 'system' | 'legacy'`) is not extended by mesh.
- A drill record does not carry `_writerKind`. A LUMA-shaped record never
  carries `_drillWriterKind`. The two contracts are disjoint.

#### 5.9.1 Drill record cleanup

- Disposable drill data MUST be tombstoned or compacted by the run cleanup
  step under §5.2.
- Retained drill data MUST have a documented retention reason in the report,
  bounded by run count or TTL, and excluded from production product reads.
- A relay operator MAY compact `vh/__mesh_drills/*` at any time without
  notice; drill harnesses MUST treat drill artifacts as ephemeral.

#### 5.9.2 Drill signer key

- The mesh drill signer key is owned by the mesh harness and managed under
  `spec-signed-pin-custody-v0.md`.
- The drill signer key MUST NOT sign anything other than drill records under
  `vh/__mesh_drills/*`. Reuse for product writes, peer-config signing,
  verifier-manifest signing, or safety-bulletin signing is a hard topology
  violation.
- Drill signer key compromise is a P2 incident: rotate the key, invalidate
  past drill records via TTL, regenerate test fixtures. It is not a P0/P1
  because no product data is at risk.

### 5.10 State-Resolution Matrix

"Tombstone wins" is correct for some classes and wrong for others. Forum
moderation has hide/restore latest-state semantics; aggregate snapshots
have supersession by version window; news reports have monotonic status
transitions; aggregate voter nodes have last-write-wins on a deterministic
id. This matrix names the actual resolution rule for each class and is the
authority for §4 Slice 7C drill assertions and the `state_resolution_drills`
report rows in §4 Slice 11.

The `state_rule` column maps directly to the `state_resolution_drills.
state_rule` enum in the report schema; a class's drill row MUST use the
named rule.

| Write class | `state_rule` | Resolution semantics | Drill assertion |
|---|---|---|---|
| health probe | `tombstone-wins` | tombstone marker wins permanently | After relay restart or partition heal, the tombstone marker is observed on every relay; no resurrection of the original probe payload. |
| directory entry (LUMA) | `best-effort-tombstone` | best-effort tombstone (`spec-luma-service-v0.md` §13.2, §13.3) | After LUMA Reset Identity, the directory entry MAY take time to tombstone on every relay; mesh asserts no resurrection of the prior entry once the tombstone has propagated, but does not assert tombstone propagation latency stricter than the LUMA spec allows. |
| forum comment | `hide-restore-latest` | latest `comment_moderations/latest/<comment_id>/` record wins (`spec-hermes-forum-v0.md` §2.3.2) | After relay restart or partition heal, the latest moderation record wins. A `hidden` record continues to suppress original markdown and reply/vote controls; a later `restored` record re-renders the comment. No older moderation state wins via clock skew. |
| forum comment moderation record | `tombstone-wins` (within the moderation namespace) | latest moderation record per `(thread_id, comment_id)` is canonical | Latest moderation record observed on every relay after restart/heal; older moderation states never win. |
| forum thread | `no-deletion-historical-artifact` | no native deletion (`spec-luma-service-v0.md` §13.3) | Mesh asserts no resurrection of moderation records and no duplication of the thread head. Reset Identity does not delete prior threads. |
| aggregate snapshot | `monotonic-supersession-version` | supersession by `(synthesisId, epoch, source-window)` monotonicity | Newer snapshot wins. Stale recomputation cannot regress aggregate counts. Drill MUST inject a stale recomputation and assert the older value never overwrites the newer. |
| aggregate voter node | `last-write-wins-deterministic-id` | deterministic id per `(topic_id, synthesis_id, epoch, voterId, point_id)`; final stance overwrites prior | One final voter row per deterministic key. Toggling stance overwrites within the same key; it does not produce a tombstone. |
| story / synthesis publication | `monotonic-supersession-epoch` | supersession by `(topic_id, epoch, synthesis_id)` monotonicity | Newer epoch wins. No resurrection of an older synthesis after relay restart or partition heal. |
| news report record | `monotonic-status-transition` | append-only audit; status moves `pending → reviewed → actioned` | Status transitions are monotonic per `report_id`; no regression to an earlier status. |
| topic engagement summary | `monotonic-supersession-version` | supersession by latest actor contribution | Replayed actor update does not double-count. Summary does not regress below the latest actor state. |

A new health reason `state-resolution-violation` is reserved for the case
where a drill observes any of the above winning rules being broken. Adding
this reason follows §5.3. The drill row in `state_resolution_drills` MUST
populate `violation_reason` with a short string naming which rule was
broken (e.g. `'observed older snapshot version overwriting newer'`,
`'hidden comment re-rendered after relay restart'`,
`'directory entry resurrected past tombstone propagation'`).

The `state_resolution_drills` report rows (§4 Slice 11) are the canonical
machine record. Each row carries `expected_winner_write_id`,
`observed_winner_write_id`, `competing_write_ids`, the `state_rule` from
this matrix, and the `violation_reason` (null when `status === 'pass'`).

### 5.11 Protocol/Schema Reject Matrix

LUMA mandates `_protocolVersion` and `_writerKind` on every public schema
(`spec-luma-service-v0.md` §15). HERMES carries its own record-level
`schemaVersion` (e.g. `'hermes-thread-v0'`, `'hermes-comment-v1'`). Mesh
adapters need explicit behavior for every combination so quarantine is
deterministic.

| `_protocolVersion` | `schemaVersion` | `_authorScheme` | Reader behavior |
|---|---|---|---|
| known, ≤ reader max | known, supported | registered, supported | Accept. Validate envelope per `_writerKind` rule. |
| known, ≤ reader max | known, supported | registered, unsupported by adapter | Quarantine via per-scheme migration adapter. Do not surface to product UI. Emit `mesh-author-scheme-unsupported`. |
| known, ≤ reader max | unknown to reader | n/a | Quarantine via legacy/migration adapter for that record class. Emit `mesh-schema-version-unknown`. |
| > reader max (future) | * | * | Refuse. Emit `protocol_version_unsupported` (LUMA `PolicyReason`). Do not quarantine: a future-version record cannot be safely migrated by a stale reader. |
| missing `_protocolVersion` | * | * | Treat as `_writerKind === 'legacy'` and route through the migration adapter for that record type. Acceptance bounded by the four-layer migration model (`spec-data-topology-privacy-v0.md` §2; `spec-luma-service-v0.md` §15). |
| present | present | missing on a record class that requires it | Quarantine. Emit `mesh-author-scheme-missing`. |

Drill rules:

- Slice 6A drills cover the first three rows under `vh/__mesh_drills/*` with
  drill records (drill records use `_drillAuthorScheme`, not `_authorScheme`,
  so the LUMA-side rules apply only when LUMA-shaped fixtures are exercised
  post-M0.B).
- Slice 7+ drills MUST cover the future-version reject row by writing a
  fixture with `_protocolVersion` deliberately ahead of the reader's maximum.
- The legacy row is exercised by replaying a fixture from the existing
  `MESH_HARDENING_PR2_2026-05-02.md` corpus.

Reader-side reject reasons enumerate into the mesh report `health.degradation_
reasons_seen` so the readiness report shows which classes were exercised.

### 5.12 Clock Discipline Boundary

Two distinct clocks participate in mesh drills. They MUST stay distinct.

Layer-specific outcomes:

| Failure type | Clock surface | Expected outcome |
|---|---|---|
| LUMA session expiry | `Clock` interface (`spec-luma-service-v0.md` §12.2) | Session transitions to `degraded`; user re-attests. No mesh transport reason fires. |
| `SignedWriteEnvelope.issuedAt` skew vs server | `Clock` interface | Reader rejects with `assurance_degraded` or `signature_suite_unsupported` (LUMA `PolicyReason`). No mesh transport reason. |
| Relay user-signature timestamp window failure | OS-level clock on the relay or browser | Relay rejects with named auth failure; mesh maps to `clock-skew-detected` health reason. |
| Peer-handshake timestamp window failure | OS-level clock on participating relays | Peer-config rejected with auth failure; mesh maps to `clock-skew-detected`. |
| Signed peer-config validity window | OS-level clock on browser | Peer config rejected; browser fails closed in strict mode; mesh maps to `peer-quorum-missing` only if no valid peer config remains. |
| LWW divergence under skew | OS-level clock on writers | Drill MUST assert no LWW divergence on deterministic-id records (votes, comments, aggregate snapshots) and MUST classify any divergence as a regression, not as expected behavior. |

Drill harness rules:

- Session/envelope skew tests MUST use the LUMA injectable `Clock` and not
  mutate the OS clock. This makes the test reproducible and non-flaky on CI.
- Peer-config and relay-auth timestamp tests MUST use the real OS clock or a
  per-process clock-shim (no LUMA `Clock` indirection) because the validity
  check happens on the actual signature payload.
- The drill report records which clock layer was skewed (`clock_skew.skewed_
  layer`), not just which actor (`browser`/`relay`/`daemon`).
- A drill that conflates the two layers (e.g. drives session expiry by
  mutating the OS clock) is a test-quality regression and the drill report
  MUST mark the run `review_required`.

### 5.13 Coherence Report Fields

The mesh readiness report (§4 Slice 11) carries cross-spec coherence fields
in addition to the per-class SLO and drill fields. These fields are required
for any report that claims `release_ready`:

- `schema_epoch` — string label naming the LUMA schema epoch under which
  the run was generated. Allowed values: `'pre_luma_m0b'`, `'post_luma_m0b'`,
  or a future epoch tag agreed under the LUMA roadmap.
- `luma_profile` — `'public-beta' | 'production-attestation' | 'none'`.
  `'none'` is allowed only for `local_production_topology` runs that exercise
  no LUMA-gated write classes.
- `luma_dependency_status` — object naming the LUMA milestone state assumed
  by the run (e.g. `{ m0a: 'landed', m0b: 'landed', m0c: 'landed', m0d:
  'in-progress', m1a: 'pending' }`). The reader uses this to decide whether
  a green report is still claim-valid after subsequent LUMA work.
- `drill_writer_kind_by_class` — object mapping `write_class` to the writer
  contract used by the drill. Allowed values per class: `'mesh-drill'`
  (drill writer contract, §5.9), `'luma'` (real `SignedWriteEnvelope`),
  `'system'` (system-writer key, defined in `spec-data-topology-privacy-v0.
  md` §8).
- `release_claims.invalidated_by_luma_epoch_change` — boolean. Set true by
  the report consumer when the report's `schema_epoch` is older than the
  current LUMA epoch.

Schema additions to `MeshProductionReadinessReport` are listed in §4 Slice
11.

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
- `pnpm test:mesh:state-resolution-drills`
  - `pnpm test:mesh:tombstone-drills` may remain as a compatibility alias, but
    the canonical command covers every §5.10 state-resolution rule, not only
    tombstones.
- `pnpm test:mesh:clock-skew-drills`
- `pnpm test:mesh:conflict-drills`
- `pnpm test:mesh:partition-drills`
- `pnpm test:mesh:soak`
- `pnpm check:mesh:production-readiness`
- `pnpm check:production-app-canary`
- `pnpm check:mesh-evidence-scrub` (gates promotion of `.tmp` packets to
  `docs/reports/evidence/`; see §5.7.1)

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

Allowed after Slice 6A and Slice 7A pass (under `schema_epoch:
pre_luma_m0b`):

- "The mesh has a local production-shaped three-relay topology harness with
  signed peer config and a passing one-peer-kill quorum write/readback drill,
  exercised against synthetic drill records under `vh/__mesh_drills/*` (mesh
  drill test writer contract, §5.9)."
- "Relay fan-out remains a time-boxed proof path; the architecture commitment is
  still pending restarted-relay readback and state-resolution evidence."
- "Mesh transport behavior for LUMA-gated write classes is not yet claimed;
  canonical drills require the LUMA M0.B schema epoch to land first."

Still not allowed after Slice 6A and Slice 7A:

- "Restarted peers catch up automatically."
- "State-resolution rules survive relay restart or partition heal."
- "The production WSS topology is deployed."
- "The mesh has production-ready multi-relay failover."
- "The app is ready for a test group."

Allowed after Slices 6B through 12 pass (under `schema_epoch:
post_luma_m0b` with all LUMA-gated write classes drilled through the LUMA
reader path):

- "The mesh has a production WSS three-relay topology with signed peer config,
  authenticated relay fallbacks, named health degradation, peer-failure and
  partition drills, websocket duplicate-write drills, and a passing 30-minute
  rolling restart soak."
- "LUMA-gated write classes (forum thread/comment, vote/aggregate, directory
  publish, news report) have transport readiness under the current LUMA
  schema epoch."

Still not allowed after mesh readiness alone:

- "The full app is test-group ready."
- "LUMA gate behavior is verified by mesh." (LUMA gate verification is owned
  by the LUMA acceptance tests and `pnpm check:luma-production-profile`.)
- "Mesh readiness from a prior LUMA schema epoch covers the current epoch."
  (See §5.8 schema-epoch invalidation.)

The full-app test-group claim requires the downstream production-app canary
after `pnpm check:mesh:production-readiness`. The canary asserts LUMA profile
match and LUMA profile gates per §5.8.

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
2. Add relay-to-relay auth for the harness and a negative unauthorized-peer
   test.
3. Add signed peer-config generation and verification for that harness,
   including `configId`, `issuedAt`, and `expiresAt`.
4. Add `run_id`, `write_id`, and `trace_id` propagation in the drill harness
   and report skeleton.
5. Write all drill data under `vh/__mesh_drills/<run_id>/...` using the mesh
   drill test writer contract (§5.9). Drill records carry
   `_drillWriterKind: 'mesh-drill'` and `_drillSignature` only; they do not
   carry LUMA `_writerKind` or `SignedWriteEnvelope`.
6. Add cleanup accounting for the drill namespace (§5.9.1).
7. Add `pnpm test:mesh:topology-drills`.
8. Prove one-peer-kill write/readback behavior through the remaining quorum.
9. Record direct per-relay readback evidence, even if restarted-peer catch-up is
   not claimed yet.
10. Stub the state-resolution, clock-skew, and LUMA-gated-write report sections
    as `skipped` with explicit reasons until Slice 7C/Slice 9 and LUMA M0.B
    implement them; do not allow those skipped sections to produce
    `release_ready`.
11. Set `schema_epoch: 'pre_luma_m0b'`, `luma_profile: 'none'`, and record
    `luma_dependency_status` reflecting the actual LUMA milestone state at
    the time of the run (§5.13).
12. Record the result in a new ops runbook and readiness report skeleton.

This is the narrowest next step because it tests the only major unproven claim
left after PR #564: real distributed topology behavior beyond the local
three-peer preview canary. Do not start with a cloud WSS deployment until the
local harness produces the first report packet; otherwise the team will be
debugging deployment, signing, topology, and convergence at the same time.
