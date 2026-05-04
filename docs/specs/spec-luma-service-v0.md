# LUMA Service v0 Spec

> Status: Draft Normative Spec
> Owner: VHC Spec Owners
> Last Reviewed: 2026-05-04
> Depends On: docs/specs/spec-identity-trust-constituency.md, docs/specs/spec-data-topology-privacy-v0.md, docs/specs/secure-storage-policy.md, docs/specs/spec-mesh-production-readiness.md, docs/specs/spec-signed-pin-custody-v0.md, docs/foundational/LUMA_BriefWhitePaper.md, docs/foundational/System_Architecture.md

Version: 0.2
Status: Draft for Season 0 LUMA service boundary and SDK contract; transitions to Canonical on M0.A review signoff.

This spec defines the LUMA service contract: API boundary, SDK surface, identity types, write-envelope shape, policy engine, storage model, session lifecycle, transparency posture, and acceptance tests. It is the canonical owner of LUMA service-level concerns. Identity, trust, and constituency *semantics* (thresholds, beta-local proof contract, familiar invariants, Season 0 fence) remain owned by `docs/specs/spec-identity-trust-constituency.md`; this spec defers to it on conflict.

Implementation sequencing for v0 lives in `docs/plans/LUMA_SERVICE_V0_ROADMAP_2026-05-02.md`.

## 1. Scope And Boundaries

### 1.1 In scope

- Identity types (`PrincipalId`, `Nullifier`).
- Session model: creation, lifecycle, revocation, re-attestation.
- Multi-claim assurance envelope (`AssuranceEnvelope`).
- Uniform signed-write envelope (`SignedWriteEnvelope`) for every LUMA-gated write.
- Policy engine boundary (`canPerform`).
- Storage model: vault, key compartments, evidence retention.
- Provider model: `ConstituencyProvider`, `AttestationProvider`, per-profile allow-list.
- Public id derivation and linkability-domain registry.
- Public mesh protocol fields: `_protocolVersion`, `_writerKind`.
- Telemetry contract and logging redaction.
- Verifier transparency manifest and identity pinning.
- Signed safety bulletin.
- Continuity contract (beta-local → Silver upgrade).
- DSAR and responsible-disclosure hooks (process integration; the policies live in ops docs).
- Forbidden-claims registry.
- Acceptance tests and frozen test vectors.

### 1.2 Out of scope (deferred)

LUMA whitepaper Phase 2-5 capabilities (BioKey/Gold, DBA/residency, ZK-SNARK enrollment, Pedersen vector commitments, Linkage Escrow, Intent-Based Decryption, Lazarus social recovery, Canary System) are deferred. The provider model in §7 and the assurance enumeration in §4 are the integration points; this spec does not define their internals.

Components owned by other specs and not redefined here:
- Civic Action Kit transmission (`docs/specs/spec-civic-action-kit-v0.md`).
- Topic synthesis and analysis objects (`docs/specs/topic-synthesis-v2.md`).
- News bundling and publication (`docs/specs/spec-news-aggregator-v0.md`).
- HERMES messaging, forum, docs (`docs/specs/spec-hermes-*.md`).
- Civic sentiment and voting contract (`docs/specs/spec-civic-sentiment.md`).
- Existing data topology rules (`docs/specs/spec-data-topology-privacy-v0.md`); this spec extends with `_protocolVersion`, `_writerKind`, and the district-hash fail-closed rule.
- Storage tiers (`docs/specs/secure-storage-policy.md`); the key-compartment manifest in §11 is an extension under that spec's authority.

### 1.3 Portable credential issuance reservation

LUMA whitepaper Phase 1 names OID4VC issuance. v0 LUMA assertions are audience-bound session assertions (§5, §10), not portable credentials. Reserved OID4VC fields (`iss`, `sub`, `cnf`, `vct`, `vc`, `vp`) are not used by v0 envelopes. Future portable issuance is a separate provider that consumes the AssuranceEnvelope; integration is out of scope for v0.

### 1.4 Spec governance: Protocol RFC gate

Any change to identifiers, derivation domains, assurance levels, public topology fields, verifier policy, forbidden claims, recovery semantics, write-envelope shape, audience set, signature suites, the policy engine, or the safety-bulletin schema arrives as a Protocol RFC PR including: migration plan, rollback behavior, test vectors, privacy classification, copy impact, release-gate updates, RFC number, owner, and supersedes/superseded-by links. RFC form: `luma-rfc-NNNN-<short-name>.md` under `docs/rfcs/`. CI check fails if a PR touches a gated path without an RFC artifact.

### 1.5 Mesh boundary

Mesh transport, relay topology, signed peer-config lifecycle, durability,
readback, conflict resolution, partition behavior, soak budgets, and the
mesh drill harness are owned by `docs/specs/spec-mesh-production-readiness.
md`. This spec does not define those concerns and does not duplicate them.

LUMA-gated writes (records carrying `_writerKind === 'luma'`) are subject
to mesh transport durability rules in addition to envelope verification.
A LUMA-gated write is release-claim-valid only when both:

- the LUMA gate (envelope, audience, scheme, public-id derivation,
  `canPerform` decision) passes; and
- the mesh transport readiness gate
  (`pnpm check:mesh:production-readiness`) covers the write class under
  the current LUMA schema epoch (mesh spec §5.8).

The mesh drill harness writes test-only records under `vh/__mesh_drills/*`
through a separate test writer contract (mesh spec §5.9). That namespace
and contract are explicitly outside LUMA's `_writerKind` enum and outside
the `SignedWriteEnvelope` reader rules. LUMA topology lints MUST NOT block
drill writes under `vh/__mesh_drills/*`; they MUST block any drill record
encountered outside that namespace.

Any LUMA public-schema epoch change (changes to `_protocolVersion`
semantics, `_writerKind` enum membership, public-id derivation,
`_authorScheme` membership, or any `vh/*` schema migration owned by this
spec) invalidates prior mesh readiness reports for affected write classes
as release-claim evidence. The mesh roadmap MUST re-run drills after any
such change before the affected write classes may be re-claimed for
release.

## 2. Deployment Profiles

Four profiles. Each is a frozen tuple of feature flags, allowed providers, allowed copy claims, and required release gates. Build-time enforcement: only `public-beta` and `production-attestation` produce deployable artifacts; mismatch between bundled env and profile rules fails the build with a named error.

| Profile | Lifecycle | Attestation provider | Constituency provider | Allowed copy | Required gates |
| --- | --- | --- | --- | --- | --- |
| `dev` | TTL respected only if `VITE_SESSION_LIFECYCLE_ENABLED=true` | Mock or DEV stub or `VITE_LUMA_DEV_FALLBACK=true` shortcut | Mock or beta-local | Internal copy only; UI shows persistent DEV banner | None |
| `e2e` | Lifecycle disabled | Mock providers only (DEV stub permitted via `x-mock-attestation` header) | Mock providers only | Test-only copy | E2E suite green |
| `public-beta` | Lifecycle enforced | `BetaLocalAttestationProvider` only | `BetaLocalConstituencyProvider` | Beta-local stance language only; forbidden-claims gate enforced | `pnpm check:public-beta-compliance`, forbidden-claims gate, telemetry redaction test, safety-bulletin freshness (advisory) |
| `production-attestation` | Lifecycle enforced | Real Silver verifier; pinned manifest required | `BetaLocalConstituencyProvider` until a separate cryptographic-proof spec | Silver attestation language permitted; beta-local stance language for constituency | All `public-beta` gates plus `pnpm check:luma-production-profile`, verifier-manifest pin check, transparency-log freshness, safety-bulletin freshness (hard), adversarial-harness corpus pass |

