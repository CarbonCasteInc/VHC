# Mesh Hardening PR2 Review Ledger

Date: 2026-05-02
Branch: `coord/mesh-durable-write-contract-pr2`
Base: merged `main` after PR #560 (`17dcbb04`)

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

Status: Done locally on `coord/mesh-durable-write-contract-pr2`; ready for PR/CI.

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

Queue next.

Scope:
- Enable daemon `gunRadisk: true` with a per-process journal path.
- Split daemon write lanes by class with bounded concurrency.
- Persist enrichment queue state and DLQ displaced candidates instead of dropping on overflow.
- Replay queue, DLQ, and accepted-but-unwritten work on restart.
- Surface queue depth and DLQ counts through daemon health.

Acceptance target:
- `kill -9` mid-synthesis does not lose accepted work; restart replays to terminal state.

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
