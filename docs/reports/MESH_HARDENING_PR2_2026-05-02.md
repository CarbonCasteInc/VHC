# Mesh Hardening PR2 Review Ledger

Date: 2026-05-02
Branch: `coord/mesh-production-relay-pr4`
Base: merged `main` after PR #562 (`6a5bfe92`)

## Completed And Verified

### PR1 — Diagnostic Clarity And Bounded Pressure

Status: Done and merged.

Verified implementation:
- `createGuardedChain.put` no longer starts caller ack timers before the physical `node.put(...)`.
- Health monitoring starts from app bootstrap and reports named degradation reasons instead of vacuous green states.
- Health probe uses deterministic browser slots with write plus readback validation.
- News, forum, and synthesis hydration are bounded and expose teardown.
- Built-preview mesh canary exists and is outside the default E2E suite.
- Service worker has a build-version update path.

Verification evidence:
- PR #560 merged to `main`.
- GitHub checks were green before merge: Change Detection, Ownership Scope, Quality Guard, Source Health, StoryCluster Correctness, Test & Build, Bundle Size, Lighthouse, E2E Tests.
- Local post-merge `main` was clean at `17dcbb04`.

### PR2 — Durable Write Contract

Status: Done and merged.

Verified implementation:
- Added `packages/gun-client/src/durableWrite.ts` with bounded ack, timeout telemetry, readback confirmation after timeout, relay fallback, and terminal failure.
- Migrated previously best-effort or partially hardened write paths:
  - news stories, latest/hot indexes, ingestion leases
  - storylines
  - analysis latest pointer
  - topic engagement actor and summary
  - encrypted sentiment outbox
  - directory publish
  - synthesis latest pointer readback before relay fallback
  - news reports and status index
  - forum moderation writes
  - namespace initialization writes
- Added `apps/web-pwa/src/hooks/intentQueue.ts` and rewired `voteIntentQueue.ts` to use the generic safeStorage-backed intent queue.
- Preserved vote-intent API compatibility while making the generic queue reusable for the next migrated intent classes.

Verification evidence:
- PR #561 merged to `main`.
- `pnpm --filter @vh/gun-client test` — 29 files, 347 tests passed.
- `pnpm --filter @vh/gun-client typecheck` — passed.
- `pnpm exec vitest run apps/web-pwa/src/hooks/intentQueue.test.ts apps/web-pwa/src/hooks/voteIntentQueue.test.ts apps/web-pwa/src/hooks/useSentimentState.test.ts apps/web-pwa/src/hooks/voteIntentMaterializer.test.ts --reporter=dot` — 4 files, 114 tests passed.
- `pnpm --filter @vh/web-pwa typecheck` — passed.
- `pnpm --filter @vh/e2e typecheck` — passed.
- `pnpm typecheck` — passed across the workspace.
- `pnpm --filter @vh/news-aggregator test` — 32 files, 396 tests passed.
- `pnpm test:mesh:browser-canary` — built preview canary passed.
- `git diff --check` — passed.
- `node tools/scripts/check-diff-coverage.mjs` — 295 files, 4,293 tests passed; every changed source file reached 100% diff line and branch coverage.

### PR3 — Daemon-Side Hardening

Status: Done and merged.

Verified implementation:
- Daemon `createNodeMeshClient` now defaults to `gunRadisk: true` with a deterministic per-daemon journal path from `VH_NEWS_DAEMON_GUN_FILE`, `VH_NEWS_DAEMON_STATE_DIR`, `VH_DAEMON_FEED_ARTIFACT_ROOT`, or `/tmp/vh-news-daemon/node-mesh-radisk/...`; hermetic tests can disable it with `VH_NEWS_DAEMON_GUN_RADISK=false`.
- Added named bounded daemon write lanes with structured `enqueued`, `started`, `completed`, and `failed` events plus rolling p95 latency. Runtime bundle, stale-bundle removal, storyline, stale-storyline removal, lease, and bundle-synthesis candidate/epoch/latest writes now flow through lanes.
- Enrichment queue state is persisted to `pending.json`; in-flight candidates remain in that replay file until worker completion, so `kill -9` mid-synthesis does not remove the candidate from durable replay state.
- Queue overflow candidates are written to `dead-letter.jsonl` with reason `queue_full`, then replayed into pending on restart. Terminal worker failures are also dead-lettered with reason `worker_failed`.
- The bundle-synthesis queue persists by default under `VH_BUNDLE_SYNTHESIS_QUEUE_DIR`, or under the daemon artifact/state root when explicit queue dir is absent.
- Accepted analysis eval artifacts can replay once after daemon leadership is acquired, republishing the latest accepted synthesis per topic through the write-lane telemetry path.
- Daemon handle now exposes `enrichmentQueueStats()`, `enrichmentQueueDeadLetterCount()`, and `writeLaneStats()` for local health/inspection surfaces.