The DEV stub verifier (`services/luma-verifier-dev`) MUST NOT serve `public-beta` or `production-attestation`. Its truth label (`environment: "DEV"`) is non-negotiable for as long as it exists.

## 3. Identity Types

```ts
type PrincipalId = string & { __brand: 'PrincipalId' };
type Nullifier   = string & { __brand: 'Nullifier' };
```

`PrincipalId` is the user-identity concept. `Nullifier` is the cryptographic projection used for double-action prevention, on-chain `bytes32Nullifier` keying, and budget enforcement. In v0, `principalId === principalNullifier` at runtime (one-to-one). The type discipline forbids mixing them: a function that takes `PrincipalId` does not accept `Nullifier`. In Phase 3+ (per-human binding), one `PrincipalId` will project into multiple device-bound `Nullifier`s; this spec preserves that upgrade path.

`principalNullifier` derivation: `HMAC-SHA-256(salt = NULLIFIER_SALT, message = deviceCredential)` (§11). The HMAC implementation MUST be constant-time (§6.4).

## 4. AssuranceEnvelope

The AssuranceEnvelope is the authority shape for trust decisions. Scalar `trustScore` is preserved for backward-compat with `spec-identity-trust-constituency.md` §2 thresholds via a single helper (`scoreFromEnvelope`). New gating code reads the envelope; new gates declare which claims they require.

```ts
interface AssuranceEnvelope {
  envelopeVersion: 1;
  signatureSuite: SignatureSuite;            // §6
  assuranceLevel: 'none' | 'beta_local' | 'bronze' | 'silver' | 'gold' | 'platinum';
  claimVector: ClaimVector;
  verifierId: string;                        // pinned-key id, or 'beta-local'
  policyVersion: string;                     // semver of trust-score policy at issue time
  evidenceDigest: string;                    // hex(JCS-canonical-hash of evidence record)
  evidenceRecordRef: EvidenceRef;            // §11.6
  limitations: string[];                     // human-readable forbidden-claim hints
  issuedAt: number;
  expiresAt: number;
  ttlSeconds: number;                        // server-set; client uses min(now+ttl, expiresAt)
}

type ClaimLevel = 'none' | 'beta_local' | 'bronze' | 'silver' | 'gold';

interface ClaimVector {
  device_integrity: ClaimLevel;
  liveness: ClaimLevel;
  human_uniqueness: ClaimLevel;
  residency: ClaimLevel;
  coercion_resistance: ClaimLevel;
  recovery_strength: ClaimLevel;
}
```

A v0 public-beta session populates `assuranceLevel='beta_local'`, all `claimVector` entries `'beta_local'` or `'none'`, `verifierId='beta-local'`, and `limitations=['no-remote-attestation','no-residency-proof','no-coercion-resistance','no-recovery']`.

A v0 production-attestation session populates `assuranceLevel='silver'`, `claimVector.device_integrity='silver'`, `claimVector.liveness='silver'`, all others `'beta_local'` or `'none'`, `verifierId='<pinned-key-id>'`.

Direct numeric comparisons of the legacy scalar `trustScore` outside `scoreFromEnvelope` and the policy engine are forbidden; lint rule `no-trust-score-direct-compare` enforces.

## 5. SignedWriteEnvelope

Every LUMA-gated write — forum posts, votes, stance events, delegation actions, budget-consuming actions, on-chain bridge submissions — uses one envelope shape.

```ts
interface SignedWriteEnvelope<TPayload> {
  envelopeVersion: 1;
  signatureSuite: SignatureSuite;            // §6
  protocolVersion: string;
  profile: 'dev' | 'e2e' | 'public-beta' | 'production-attestation';
  audience: AudienceTag;
  origin: string;
  scheme: string;                            // public-id scheme tag, e.g. 'forum-author-v1'
  publicAuthor: string;                      // public-id derivative; never raw nullifier
  sessionRef: { tokenHash: string; envelopeDigest: string };
  payload: TPayload;
  payloadDigest: string;                     // hex(JCS-hash(payload))
  sequence: number;                          // monotonic per (publicAuthor, audience)
  nonce: string;                             // 128-bit random
  idempotencyKey: string;                    // = hex(JCS-hash(payloadDigest ‖ audience ‖ sequence))
  issuedAt: number;
  signature: string;                         // over canonical envelope minus signature
}

type AudienceTag =
  | 'vh-forum-thread'
  | 'vh-forum-comment'
  | 'vh-stance-vote'
  | 'vh-stance-clear'
  | 'vh-civic-action-draft'
  | 'vh-civic-action-send'
  | 'vh-delegation-grant'
  | 'vh-delegation-revoke'
  | 'vh-budget-consume'
  | 'vh-onchain-bridge';
```

`AudienceTag` is a closed enum. Adding an audience requires a Protocol RFC.

### 5.1 Reader rules

A reader MUST reject an envelope on any of:
- protocol-version mismatch;
- audience not in the expected set for the surface;
- scheme not registered in §9;
- origin mismatch when the audience is origin-bound;
- signature verification failure under the named suite;
- signature suite unsupported by the reader;
- sequence regression for `(publicAuthor, audience)`;
- payload digest mismatch;
- `sessionRef.envelopeDigest` failure to verify against a known AssuranceEnvelope;
- profile not allowed for the surface;
- `_writerKind !== 'luma'` on the carrying record (§15).

### 5.2 Idempotency

Readers MUST dedupe on `idempotencyKey` within a 7-day window per `(publicAuthor, audience)`. Duplicate keys within the window are rejected with `idempotency_replay`.

### 5.3 Time-of-check vs time-of-use

The envelope is sealed at sign time. The policy engine (§10) MUST re-check at submission. A queued or offline-drafted write whose author's envelope assurance has dropped below the surface's required claim levels is rejected with `assurance_degraded`.

## 6. Signature Suites And Canonical JSON

### 6.1 Canonical JSON

All signing, hashing, and topology-lint inputs use **RFC 8785 (JCS)** canonical JSON. Implementations MUST use a conformant JCS encoder; rolling a custom canonicalization is forbidden.

### 6.2 Signature suites

A signature suite binds canonicalization, hash, signature algorithm, and key type as one named unit.

| Suite | Canonicalization | Hash | Signature | Key type | Use |
| --- | --- | --- | --- | --- | --- |
| `jcs-ed25519-sha512-v1` | RFC 8785 (JCS) | SHA-512 | Ed25519 | Ed25519 raw 32-byte public key | Verifier-issued envelopes (default) |
| `jcs-ed25519-sha256-v1` | RFC 8785 (JCS) | SHA-256 | Ed25519 | Ed25519 raw 32-byte public key | Client-issued write envelopes; SHA-256 alignment with on-chain anchoring |
| `jcs-mldsa65-shake256-v1` | RFC 8785 (JCS) | SHAKE-256 | ML-DSA-65 (FIPS 204) | ML-DSA-65 | Reserved; PQ migration |
| `jcs-mldsa87-shake256-v1` | RFC 8785 (JCS) | SHAKE-256 | ML-DSA-87 (FIPS 204) | ML-DSA-87 | Reserved; PQ migration |

### 6.3 Suite binding

