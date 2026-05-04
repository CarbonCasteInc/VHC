# Signed-Pin Custody Spec

> Status: Draft Normative Spec
> Owner: VHC Spec Owners
> Last Reviewed: 2026-05-04
> Depends On: docs/specs/spec-luma-service-v0.md, docs/specs/spec-mesh-production-readiness.md, docs/specs/spec-data-topology-privacy-v0.md, docs/foundational/System_Architecture.md

Version: 0.1
Status: Draft for cross-spec key custody coherence; transitions to Canonical
when all referenced surfaces (mesh peer-config, LUMA verifier manifest,
LUMA safety bulletin, mesh drill writer, system writer) are implemented.

## 1. Purpose

VHC has multiple build-time pinned signing-key surfaces. Each was specified
inside the system that uses it. Without one place that lists every key, what
it signs, and what its compromise blast radius is, three things go wrong:

1. Key custody, rotation, and compromise procedures get duplicated across
   per-system runbooks. Drift is invisible.
2. Cross-system reuse of a single key (peer-config key signing a verifier
   manifest, for example) becomes a one-line bug instead of a topology
   violation that lints.
3. A single compromise incident triggers ad-hoc cross-team coordination
   instead of a documented blast-radius response.

This spec is the single index of every pinned signing-key surface in the
project. It does not replace the per-system specs; it cross-references them
and adds the *scope* dimension (allowed artifact, allowed namespace,
forbidden reuse) and the *blast radius* response.

## 2. Scope and non-goals

In scope:

- Build-time pinned signing keys whose public component is committed in
  the repository (CSP/connect-src pins, JWKS pins, manifest pins, peer-config
  pins, drill signer pins, system writer pins).
- Operational signing keys held by infrastructure (relay daemon tokens,
  verifier session-signing subkeys, safety-bulletin root key) where their
  public counterparts are pinned at build time.
- Key rotation procedures, compromise procedures, blast-radius response.

Out of scope:

- Per-user vault keys (`vaultMasterKey`, `deviceCredential`,
  `seaDevicePair`, `delegationSigningKey`, `walletBinding`,
  `recoveryKey`). Those are owned by `spec-luma-service-v0.md` §11.
- On-chain attestation keys. Those are owned by future on-chain bridge
  specs.
- Third-party SDK signing keys (OAuth providers, etc.). Those are managed
  by the provider.
- Daily operational secrets that are not pinned at build time (database
  passwords, generic API keys, environment-specific service tokens).

## 3. Pin manifest

This is the canonical list of pinned **signing-key** surfaces — keys whose
public component is committed in the build and whose private component
produces verifying signatures. Bearer credentials (HTTP tokens that are
not signing keys) are listed separately in §3.1; they share custody and
compromise concerns with §3 but are not subject to this spec's
key-reuse-and-pin-location lints.

Every pinned signing-key surface in the project MUST appear in this table.
Adding or removing a row requires a Protocol RFC under
`spec-luma-service-v0.md` §1.4 if the row touches any LUMA-gated artifact;
otherwise it requires a coordinated PR touching this spec and the owning
system spec.

