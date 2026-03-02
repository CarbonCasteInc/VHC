# Beta Wiring Implementation Plan

## Context

PR #345 merged the two-phase readiness gate. The run sheet (`docs/ops/BETA_SESSION_RUNSHEET.md`) defines the operational contract. This plan covers the **code work** needed before the first dev session.

## Work Items

### 1. Health Monitor Hook + Dev Overlay

**Why:** No Gun connectivity or mesh health monitoring exists anywhere in the client. The `VennClient` (`packages/gun-client/src/types.ts:25`) wraps Gun with no connection event hooks. Telemetry is console.info only (`apps/web-pwa/src/utils/sentimentTelemetry.ts`).

**What to build:**

Create `apps/web-pwa/src/hooks/useHealthMonitor.ts`:
- Zustand store tracking:
  - `gunPeerState`: 'connected' | 'degraded' | 'disconnected' (probe Gun peer with periodic put/ack roundtrip, timeout = 3s)
  - `meshWriteAckRate`: rolling 60s window of write-ack success/timeout ratio from `logMeshWriteResult` events
  - `analysisRelayAvailable`: boolean from periodic GET to `/api/analyze/config` (every 30s)
  - `lastHealthCheck`: ISO timestamp
  - `degradationMode`: 'none' | 'mesh-degraded' | 'relay-unavailable' | 'disconnected'

Create `apps/web-pwa/src/components/dev/HealthIndicator.tsx`:
- Renders a small colored dot in the corner (green/yellow/red) gated on `import.meta.env.DEV || import.meta.env.VITE_VH_SHOW_HEALTH === 'true'`
- Expandable on click: shows gunPeerState, meshWriteAckRate, analysisRelayAvailable, degradationMode
- Uses the health store, no new Gun calls — just reads from the store

Wire into `apps/web-pwa/src/App.tsx` or root layout alongside existing `DevModelPicker`.

**Files touched:**
- New: `apps/web-pwa/src/hooks/useHealthMonitor.ts`
- New: `apps/web-pwa/src/components/dev/HealthIndicator.tsx`
- Edit: root layout/App to mount `HealthIndicator`
- Edit: `apps/web-pwa/src/utils/sentimentTelemetry.ts` — add event bus so health monitor can subscribe to write results without console parsing

**Tests:**
- Unit test for health store state transitions
- Unit test for rolling window rate calculation

---

### 2. Convergence Lag Measurement

**Why:** SLO is A->B p95 < 5s but there's no instrumentation to measure it outside the E2E harness.

**What to build:**

Extend `sentimentTelemetry.ts` with a new event:
```typescript
export function logConvergenceObserved(params: {
  topic_id: string;
  point_id: string;
  voter_id: string;
  observed_by: string;
  write_at: number;    // when A voted
  observed_at: number; // when B saw it
  lag_ms: number;
}): void
```

In `usePointAggregate.ts`, when aggregate transitions from 0 to >0 for a point after a known write, emit this event with timing.

In `useHealthMonitor.ts`, track convergence lag as a rolling p95 over the last 20 observations.

**Files touched:**
- Edit: `apps/web-pwa/src/utils/sentimentTelemetry.ts`
- Edit: `apps/web-pwa/src/hooks/usePointAggregate.ts`
- Edit: `apps/web-pwa/src/hooks/useHealthMonitor.ts`

---

### 3. Vote Mutation E2E Validation

**Why:** `resolveNextAgreement` (`voteSemantics.ts:19`) handles toggle logic but there's no E2E coverage for mutation transitions against live mesh state.

**What to build:**

Add a focused vote-mutation spec: `packages/e2e/src/live/vote-mutation.live.spec.ts`

Test matrix (single user, single topic):
| Transition | Action | Expected aggregate change |
|------------|--------|--------------------------|
| 0 -> +1 | click agree | agree increments |
| +1 -> 0 | click agree again (toggle off) | agree decrements |
| 0 -> -1 | click disagree | disagree increments |
| -1 -> 0 | click disagree again | disagree decrements |
| +1 -> -1 | click disagree (switch) | agree decrements, disagree increments |
| -1 -> +1 | click agree (switch) | disagree decrements, agree increments |