Every signed envelope MUST name exactly one suite. Verifiers MUST reject envelopes whose suite is not in their accepted set, with `signature_suite_unsupported`. PQ migration is a suite addition and does not change envelope shape.

### 6.4 Constant-time discipline

Implementations MUST use:
- Fixed-length canonical inputs to all derivations (HKDF, HMAC, signature payloads).
- No secret-dependent branching in identity, vault, policy, or verifier code.
- Constant-time equality (`crypto.subtle.timingSafeEqual` or equivalent) for: hash comparison, signature comparison, salt-fingerprint comparison, manifest-pin fingerprint comparison, idempotency-key dedupe membership, revocation-list membership.

Lint rule `luma-no-eq-on-secrets` flags `===` and `Buffer.compare` against typed-secret values; CI fails on violation.

## 7. Provider Model

Two interfaces:

```ts
interface ConstituencyProvider {
  getProof(opts: { nullifier: Nullifier; districtHash: string }): Promise<ConstituencyProof>;
  isAcceptable(profile: DeploymentProfile): boolean;
}

interface AttestationProvider {
  attest(opts: { deviceCredential: DeviceCredential; nonce: string; audience: AudienceTag; origin: string; profile: DeploymentProfile }): Promise<{
    session: IdentitySession;
    envelope: AssuranceEnvelope;
  }>;
  isAcceptable(profile: DeploymentProfile): boolean;
}
```

Implementations:

| Implementation | Permitted profiles |
| --- | --- |
| `MockConstituencyProvider` / `MockAttestationProvider` | `e2e`, `dev` |
| `RustDevStubAttestationProvider` | `dev`, `e2e` (via `x-mock-attestation` header) |
| `BetaLocalConstituencyProvider` | `dev`, `public-beta`, `production-attestation` |
| `BetaLocalAttestationProvider` | `dev`, `public-beta` |
| `SilverVerifierAttestationProvider` (M2) | `dev`, `production-attestation` |
| Future `CryptographicConstituencyProvider` | reserved |

Per-profile allow-list is enforced at construction time and verified by tree-shake / bundle-analysis assertion in the build.

## 8. BetaLocalAttestationProvider

The `public-beta` profile uses `BetaLocalAttestationProvider` (no remote verifier) until M2 lands.

```ts
interface BetaLocalSession {
  token: string;                             // randomToken(); per-session, not stable
  trustScore: number;                        // 0.5 floor + telemetry-policy modifier; capped < 1.0
  scaledTrustScore: number;
  nullifier: Nullifier;
  envelope: AssuranceEnvelope;
  createdAt: number;
  expiresAt: number;                         // createdAt + TTL (§12)
  ttlSeconds: number;
}
```

Envelope construction:
- `assuranceLevel: 'beta_local'`.
- `claimVector`: all entries `'beta_local'` or `'none'`.
- `verifierId: 'beta-local'`.
- `policyVersion: 'beta-local-v1'`.
- `evidenceDigest`: `hex(JCS-hash(local-evidence-record))`. The local evidence record records platform, vault presence, SEA presence, and a coarse session-creation timestamp; never raw biometric features.
- `evidenceRecordRef`: `{ kind: 'local', vaultKey: 'evidence/<sessionId>' }`.
- `limitations: ['no-remote-attestation', 'no-residency-proof', 'no-coercion-resistance', 'no-recovery']`.
- `signatureSuite: 'jcs-ed25519-sha256-v1'`. Signed by `delegationSigningKey` (§11) so the envelope is verifiable by any consumer holding the principal's public component.

Continuity rule: a `BetaLocalSession`'s `nullifier` and `envelope.evidenceDigest` derivation MUST be stable on the same `deviceCredential`. A future M2 Silver attestation on the same device produces a new envelope with `assuranceLevel: 'silver'` and the same `principalNullifier` (§14).

## 9. Public Id Derivation And Linkability Domains

### 9.1 Four-name taxonomy

| Name | Visibility | Derivation |
| --- | --- | --- |
| `principalNullifier` | private | `HMAC-SHA-256(NULLIFIER_SALT, deviceCredential)` (§11) |
| `forumAuthorId` | public, global-stable | `HKDF-SHA-256(principalNullifier, salt = null, info = "vh:forum-author:v1")` |
| `identityDirectoryKey` | public, global-stable | `HKDF-SHA-256(principalNullifier, salt = null, info = "vh:identity-directory:v1")` |
| `voterId` | public per-(topic, epoch); unlinkable across scope | `HKDF-SHA-256(principalNullifier, salt = UTF-8(topicId+":"+epoch), info = "vh:voter:v1")` |

### 9.2 Derivation rules

- HKDF-SHA-256 (RFC 5869).
- IKM: UTF-8 encoding of `principalNullifier` (which is itself hex; treated as opaque bytes after UTF-8 encoding for cross-language portability).
- Salt: `null` for non-scoped derivations (HKDF uses an all-zero salt of hash length). For scoped derivations, `salt = UTF-8(scopeIdentifier)`.
- Info: `UTF-8("vh:" || domain || ":v" || version)`.
- Output: 32 bytes encoded as lowercase hex (64 chars). Mixed-case or base64 forms are rejected on read.
- Browser-safety: implementation MUST NOT depend on Node-only APIs at runtime in `apps/web-pwa`. WebCrypto is the source. Node parity is unit-tested.
- Leak posture: if `principalNullifier` leaks, every derived id is recomputable. Public ids defend correlation between *the things `principalNullifier` is correlated with*, not `principalNullifier` itself.
- No collision with raw nullifier: derived ids never equal the raw nullifier under any input; tests assert this.

### 9.3 Linkability-domain registry

Every public-id derivation is registered. New surfaces register a domain instead of writing `H(...)` inline.

```ts
interface LinkabilityDomain {
  name: string;
  scope: 'global' | 'topic-scoped' | 'topic-epoch-scoped' | 'thread-scoped' | 'session-scoped';
  saltSource: 'none' | 'topic-id' | 'topic-id+epoch' | 'thread-id' | 'session-id';
  info: string;
  linkabilityProfile: 'global' | 'scoped' | 'unlinkable-across-scope';
  publicVisibility: 'public-mesh' | 'sensitive' | 'local';
  rotationPolicy: 'never' | 'on-reset-identity' | 'per-session';
  ownerSpec: string;
}
```

Initial registry:

| Name | Scope | Salt source | Info | Linkability | Visibility | Rotation | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `forum-author-v1` | global | none | `vh:forum-author:v1` | global | public-mesh | on-reset-identity | `spec-hermes-forum-v0.md` |
| `identity-directory-v1` | global | none | `vh:identity-directory:v1` | global | public-mesh | on-reset-identity | `spec-luma-service-v0.md` |
| `voter-v1` | topic-epoch-scoped | topic-id+epoch | `vh:voter:v1` | unlinkable-across-scope | public-mesh | on-reset-identity | `spec-civic-sentiment.md` |

Adding a domain is a Protocol RFC (§1.4); reviewers verify registry entry, frozen test vectors, and topology classification together.

### 9.4 District-hash k-anonymity

`MIN_DISTRICT_COHORT_SIZE = 100`.

Allowed: aggregate or dashboard records that publish `district_hash` together with derived counts/statistics over a cohort whose size ≥ threshold.