| Key surface | Owner spec | Build-time pin location | What it signs | Allowed artifact paths / namespaces | Forbidden reuse | Compromise severity |
|---|---|---|---|---|---|---|
| Mesh peer-config signing key | `spec-mesh-production-readiness.md` §5.5 | `VITE_GUN_PEER_CONFIG_PUBLIC_KEY` (env, build-baked) | Signed peer-config records (`configId`, `issuedAt`, `expiresAt`, peer URL list, minimum peer count, quorum required) | Peer-config artifact served at the configured URL; never written to public `vh/*` | MUST NOT sign LUMA verifier manifests, LUMA safety bulletins, drill records, system writes, or any `vh/*` write | P0 — every browser must refetch a freshly-signed peer config under a new key; old config must rollback per mesh spec §5.5 |
| LUMA verifier manifest key | `spec-luma-service-v0.md` §17 | `apps/web-pwa/src/luma/verifier-pin.json` (committed pin file naming `verifierId`, `buildHash`, `policyVersion`, `schemaVersion`, `saltFingerprint`, `acceptedSignatureSuites`) | `VerifierTransparencyManifest` records served from `GET /.well-known/luma-verifier-manifest` | The verifier `.well-known/*` endpoints; mirrored to GitHub Pages and Sigstore-rekor | MUST NOT sign peer config, safety bulletins, drill records, system writes, or any `vh/*` write | P0 — pinned manifest in the build is now stale; new build with new pin and new manifest fingerprint required; transparency-log entry MUST cite the rotation reason |
| LUMA safety-bulletin root key | `spec-luma-service-v0.md` §18 | Cold storage, public component pinned in `apps/web-pwa/src/luma/verifier-pin.json` (or successor pin file) | `SignedSafetyBulletin` records served from `GET /.well-known/luma-safety-bulletin` | The verifier `.well-known/*` endpoints; mirrored alongside the manifest | MUST NOT sign manifests, peer config, drill records, system writes, or `vh/*` content. MUST NOT be held online or by an automated signer; root signing requires the cold-storage quorum (`spec-luma-service-v0.md` §17 / M2.A-7) | P0 — entire bulletin chain is potentially forged; a new root key with N=3-of-K=5 quorum re-issuance is required; production-attestation profile blocked until a fresh bulletin signed by the new root is published |
| Mesh drill signer key | `spec-mesh-production-readiness.md` §5.9 | Test fixture under `packages/e2e/fixtures/mesh-drill/` (build-baked into the test harness, not the production app bundle) | Mesh drill records under `vh/__mesh_drills/<run_id>/...` (`_drillSignature` over JCS(record minus `_drillSignature`); record carries `_drillSignerId` and `_drillSignatureSuite`) | `vh/__mesh_drills/*` only | MUST NOT sign any product write, peer config, manifest, bulletin, or system write. MUST NOT appear in the production app bundle (tree-shake assertion required). | P2 — no product data at risk; rotate the key, invalidate past drill records via TTL, regenerate test fixtures |
| System writer key | `spec-data-topology-privacy-v0.md` §8 (created by LUMA M0.B) | TBD at M0.B; expected location is a separate pin file under `apps/web-pwa/src/luma/system-writer-pin.json` or an equivalent build-baked artifact | `_writerKind === 'system'` records (daemon-published news bundles, storylines, accepted synthesis pointers, etc.); see `spec-data-topology-privacy-v0.md` §8.3 for the signature shape | The public namespaces enumerated in `spec-data-topology-privacy-v0.md` §8.2; never user-facing write paths; never `vh/__mesh_drills/*`; never LUMA `.well-known/*` | MUST NOT sign user-author writes. MUST NOT be held by browser code; only daemon and operator paths hold the private key. MUST NOT sign peer config, manifests, bulletins, or drill records. | P1 — daemon-published mesh state is potentially forged; rotate the key, re-publish current state under the new key, and audit recent writes for forged content |

### 3.1 Operational bearer credentials

Bearer credentials are HTTP tokens that authenticate a request but do not
sign a record. They have custody and compromise concerns adjacent to the
§3 keys but they are NOT pinned at build time, are NOT subject to the
§4 key-reuse rules, and are NOT lint-enforced by
`pnpm check:signed-pin-custody`. They are listed here so the cross-spec
inventory of authority-bearing material is complete in one place.

| Credential | Owner spec | Storage | Authenticates | Allowed surfaces | Forbidden reuse | Compromise severity |
|---|---|---|---|---|---|---|
| Relay daemon bearer token | `spec-mesh-production-readiness.md` §5.4 | `VH_RELAY_DAEMON_TOKEN` (env, never build-baked, never bundled into browser code) | Daemon-only relay fallback HTTP requests | The daemon-only fallback routes named in mesh spec Slice 4 | MUST NOT be exposed to browser fallback paths. MUST NOT be reused as a signing key for mesh writes; the token is bearer auth only. | P1 — daemon write fallback path is potentially abused; rotate the token at the relay (no dual-token window), invalidate the old token immediately, audit recent fallback writes |

Operational bearer credentials added in the future (verifier admin token,
operator console session token, etc.) MUST be added here, not to §3,
unless they are also pinned signing keys.

The pin manifest in §3 is the source of truth for cross-surface key
reuse, custody scope, and compromise blast-radius response. Per-system
specs reference back to this spec for those columns and MUST NOT
contradict them. The owning per-system spec remains the source of truth
for **artifact schema** (record fields, signature construction, payload
shape) and **runtime behavior** (when to fetch, cache, revoke, refresh).
If this spec and a per-system spec disagree on cross-surface reuse,
custody scope, or compromise response, this spec wins. If they disagree
on artifact schema or runtime behavior, the owning per-system spec wins.

## 4. Forbidden reuse rules

Cross-surface key reuse for the §3 signing keys is a hard topology
violation. A linter check (`pnpm check:signed-pin-custody`) MUST fail if:

