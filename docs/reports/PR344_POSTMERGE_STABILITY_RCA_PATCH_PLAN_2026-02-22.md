# PR344 Post-Merge Stability RCA + Patch Plan (Residual Strict Flake)

Date: 2026-02-22 (UTC)
Owner: coordinator
Context: PR #344 merged (`15d1af6365973f90a8ed9e40d689b1da34695826`), single strict confirmation passed, but consecutive strict runs regressed.

## Problem Statement

Residual strict convergence flake persists after PR #344 hardening:
- Failure signature repeats as `b-aggregate-remained-zero`
- Failure shape remains A-side vote observed while B-side aggregate stays `+0/-0` after reload

This means the hotfix improved observability and reduced failure frequency, but did not eliminate the edge path.

## Evidence Snapshot (3 consecutive strict runs)

Run config:
- `VH_RUN_LIVE_MATRIX=true`
- `VH_LIVE_MATRIX_REQUIRE_FULL=true`
- `playwright test --config=playwright.live.config.ts src/live/bias-vote-convergence.live.spec.ts --reporter=json`

Outcomes:
1. Run 1: **FAIL** (7/8), reason `b-aggregate-remained-zero`
2. Run 2: **PASS** (8/8)
3. Run 3: **FAIL** (7/8), reason `b-aggregate-remained-zero`

Verdict:
- strict stability achieved: **NO**
- pass/fail tally: **1 pass / 2 fail**

Artifacts:
- `/tmp/pr344_stability_run1.json`
- `/tmp/pr344_stability_run2.json`
- `/tmp/pr344_stability_run3.json`
- `/tmp/pr344_stability_run1_summary.json`
- `/tmp/pr344_stability_run2_summary.json`
- `/tmp/pr344_stability_run3_summary.json`
- `/tmp/pr344_stability_runs_summary.json`

## RCA (Current Confidence)

### High-confidence
1. The failure remains in the same convergence class as pre-PR344 post-merge strict failure.
2. It is intermittent under repeated live pressure (not a deterministic per-row hard break).
3. Observability added in PR344 confirms writes/readbacks can occur while B still resolves zero aggregate.

### Working hypothesis (needs targeted instrumentation)
- A residual namespace/visibility race still exists in a narrow timing window where B-side aggregate resolution path can settle on an empty view despite A-side write path and readback signals being present.
- Current fallback+retry strategy mitigates many but not all timing permutations.

## Follow-up Hotfix Track (Immediate)

Branch: `coord/postmerge-convergence-stability-gate`

### Land now (deterministic release gate)
- Add multi-run strict stability gate runner:
  - `packages/e2e/src/live/live-matrix-stability-gate.mjs`
  - Script: `pnpm --filter @vh/e2e test:live:matrix:strict:stability`
- Default behavior: run **N consecutive strict live matrix passes** (`N=3`) and fail unless all pass.
- Emit machine-readable packet with per-run status, first-failure detail, and telemetry counts.

### Patch plan (next code lane)
1. **Convergence-path hardening (read semantics)**
   - Ensure B read path deterministically resolves canonical + fallback point-id views before declaring zero.
   - Add explicit "zero after dual-path settle" diagnostic event to separate true zeros from unresolved visibility windows.
2. **Temporal hardening (bounded settle window)**
   - Introduce small post-write convergence settle phase on B observer path prior to final zero verdict.
   - Preserve strict semantics (no silent success) while preventing premature zero finalization.
3. **Regression coverage expansion**
   - Add deterministic test matrix for delayed propagation + namespace split simulation.
   - Keep per-file 100/100 diff coverage on changed source files.

## Acceptance Criteria for "Fully Stable"

1. `pnpm --filter @vh/e2e test:live:matrix:strict:stability` with default `N=3` passes cleanly (3/3 strict).
2. No `b-aggregate-remained-zero` in stability packet.
3. Smoke checks all green after deploy:
   - `/` = 200
   - `/gun` = 200
   - `/api/analysis/health?pipeline=true` = 200
4. Stability packet posted on follow-up PR with artifact paths.

## Operational Decision

Do not declare full stability on single-run strict passes. Require deterministic multi-run strict gate pass before final closeout.