Forbidden, fail-closed: any non-aggregate public record carrying `district_hash`. The topology lint refuses these regardless of any `cohortSize` annotation; cohort size is meaningful only for aggregate object classes. Lint rule: a write that contains `district_hash` MUST (a) target an aggregate-class path (allow-list), and (b) declare `cohortSize >= MIN_DISTRICT_COHORT_SIZE`. Either condition missing → reject at write time.

## 10. Policy Engine

`canPerform` is the single authority for write/vote/claim/familiar decisions. Surface-local threshold checks are forbidden; the lint `no-trust-score-direct-compare` enforces.

```ts
interface PolicyContext {
  principal: PrincipalRecord;
  envelope: AssuranceEnvelope;
  audience: AudienceTag;
  profile: DeploymentProfile;
  budgetState: BudgetState;
  delegation?: DelegationGrant;
  topologyClass: 'public' | 'sensitive' | 'local';
}

interface PolicyDecision {
  allowed: boolean;
  reason?: PolicyReason;
  recoveryHint?: PolicyRecoveryHint;
  warnings?: string[];
}

type PolicyReason =
  | 'missing_identity'
  | 'session_expired'
  | 'session_revoked_by_bulletin'
  | 'principal_revoked'
  | 'assurance_too_low'
  | 'assurance_degraded'
  | 'budget_exhausted'
  | 'profile_forbidden'
  | 'audience_not_registered'
  | 'origin_mismatch'
  | 'topology_class_mismatch'
  | 'delegation_scope_denied'
  | 'delegation_expired'
  | 'delegation_revoked'
  | 'idempotency_replay'
  | 'protocol_version_unsupported'
  | 'signature_suite_unsupported'
  | 'verifier_identity_mismatch'
  | 'verifier_revoked';

type PolicyRecoveryHint =
  | 'sign_in'
  | 're_attest'
  | 'wait_for_budget_reset'
  | 'cannot_recover'
  | 'switch_profile'
  | 'request_higher_assurance'
  | 'review_delegation_grant';

function canPerform(action: AudienceTag, ctx: PolicyContext): PolicyDecision;
```

Numeric thresholds and per-surface required claim levels are defined by `docs/specs/spec-identity-trust-constituency.md` §2 (`TRUST_THRESHOLDS`) and `docs/specs/spec-civic-action-kit-v0.md` §7.1; `canPerform` consumes those tables as inputs and does not redefine them. Surface-local numeric comparisons against `trustScore` outside this engine are forbidden (§4).

Reads of public mesh records are not gated by `canPerform`; only audiences enumerated in §5 (all write-shaped) are gated. First-run browsing without identity is therefore permitted by the contract — identity is required only at write/vote/claim moments.

Both enums are closed and Protocol-RFC-gated. UX, tests, and telemetry consume the same enums; copy mapping is one layer in the SDK.

### 10.1 Latency budget

Cached calls < 5 ms; cold calls < 50 ms.

### 10.2 Audience and origin binding

Every signed assertion is bound to:
- `aud` — one of `AudienceTag`.
- `origin` — the URL origin the assertion was authored on.
- `profile` — the deployment profile.
- `devicePubBinding` — `H(devicePub)` proves the matching SEA private key constructed it.

Cross-audience replay, cross-origin replay, and cross-profile replay MUST be rejected.

## 11. Storage Model And Key Compartments

### 11.1 Vault structure

`packages/identity-vault` stores an encrypted typed record in IndexedDB. Vault schema version 2 (`VAULT_VERSION = 2`):

```ts
interface VaultV2 {
  schemaVersion: 2;
  deviceCredential: { material: ArrayBuffer; createdAt: number };
  identityRecord: IdentityRecordV2;          // session carries AssuranceEnvelope
  seaDevicePair: SEAPair;
  walletBinding?: WalletBinding;
  delegationSigningKey: DelegationSigningKey;
  operatorAuthorizationToken?: OperatorToken;
  evidence?: { [sessionId: string]: EvidenceRecord };
}
```

Migration from v1: forward-only. v1's opaque blob is decrypted; if it contains a usable `attestation.deviceKey`, that material is reused as `deviceCredential.material` so legacy users keep their existing per-device nullifier. v2 vaults on a v1 client are rejected (unknown version).

### 11.2 Key-compartment manifest

| Compartment | Purpose | Storage tier | Exportable | Rotation trigger | Sign Out | Reset Identity | Recovery (future) | Cross-device |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `vaultMasterKey` | Encrypts vault contents | IDB `keys` store, non-extractable CryptoKey | No | Vault re-key only | Preserved | Preserved | N/A | No |
| `deviceCredential` | IKM for `principalNullifier` derivation | Vault | No (v0); future encrypted export under Lazarus | `deviceCredential.rotate()` | Preserved | Rotated | Restored from Lazarus shards | Future |
| `sessionToken` | Per-session bearer | Vault (`IdentityRecord.session`) | No | Re-attestation | Cleared | Cleared | N/A | No |
| `assuranceEnvelope` | Active envelope | Vault (`IdentityRecord.session`) | No | Re-attestation | Cleared | Cleared | N/A | No |
| `seaDevicePair` | Gun mesh auth + content encryption | Vault | Future encrypted export | Mesh-actor re-anchor (Reset Identity) | Preserved | Rotated | Restored from Lazarus shards | Future |
| `walletBinding` | Address bound to principal (record only) | Vault | No | Reset Identity | Preserved | Cleared (forces re-bind) | Restored from Lazarus shards | Future |
| `delegationSigningKey` | Signs `OnBehalfOfAssertion` for familiars | Vault | No | Reset Identity | Preserved | Rotated | N/A | No |
| `operatorAuthorizationToken` | Cached operator authorization | Vault | No | Server-issued; re-fetched on re-attest | Preserved | Cleared (new principal requires a new authorization grant) | N/A | No |
| `recoveryKey` (Phase 2) | Lazarus shard-recombine target | Future | Encrypted export only | Lazarus event | Preserved | Preserved (recovery survives reset) | N/A | Future |

Each compartment has a typed accessor (`compartments.deviceCredential.loadOrCreate()`, etc.). The only path that wipes a compartment is the row's named trigger.

### 11.3 `deviceCredential` derivation rule

32 bytes of secure random material at first creation; persists in the vault unmodified across Sign Out; rotated only by explicit `rotate()` call (Reset Identity). Verifier-side nullifier derivation: `HMAC-SHA-256(salt = NULLIFIER_SALT, message = deviceCredential)`. Constant-time HMAC required (§6.4).

### 11.4 `delegationSigningKey` derivation

Ed25519 keypair generated at first identity creation, persisted in the vault. Signs `OnBehalfOfAssertion` records for familiars. Rotated on Reset Identity (delegation grants under the old key are invalidated transitively because they reference the old `principalNullifier`). Public component is published in the directory entry so verifiers can validate `OnBehalfOfAssertion`.

### 11.5 `walletBinding` semantics

`walletBinding` stores the address and connection metadata, not the wallet's signing key. External wallets (MetaMask, WalletConnect, etc.) hold their own keys; LUMA "rotate" means clear the binding record and prompt the user to re-bind on next claim. Internal wallets (if any) follow the same external-key principle: LUMA never holds wallet signing keys.

### 11.6 Evidence retention and zeroization