- A single key is named in more than one row of §3.
- A single private key file or HSM slot signs artifacts under more than
  one row's "Allowed artifact paths / namespaces".
- The mesh drill signer key is bundled into the production app build.
- The system writer key is bundled into any browser build.
- The LUMA safety-bulletin root key is held by an online signer or appears
  in any application bundle.

These rules apply to §3 only. §3.1 operational bearer credentials are
governed by their owning spec's runbook (mesh ops runbook for the relay
daemon bearer token).

Specific forbidden combinations among the §3 keys:

- Peer-config key MUST NOT sign verifier manifests. They serve different
  trust boundaries: peer-config defines who you talk to; manifest defines
  who you trust to issue identity. Reusing one key collapses the boundary.
- Verifier manifest key MUST NOT sign safety bulletins. Manifest is the
  routine-operation trust anchor; the bulletin is the kill switch. Reusing
  one key means a compromised manifest signer can forge an "all clear"
  bulletin.
- Drill signer MUST NOT sign anything outside `vh/__mesh_drills/*`. Drill
  data is by design ephemeral and untrusted; widening the signer's scope
  collapses the test-only namespace boundary.
- System writer MUST NOT sign user-author writes. User-author writes go
  through `SignedWriteEnvelope`; conflating system and user authority is a
  LUMA spec violation.
- Any §3 signing key MUST NOT be reused as a §3.1 bearer token, and any
  §3.1 bearer token MUST NOT be promoted to a signing key without a new
  row in §3 and a fresh key generation.

## 5. Rotation procedure

Routine rotation cadence for §3 signing keys:

| Key surface | Cadence | Procedure owner |
|---|---|---|
| Mesh peer-config signing key | quarterly or on operator request | mesh ops runbook (`spec-mesh-production-readiness.md` Slice 12) |
| LUMA verifier manifest key | per `spec-luma-service-v0.md` §17 (key-rotation grace 7 days; M2.A-6) | LUMA verifier runbook (M2.A) |
| LUMA safety-bulletin root key | annual or on quorum-member change | LUMA verifier runbook |
| Mesh drill signer key | per drill harness owner discretion | mesh harness owner |
| System writer key | per data-topology spec §8 | data-topology spec owner + LUMA spec owner |

Operational bearer credentials in §3.1:

| Credential | Cadence | Procedure owner |
|---|---|---|
| Relay daemon bearer token | per relay deployment cadence; immediate rotation on suspected compromise | mesh ops runbook |

Routine rotation procedure (general shape, refined per surface in the
owning runbook):

1. Generate the new key (or token) under the surface's custody model.
2. Add the new pin to the build alongside the old pin (dual-pin window).
3. Cut a new release with the dual-pin build.
4. Issue artifacts under the new key. Old artifacts continue to verify
   under the old pin within the rotation grace window.
5. Once the rotation grace window expires, drop the old pin from the
   build. Cut a release.
6. Audit-log the rotation in the surface's operational record.

Surfaces without a dual-pin window (drill signer, daemon bearer token)
rotate atomically with a coordinated relay/daemon restart.

## 6. Compromise procedure

A pinned signing key is considered compromised if any of:

- The private key material has left controlled storage.
- An unauthorized signer has produced a verifying artifact.
- The custody quorum has been broken (root key only).
- A transparency-log discrepancy is observed (manifest, bulletin).
- A topology lint detects cross-surface reuse against this spec's §4.

Per-surface compromise response:

### 6.1 Mesh peer-config signing key (P0)

1. Operator declares peer-config compromise.
2. Generate a new peer-config signing key under the mesh ops runbook.
3. Issue a new signed peer-config under the new key.
4. Cut a release with the new pin.
5. Trigger forced refetch on every browser via the existing peer-config
   stale-rejection canary (`spec-mesh-production-readiness.md` §5.5).
6. Old peer config is treated as revoked; relays MAY refuse old-config
   browser handshakes if implemented.
7. Audit-log: which old config was last issued, when the new one took
   effect, blast-radius assessment (was a forged peer config used to
   redirect browsers to a hostile relay?).

### 6.2 LUMA verifier manifest key (P0)

1. Operator declares verifier manifest compromise.
2. New manifest key generated; new manifest published.
3. New build cut with new pin.
4. Transparency log entry MUST cite rotation reason and any forged-manifest
   evidence.