Verify after each transition that:
- Local user's displayed vote state matches expected
- Aggregate counts are correct
- State survives page reload

Gated on `VH_RUN_LIVE_MATRIX=true` like the convergence spec.

**Files touched:**
- New: `packages/e2e/src/live/vote-mutation.live.spec.ts`

---

### 4. Three-User Convergence Spec

**Why:** Current E2E only validates A->B (2 users). Beta day 1 has 3 testers. Need to certify N>2 aggregate correctness.

**What to build:**

Add `packages/e2e/src/live/three-user-convergence.live.spec.ts`:
- Three browser contexts (A, B, C), each with distinct identity
- One topic, one point
- A votes +1, verify B and C see agree=1
- B votes +1, verify A and C see agree=2
- C votes -1, verify A and B see agree=2, disagree=1
- A changes vote to -1 (mutation), verify B and C see agree=1, disagree=2
- All three reload, verify state persists

Uses same helpers as bias-vote-convergence spec (gotoFeed, openTopic, resolvePointInCard, readCounts, ensureIdentity).

Extract shared helpers into `packages/e2e/src/live/helpers.ts` to avoid duplication.

**Files touched:**
- New: `packages/e2e/src/live/helpers.ts` (extracted from bias-vote-convergence.live.spec.ts)
- New: `packages/e2e/src/live/three-user-convergence.live.spec.ts`
- Edit: `packages/e2e/src/live/bias-vote-convergence.live.spec.ts` (import from helpers)

---

### 5. Runtime Profile Env Files

**Why:** Run sheet defines `dev-small` and `beta-scale` profiles but they're not codified as committable env files.

**What to build:**

Create dotenv profile files in `packages/e2e/`:
- `packages/e2e/.env.dev-small`:
  ```
  VITE_ANALYSIS_MODEL=gpt-5-nano
  VH_LIVE_MATRIX_TOPICS=3
  VH_LIVE_MATRIX_STABILITY_RUNS=3
  ANALYSIS_RELAY_BUDGET_ANALYSES=120
  ANALYSIS_RELAY_BUDGET_ANALYSES_PER_TOPIC=20
  ```
- `packages/e2e/.env.beta-scale`:
  ```
  VITE_ANALYSIS_MODEL=gpt-5-nano
  VH_LIVE_MATRIX_TOPICS=8
  VH_LIVE_MATRIX_STABILITY_RUNS=3
  ANALYSIS_RELAY_BUDGET_ANALYSES=600
  ANALYSIS_RELAY_BUDGET_ANALYSES_PER_TOPIC=20
  ```

Add npm scripts to `packages/e2e/package.json`:
- `test:live:matrix:strict:stability:dev-small` — loads `.env.dev-small` then runs stability gate
- `test:live:matrix:strict:stability:beta-scale` — loads `.env.beta-scale` then runs stability gate

**Files touched:**
- New: `packages/e2e/.env.dev-small`
- New: `packages/e2e/.env.beta-scale`
- Edit: `packages/e2e/package.json`

---

## Ordering

1. **Health monitor + overlay** (item 1) — enables mid-session monitoring, blocks nothing
2. **Convergence lag measurement** (item 2) — depends on health monitor store
3. **Vote mutation spec** (item 3) — independent, can parallel with 1-2
4. **Three-user convergence spec** (item 4) — independent, can parallel with 1-2
5. **Runtime profile env files** (item 5) — independent, do first or last

Items 1+2 are the critical path. Items 3+4 can be built in parallel. Item 5 is quick config.

## Not in scope

- Analysis pipeline precomputation (background job queue) — production optimization, not beta blocker
- Identity recovery/migration — documented as limitation in beta policy
- Feed staleness/TTL — not a blocker for controlled beta sessions
- Server-side aggregate materialization — client-side LWW is sufficient for beta scale