| Stage | Retention | Notes |
| --- | --- | --- |
| Raw camera/IMU capture | In-memory only; never persisted | Frames processed into a derived feature vector on-device in real time; raw frames dropped from memory after vector extraction. |
| Derived feature vector | In-memory until `evidenceDigest` is committed; then zeroed | `crypto.subtle` operations only; no DOM caching. |
| Local evidence record | Vault `evidence/<sessionId>` for the lifetime of the session | Holds platform, vault presence, SEA presence, capture timestamp (beta-local). Silver: holds verifier-acknowledged evidence reference, not the raw vector. |
| `evidenceDigest` (in AssuranceEnvelope) | Persisted as long as the envelope persists | Auditable post-fact. |
| On Sign Out | Local evidence record cleared with the session compartment | `evidenceDigest` retained on the (now-cleared) envelope which is also cleared. |
| On Reset Identity | All evidence records and envelope history zeroed | The 30-day historical retention exception in §13.3 does not apply to Reset. |
| On verifier side (Silver) | Per the verifier audit-log retention policy (deferred to verifier spec) | Redacted: only digests and timestamps; never raw vectors. |

In-memory buffers holding raw biometric features use a `Uint8Array` allocated through `compartments.evidence.allocateZeroizable()` which calls `crypto.getRandomValues` to overwrite before garbage collection.

`EvidenceRef`:

```ts
type EvidenceRef =
  | { kind: 'local';    vaultKey: string }
  | { kind: 'verifier'; verifierId: string; ref: string };
```

## 12. Session Lifecycle

### 12.1 TTL

Default `ttlSeconds = 7 days` for beta-local sessions. The same value is the intended Silver TTL once M2 lands; the value is shared, the assurance is not.

### 12.2 Expiry and clock discipline

Sessions carry server-set `expiresAt`. Clients use `min(now + ttlSeconds, expiresAt)` to tolerate client clock skew; the more conservative bound wins.

`Date.now()` MUST be fronted by an injectable `Clock` interface in the SDK; direct `Date.now()` calls in identity, vault, policy, and verifier-client code are lint-forbidden. This makes clock skew testable and audit-replayable, and prevents secret-dependent timing leaks where a real-clock branch would otherwise diverge from a test-clock branch.

### 12.3 Near-expiry warning

UI MUST show a non-blocking warning when within 24 hours of `expiresAt`.

### 12.4 Re-attestation

Re-attestation produces a fresh `SessionResponse` and a fresh `AssuranceEnvelope` with the same `principalNullifier` on the same device. Re-attestation MUST NOT be silent: the user takes an explicit step.

### 12.5 No silent token refresh

There is no silent token refresh mechanism. Re-attestation is the only path. Lifecycle expiry transitions to a `degraded` state (UI prompts to re-attest), not a silent drop.

### 12.6 Mid-session trust degradation

If a user's `trustScore` (or any `claimVector` entry) drops mid-session below a gated surface's required level, the session remains valid but actions gated above the current level are blocked at the action boundary (`assurance_too_low`). On-chain attestations MAY be updated to the lower level (degradation allowed; lower overwrites higher).

### 12.7 Multi-tab attestation lock

A vault-level mutex MUST allow only one attestation in-flight per origin. Concurrent attempts from a second tab see "Identity setup in another tab — switch there to continue."

## 13. Revocation, Sign Out, And Reset Identity

### 13.1 Definitions

- **Sign Out** ends the current session and clears short-lived state but preserves the device-bound identity. Re-attestation on the same device produces the same `principalNullifier`, the same `forumAuthorId`, and the same operator authorization.
- **Reset Identity** rotates the device-bound identity. A new `principalNullifier`, a new `forumAuthorId`, no operator authorization, no delegation grants. Reset Identity is **not** deletion and **not** repudiation.

### 13.2 Revocation state graph

| Layer | Sign Out | Reset Identity |
| --- | --- | --- |
| In-memory `useIdentity` state | Cleared | Cleared |
| `vaultMasterKey` | Preserved | Preserved |
| `deviceCredential` | Preserved | Rotated |
| `sessionToken` | Cleared | Cleared |
| `assuranceEnvelope` | Cleared | Cleared |
| `seaDevicePair` | Preserved | Rotated |
| `walletBinding` | Preserved | Cleared (prompts re-bind) |
| `delegationSigningKey` | Preserved | Rotated |
| `operatorAuthorizationToken` | Preserved | Cleared |
| `vh_delegation_v1:<principalNullifier>` localStorage | Preserved | Cleared |
| `xpLedger.activeNullifier` | Cleared then re-attached on re-attest | Cleared (new principal) |
| `useSentimentState.signals` | Cleared | Cleared |
| Hermes outbox | Untouched | Untouched (mesh-permanent) |
| Hermes chat threads | Untouched | Untouched |
| Directory entry | Preserved | Best-effort tombstone (telemetry-logged) |
| On-chain attestation | Untouched | Untouched (permanent under old principal) |
| Forum thread `author` field on prior posts | Untouched | Untouched (historical artifact under old `forumAuthorId`) |

### 13.3 Historical artifact semantics

Reset Identity rotates the principal but does **not** delete or repudiate prior public artifacts. Old forum posts, comments, votes, signed writes, and on-chain records remain under the prior `forumAuthorId` / prior `principalNullifier` / prior on-chain attestor. They are not transferred. They are not re-authored. They are not labeled as "abandoned." Moderation tools may continue to act on artifacts under prior pseudonyms (hide, restore, ban) independently of any current principal.

The vault retains the last beta-local envelope for **30 days** for audit; thereafter zeroed (this exception does not apply to Reset Identity, which zeroes immediately).

### 13.4 Forbidden claims related to revocation

- "Reset Identity deletes your activity."
- "Sign Out removes your data from the network."
- See §20 for the full list.

## 14. Continuity Contract

When M2 lands, the same user on the same device upgrades from `BetaLocalAttestationProvider` to a Silver verifier. The upgrade preserves:

| Asset | Preserved? | Mechanism |
| --- | --- | --- |
| `PrincipalId` | Yes | Same `deviceCredential` material → same `principalNullifier`. |
| `principalNullifier` | Yes | `NULLIFIER_SALT` is pinned and stable across the upgrade. |
| `forumAuthorId` | Yes | Derived from preserved `principalNullifier`. |
| `identityDirectoryKey` | Yes | Same. |
| `voterId` (per topic, epoch) | Yes | Same input, same output. |
| XP / reputation | Yes | Keyed on `principalNullifier`. |
| Wallet binding | Yes | Compartment preserved on Sign Out and on re-attestation; only Reset Identity rotates. |
| Operator authorization | Yes | Compartment preserved. |
| Public history (forum threads, comments, votes) | Yes | Authored under preserved `forumAuthorId`. |
| AssuranceEnvelope | Replaced | `assuranceLevel` upgrades from `'beta_local'` to `'silver'`; `verifierId` changes from `'beta-local'` to the pinned verifier id; `evidenceDigest` references the new Silver evidence record. |
| `evidenceRecordRef` | Replaced | New record under the verifier-emitted shape. |
| Old beta-local envelopes | Retained as historical artifacts (30 days) | Vault keeps the last beta-local envelope for 30 days for audit; thereafter zeroed. |

A user who held beta-local identity at time T MUST hold the same identity at time T+M2 unless they explicitly invoked Reset Identity. The release gate verifying this is described in §21.

## 15. Public Mesh Protocol Fields

Every public schema in `vh/*` namespaces MUST carry:

```ts
interface PublicProtocolFields {
  _protocolVersion: string;                  // semver of the protocol contract at write time
  _writerKind: 'luma' | 'system' | 'legacy';
}
```