5. Old `verifierId` MAY be added to the safety bulletin's `revokedManifest
   Fingerprints` to force clients to reject any cached old manifest.
6. Audit-log: how many sessions were created against the compromised
   manifest, blast-radius assessment.

### 6.3 LUMA safety-bulletin root key (P0)

1. Operator declares root key compromise.
2. Convene the cold-storage quorum (N=3-of-K=5 per `spec-luma-service-v0.
   md` M2.A-7) and re-issue the root key.
3. New bulletin signed by the new root key, published with explicit
   `bulletinId` rotation reason.
4. New build cut with new pin.
5. `production-attestation` profile MUST be blocked until the fresh
   bulletin is published and clients have refetched.
6. The compromised root key's fingerprint MAY be added to a forbidden-
   bulletin-signer registry (forward-only), refusing any future cached
   bulletin under the old key.
7. Audit-log: full custody chain incident review.

### 6.4 Mesh drill signer key (P2)

1. Drill harness owner generates a new drill signer key.
2. Update the test fixture; regenerate any in-flight drill records.
3. Old drill records expire via their `_drillExpiresAt` TTL; no manual
   revocation required.
4. No production impact; no release blocker.

### 6.5 System writer key (P1)

1. Operator declares system writer compromise.
2. Daemon paused; new system writer key generated and pinned in the build.
3. Re-publish current canonical state under the new key (news bundles,
   storylines, accepted synthesis pointers, etc.).
4. Topology lint MUST refuse any record under the old system writer key
   for new writes; readers MAY still accept old records pending a full
   re-publication pass.
5. Audit recent writes for forged content; surface findings in the
   readiness report.
6. New build cut.

### 6.6 Relay daemon bearer token (P1)

1. Operator rotates `VH_RELAY_DAEMON_TOKEN` at the relay.
2. Daemon redeployed with the new token.
3. Old token rejected immediately; no dual-token window.
4. Audit recent fallback writes for abuse pattern.

## 7. Cross-spec implementation hooks

Each per-system spec retains its own runbook. This spec adds:

- `pnpm check:signed-pin-custody` — lints the pin manifest in §3 against
  the actual repo state. Fails if a key file is found in more than one
  custody location, if the drill signer appears in production bundles, or
  if any pin file references a custody slot that is not in §3.
- `tools/scripts/rotate-pinned-key.mjs <surface>` — a thin wrapper that
  prints the per-surface runbook from §5 and validates the post-rotation
  state matches §3.
- `signed-pin-custody-runbook.md` (under `docs/ops/`, created when the
  first pin is rotated post-this-spec) — operational worksheet for an
  operator executing one of the §5 or §6 procedures.

## 8. Test invariants

- Static lint: §4 forbidden-reuse rules pass against a recorded build.
- Static lint: drill signer key file is not present in any
  `apps/web-pwa/dist/**` artifact.
- Static lint: system writer key file is not present in any browser
  build artifact.
- Build-time assertion: every pin file referenced in §3 exists, parses,
  and matches its declared schema (or carries a documented `tbd: true`
  flag while the surface is being built).
- Build-time assertion: `acceptedSignatureSuites` lists in `verifier-pin.
  json` are a subset of the suites enumerated in `spec-luma-service-v0.md`
  §6.2.
- Compromise drill: at least one §3 signing-key surface MUST be
  exercised end-to-end per release cycle as a tabletop, recorded in the
  per-surface readiness report named in §3 ("Owner spec" column). Mesh
  surfaces record in `docs/reports/evidence/mesh-production/<timestamp>/`;
  LUMA surfaces record in the LUMA verifier runbook artifact directory
  (M2.A). §3.1 bearer credentials follow their owning runbook's drill
  cadence and are out of scope for this lint.

## 9. Forbidden defaults

- No §3 signing-key surface may be added without a documented "Allowed
  artifact paths / namespaces" entry. "TBD" is permitted only as a
  temporary entry while the owning system spec is being drafted.
- No §3 signing-key surface may be added without a "Forbidden reuse"
  entry. Reuse rules are normative.
- No §3 or §3.1 surface may be added without a "Compromise severity"
  rating. The rating drives §6 response intensity.
- No system spec may declare its own custody manifest that contradicts
  §3 or §3.1. Cross-references are required; duplicates are forbidden.
- New operational bearer credentials MUST be added to §3.1, not §3,
  unless they are also pinned signing keys. Conflating bearer auth and
  signing keys is a category error and breaks the lint semantics in §4.

## 10. Iteration log

| Version | Date | Author | Notes |
|---|---|---|---|
| 0.1 | 2026-05-04 | Reviewer | Initial draft. Six surfaces enumerated. Forbidden-reuse, rotation, and compromise procedures locked. `pnpm check:signed-pin-custody` named as the lint gate. |
