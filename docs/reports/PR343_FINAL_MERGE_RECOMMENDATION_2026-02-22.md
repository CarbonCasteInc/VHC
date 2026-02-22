# PR #343 Final Merge Recommendation (2026-02-22)

PR: https://github.com/CarbonCasteInc/VHC/pull/343  
Branch: `coord/bias-vote-context-fallback`  
Head: `58c5e9f04057afb46504378e92078b3bb8421d14`

## Executive verdict

**Recommendation: MERGE NOW** ✅

Rationale:
1. CI checks on PR #343 are green and merge state is clean.
2. Fresh live A→B convergence matrix on target (`https://ccibootstrap.tail6cc9b5.ts.net`) passed **8/8**.
3. Aggregate reads on B are non-zero and consistent with A-side vote submissions for all sampled rows.

## Evidence snapshot

### CI
- Ownership Scope: pass
- Change Detection: pass
- Quality Guard: pass
- Test & Build: pass
- E2E Tests: pass
- Bundle Size: pass
- Lighthouse: pass

### Live convergence rerun (2026-02-22 19:37 UTC)
- Base URL: `https://ccibootstrap.tail6cc9b5.ts.net/`
- Tested rows: 8
- Converged: 8
- Failed: 0
- Artifact log: `/tmp/vhc_live_ab_matrix.log`
- PR comment packet: https://github.com/CarbonCasteInc/VHC/pull/343#issuecomment-3941588536

### Telemetry tag counts from run packet
- `[vh:aggregate:voter-write]`: 19
- `[vh:vote:voter-node-readback]`: 0
- `[vh:aggregate:point-snapshot-write]`: 7
- `[vh:aggregate:read]`: 64
- `[vh:vote:intent-replay]`: 9

## Why `[vh:vote:voter-node-readback]` is silent even when convergence succeeds

Root cause is control-flow, not missing writes:

1. `writeVoterNode(...)` now throws when ack times out (`aggregate-put-ack-timeout`) after logging `[vh:aggregate:voter-write]` warning.  
   - File: `packages/gun-client/src/aggregateAdapters.ts` (throw path at `writeVoterNode`, lines ~520-551).
2. In `projectSignalToMesh(...)`, `readAggregateVoterNode(...)` and the `[vh:vote:voter-node-readback]` log happen **only after** `await writeVoterNode(...)` resolves successfully.  
   - File: `apps/web-pwa/src/hooks/useSentimentState.ts` (readback block lines ~300-331).
3. Therefore, if `writeVoterNode(...)` throws on timeout, execution jumps to outer catch in `projectSignalToMesh(...)` and readback code is never reached, producing zero readback events.

This exactly matches observed telemetry: many voter-write timeout warnings + zero readback logs + successful aggregate convergence via fan-in/snapshot path.

## Risk and follow-up

Residual risk is **observability clarity**, not convergence correctness in this run.

Recommended follow-up (post-merge, narrow scope):
1. Emit explicit `readback_skipped_due_to_write_error` telemetry when `writeVoterNode` throws.
2. Optionally attempt best-effort readback in catch for diagnostic visibility while still preserving strict write failure semantics.

## Additional action completed in this turn

Added a checked-in live regression spec (opt-in) so this matrix can be replayed consistently:
- `packages/e2e/src/live/bias-vote-convergence.live.spec.ts`
- `packages/e2e/playwright.live.config.ts`
- script: `pnpm --filter @vh/e2e test:live:matrix`

The live test is gated by env (`VH_RUN_LIVE_MATRIX=true`) to avoid accidental CI dependence on external live infrastructure.