Reader rules:
- A reader MUST refuse any record whose `_protocolVersion` is greater than the reader's known maximum.
- A reader MUST apply LUMA topology rules (signed-write envelope verification, public-author-id derivation, audience binding) only when `_writerKind === 'luma'`.
- `system` writes are signed by a system writer key. The system writer key contract — key custody, allowed namespaces, allowed record classes, signature shape, rotation procedure, compromise procedure — is defined in `docs/specs/spec-data-topology-privacy-v0.md` §8 (System Writer Key) and the cross-spec key-custody manifest in `docs/specs/spec-signed-pin-custody-v0.md`. `system` writes do not pass through `canPerform`. A reader MUST accept `_writerKind === 'system'` only when ALL of the following validate at read time:
  - `_systemWriterId` resolves to a pinned system-writer public key in the build (per `spec-signed-pin-custody-v0.md` §3 and the system-writer pin file referenced from `spec-data-topology-privacy-v0.md` §8.1);
  - the record path is in the allowed-record-classes list per `spec-data-topology-privacy-v0.md` §8.2;
  - `_systemSignature` verifies under the named signature suite (`spec-data-topology-privacy-v0.md` §8.3) over JCS(record minus `_systemSignature`);
  - the record's `_protocolVersion` is at or below the reader's known maximum and matches the schema epoch the system-writer pin was issued for.

  If any condition fails, the reader MUST reject/quarantine the record, MUST
  NOT surface it to product UI, MUST NOT route it through the legacy migration
  adapter, and MUST emit `system-writer-validation-failed` carrying the failing
  condition (one of `unknown-signer-id`, `path-not-allowed`,
  `signature-invalid`, `protocol-version-mismatch`). The legacy migration
  adapter is reserved for records missing `_writerKind` or explicitly carrying
  `_writerKind === 'legacy'`.
- `legacy` is a read-only classification for records written before the field was introduced; readers handle these via the migration adapter for that record type.
- Records written through the mesh drill test writer contract carry `_drillWriterKind`, not `_writerKind`. They live only under `vh/__mesh_drills/*` (mesh spec §5.9). LUMA readers MUST NOT process drill records and MUST NOT extend the `_writerKind` enum to include drill writers.

### 15.1 `_authorScheme` registry

Where a schema's identifier-bearing field carries a public author id, the
schema MUST also carry a field-level `_authorScheme` so readers handle each
generation explicitly. `_authorScheme` values MUST be registered in the
linkability-domain registry §9.3 (the `name` column); a value not in that
registry is rejected at read time with `mesh-author-scheme-unsupported`.

Required record classes carrying `_authorScheme` (post-M0.B):

| Record class | Path | Author field | `_authorScheme` value | Linkability domain |
| --- | --- | --- | --- | --- |
| Forum thread | `vh/forum/threads/<threadId>` | `Thread.author` | `forum-author-v1` | global, on-reset-identity |
| Forum comment | `vh/forum/threads/<threadId>/comments/<commentId>` | `Comment.author` | `forum-author-v1` | global, on-reset-identity |
| Forum post (reply/article) | `vh/forum/threads/<threadId>/posts/<postId>` | `ForumPost.author` | `forum-author-v1` | global, on-reset-identity |
| Identity directory entry | `vh/directory/<identityDirectoryKey>` | record key | `identity-directory-v1` | global, on-reset-identity |
| Aggregate voter node | `vh/aggregates/topics/<topicId>/syntheses/<synthesisId>/epochs/<epoch>/points/<pointId>/voters/<voterId>` | `voter_id` | `voter-v1` | scoped to (topic, epoch), unlinkable across scope |
| News report (reporter id) | `vh/news/reports/<reportId>` | `NewsReport.reporter_id` | `forum-author-v1` | global, on-reset-identity |
| Forum nomination | `vh/forum/nominations/<nominationId>` | `NominationEvent.nominatorAuthorId` | `forum-author-v1` | global, on-reset-identity |

Records that MUST NOT carry `_authorScheme` (no user author; system-writer or
record-derived id):

| Record class | Reason |
| --- | --- |
| News bundle / story | system writer; no user author |
| Topic synthesis (epoch + latest pointer) | system writer; no user author |
| Topic digest | system writer; no user author |
| Discovery indexes | system writer |
| Civic representative directory snapshot | system writer |
| Aggregate snapshot (`PointAggregateSnapshotV1`, topic engagement summary) | record-derived id; not author-scoped |
| Comment moderation record (`CommentModeration.operator_id`) | operator id is a system-writer-signed pseudonym; carries `_writerKind: 'system'`, no `_authorScheme` |
| News report operator action (`audit.operator_id`) | same as above |

Adding a new `_authorScheme` value is a Protocol RFC under §1.4 and requires
a corresponding linkability-domain registry entry under §9.3. Removing a
value is also an RFC; legacy records under the old scheme remain readable
via the migration adapter for one release cycle.

The fail-closed district-hash rule (§9.4) is a special case of public-mesh write enforcement.

## 16. Telemetry And Logging Redaction

### 16.1 Telemetry contract

All LUMA telemetry is local-only in Season 0. No remote collector.

```ts
type LumaEvent =
  | { type: 'luma_session_created';     at: number; assuranceLevel: AssuranceLevel; verifierIdHash: string; profileTag: ProfileTag }
  | { type: 'luma_session_expired';     at: number; reason: 'ttl' | 'manual' }
  | { type: 'luma_session_re_attested'; at: number; assuranceLevel: AssuranceLevel }
  | { type: 'luma_session_revoked';     at: number; mode: 'sign-out' | 'reset-identity' }
  | { type: 'luma_session_revoked_by_bulletin'; at: number; bulletinId: string }
  | { type: 'luma_policy_blocked';      at: number; audience: AudienceTag; reason: PolicyReason }
  | { type: 'luma_envelope_rejected';   at: number; audience: AudienceTag; reason: string }
  | { type: 'luma_tombstone_attempted'; at: number; domain: string; pathClass: string; redactedPathHash: string; outcome: 'ok' | 'fail' }
  | { type: 'luma_evidence_capture_started';   at: number; profileTag: ProfileTag }
  | { type: 'luma_evidence_capture_succeeded'; at: number; profileTag: ProfileTag }
  | { type: 'luma_evidence_capture_failed';    at: number; profileTag: ProfileTag; reason: string }
  | { type: 'luma_forbidden_claim_rendered';   at: number; surface: string }
  | { type: 'luma_safety_bulletin_fetched';    at: number; bulletinId: string; outcome: 'fresh' | 'stale' | 'fetch_failed' }
  | { type: 'luma_vault_migrated_v1_to_v2';    at: number };
```

Path redaction: `luma_tombstone_attempted` carries `{ domain, pathClass, redactedPathHash }` instead of a raw path. `domain` is one of the registered linkability domains; `pathClass` is a coarse classification (`directory`, `outbox`, `forum-author-record`, etc.); `redactedPathHash` is `H(salt ‖ rawPath)` with a per-session salt rotated on Sign Out.

### 16.2 Forbidden fields

A typed `isPii` check at the emit site rejects:
- `Nullifier`-typed values; raw `deviceCredential`.
- `sessionToken`; raw signature bytes; raw envelope JSON; raw `verifierId` (use `verifierIdHash`).
- Raw `district_hash`; raw `region_code`.
- Raw mesh paths.
- Any URL containing a token query string.

### 16.3 Retention

