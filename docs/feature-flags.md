# Feature Flags (Season 0)

This document defines compile-time flags used by the web PWA for FPD rollout.

## Critical note

`VITE_*` variables are compile-time values. They are baked into the bundle at build time and cannot be changed dynamically at runtime.

## Flags

- **`VITE_CONSTITUENCY_PROOF_REAL`**
  - **Default:** `false`
  - **Description:** Enables strict production proof validation policy.
    - `false`: non-production tolerance (still uses real attestation-bound proof generation)
    - `true`: strict production mode (configured district enforcement + production guard)
  - **Production requirement:** `true`

- **`VITE_E2E_MODE`**
  - **Default:** `false`
  - **Description:** Enables E2E-mode stores/wiring used for deterministic browser tests.
  - **Production requirement:** `false`
  - **Note:** E2E mode is test-only and must never ship in production artifacts.

- **`VITE_DEFAULT_DISTRICT_HASH`**
  - **Default:** empty
  - **Description:** District hash used by proof verification in strict mode.
  - **Production requirement:** must be explicitly configured to the deployment district value.

- **`VITE_VH_ANALYSIS_PIPELINE`**
  - **Default:** `false`
  - **Description:** Enables analysis pipeline generation/consumption paths.
  - **Runtime dependency:** requires managed analysis backend on `:3001` (see `docs/ops/analysis-backend-3001.md`).
  - **Health contract:** `http://127.0.0.1:3001/api/analysis/health?pipeline=true` must return 200 before pipeline-mode canary/prod checks.
  - **Production requirement:** set per release plan; leave `false` until rollout gate approval.

- **`VITE_VH_ANALYSIS_DAILY_LIMIT`**
  - **Default:** `20`
  - **Description:** Daily analysis generation cap (`0` means unlimited).
  - **Production requirement:** non-zero finite limit unless explicit exception approved.

- **`VITE_VH_BIAS_TABLE_V2`**
  - **Default:** `false`
  - **Description:** Enables Bias Table v2 UX behavior.
  - **Production requirement:** set per rollout decision.

## Deployment guardrails

1. Production builds must enforce `VITE_CONSTITUENCY_PROOF_REAL=true`.
2. E2E-mode (`VITE_E2E_MODE=true`) is test-only and cannot ship.
3. Any flag change requires a new build artifact because flags are compile-time constants.