Verification evidence:
- PR #562 merged to `main` at `6a5bfe92`.
- GitHub checks were green before merge: Change Detection, Ownership Scope, Quality Guard, Source Health, StoryCluster Correctness, Test & Build, Bundle Size, Lighthouse, E2E Tests.
- `pnpm --filter @vh/news-aggregator exec vitest run src/daemonUtils.test.ts src/daemonWriteLane.test.ts src/analysisEvalReplay.test.ts src/bundleSynthesisDaemonConfig.test.ts src/bundleSynthesisWorker.test.ts src/daemon.test.ts src/daemon.env.test.ts src/daemon.production.test.ts src/daemon.storylines.test.ts --reporter=dot` — 9 files, 48 tests passed.
- `pnpm --filter @vh/news-aggregator typecheck` — passed.
- `pnpm --filter @vh/news-aggregator exec vitest run src/daemon.coverage.test.ts --reporter=dot` — 6 tests passed after updating the stopped-daemon expectation.
- `pnpm --filter @vh/news-aggregator exec vitest run src/sourceHealthReport.test.ts --reporter=dot` — 25 tests passed in isolation after an initial parallel timeout.
- `pnpm --filter @vh/news-aggregator test` — 34 files, 407 tests passed.
- `pnpm typecheck` — passed across the workspace.
- `pnpm lint` — passed across the workspace.
- `node tools/scripts/check-diff-coverage.mjs` — passed; the guard reported no coverage-eligible service files, so the daemon package tests above are the primary coverage evidence.
- `pnpm test:mesh:browser-canary` — built-preview mesh canary passed.
- `pnpm test:storycluster:correctness` — passed after fixing daemon radisk parent-directory creation for the daemon-first fixture lane.
- `git diff --check` — passed.

Acceptance target:
- `kill -9` mid-synthesis does not lose candidate work because the in-flight synthesis candidate remains in `pending.json` until worker completion.
- Accepted-but-unwritten syntheses can be replayed from eval artifacts after leadership acquisition.

Known unrelated test debt:
- `pnpm --filter @vh/web-pwa typecheck:test` still fails on broad pre-existing fixture strictness issues across bridge/feed/forum/discovery tests. The production web typecheck and focused tests affected by PR2 were green.

### PR4 — Production Relay

Status: Done and merged.

Verified implementation:
- Relay exposes `/healthz`, `/readyz`, and Prometheus-shaped `/metrics`.
- Graph-injection HTTP endpoints are auth-gated when `VH_RELAY_AUTH_REQUIRED=true` or `NODE_ENV=production`.
- User-callable fallback endpoints verify SEA device signatures with nonce/timestamp replay protection; daemon-only synthesis fallback requires a bearer token.
- Browser/forum and aggregate relay fallbacks attach user signatures when a device keypair is available; daemon synthesis fallback attaches `VH_RELAY_DAEMON_TOKEN`.
- Relay enforces origin allowlist, HTTP token-bucket rate limit, JSON body size cap, active connection cap, and byte-per-second socket drop handling with structured logs and counters.
- Docker relay profile now binds `GUN_HOST=0.0.0.0`, runs with `NODE_ENV=production`, requires daemon token and allowed origins, and enables health-probe namespace compaction.
- Built-preview mesh canary now asserts relay health, readiness, and metrics before exercising Gun write/readback and reconnect.
- Historical `vh/__health/__vh_health_probe_*` compaction can run at startup and on interval, with compaction counters in `/metrics`.