In-memory ring buffer, max 1000 events. Cleared on Sign Out and on Reset Identity. Exposed to `/account/identity` debug panel only.

### 16.4 Client logging redaction policy

`console.info` / `console.warn` / `console.error` in identity, vault, gun-client, and policy code MUST go through `lumaLog(level, message, context)` which applies the same redaction list as telemetry. Direct `console.*` is lint-forbidden in those packages.

### 16.5 Cross-spec trace and report allowance

The mesh readiness report (`spec-mesh-production-readiness.md` §4 Slice 11)
and the production-app canary report join browser, gun-client, relay,
daemon, and report artifacts via opaque correlation identifiers. To support
that join without violating LUMA telemetry redaction rules, the following
identifiers are explicitly **permitted** in mesh/canary reports and in
LUMA telemetry that surfaces in those reports:

- `run_id` (mesh report run identifier)
- `write_id` (deterministic per-write identifier; see mesh spec §5.2)
- `trace_id` (per-write join key across browser/relay/daemon)
- `drill_run_id` (mesh drill writer correlation identifier; see mesh spec
  §5.9)
- `idempotencyKey` from `SignedWriteEnvelope` (already public-derived; safe
  to surface)
- `audience` from `SignedWriteEnvelope` (closed enum)

The forbidden-fields list in §16.2 continues to apply to the mesh and
canary report contents. Specifically forbidden in those reports:

- raw mesh paths (use `redactedPathHash` per §16.1)
- raw `SignedWriteEnvelope` JSON or any envelope field other than
  `idempotencyKey` and `audience`
- raw `principalNullifier`, raw `verifierId` (use `verifierIdHash`), raw
  device public key, raw session token
- raw signature material, peer-config private key material, drill writer
  signing key material, safety-bulletin signing material
- raw evidence vector material or raw biometric features
- unredacted relay URLs (allowed: scheme + redacted host hash)

The mesh spec §5.7.1 evidence-promotion scrub gate enforces these rules
before any `.tmp` packet is promoted to tracked evidence under
`docs/reports/evidence/`.

### 16.6 LUMA profile disablement and downstream canary

If `production-attestation` is disabled by a `SignedSafetyBulletin`
`profileDisablements` entry (§18.1), the mesh transport may still be
healthy and a mesh readiness gate may still pass. The downstream
production-app canary (`pnpm check:production-app-canary` from the mesh
spec §4 Slice 11) MUST fail closed in this state with a LUMA-named reason
(`profile_forbidden` or `session_revoked_by_bulletin`), not a mesh
transport reason. The canary MUST NOT silently degrade to `public-beta`.
The canary report records the bulletin id and the disablement reason. See
mesh spec §5.8 for the cross-gate boundary.

## 17. Transparency Manifest

Every M2 verifier deployment publishes a transparency manifest. Custody decides who can sign; transparency decides whether silent policy drift is detectable.

```ts
interface VerifierTransparencyManifest {
  manifestVersion: 1;
  signatureSuite: SignatureSuite;
  verifierId: string;
  buildHash: string;                         // git commit + reproducible-build hash
  policyVersion: string;
  schemaVersion: string;
  saltFingerprint: string;                   // H(NULLIFIER_SALT) — never the salt itself
  trustScorePolicyHash: string;              // H(JCS(canonical policy doc))
  acceptedSignatureSuites: SignatureSuite[];
  publicKey: string;
  retiredKeys: { keyId: string; retiredAt: number; reason: string }[];
  publishedAt: number;
  signature: string;                         // signed by previous-generation key during rotations
}
```

Endpoint: `GET /.well-known/luma-verifier-manifest`. Append-only mirrored to GitHub Pages plus a Sigstore-rekor entry per manifest. Clients verify on every session creation that the live JWKS matches the manifest. Drift is a hard reject.

### 17.1 Verifier identity pinning

Build-time pinned manifest at `apps/web-pwa/src/luma/verifier-pin.json` names the expected `verifierId`, `buildHash`, `policyVersion`, `schemaVersion`, `saltFingerprint`, and `acceptedSignatureSuites`. A verifier whose live values do not match is treated as untrusted. `VITE_ATTESTATION_URL` is configurable per environment; the verifier identity the client trusts is not.

The build assertion `pnpm check:luma-production-profile` verifies that the pinned manifest exists, is well-formed, and matches an expected fingerprint provided to the build.

### 17.2 Salt pinning

`NULLIFIER_SALT` is pinned per profile in checked-in config. Salt rotation is a P0 incident requiring its own migration plan (see `spec-identity-trust-constituency.md` §10 and the verifier deployment runbook produced by M2).

## 18. Safety Bulletin

The transparency manifest is for normal operation. The signed safety bulletin is the operational kill switch.

```ts
interface SignedSafetyBulletin {
  bulletinVersion: 1;
  signatureSuite: SignatureSuite;
  bulletinId: string;                        // monotonic
  publishedAt: number;
  freshnessWindow: number;                   // ms; clients reject bulletins older than now - freshness
  minAcceptedProtocolVersion: string;
  revokedVerifierIds: string[];
  revokedPolicyHashes: string[];
  revokedManifestFingerprints: string[];
  profileDisablements: { profile: DeploymentProfile; reason: string }[];
  notice: string;                            // human-readable
  signature: string;                         // signed by verifier root key (NOT the rotating subkey)
}
```

Endpoint: `GET /.well-known/luma-safety-bulletin`. Append-only mirrored alongside the transparency manifest.

### 18.1 Client behavior

Clients fetch on every session creation, on lifecycle expiry, and on a `<freshnessWindow>`-aligned background poll. A missing or stale bulletin in `production-attestation` is a hard reject. Default freshness window: 24 hours.

Clients honor:
- `minAcceptedProtocolVersion` — refuse to use sessions whose `SignedWriteEnvelope.protocolVersion` is lower.
- `revokedVerifierIds` — drop any session whose envelope's `verifierId` is on the list (transitions to `session_revoked_by_bulletin`).
- `revokedPolicyHashes` — drop any session whose envelope's `policyVersion` hashes to a revoked value.
- `revokedManifestFingerprints` — refuse pinned-manifest matches.
- `profileDisablements` — display a soft-block message and refuse new attestations in the named profile until a fresher bulletin clears the block.

### 18.2 Root-key signing requirement

The bulletin's signature MUST be produced by the verifier root key in cold storage, not by an online subkey. This means a compromised online subkey cannot forge a malicious "all clear" bulletin.

## 19. DSAR And Responsible Disclosure Hooks

The policies live in ops docs; this section names the integration hooks.

### 19.1 DSAR / privacy requests

Integrated with the existing `/support` and `/data-deletion` surfaces and the documented private-handoff escalation in `docs/ops/public-beta-compliance-minimums.md`. Not a parallel desk.

The honest stance, locked in copy:
- "LUMA is designed so that personal data is minimized at the source. Most of what is associated with your identity lives only on your device, encrypted in your vault."
- "When you submit a privacy request, we honor it to the technical extent possible: clearing your local vault, tombstoning your directory entry on a best-effort basis, and removing operator-side records under your principal nullifier."
- "Public mesh records authored under your prior pseudonym persist by design of the protocol. We will provide a written description of the protocol's data flow as part of the response."
- "On-chain attestations are permanent and cannot be deleted by anyone, including us."

DSAR response template lives at `dsar-response-template.md` under `docs/ops/` (created at M2.C release readiness).

