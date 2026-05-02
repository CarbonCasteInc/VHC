# Mesh Hardening PR2 Review Ledger

Date: 2026-05-02
Branch: `coord/mesh-daemon-durability-pr3`
Base: merged `main` after PR #561 (`77567bed`)

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

Known unrelated test debt:
- `pnpm --filter @vh/web-pwa typecheck:test` still fails on broad pre-existing fixture strictness issues across bridge/feed/forum/discovery tests. The production web typecheck and focused tests affected by this PR are green.

## Queued

### PR3 — Daemon-Side Hardening

Status: Done locally on `coord/mesh-daemon-durability-pr3`; ready for PR/CI.

Verified implementation:
- Daemon `createNodeMeshClient` now defaults to `gunRadisk: true` with a deterministic per-daemon journal path from `VH_NEWS_DAEMON_GUN_FILE`, `VH_NEWS_DAEMON_STATE_DIR`, `VH_DAEMON_FEED_ARTIFACT_ROOT`, or `/tmp/vh-news-daemon/node-mesh-radisk/...`; hermetic tests can disable it with `VH_NEWS_DAEMON_GUN_RADISK=false`.
- Added named bounded daemon write lanes with structured `enqueued`, `started`, `completed`, and `failed` events plus rolling p95 latency. Runtime bundle, stale-bundle removal, storyline, stale-storyline removal, lease, and bundle-synthesis candidate/epoch/latest writes now flow through lanes.
- Enrichment queue state is persisted to `pending.json`; in-flight candidates remain in that replay file until worker completion, so `kill -9` mid-synthesis does not remove the candidate from durable replay state.
- Queue overflow candidates are written to `dead-letter.jsonl` with reason `queue_full`, then replayed into pending on restart. Terminal worker failures are also dead-lettered with reason `worker_failed`.
- The bundle-synthesis queue persists by default under `VH_BUNDLE_SYNTHESIS_QUEUE_DIR`, or under the daemon artifact/state root when explicit queue dir is absent.
- Accepted analysis eval artifacts can replay once after daemon leadership is acquired, republishing the latest accepted synthesis per topic through the write-lane telemetry path.
- Daemon handle now exposes `enrichmentQueueStats()`, `enrichmentQueueDeadLetterCount()`, and `writeLaneStats()` for local health/inspection surfaces.

Verification evidence:
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

Remaining PR3 packaging work:
- Run broad workspace gates and CI.
- Open PR, merge on green, and refresh local `main`.

### PR4 — Production Relay

Queue after PR3.

Scope:
- Add `/healthz`, `/readyz`, and `/metrics`.
- Auth-gate graph-injection HTTP endpoints.
- Split user-callable signed endpoints from daemon-only bearer-auth endpoints.
- Add WS rate limits, body size caps, per-client backpressure, origin allowlist, and structured drop reasons.
- Add compaction strategy for utility namespaces.

Acceptance target:
- Auth failures are rejected, noisy peers are dropped with structured reasons, and metrics expose write/ack/drop/radata signals.

### PR5 — Topology And Quorum

Queue after PR4.

Scope:
- Three-peer WSS topology.
- Signed peer config fetched at boot.
- Remove hardcoded Tailscale fallback from production code paths.
- Strip or reject runtime peer mutation in production builds.
- Health reports quorum, not configured peer count.
- Add failover, network partition, WS reconnect, and soak drills.

Acceptance target:
- One-peer kill and restart drill converges within SLA with no duplicate writes.
