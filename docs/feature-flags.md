# Feature Flags (Season 0)

This document defines compile-time flags used by the web PWA for FPD rollout.

## Critical note

`VITE_*` variables are compile-time values. They are baked into the bundle at build time and cannot be changed dynamically at runtime.

## Flags

- **`VITE_CONSTITUENCY_PROOF_REAL`**
  - **Default:** `false`
  - **Description:** Enables strict production proof validation policy.
    - `false`: non-production tolerance (still uses attestation-bound deterministic beta-local proof generation)
    - `true`: strict production mode (configured district enforcement + production guard)
  - **Important:** this flag tightens client-side validation policy; it does
    not by itself replace the current deterministic proof provider with
    cryptographic residency proof acquisition.
  - **Production requirement:** `true`
  - **MVP beta note:** A Web PWA beta may run with `false` only if product copy
    explicitly uses beta-local identity/proof language and avoids verified-human,
    one-human-one-vote, district-proof, and Sybil-resistance claims.
  - **Runtime copy contract:** stance UI must follow `useConstituencyProof()`
    assurance metadata. Current accepted proofs are `beta_local`; this supports
    point-level stance persistence but not production proof claims.

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

- **BiasTable v2 voting path**
  - **Status:** always-on in production wiring.
  - **Control model:** no runtime/compile-time feature flag; card-back voting uses BiasTable v2 unconditionally.

## Mesh peer-config flags

- **`VITE_VH_STRICT_PEER_CONFIG`**
  - **Default:** production builds default to strict; non-production may opt in.
  - **Description:** Requires explicit Gun peers or a verified signed peer-config
    source. In strict mode, invalid peer config fails closed before accepting
    peer sockets.
  - **Production requirement:** `true`

- **`VITE_GUN_PEER_CONFIG_URL`**
  - **Default:** empty
  - **Description:** HTTPS URL for the signed mesh peer-config payload.
  - **Production requirement:** set to the deployed peer-config origin.

- **`VITE_GUN_PEER_CONFIG_PUBLIC_KEY`**
  - **Default:** empty
  - **Description:** Trusted public key used to verify signed peer-config
    payloads.
  - **Production requirement:** set. Rotation requires a new app build or a
    future trusted runtime key-distribution path.

- **`VITE_GUN_PEER_MINIMUM` / `VITE_GUN_PEER_QUORUM_REQUIRED`**
  - **Default:** strict mode expects three peers and quorum two.
  - **Description:** Browser topology floors. Signed strict configs must include
    `minimumPeerCount` and `quorumRequired`, and `quorumRequired` cannot exceed
    the signed peer count.

- **`VITE_VH_ALLOW_LOCAL_MESH_PEERS`**
  - **Default:** `false`
  - **Description:** Allows local `http://`, `ws://`, loopback peer URLs only for
    local harnesses.
  - **Production requirement:** `false`

- **`VITE_VH_CSP_CONNECT_SRC` / `VITE_VH_CSP_STRICT_CONNECT_SRC`**
  - **Default:** environment-specific
  - **Description:** Adds the peer-config and WSS relay origins to CSP
    `connect-src`; strict mode rejects broad wildcard/path/malformed extra
    sources in the mesh canary.
  - **Production requirement:** exact expected HTTPS/WSS origins only.

## Deployment guardrails

1. Production builds must enforce `VITE_CONSTITUENCY_PROOF_REAL=true`.
   Public beta builds that intentionally keep this flag `false` are not
   production-proof builds and must be labeled/copy-reviewed accordingly.
   A production-proof launch also requires a real cryptographic proof provider;
   the flag alone is not sufficient evidence of residency proof or Sybil
   resistance.
2. E2E-mode (`VITE_E2E_MODE=true`) is test-only and cannot ship.
3. Any flag change requires a new build artifact because flags are compile-time constants.
4. Mesh peer-config key, URL, local-peer allowance, quorum, or CSP changes require
   a new Web PWA build and a rerun of `pnpm test:mesh:peer-config-rollback-drill`
   plus `pnpm check:mesh:production-readiness`.