### 19.2 Responsible disclosure

Locked policy elements (publishable in `security.md` at the docs root and at `/security`):

- **Scope**: this spec, the verifier service binary and keys, the Web PWA `apps/web-pwa/src/luma/**` surface, the SDK packages (`packages/luma-sdk`, `packages/identity-vault`, `packages/types/identifiers**`), and the verifier transparency manifest / safety bulletin endpoints. Out of scope: third-party packages without proven reachability, social-engineering attacks against operators, denial-of-service that does not bypass rate limiting.
- **Safe harbor**: researchers acting in good faith within scope are protected from legal action, including DMCA / CFAA-style claims, provided they (a) do not access user data beyond what is necessary to demonstrate the bug, (b) do not exploit or persist beyond proof-of-concept, and (c) honor the disclosure window.
- **Intake address**: `security@<vh-domain>` (final address resolved at M2.C); plus a public PGP key. A public reporting form linked from `/security` is permitted but the email is the canonical channel.
- **Triage SLA**: acknowledge within 3 business days; initial severity assessment within 7 business days; status updates at least every 14 days until close.
- **Public disclosure window**: 90 days from acknowledgement, extendable by mutual agreement. Critical vulnerabilities under active exploitation may be disclosed sooner with researcher coordination.
- **Severity rubric**: Critical (verifier key compromise, signature forgery, `principalNullifier` extraction without device access), High (cross-audience replay, downgrade attack, k-anonymity violation), Medium (UX-level forbidden-claim leak, telemetry redaction bypass), Low (informational).
- **Payment ranges**: owned by finance and legal; not specified in this spec.

## 20. Forbidden Claims

The forbidden-claims registry is normative. UI copy, marketing, docs, and contract event names MUST NOT use these strings or close paraphrases while the active provider configuration cannot back the claim.

Initial registry:
- "verified human"
- "one-human-one-vote"
- "Sybil-resistant"
- "district-proof"
- "cryptographic residency"
- "permanently delete"
- "anonymous"
- "untraceable"
- "Reset Identity deletes your activity"
- "Sign Out removes your data from the network"
- "permanently deleted from the network"
- "fully anonymous"
- "untraceable across devices"

Enforcement:
- Build-time grep: `pnpm check:luma-forbidden-claims` over `apps/web-pwa/src/**/*.{ts,tsx,md}`. Whitelist for files that intentionally discuss forbidden claims (this spec, the identity spec, the LUMA whitepaper, the security policy).
- Runtime defense: a `<TrustClaim>` wrapper renders any string against the registry at render time. In `dev`/`e2e`: throws. In `public-beta`/`production-attestation`: renders a redacted box and emits `luma_forbidden_claim_rendered`.

Adding or removing a forbidden claim is a Protocol RFC.

## 21. Test Vectors And Acceptance Tests

### 21.1 Frozen test vectors

Checked into `packages/types/test-vectors/`:
- HKDF-SHA-256 derivation per linkability domain.
- Ed25519 signatures over JCS-canonical envelopes for each supported suite.
- JCS canonical encoding of representative payloads.
- RFC 5869 KDF golden vectors.
- AssuranceEnvelope JCS hash.
- SignedSafetyBulletin JCS hash.
- HMAC-SHA-256 nullifier derivation with a fixed test salt.

Any future Rust/Go implementation consumes the same vectors.

### 21.2 Adversarial assurance harness

Before any implementation may claim Silver assurance, the corpus below MUST pass. Implemented under `services/luma-verifier/tests/adversarial/` and `apps/web-pwa/e2e/adversarial/`.

| Attack | Expected response |
| --- | --- |
| Replayed video | `attestation_replayed` or `bad_nonce` |
| Synthetic camera feed | `attestation_too_low` |
| Missing IMU on mobile | `attestation_too_low` |
| Emulator / rooted device | `attestation_too_low` |
| Clock skew (client +1 day) | accept within tolerance; TTL counter behaves correctly |
| Clock skew (client -1 day) | accept; TTL counter clamps to server-set `expiresAt` |
| Nonce replay | `attestation_replayed` |
| Origin mismatch | `origin_mismatch` |
| Audience replay | `audience_mismatch` |
| Profile crossover | `profile_forbidden` |
| Salt mismatch | `salt_mismatch` |
| Manifest drift | `manifest_drift` (hard reject) |
| Bulletin staleness | block new attestations until fresh |
| Hostile verifier | `verifier_identity_mismatch` |
| Signature suite mismatch | `signature_suite_unsupported` |
| Envelope downgrade | `assurance_degraded` |
| Idempotency replay | `idempotency_replay` |
| Accessibility failure path | falls back to `view-only` cleanly |

### 21.3 Continuity verification

A release gate runs the beta-local → Silver upgrade on a recorded engagement corpus and asserts byte-identical `PrincipalId`, `forumAuthorId`, XP totals, wallet binding, and operator status before and after. A divergence fails the gate.

### 21.4 Telemetry redaction red test

A recorded full-product engagement run is replayed; every emitted `LumaEvent` is checked against §16.2 forbidden fields. Any forbidden field anywhere fails the test. CI: `pnpm check:luma-telemetry-redaction`.

### 21.5 Public-namespace leak gate

`pnpm check:public-namespace-leaks` runs against a recorded mesh fixture and fails on raw nullifier presence in records written after the cutover commit timestamp. Legacy records are not counted.

### 21.6 Linkability-domain registry gate

`pnpm check:linkability-domain-registry`: every public-id surface in code must reference a registered domain (§9.3). New surfaces are rejected at review.

## 22. Deferred Capabilities

| Capability | LUMA whitepaper phase | Integration point |
| --- | --- | --- |
| Cryptographic residency proof (DBA, region notary) | Phase 5 | New `CryptographicConstituencyProvider` (§7) |
| ZK-SNARK enrollment + Pedersen vector commitments | Phase 4 | Same |
| BioKey hardware (Gold) | Phase 3 | New `AttestationProvider` implementation; `device_integrity` claim level upgrade |
| Linkage Escrow + Intent-Based Decryption | Phase 2 | `coercion_resistance` claim level; new key compartment |
| Lazarus social recovery | Phase 2 | `recoveryKey` compartment (reserved in §11.2) |
| Canary System | Phase 4+ | Verifier-side; outside this spec |
| Per-human nullifier binding (cross-device) | Phase 3+ | `PrincipalId` projection rule (§3) |
| Real multi-device linking cryptography | Phase 3+ | New SDK surface; `linkDevice` stub today |
| Dynamic trust adjustment | Season 1+ | Mid-session envelope mutation (§12.6 already permits degradation) |
| Remote session revocation | Phase 3+ | Extension of §13 + safety bulletin (§18 already supports `revokedVerifierIds` and `revokedPolicyHashes`) |
| Federation / multi-verifier | Season 1+ | Verifier-pin set rather than single pin |
| Anti-coercion / duress affordance | Phase 2 | `coercion_resistance` claim level; new SDK surface |
| Composability with non-LUMA identities (Passport, World ID, Eth wallet) | Season 1+ | Out of scope; `claimVector` is not extended |
| Post-quantum signature suites | Season 2+ | Suite enumeration (§6.2); reserved slots |
| Account merging across devices | Phase 3+ | Out of scope |
| Username squatting reclaim | Season 1+ | Out of scope |

Implementations MUST NOT build features from this list without a successor spec or RFC that resolves prerequisites.
