# LUMA Verifier Current State

> Status: Operational Current-State Record
> Owner: VHC LUMA Ops
> Last Reviewed: 2026-05-04
> Depends On: docs/specs/spec-luma-service-v0.md, docs/plans/LUMA_SERVICE_V0_ROADMAP_2026-05-02.md, docs/specs/spec-identity-trust-constituency.md, docs/specs/spec-data-topology-privacy-v0.md, docs/specs/spec-signed-pin-custody-v0.md, services/luma-verifier-dev/src/main.rs, apps/web-pwa/src/hooks/useIdentity.ts, packages/gun-client/src/auth.ts, packages/types/src/attestation.ts, packages/types/src/session.ts, infra/docker/docker-compose.yml, infra/docker/traefik-dynamic.yml

Version: 0.1
Scope: M0.E current-state record for the DEV verifier. This document does not
authorize a production verifier, does not define Silver assurance, and does not
migrate public schemas, public adapters, vault state, or LUMA provider
interfaces.

## 1. Purpose

M0.E records the verifier implementation that exists before M0.B. M0.F moves
that implementation to `services/luma-verifier-dev` without changing runtime
behavior. This document is a required input to M2.A, where the real verifier
spec and runbook will be designed from explicit current-state drift instead of
implicit assumptions.

Release note for M0.F: DEV-only verifier moved; behavior unchanged.

## 2. Current DEV Stub Inventory

The verifier is explicitly a development stub. Its module warning says the
service does not provide production-grade sybil defense and that all responses
are truth-labeled with `environment: "DEV"` and a disclaimer
(`services/luma-verifier-dev/src/main.rs:1`). The code hard-codes
`ENV_POSTURE` to `"DEV"` and defines a `DEV-ONLY` disclaimer
(`services/luma-verifier-dev/src/main.rs:19`,
`services/luma-verifier-dev/src/main.rs:22`).

The served API surface is only `GET /health` and `POST /verify`
(`services/luma-verifier-dev/src/main.rs:113`,
`services/luma-verifier-dev/src/main.rs:123`). The process listens on
`0.0.0.0:3000` (`services/luma-verifier-dev/src/main.rs:137`). Docker and
Traefik keep the existing external route shape while pointing at the renamed
service (`infra/docker/docker-compose.yml:95`,
`infra/docker/traefik-dynamic.yml:19`).

The Rust request body is `AttestationPayload` with `platform`,
`integrityToken`, `deviceKey`, and `nonce` after camelCase serialization
(`services/luma-verifier-dev/src/main.rs:37`). The TypeScript request contract
uses the same four fields (`packages/types/src/attestation.ts:2`) and the
exported zod schema validates the same shape (`packages/types/src/index.ts:34`).

The Rust response body contains `token`, `trustScore`, `nullifier`,
`environment`, and `disclaimer` after camelCase serialization
(`services/luma-verifier-dev/src/main.rs:64`). The canonical TypeScript
`SessionResponse` requires `token`, `trustScore`, `scaledTrustScore`,
`nullifier`, `createdAt`, and `expiresAt`
(`packages/types/src/session.ts:8`). The gun-client bridge fills missing
`scaledTrustScore`, `createdAt`, and `expiresAt` from client-side fallback
logic (`packages/gun-client/src/auth.ts:28`). This compatibility shim is
current implementation truth only; M2.A owns the single shared verifier schema.

The verifier validates that the three string inputs are non-blank and below
fixed maximum lengths (`services/luma-verifier-dev/src/main.rs:172`). It checks
mock mode through `E2E_MODE` or `x-mock-attestation`
(`services/luma-verifier-dev/src/main.rs:214`). The platform routines are
length and prefix heuristics only: web length/test-token, Apple prefix, and
Google prefix (`services/luma-verifier-dev/src/main.rs:228`,
`services/luma-verifier-dev/src/main.rs:240`,
`services/luma-verifier-dev/src/main.rs:252`). They do not validate a device
vendor attestation chain, nonce freshness, liveness, residency, or recovery.

Nullifier derivation is `sha256(NULLIFIER_SALT || device_key)` with a default
salt of `vh-nullifier-salt` when the environment variable is unset
(`services/luma-verifier-dev/src/main.rs:324`). The current Web PWA
`buildAttestation()` creates a fresh random `deviceKey` during identity
creation (`apps/web-pwa/src/hooks/useIdentity.ts:317`), which is why stable
device credential lifecycle remains M0.D work and is outside this branch.

The current test suite asserts the DEV truth label on health responses,
successful verify responses, mock-header verify responses, validation errors,
platform stub scoring, nullifier stability for a fixed device key, mock-mode
detection, and DEV disclaimer constants
(`services/luma-verifier-dev/src/main.rs:363`,
`services/luma-verifier-dev/src/main.rs:385`,
`services/luma-verifier-dev/src/main.rs:411`,
`services/luma-verifier-dev/src/main.rs:448`,
`services/luma-verifier-dev/src/main.rs:475`,
`services/luma-verifier-dev/src/main.rs:619`,
`services/luma-verifier-dev/src/main.rs:690`,
`services/luma-verifier-dev/src/main.rs:702`,
`services/luma-verifier-dev/src/main.rs:725`).