Verification evidence:
- PR #563 merged to `main` at `af2db9e0`.
- GitHub checks were green before merge: Change Detection, Ownership Scope, Quality Guard, Source Health, StoryCluster Correctness, Test & Build, Bundle Size, Lighthouse, E2E Tests.
- `pnpm --filter @vh/e2e exec vitest run src/live/relay-server.vitest.mjs --reporter=dot` — 5 tests passed.
- `pnpm exec vitest run apps/web-pwa/src/store/hermesForum.test.ts --config vitest.config.ts --reporter=dot` — 38 tests passed.
- `pnpm --filter @vh/gun-client test` — 29 files, 348 tests passed.
- `pnpm --filter @vh/gun-client typecheck` — passed.
- `pnpm --filter @vh/e2e typecheck` — passed.
- `pnpm --filter @vh/web-pwa typecheck` — passed.
- `pnpm typecheck` — passed across the workspace.
- `pnpm lint` — passed across the workspace.
- `pnpm test:mesh:browser-canary` — built-preview mesh canary passed.
- `VH_RELAY_DAEMON_TOKEN=dummy VH_RELAY_ALLOWED_ORIGINS=https://allowed.example docker compose -f infra/docker/docker-compose.yml config` — passed and rendered production relay env.
- `git diff --check` — passed.
- `node tools/scripts/check-diff-coverage.mjs` — passed; guard reported no coverage-eligible source files changed, so the targeted relay/gun-client/web/e2e tests above are the primary coverage evidence.

Acceptance target:
- Auth failures are rejected, signed user fallback writes and bearer-auth daemon writes are accepted, noisy peers are dropped with structured reasons, and metrics expose write/drop/radata/compaction signals.

### PR5 — Topology And Quorum

Status: Done locally on `coord/mesh-topology-quorum-pr5`; ready for PR/CI.

Verified implementation:
- Added `apps/web-pwa/src/store/peerConfig.ts` as the single peer-topology resolver.
- Removed the hard-coded Tailscale fallback from web runtime peer resolution.
- Strict production peer mode now requires explicit peer configuration, requires at least three peers by default, rejects insecure peers unless local mesh peers are explicitly allowed, and ignores the mutable `globalThis.__VH_GUN_PEERS__` escape hatch.
- Added signed peer-config support for inline or remote JSON envelopes, verified through Gun SEA against `VITE_GUN_PEER_CONFIG_PUBLIC_KEY`.
- Health monitoring now probes relay `/healthz` endpoints and reports `healthy/configured (need quorum)` instead of showing a vacuous peer URL count.
- Built-preview mesh canary now runs three local relays, asserts health/readiness/metrics, and includes a one-peer-unavailable write/readback drill.
- The root `pnpm test:mesh:browser-canary` command builds the app with an explicit three-peer local topology and local-peer permission for the production-preview artifact.

Verification evidence:
- `pnpm exec vitest run apps/web-pwa/src/store/peerConfig.test.ts apps/web-pwa/src/store/store.test.ts apps/web-pwa/src/hooks/useHealthMonitor.test.ts apps/web-pwa/src/components/dev/HealthIndicator.test.tsx --config vitest.config.ts --reporter=dot` — 4 files, 46 tests passed.
- `pnpm --filter @vh/e2e typecheck` — passed.
- `pnpm --filter @vh/web-pwa typecheck` — passed.
- `pnpm typecheck` — passed across the workspace.
- `pnpm lint` — passed across the workspace.
- `node tools/scripts/check-diff-coverage.mjs` — passed; guard reported no coverage-eligible source files changed, so focused peer-config/health/e2e tests are the primary source evidence.
- `git diff --check` — passed.
- `pnpm test:mesh:browser-canary` — passed against three built-preview relays with one-peer-unavailable drill.

Acceptance target:
- One-peer-unavailable write/readback drill converges within SLA; full peer kill/restart and network-partition drills remain queued for the production relay/topology environment where relay-to-relay persistence is available.

## Queued

### Production Topology Drills

Scope:
- Deploy three WSS relays with signed boot peer config.
- Add peer kill/restart and network-partition drills against the hardened production relay environment.
- Add 30-minute rolling-restart soak with no duplicate writes after forced WS reconnect.

Acceptance target:
- Kill one peer, write still confirms; restart peer catches up within SLA; forced WS disconnect does not duplicate user writes.
