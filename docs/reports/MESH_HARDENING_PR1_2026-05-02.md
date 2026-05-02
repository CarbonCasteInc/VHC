# Mesh Hardening PR 1 Evidence

Date: 2026-05-02
Branch: `codex/mesh-diagnostic-hardening-pr1`

## Completed

- Fixed guarded Gun write ack timing so adapter ack budgets start after the physical `put(...)` is invoked, not while `waitForRemote(...)` is still pending.
- Bootstrapped the health monitor from app startup and made the health state truthful:
  - no vacuous `100%` write-ack rate before enough samples exist;
  - named degradation reasons;
  - deterministic health probe key;
  - write-plus-readback probe;
  - message-rate degradation signal;
  - local-storage hydration and client-update signals.
- Reduced mesh fan-out:
  - news hydration now follows bounded latest/hot indexes instead of subscribing to all stories and storylines;
  - forum root hydration follows the date index, while comment-thread subscriptions are LRU-capped and guarded against late Gun callbacks;
  - synthesis hydration is explicitly releasable, LRU-capped, and guarded against late callbacks.
- Added a build-preview mesh canary that starts a local relay, serves the built app, verifies browser write/readback through a separate Gun client, validates subscription disposal behavior, checks idle message rate, and verifies reconnect convergence.
- Added a one-time operator script for compacting historical leaked health probe keys.
- Added a service-worker update signal path so the app can surface `client-out-of-date`.

## Verified

- `pnpm test:mesh:browser-canary`
- `pnpm --filter @vh/gun-client test`
- `pnpm --filter @vh/web-pwa typecheck`
- `pnpm --filter @vh/e2e typecheck`
- `pnpm exec vitest run apps/web-pwa/src/hooks/useHealthMonitor.test.ts apps/web-pwa/src/components/dev/HealthIndicator.test.tsx apps/web-pwa/src/store/news/hydration.test.ts apps/web-pwa/src/store/news/hydration.storylines.test.ts apps/web-pwa/src/store/news/hydration.identity.test.ts apps/web-pwa/src/store/synthesis/hydration.test.ts apps/web-pwa/src/store/synthesis/index.test.ts apps/web-pwa/src/hooks/useSynthesis.test.ts apps/web-pwa/src/store/hermesForum.test.ts --reporter=dot`
- `git diff --check`

## Known Non-Blocking Baseline

- `pnpm --filter @vh/web-pwa typecheck:test` remains red on pre-existing app-wide test fixture strictness issues outside this slice. The touched files in this PR no longer contribute errors to that run.

## Queued Next

- PR 2: migrate remaining write classes to the durable write contract and generic intent queue shape.
- PR 3: daemon-side persisted queues, DLQ, replay, and per-class write lanes.
- PR 4: hardened relay auth, limits, metrics, and compaction.
- PR 5: three-peer topology, signed peer config, quorum health, and failover drills.