## 3. Schema Reconciliation

| Surface | Rust DEV stub today | TypeScript/client today | Reconciliation state |
|---|---|---|---|
| Request payload | `platform`, `integrityToken`, `deviceKey`, `nonce` via serde camelCase (`services/luma-verifier-dev/src/main.rs:37`) | Same fields in `AttestationPayload` and zod schema (`packages/types/src/attestation.ts:2`, `packages/types/src/index.ts:34`) | Aligned for current DEV payload shape. |
| Session response | `token`, `trustScore`, `nullifier`, `environment`, `disclaimer` (`services/luma-verifier-dev/src/main.rs:64`) | Canonical `SessionResponse` requires `scaledTrustScore`, `createdAt`, `expiresAt` and does not include DEV truth labels (`packages/types/src/session.ts:8`) | Drift is bridged by `packages/gun-client/src/auth.ts:28`; M2.A must formalize one shared schema. |
| Token | `session-<unix seconds>` (`services/luma-verifier-dev/src/main.rs:157`) | Treated as an opaque bearer token by `useIdentity` (`apps/web-pwa/src/hooks/useIdentity.ts:153`) | DEV-only; not signed and not a production verifier token. |
| Trust score | Heuristic per platform (`services/luma-verifier-dev/src/main.rs:228`) | Compared against `TRUST_MINIMUM` in client paths (`packages/gun-client/src/auth.ts:23`, `apps/web-pwa/src/hooks/useIdentity.ts:139`) | Current score is beta/dev compatibility, not Silver assurance. |
| Nullifier | Hash of salt and device key (`services/luma-verifier-dev/src/main.rs:324`) | Stored as the active session nullifier (`apps/web-pwa/src/hooks/useIdentity.ts:156`) | Stable only when the same device key is reused; M0.D owns credential persistence. |
| Nonce | Required and length-limited (`services/luma-verifier-dev/src/main.rs:197`) | Generated randomly by `buildAttestation()` (`apps/web-pwa/src/hooks/useIdentity.ts:318`) | No freshness or replay check today; M2.A/M2.B owns real nonce policy. |
| DEV truth label | Returned as `environment` and `disclaimer` (`services/luma-verifier-dev/src/main.rs:64`) | Not part of canonical `SessionResponse` (`packages/types/src/session.ts:8`) | Kept as runtime honesty label on the DEV stub. Production schemas must not inherit this shape by accident. |

## 4. Env-Name Drift

The Web PWA calls `VITE_ATTESTATION_URL` and defaults to
`http://localhost:3000/verify` (`apps/web-pwa/src/hooks/useIdentity.ts:17`).
The gun-client module separately reads `ATTESTATION_URL` from import meta or
process env, with the same default URL (`packages/gun-client/src/auth.ts:7`).

Policy decision: this branch records the drift only. M1.C owns the build-time
assertion that both names resolve to the same URL in deployable profiles.
Until that assertion lands, operators must treat `VITE_ATTESTATION_URL` and
`ATTESTATION_URL` as a paired setting and must not point either deployable
profile at the DEV stub.

## 5. Nullifier Salt Policy

Current code reads `NULLIFIER_SALT` dynamically and falls back to
`vh-nullifier-salt` (`services/luma-verifier-dev/src/main.rs:324`). That is
acceptable only for the current DEV stub. The LUMA service spec requires the
salt to be pinned per profile in checked-in config before production
attestation. Salt rotation changes derived nullifiers and therefore is a P0
identity-continuity incident requiring a forward-only migration plan, a new
build pin, and explicit user/operator impact review.

M2.A must replace this current-state note with a verifier runbook section that
names the profile salt pin, rotation owner, rollback behavior, and audit-log
fields. No branch before M2 may treat the DEV fallback salt as production
configuration.

## 6. Scope Guardrails

This document and the mechanical rename do not:

- add `_protocolVersion` or `_writerKind` to public schemas;
- migrate forum, directory, aggregate, materializer, synthesis, news,
  storyline, analysis, topic-engagement, or sentiment outbox adapter write
  paths;
- touch `packages/luma-sdk/src/index.ts` or provider interfaces;
- modify vault layout or device credential persistence;
- touch the mesh drill harness or `vh/__mesh_drills/*`;
- widen LUMA `_writerKind` to include drill writers;
- claim post-M0.B mesh readiness or Silver assurance.

Invalid `_writerKind: 'system'` records and non-aggregate public records
carrying `district_hash` remain governed by `spec-data-topology-privacy-v0.md`
and are not implemented or migrated in this M0.E/M0.F slice.
