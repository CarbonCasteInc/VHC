# LUMA Service v0 Roadmap

> Status: Draft v0.7 — execution-sequence document; the normative service contract has been extracted to `docs/specs/spec-luma-service-v0.md`.
> Date: 2026-05-02 (v0.1 through v0.6); 2026-05-04 (v0.7 mesh-coherence pass)
> Owner: VHC Spec Owners (proposed)
> Depends On: `docs/specs/spec-luma-service-v0.md`, `docs/specs/spec-identity-trust-constituency.md`, `docs/specs/spec-data-topology-privacy-v0.md`, `docs/specs/spec-mesh-production-readiness.md`, `docs/specs/spec-signed-pin-custody-v0.md`, `docs/specs/secure-storage-policy.md`, `docs/foundational/LUMA_BriefWhitePaper.md`, `docs/foundational/STATUS.md`, `docs/foundational/System_Architecture.md`, `docs/ops/luma-verifier-current-state.md`, `services/luma-verifier-dev/src/main.rs`, `apps/web-pwa/src/hooks/useIdentity.ts`, `packages/identity-vault/src/vault.ts`, `packages/identity-vault/src/types.ts`, `packages/gun-client/src/auth.ts`
> Scope: Sequence the work that lands `docs/specs/spec-luma-service-v0.md` in code. Implementation milestones, codebase reality check, and open decisions only — normative contract material lives in the spec.

## Purpose

LUMA today has a vision (`docs/foundational/LUMA_BriefWhitePaper.md`), Season 0 semantics (`docs/specs/spec-identity-trust-constituency.md`), transitional hooks in `apps/web-pwa` and `packages/gun-client`, and a DEV-only Rust stub in `services/luma-verifier-dev`. The v0 service contract is now in `docs/specs/spec-luma-service-v0.md`. This roadmap sequences the implementation work that turns that contract into shipped code.

This is a non-authoritative execution artifact (per `docs/README.md` precedence rules). Where this document and the spec disagree, the spec wins.

## How to read this document

Each milestone is structured as:

- **Goal** — one-sentence outcome.
- **Inputs / dependencies** — what must be true before starting.
- **Deliverables** — concrete files, types, endpoints, UI surfaces.
- **Acceptance criteria** — objectively verifiable outcomes.
- **Forbidden during this milestone** — claims, code paths, and shortcuts that block the milestone.
- **Rollback / reversibility** — how to back out if a deliverable is wrong.
- **Open questions** — decisions that must be resolved during the milestone.

Iteration protocol: `// REVIEW: <author> <date> — <note>` callouts inline rather than silent rewrites.

## Pointer table — roadmap concepts → spec sections

| Concept | Spec section |
| --- | --- |
| Service boundary, OID4VC reservation | `docs/specs/spec-luma-service-v0.md` §1 |
| Deployment profiles (`dev` / `e2e` / `public-beta` / `production-attestation`) | §2 |
| `PrincipalId` vs `Nullifier` | §3 |
| AssuranceEnvelope, claim vector, `scoreFromEnvelope` | §4 |
| SignedWriteEnvelope, AudienceTag enum, idempotency, ToC/ToU rule | §5 |
| Signature suites, RFC 8785 (JCS), constant-time discipline | §6 |
| Provider model, per-profile allow-list | §7 |
| BetaLocalAttestationProvider shape | §8 |
| Public-id derivation (HKDF-SHA-256), linkability-domain registry, district-hash k-anonymity | §9 |
| `canPerform`, `PolicyReason`/`PolicyRecoveryHint` enums, latency budget, audience+origin binding | §10 |
| Vault structure, key-compartment manifest, `deviceCredential`, `delegationSigningKey`, `walletBinding`, evidence retention/zeroization | §11 |
| Session lifecycle, TTL, re-attestation, no silent refresh, multi-tab lock | §12 |
| Sign Out vs Reset Identity, revocation state graph, historical-artifact semantics | §13 |
| Beta-local → Silver continuity contract | §14 |
| Public mesh fields (`_protocolVersion`, `_writerKind`) | §15 |
| Mesh boundary, schema-epoch invalidation, drill writer exemption | §1.5 |
| Telemetry contract, path redaction, client logging redaction | §16 |
| Cross-spec trace allowance for mesh/canary reports; profile-disablement canary rule | §16.5, §16.6 |
| Verifier transparency manifest, identity pinning, salt pinning | §17 |
| Signed safety bulletin, kill-switch fields, root-key signing | §18 |
| DSAR via `/support` and `/data-deletion`; bug bounty scope/SLA/window/rubric | §19 |
| Forbidden-claims registry | §20 |
| Frozen test vectors, adversarial assurance harness, continuity verification gate, telemetry red test, namespace-leak gate, registry gate | §21 |
| Deferred capabilities and integration points | §22 |

## Locked defaults

Every locked default below is normative under the spec section in parentheses; the roadmap restates them only as execution stance.

- Forum pseudonym is **global-stable** for v0 (§9).
- Public-id derivation is **HKDF-SHA-256** with versioned domain labels and frozen test vectors (§9).
- Identifier migration uses the **four-layer model** (new-write prevention, read-side quarantine, best-effort tombstones, legacy display) (§15).
- The `vh/directory/` PII bypass in `packages/gun-client/src/topology.ts` is **hard-removed** at end of M0.B (§9).
- Session TTL default is **7 days** for beta-local sessions; the value is shared with the intended Silver TTL, the assurance is not (§12).
- Identity controls live at **`/account/identity`** (M1.B).
- **Sign Out preserves SEA `devicePair` and operator authorization**; only **Reset Identity** rotates the SEA pair, clears delegation grants, and clears operator authorization (§13).
- **Telemetry is local-only for Season 0** (§16).
- **Forbidden-claims is a release gate** (§20).
- **The Rust DEV stub verifier is restricted to `dev` and `e2e`.** It is forbidden in `public-beta` and `production-attestation`. `public-beta` uses `BetaLocalAttestationProvider` until M2 lands (§2, §8).
- **`production-proof` is renamed `production-attestation`.** Constituency proof remains beta-local in this profile until a separate cryptographic-proof spec (§2).
- **`PrincipalId` is a distinct type from `principalNullifier`** (§3).
- **AssuranceEnvelope replaces scalar `trustScore` as the authority shape** (§4).
- **Every LUMA-gated write uses the signed-write envelope**, including an explicit `idempotencyKey` (§5).
- **`canPerform` is the single authority** for write/vote/claim/familiar decisions, returning a typed `PolicyReason` from a closed enum (§10).
- **Verifier publishes a transparency log** (§17).
- **Signed safety bulletin** is the operational kill switch (§18).
- **Audience binding is required** on every signed assertion (§5, §10).
- **Canonical JSON is RFC 8785 (JCS)** (§6).
- **Signatures use named suites** (`signatureSuite`); PQ migration is a suite addition, not an envelope-shape change (§6).
- **`Date.now()` is fronted by an injectable `Clock` interface** in the SDK.
- **District-hash k-anonymity threshold is `MIN_DISTRICT_COHORT_SIZE = 100`**, fail-closed for non-aggregate public records (§9).
- **First-run is read-only**; identity gates only writes/votes/claims (M2.D).
- **Trust score shown as a tier**, not a number.
- **Familiar UX in v0 is developer-only stub-marked.**
- **OID4VC fields/terms are reserved; not implemented in v0** (§1).
- **Latency budget for `canPerform`: <5 ms cached / <50 ms cold** (§10).
- **Constant-time discipline** required for hashes, signatures, salt fingerprints, idempotency-key dedupe, revocation membership; SHA-256 itself is fine; comparisons are where mistakes land (§6).
- **Reset Identity is not deletion and not repudiation** (§13).
- **Beta-local → Silver continuity** preserves `PrincipalId`, `forumAuthorId`, `identityDirectoryKey`, XP, wallet binding, operator authorization, and public history on the same device (§14).
- **Adversarial assurance harness gates the Silver claim** (§21).
- **Bug-bounty / responsible-disclosure scope** locked: scope, safe-harbor, intake address, triage SLA, public disclosure window, severity rubric. Payment ranges are owned by finance/legal and not locked here (§19).
- **DSAR / privacy requests** integrate with existing `/support` and `/data-deletion` (§19).
- **Public objects carry `_protocolVersion` and `_writerKind`**; readers reject unknown protocol versions and apply LUMA topology rules only when `_writerKind === 'luma'` (§15).
- **Idempotency key on signed writes** with a **7-day dedupe window** per `(publicAuthor, audience)` (§5).
- **Mesh transport readiness is owned by `spec-mesh-production-readiness.md`**; LUMA-gated writes require both the LUMA gate and the mesh transport gate to pass for release-claim validity (§1.5).
- **Any LUMA public-schema epoch change invalidates prior mesh readiness** for affected write classes; M0.B exit requires a post-M0.B mesh re-run with `schema_epoch: 'post_luma_m0b'` (§1.5; mesh spec §5.8).
- **Mesh drill records are namespace-scoped to `vh/__mesh_drills/*` and live outside the LUMA `_writerKind` enum** (§15; mesh spec §5.9).
- **System writer key contract is owned by `spec-data-topology-privacy-v0.md` §8 and the cross-spec key-custody manifest in `spec-signed-pin-custody-v0.md`** (§15).
- **LUMA profile disablement (`SignedSafetyBulletin.profileDisablements`) fails the production-app canary closed with a LUMA-named reason**, never a mesh transport reason (§16.6).

## Codebase reality check (2026-05-02)

| Area | Current state | Roadmap consequence |
| --- | --- | --- |
| Service boundary | No `spec-luma-service-v0.md` (extracted by this PR). | M0.A is the spec-creation milestone; this PR is its first slice. |
| Identity semantics | `spec-identity-trust-constituency.md` v0.4 is canonical. | M0.B reconciles the identifier-topology conflict against the spec. |
| Identifier taxonomy conflict | `spec-data-topology-privacy-v0.md` §2 forbids raw `nullifier` in public namespaces. `spec-hermes-forum-v0.md` §2.1 sets thread `author` to "principal nullifier"; `packages/data-model/src/schemas/hermes/directory.ts` publishes nullifier publicly; `packages/gun-client/src/topology.ts:99` exempts `vh/directory/` from PII guard. | M0.B is a hard prerequisite. |
| Beta-local proof provider | `apps/web-pwa/src/store/bridge/realConstituencyProof.ts` returns deterministic `s0-root-…` material; `useConstituencyProof()` honestly labels `assurance: "beta_local"`. | M0.C wraps it behind a typed provider interface. |
| Device-key randomization | `apps/web-pwa/src/hooks/useIdentity.ts:317` (`buildAttestation`) generates a fresh random `deviceKey` on every identity creation. The verifier derives nullifier from `deviceKey` (`services/luma-verifier-dev/src/main.rs:324`). | Contradicts identity spec §2.1.1. M0.D fixes it. |
| SEA device pair rotation | `useIdentity.ts:114` calls `SEA.pair()` on every identity creation. | M0.D treats the SEA pair as a separate key compartment with its own lifecycle (Sign Out preserves it). |
| Existing Rust verifier | `services/luma-verifier-dev/src/main.rs` is a DEV-only stub with `ENV_POSTURE = "DEV"`, length/prefix heuristics, `NULLIFIER_SALT` env-driven, no nonce freshness, no signing, no audit. Source comment explicitly says do not deploy without replacing the stub verification logic. | M0.E records in `docs/ops/luma-verifier-current-state.md`. M0.F renames mechanically. M2.B builds a new service alongside. |
| Rust ↔ TS schema drift | Rust `SessionResponse` returns `{ token, trustScore, nullifier, environment, disclaimer }`. TS spec expects `{ token, trustScore, scaledTrustScore, nullifier, createdAt, expiresAt }`. | M0.E records drift; M2.A formalizes a single shared schema. |
| Vault structure | `packages/identity-vault/src/vault.ts` stores an opaque `Identity = Record<string, unknown>` blob keyed by `IDENTITY_KEY = 'identity'` at `VAULT_VERSION = 1`. `clearIdentity()` removes only that key. No `deviceCredential` separation. | M0.D bumps to `VAULT_VERSION = 2` with typed schema and key-compartment-aware accessors per spec §11. |
| Secure-storage policy granularity | `secure-storage-policy.md` Tier 1 lumps "Master key, Identity record, Session token, Nullifier, Trust score". | M0.D produces the key-compartment manifest sub-spec under that authority (lands as part of spec §11). |
| Env-name drift | `packages/gun-client/src/auth.ts:7` reads `ATTESTATION_URL`. `apps/web-pwa/src/hooks/useIdentity.ts:18` reads `VITE_ATTESTATION_URL`. Both default `localhost:3000/verify`. | M0.E records. M1.C build assertion checks both names resolve to the same URL. |
| Revocation underdelivers vs comments | `revokeSession` JSDoc claims it clears delegation grants; implementation does not. | M1.B revocation state graph (per spec §13) makes behavior match comments. |
| Dev fallback trust score | `useIdentity.ts:127` uses hard-coded `trustScore: 0.95` when verifier is unreachable in dev mode. | M1.C removes from non-dev profiles via build-time assertion. |
| E2E auto-create | `useIdentity.ts:188` auto-calls `createIdentity()` when `status === 'anonymous' && E2E_MODE`. | M1.C build-time assertion makes `VITE_E2E_MODE=false` the only acceptable value in `public-beta` and `production-attestation`. |
| Production proof flag | `VITE_CONSTITUENCY_PROOF_REAL` documented as "stricter validation, not a real cryptographic provider." | M0.C and M2 keep this discipline. |
| Per-human nullifier | Identity spec §1 names per-human nullifier as the target; §2 v0 implementation note records device-bound reality. | Out of scope. M0.D scopes only "stable per device". |
| Cryptographic residency proof | DBA acoustic proof, ZK-SNARK enrollment, Region Notary all unimplemented. | Out of scope. |

## Milestone M0 — Foundation freeze

Goal: produce the canonical service spec, fix the identifier-taxonomy crisis, rename the beta-local proof surface, stabilize the device credential, document the existing Rust verifier, rename it mechanically, and reconcile env-name drift.

### M0.A — Author `spec-luma-service-v0.md`

Inputs / dependencies: this roadmap, `LUMA_BriefWhitePaper.md`, identity spec, secure-storage spec.

Deliverables:
- `docs/specs/spec-luma-service-v0.md` (this PR creates it).
- New row in `docs/CANON_MAP.md`. Roll `Last Reviewed` for cross-referenced rows (this PR rolls the identity-spec row).
- Update identity spec and secure-storage spec Depends On to point at the new service spec for service-level concerns.

Acceptance criteria:
- Spec lands with all required metadata and complete §1–§22.
- Canon map updated.
- Independent reviewer confirms no silent change to `spec-identity-trust-constituency.md` semantics.
- `pnpm docs:check` passes.

Forbidden during M0.A: feature flags, numeric SLOs, TS surface renames.

Rollback / reversibility: docs-only.

### M0.B — Resolve identifier taxonomy and migrate gun-client adapters

Inputs / dependencies: M0.A complete; locked defaults; mesh spec
`spec-mesh-production-readiness.md` §5.8 LUMA Coherence Rules and §5.11
Protocol/Schema Reject Matrix landed.

Ownership note (parallel with M0.C): M0.B owns identifiers, public schemas,
topology lints, gun-client adapter migration, and the materializer migration
listed below. M0.C owns the `packages/luma-sdk` provider interfaces and
import replacement. The shared file `packages/luma-sdk/src/index.ts` requires
sequencing — M0.B lands its registry exports first; M0.C lands provider
exports second. See "Parallel M0.B/M0.C write-set split" below.

Deliverables:

- Spec updates:
  - Update `spec-data-topology-privacy-v0.md` §2 with the four-name taxonomy and four-layer migration model. Add the fail-closed `district_hash` rule per spec §9.4.
  - Update `spec-hermes-forum-v0.md` §2.1: `Thread.author` is `forumAuthorId`, with explicit global-linkability statement per spec §9.
  - Update `spec-hermes-forum-v0.md` §5.1: `NominationEvent.nominatorNullifier` becomes `nominatorAuthorId`, with `_authorScheme: 'forum-author-v1'` and the same global-linkability statement as forum authors.
  - Update `spec-civic-sentiment.md` §6 and §12: keep `VoteIntentRecord` local/sensitive, define the public aggregate voter node as scoped `voterId` per `(topic_id, epoch)`, and align deterministic aggregate keys with LUMA §9.3.
  - Add `spec-data-topology-privacy-v0.md` §8 System Writer Key contract referenced from `spec-luma-service-v0.md` §15.
- Schema and field migration:
  - Update `packages/data-model/src/schemas/hermes/directory.ts` to use `identityDirectoryKey`. Bump schema version (`hermes-directory-v1`).
  - Add `_protocolVersion` and `_writerKind` fields to every public schema per spec §15.
  - Add `_authorScheme` field at the field level for migrating records.
  - Remove `vh/directory/` PII bypass at `packages/gun-client/src/topology.ts:99`. Tighten `containsPII` allow-list.
  - Add `packages/types/src/identifiers.ts` (HKDF-SHA-256, WebCrypto + Node parity, frozen vectors) per spec §9.2.
  - Add `packages/luma-sdk/src/linkabilityDomains.ts` registry per spec §9.3.
  - Read-side quarantine adapter for legacy raw-nullifier records.
  - Best-effort tombstone helper (off by default; per-domain enable after privacy review).
- Adapter and materializer migration (the surfaces the mesh hardening
  series already touched, now on the LUMA epoch):
  - `packages/gun-client/src/forumAdapters.ts`: thread/comment writes use `forumAuthorId`, carry `_writerKind: 'luma'`, embed `SignedWriteEnvelope` with audience `vh-forum-thread` / `vh-forum-comment`.
  - `packages/gun-client/src/directoryAdapters.ts`: directory publish uses `identityDirectoryKey` and the LUMA envelope. Coordinate with mesh hardening durability rules in `spec-mesh-production-readiness.md` §5.1 (no regression on durable-write contract).
  - `packages/gun-client/src/aggregateAdapters.ts`: aggregate voter node uses scoped `voterId` per `(topic_id, epoch)`. No raw nullifier in any field. Aggregate snapshot retains supersession-by-version semantics from mesh spec §5.10.
  - `packages/gun-client/src/sentimentEventAdapters.ts`: encrypted outbox writer-kind is unchanged (`~<devicePub>/outbox/sentiment/*` per Open M0.B-3); add `_protocolVersion` and explicit topology classification.
  - `apps/web-pwa/src/hooks/voteIntentMaterializer.ts`: the join point between local sensitive `VoteIntentRecord` and the public aggregate voter node. Materializer derives `voterId` per `(topic_id, epoch)` and writes through the LUMA envelope. Local `VoteIntentRecord` shape is unchanged (still local durable queue only).
  - `packages/gun-client/src/synthesisAdapters.ts`, `newsAdapters.ts`, `newsReportAdapters.ts`, `storylineAdapters.ts`, `analysisAdapters.ts`, `topicEngagementAdapters.ts`: add `_protocolVersion` and `_writerKind` (`'system'` or `'luma'` per write class). Daemon publication paths use `_writerKind: 'system'` per the new system writer key contract.
- Topology lints and release gates:
  - Topology lint: fail-closed `district_hash` rule (only on aggregate-class paths with cohort proof).
  - Topology lint: protocol/schema reject matrix from mesh spec §5.11 enforced at the adapter layer.
  - Topology lint: drill record outside `vh/__mesh_drills/*` is hard-rejected.
  - New release gates: `pnpm check:public-namespace-leaks`, `pnpm check:linkability-domain-registry`.
  - Re-run `pnpm test:live:five-user-engagement` against the new taxonomy.
- Mesh re-run gate (post-M0.B): schema-epoch revalidation only.
  - After all adapter and materializer migration deliverables land, re-run `pnpm check:mesh:production-readiness` against the new schema epoch with `schema_epoch: 'post_luma_m0b'`. The drill harness exercises migrated write classes through their real post-M0.B reader path, not the mesh drill writer contract.
  - M0.B exit requires **per-class pass** for the write classes migrated by M0.B, not overall `release_ready`. The overall mesh report MAY remain `review_required` if non-schema mesh slices (deployed WSS topology, 30-minute soak, partition drills, resource budgets, downstream production-app canary) are still in progress; those are owned by the mesh roadmap, not M0.B.
  - The post-M0.B mesh report MUST show, for each migrated write class:
    - `status: pass` in `write_class_slos` for that class (or `insufficient_samples` only if the class is explicitly out-of-scope for the run);
    - `status: pass` in every `state_resolution_drills` row that names that class as `object_class` (mesh spec §5.10);
    - no `state-resolution-violation`, `mesh-author-scheme-unsupported`, `mesh-author-scheme-missing`, `mesh-schema-version-unknown`, or `system-writer-validation-failed` health reason for that class in `health.degradation_reasons_seen`;
    - user-authored/LUMA-envelope classes (`forum thread`, `forum comment`, `forum post`, `forum nomination`, `directory publish`, `aggregate voter node`, `news report intake reporter field`) have `drill_writer_kind_by_class[<class>] === 'luma'` and a valid `SignedWriteEnvelope`;
    - daemon/system-published classes (`news bundle/story`, `storyline`, `topic synthesis epoch`, `synthesis latest pointer`, `topic digest`, `discovery indexes`, `civic representative directory snapshot`, `comment moderation/operator action`) have `drill_writer_kind_by_class[<class>] === 'system'` and pass `spec-data-topology-privacy-v0.md` §8 system-writer validation;
    - derived aggregate snapshots that are not user-authored carry no `_authorScheme`; their expected writer kind MUST match the adapter under test, and any system-published snapshot MUST satisfy the system-writer validation condition above;
    - `release_claims.invalidated_by_luma_epoch_change: false`.
  - The mesh re-run gate is satisfied when the per-class conditions above are met for the migrated classes. M0.B is not coupled to the broader mesh roadmap; it is coupled only to schema-epoch transport revalidation for the migrated write classes.

Acceptance criteria:

- All public `vh/*` mesh writes pass the topology lint, including the
  protocol/schema reject matrix and the drill-record-out-of-namespace rule.
- `pnpm test --filter @vh/types --filter @vh/data-model --filter @vh/gun-client --filter @vh/luma-sdk` green.
- Property test: no two domain derivations collide.
- Property test: `voterId` differs across topic and across epoch.
- Lint test: a non-aggregate public write with `district_hash` is rejected even when `cohortSize` is declared.
- Migration test: every adapter listed above produces records carrying `_protocolVersion`, `_writerKind`, and (where required) `_authorScheme`. Legacy fixtures route through the migration adapter without surfacing to product UI.
- Materializer test: `voteIntentMaterializer.ts` derives `voterId` for the correct `(topic_id, epoch)` and writes the public aggregate voter node carrying `_writerKind: 'luma'` and a valid `SignedWriteEnvelope`. Local `VoteIntentRecord` does not appear on any public path.
- Mesh re-run: `pnpm check:mesh:production-readiness` produces a report with `schema_epoch: 'post_luma_m0b'` that meets the per-class conditions enumerated in the "Mesh re-run gate (post-M0.B)" deliverable above. The overall report status MAY be `review_required` if non-schema mesh slices are pending; the M0.B exit gate inspects per-class pass for the migrated write classes, not the overall report status.

Forbidden during M0.B:

- Changing on-chain attestation keying.
- Renaming `principalNullifier`.
- Migrating sentiment/outbox payloads (defer per Open M0.B-3).
- Touching `packages/luma-sdk` provider interfaces (those belong to M0.C; coordinate the shared `packages/luma-sdk/src/index.ts` via the sequencing rule in "Parallel M0.B/M0.C write-set split" below).
- Claiming per-class transport readiness for any write class migrated by M0.B before the post-M0.B mesh re-run produces a report meeting the per-class conditions in the "Mesh re-run gate" deliverable above. (M0.B does not require the overall mesh report to be `release_ready`; it requires the per-class pass for the migrated classes.)
- Widening LUMA's `_writerKind` enum to include `'mesh-drill'` or any drill writer kind. Drill writer is namespace-scoped and lives outside the LUMA enum (mesh spec §5.9).

#### Parallel M0.B/M0.C write-set split

M0.B and M0.C may run in parallel under the following ownership split.
Without this split, both teams will modify `packages/luma-sdk` and adapter
imports in `apps/` simultaneously and collide.

| Surface | Owner | Rule |
|---|---|---|
| `packages/types/src/identifiers.ts` | M0.B | M0.B writes; M0.C does not touch. |
| `packages/luma-sdk/src/linkabilityDomains.ts` | M0.B | M0.B writes; M0.C may import after M0.B lands the registry exports. |
| `packages/luma-sdk/src/providers/**` | M0.C | M0.C writes; M0.B does not touch provider interfaces. |
| `packages/luma-sdk/src/index.ts` | shared (sequenced) | M0.B lands first with registry exports. M0.C lands second with provider exports. The PRs MUST not be open simultaneously against this file. |
| `packages/data-model/src/schemas/**` | M0.B | M0.B owns schema migration; M0.C does not touch. |
| `packages/gun-client/src/topology.ts` | M0.B | M0.B removes the directory PII bypass and adds the new lints. |
| `packages/gun-client/src/{forum,directory,aggregate,sentimentEvent,synthesis,news,newsReport,storyline,analysis,topicEngagement}Adapters.ts` | M0.B | M0.B owns adapter migration. M0.C does not modify adapter logic; M0.C may adjust import paths after M0.B has landed if the SDK surface is renamed. |
| `apps/web-pwa/src/hooks/voteIntentMaterializer.ts` | M0.B | Materializer migration is part of M0.B; M0.C does not touch. |
| `apps/web-pwa/src/store/bridge/realConstituencyProof.ts` | M0.C | M0.C deprecates and replaces with SDK surface. |
| `apps/**/*.{ts,tsx}` import sites for `getRealConstituencyProof` | M0.C | M0.C replaces imports. M0.B does not. |
| `tools/scripts/check-public-namespace-leaks.*` | M0.B | M0.B writes the gate. |
| `tools/scripts/check-linkability-domain-registry.*` | M0.B | M0.B writes the gate. |
| `infra/relay/server.js`, `apps/web-pwa/src/store/peerConfig.ts` | mesh hardening (out of scope for both) | Neither M0.B nor M0.C touches transport/peer-config code. |

Conflict-resolution rule for the shared `packages/luma-sdk/src/index.ts`:
M0.B's PR lands first; M0.C rebases onto it before merging.

### M0.C — Provider interface rename

Inputs / dependencies: M0.A complete.

Deliverables:
- New `packages/luma-sdk` exporting `ConstituencyProvider`, `AttestationProvider`, `BetaLocalConstituencyProvider`, `BetaLocalAttestationProvider`, `MockConstituencyProvider`, `MockAttestationProvider`, `RustDevStubAttestationProvider` per spec §7 and §8.
- Replace direct `realConstituencyProof.ts` imports with SDK surface.
- Soft-deprecate `realConstituencyProof.ts` with re-export shim.
- Update identity spec §4.3 references that mention `getRealConstituencyProof()`.
- Wire per-profile provider allow-list into the build assertion.

Acceptance criteria (real gates only):
- No file under `apps/` references `getRealConstituencyProof` directly after sunset.
- `pnpm check:linkability-domain-registry` green.
- Tree-shake / bundle-analysis assertion: `BetaLocalAttestationProvider` is the only attestation provider in `public-beta` bundles; `RustDevStubAttestationProvider` is unreachable in `public-beta`/`production-attestation` bundles.
- Forbidden-claims grep green over the SDK surface.
- Legacy import emits deprecation warning.

Forbidden during M0.C: cryptographic-provider stubs; `ConstituencyProof` shape changes.

### M0.D — Device credential lifecycle and vault migration

Inputs / dependencies: M0.A complete.

Vault migration v1 → v2 per spec §11.1.

Deliverables:
- Vault schema bumped to v2 with migration on read.
- `packages/identity-vault/src/compartments/` typed accessors per spec §11.2.
- `useIdentity.createIdentity()` reads `deviceCredential.loadOrCreate()`.
- Split `useIdentity.revokeSession()` into `signOut()` and `resetIdentity()` per spec §13.2. `revokeSession` becomes a deprecation shim calling `signOut()`.
- Multi-device link flow (`linkDevice` / `startLinkSession` / `completeLinkSession`) explicitly stub-marked.
- `delegationSigningKey` Ed25519 generation and persistence; public component published in directory entry per spec §11.4.
- `walletBinding` semantics implemented per spec §11.5 (LUMA never holds wallet signing keys).
- Constant-time HMAC for verifier-side and any client-side nullifier derivation per spec §6.4 and §11.3.

Acceptance criteria:
- `useIdentity.ts:317` no longer calls `randomToken()` for `deviceKey`.
- Unit test: `createIdentity → signOut → createIdentity` yields the same `principalNullifier`.
- Unit test: `createIdentity → resetIdentity → createIdentity` yields a different `principalNullifier`.
- Unit test: `signOut` preserves `seaDevicePair`; `resetIdentity` rotates it.
- Unit test: vault v1 → v2 migration is idempotent.
- Unit test: `delegationSigningKey` public component appears in the directory entry; familiar `OnBehalfOfAssertion` validates against it.
- Unit test: `walletBinding` Reset Identity clears the binding and a re-bind prompt is surfaced.
- `pnpm check:luma-production-profile` confirms only v2 vault in non-`dev` profiles.

Forbidden during M0.D: cross-device per-human nullifier binding; verifier-side derivation algorithm change beyond constant-time enforcement; persisting credentials outside the vault.

Open questions:
- M0.D-2: real multi-device link in M0.D vs deferred — default deferred.
- M0.D-3: XP/reputation continuity across Sign Out — default preserved.
- M0.D-4: legacy-vault migration policy — default reuse existing `deviceKey` as `deviceCredential`.

### M0.E — Existing verifier reconciliation (docs-only)

Goal: document the Rust DEV stub, pin schema/salt invariants, record env-name drift.

Deliverables:
- New ops doc `luma-verifier-current-state.md` (under `docs/ops/`) with file:line references throughout.
- Schema reconciliation sub-section (Rust ↔ TS drift table).
- Env-name drift sub-section (`ATTESTATION_URL` vs `VITE_ATTESTATION_URL`); pinning policy: build assertion in M1.C requires both names resolve to the same URL.
- `NULLIFIER_SALT` policy sub-section: pin per profile in checked-in config; salt rotation = P0 incident.
- Adds the document as a required input to M2.A.

Acceptance criteria:
- Current-state doc lands.
- Drift table is exhaustive.
- `NULLIFIER_SALT` policy decision recorded.
- Env-name drift policy decision recorded.

Forbidden during M0.E: modifying the Rust verifier; renaming directories; adding non-DEV deployments.

Open questions:
- M0.E-1: `NULLIFIER_SALT` policy — default pinned per profile in checked-in config.

### M0.F — Mechanical verifier rename

Goal: mechanically move the DEV verifier stub to `services/luma-verifier-dev`. No behavior change.

Deliverables:
- Directory rename.
- Workspace globs, Cargo workspace members, Dockerfile paths, CI config updated.
- `cargo test` passes at the new location.
- Release note: "DEV-only verifier moved; behavior unchanged."

Acceptance criteria:
- Build, test, and dev-stack runbooks pass at the new path.
- No active/runtime reference to the previous verifier service path remains.

## Milestone M1 — Lifecycle hardening

### M1.A — Default-on session lifecycle and AssuranceEnvelope wiring

Inputs / dependencies: M0.A, M0.D, M0.E complete.

Deliverables:
- Flip default of `VITE_SESSION_LIFECYCLE_ENABLED` in `public-beta` and `production-attestation` to `true`.
- 7-day TTL.
- Near-expiry warning UI in bridge layout when within 24h.
- Re-attestation flow producing fresh `SessionResponse` and fresh `AssuranceEnvelope` with the same `principalNullifier` (depends on M0.D).
- `IdentityRecord.session` carries `AssuranceEnvelope`. Legacy scalar `trustScore` via `scoreFromEnvelope`.
- `BetaLocalAttestationProvider` per spec §8.
- Client fetches `SignedSafetyBulletin` per spec §18 on session creation and at lifecycle expiry.
- Telemetry events per spec §16 (with redacted paths).

Acceptance criteria:
- E2E: clock fast-forward past `expiresAt` blocks trust-gated actions.
- E2E: re-attestation preserves `principalNullifier` and emits a fresh envelope.
- E2E: `BetaLocalAttestationProvider` produces an envelope with all-`beta_local` claim vector and a valid Ed25519 signature.
- E2E: a `SignedSafetyBulletin` revoking the current `verifierId` causes the next session creation to fail with `session_revoked_by_bulletin`.
- Manual QA on `public-beta` profile build.

Forbidden during M1.A: server-side session list; silent token refresh; leaking envelope contents to telemetry.

### M1.B — User-facing identity controls and revocation state graph

Inputs / dependencies: M0.D complete; M1.A in progress.

Deliverables:
- `/account/identity` route per spec §13.
- `useIdentity.signOut()` and `useIdentity.resetIdentity()` per spec §13.2 state graph.
- Confirmation modals; copy must align with spec §13.3 historical-artifact semantics and the §20 forbidden-claims registry.
- Wallet re-bind prompt on next claim after Reset Identity per spec §11.5.
- Privacy/deletion links to `/support` per spec §19.1.
- Visible session metadata; `principalNullifier` is never shown.
- Unit test asserting every row of the spec §13.2 state graph.

Acceptance criteria:
- E2E: create → publish → sign out → re-create asserts same `principalNullifier`, same `forumAuthorId`, same operator authorization, same wallet binding.
- E2E: create → publish → reset identity → re-create asserts different `principalNullifier`, different `forumAuthorId`, no operator authorization, no delegation grants, wallet re-bind prompt rendered.
- A11y audit on the panel passes baseline.
- No telemetry leak of token, principal nullifier, or credential material.

Forbidden during M1.B: any "delete account" affordance touching mesh-side state beyond best-effort tombstones; UI showing `principalNullifier`; copy implying Reset Identity is deletion.

### M1.C — Remove dev fallback and harden production-attestation guard

Comprehensive dev-fallback table:

| Surface | File | Today | After M1.C |
| --- | --- | --- | --- |
| Trust-score 0.95 fallback | `useIdentity.ts:127` | `if (DEV_MODE)` | Gate behind `VITE_LUMA_DEV_FALLBACK=true`. Off in `public-beta`/`production-attestation`. |
| E2E auto-create | `useIdentity.ts:188` | `if (E2E_MODE)` | Build assertion: `VITE_E2E_MODE=false` is the only acceptable value in `public-beta`/`production-attestation`. |
| Attestation timeout default | `useIdentity.ts:19` | 2000ms env-tunable | Pinned at build time per profile. `production-attestation`/`public-beta`: 5000ms; `dev`/`e2e`: 2000ms. |
| Verifier URL | `useIdentity.ts:18`, `gun-client/auth.ts:7` | Both default localhost | Build assertion: both env names resolve to identical URL or build fails. |
| Mock constituency proof | `constituencyProof.ts` | Test/dev only | Tree-shake assertion: not present in `public-beta`/`production-attestation` bundles. |
| Rust DEV stub URL | `services/luma-verifier-dev` | Allowed everywhere | Bundle assertion: `VITE_ATTESTATION_URL` does not point at known DEV-stub hosts in non-`dev` profiles. |

Deliverables:
- Replace `DEV_MODE` guard with `VITE_LUMA_DEV_FALLBACK`.
- Replace magic `0.95` with `DEV_FALLBACK_TRUST_SCORE` constant.
- Build-time assertions per the table.
- New release gate `pnpm check:luma-production-profile` wired into `pnpm check:mvp-release-gates`.

Acceptance criteria:
- `pnpm build --profile=production-attestation` with any forbidden flag fails with clear error.
- A test reproduces "verifier unreachable" in `public-beta` and asserts the user sees an error rather than silent dev fallback.
- Env-name drift test fails the build when `ATTESTATION_URL` and `VITE_ATTESTATION_URL` diverge.

Forbidden during M1.C: increasing dev fallback trust score; replacing dev fallback with a "stub real verifier"; weakening any of the table's gates.

### M1.D — Forbidden-claims release gate (with runtime defense)

Deliverables:
- `pnpm check:luma-forbidden-claims` greps `apps/web-pwa/src/**/*.{ts,tsx,md}` against spec §20 registry. Whitelist for files that intentionally discuss forbidden claims (this roadmap, identity spec, whitepaper, security policy, the spec itself).
- Wire into `pnpm check:mvp-release-gates`.
- Runtime defense: `<TrustClaim>` wrapper per spec §20.

Acceptance criteria:
- CI gate green on current `main`.
- Red test: PR introducing forbidden phrase fails the gate.
- Red test: `<TrustClaim>` with forbidden string in `dev` profile throws.

Forbidden during M1.D: whitelisting user-facing copy.

### M1.E — Telemetry contract implementation

Deliverables:
- `packages/luma-sdk/src/telemetry.ts` implementing the event registry and `lumaLog` per spec §16. Includes `redactedPathHash` derivation with per-session salt rotated on Sign Out.
- Lint rule: `no-direct-console` for `apps/web-pwa/src/hooks/identity/**`, `packages/identity-vault`, `packages/gun-client`, `packages/luma-sdk`.
- Lint rule: `luma-no-eq-on-secrets` per spec §6.4.
- `useTelemetry()` hook exposing the in-memory ring buffer to `/account/identity` debug panel.
- Red test per spec §21.4.
- `pnpm check:luma-telemetry-redaction` runs the red test in CI.

Acceptance criteria:
- Red test green over `pnpm test:live:five-user-engagement` recording.
- No `console.*` calls in the four namespaces.
- No `===` against typed-secret values.
- Ring buffer cleared on Sign Out and Reset Identity.

Forbidden during M1.E: shipping a remote telemetry collector; logging unredacted envelope contents; persisting telemetry beyond the in-memory buffer; emitting raw mesh paths.

## Milestone M2 — Real verifier path (Silver), client evidence acquisition, and adversarial harness

### M2.A — Verifier service spec

Goal: produce `spec-luma-verifier-v0.md` (sibling spec under `docs/specs/`). Deferred until ops ownership, retention policy, custody model, and SLO numbers are settled.

Inputs / dependencies: M0.A, M0.E complete, including `docs/ops/luma-verifier-current-state.md`; M1 complete; ops ownership decided (M2.A-4); retention policy decided (M2.A-3); custody model decided (M2.A-7).

Deliverables (the verifier-spec section list, finalized at planning time):
- Endpoint contract — `POST /verify`, `GET /challenge`, `GET /.well-known/jwks.json`, `GET /.well-known/luma-verifier-manifest`, `GET /.well-known/luma-verifier-revocations`, `GET /.well-known/luma-safety-bulletin`, `GET /health`.
- Single shared schema, TS as the schema authority.
- Nonce/challenge protocol per spec §10.2; 60s window default (M2.A-2).
- Trust-score policy and `AssuranceEnvelope` construction algorithm. Existing Rust verifier's length/prefix heuristic is **not** Silver and **not** the algorithm.
- Rate limits — per-IP, per-devicePub, per-nullifier.
- Audit events — append-only with redaction list per spec §16.2. Retention TBD with ops (M2.A-3).
- Failure modes — full enumeration per spec §10 `PolicyReason` plus verifier-specific (`bad_nonce`, `attestation_replayed`, `attestation_too_low`, `rate_limited`, `verifier_overload`, `salt_mismatch`, `manifest_drift`, `key_rotation_in_progress`).
- SLOs — availability 99.5%, p95 verify latency < 1.5s, p99 < 3s. Draft until ops review.
- Deployment topology.
- Trust boundary and signing — Ed25519 default (`jcs-ed25519-sha512-v1`); JWKS plus pinned client key with pinned takes precedence; signature covers full `SessionResponse` + bound `nonce`/`audience`/`origin`/`profile`; server-set `expiresAt`; 7-day key rotation grace; cold-storage root + online subkeys + N=3-of-K=5 quorum (M2.A-7).
- Verifier transparency manifest, identity pinning, hostile-verifier mitigations per spec §17.
- Verifier session-revocation list at `/.well-known/luma-verifier-revocations`.
- Salt pinning per spec §17.2.
- Failed-attestation fallback policy — `view-only`, never silent anonymous.
- OID4VC reservation per spec §1.3.
- Signed safety bulletin per spec §18; root-key signing requirement.
- Continuity contract per spec §14.
- Evidence retention per spec §11.6.
- Adversarial test corpus per spec §21.2.
- Constant-time discipline per spec §6.4.
- Bug bounty intake per spec §19.2.
- Key-compromise drill — written runbook + quarterly rehearsal calendar.

Acceptance criteria:
- Verifier spec lands.
- Cross-team review with verifier operating team (M2.A-4).
- Key-compromise drill runbook lands in `luma-verifier-runbook.md` (under `docs/ops/`) with first rehearsal date scheduled.

Forbidden during M2.A: building the verifier code; defining cryptographic residency proof; loosening identity spec `SessionResponse`.

Open questions:
- M2.A-2 nonce window — default 60 seconds.
- M2.A-3 audit-log retention — TBD.
- M2.A-4 operating team — TBD.
- M2.A-6 key rotation grace — default 7 days.
- M2.A-7 custody architecture — default cold root + online subkeys + N=3-of-K=5 quorum.

### M2.B — Verifier reference implementation

Inputs / dependencies: M2.A signed off.

Deliverables:
- `services/luma-verifier` (new path; M0.F created the room).
- TypeScript implementation (default; M2.B-1 still open).
- Schema parity per spec §4 / §5 / §17 / §18.
- Replay-protection store (in-memory ring buffer; durable later).
- Audit log writer with redaction per spec §16.2.
- All `.well-known/*` endpoints.
- Observability hooks per SLOs.
- Deployment runbook.
- Client-side: verify signed response + nonce + audience + origin + profile + manifest fingerprint + safety-bulletin freshness before accepting.
- Constant-time crypto throughout per spec §6.4.
- Adversarial harness corpus implementation per spec §21.2 under `services/luma-verifier/tests/adversarial/` and `apps/web-pwa/e2e/adversarial/`.

Acceptance criteria:
- Contract tests against schemas.
- Signature/JWKS round-trip test.
- Replay test (`attestation_replayed`).
- Salt-mismatch test.
- Manifest-drift test.
- Hostile-verifier test.
- Revocation test.
- Adversarial harness corpus: every row passes its expected reject. CI failure if any new code path can bypass any row.
- Load test: sustained 10 rps for 10 minutes inside SLO targets.
- Disaster test: process killed mid-request.

Forbidden during M2.B: caching `trustScore` across nonces; storing `principalNullifier`/`deviceCredential`/raw attestation bodies in plaintext logs; reusing the DEV stub's identity.

Open questions:
- M2.B-1 implementation language — default TypeScript.

### M2.C — Production-attestation cutover

Inputs / dependencies: M2.B deployed to staging; M1.D forbidden-claims gate green; ops-review numbers committed.

Deliverables:
- Update `production-attestation` profile so `VITE_ATTESTATION_URL` and `ATTESTATION_URL` (env-name drift fix) point at the staging-promoted verifier; pinned manifest is the production manifest.
- Release gate: production verifier health 200 + JWKS contains pinned key + manifest matches pin + safety bulletin is fresh + revocation list reachable + adversarial-harness corpus passes.
- Smoke E2E running against `production-attestation` verifier on a deploy candidate.
- Update copy across `/compliance`, `/beta`, `/privacy`, `/security` to reflect real Silver attestation (still beta-local constituency).
- Bug bounty program live — `/security` page published; intake address and PGP key live; intake-triage runbook in `security-disclosure-runbook.md` (under `docs/ops/`).
- DSAR response template — `dsar-response-template.md` (under `docs/ops/`) lands; integrated with `/support` and `/data-deletion`; private-handoff path documented.
- Continuity verification — release gate runs the upgrade on a recorded `pnpm test:live:five-user-engagement` corpus and asserts `PrincipalId`, `forumAuthorId`, XP totals, wallet binding, operator status are byte-identical before and after, per spec §21.3.
- Beta exit criterion — M2.C is the gate at which the system is no longer "beta" with respect to attestation. `/beta` and `STATUS.md` updated.
- Decommission plan for `services/luma-verifier-dev`: stays in tree for `dev`/`e2e`.

Acceptance criteria:
- `production-attestation` build runs end-to-end against the real verifier with signature, JWKS, manifest, audience, origin, bulletin verification.
- Forbidden-claims gate green.
- `public-beta` profile remains operable with `BetaLocalAttestationProvider`.
- Continuity verification green.
- Bug bounty program live; first triage SLA test passes (synthetic submission acknowledged within 3 business days).
- DSAR response template stress-tested with a synthetic request.
- Adversarial harness corpus green.

Forbidden during M2.C: removing `BetaLocalConstituencyProvider`; reusing the DEV signing key; declaring the system "out of beta" with respect to constituency proof; shipping without bug bounty intake live; shipping without DSAR template; shipping without adversarial harness pass.

### M2.D — Client evidence acquisition

Goal: specify and ship the browser-side capture path that turns "user is here, with their device" into the evidence the M2 verifier validates.

Inputs / dependencies: M2.A complete (so the evidence schema is part of the verifier contract); M0.A complete (so `AssuranceEnvelope` and `EvidenceRef` are spec'd).

Deliverables (verifier-spec §17 "Client evidence acquisition" — finalized at M2.A):
- VIO capture flow on supported clients — flight-path UX, camera + IMU sensor fusion, frame-rate and IMU-rate budgets.
- Permission policy — camera (required), motion sensors (required on mobile, gracefully degrade on desktop). Refusal path = `view-only`.
- Challenge UX — visible nonce/challenge representation; cancel/retry semantics; accessibility considerations.
- Evidence transport — captured frames/IMU traces processed locally; only derived feature vector and integrity attestation sent. Raw biometric features never leave the device.
- Evidence retention and zeroization per spec §11.6.
- Web-VIO Plan B — desktop tops out at `beta-local`; Silver-Mobile only (M2.D-1 default).
- WebAuthn / passkey integration — M2.D-2 default: not in v0; future hardening promotes `device_integrity` from `silver` to `gold`.
- Multi-tab attestation lock per spec §12.7.
- Failed-attestation UX — explicit `view-only`. "We couldn't verify your device. You can keep reading, but creating posts and votes needs verification." with retry.
- First-run UX — read-only browsing without identity is the default. "Sign in to post or vote" affordances at the right moments, not as a blocking first-run modal.
- Adversarial harness inputs — capture flow exposes deterministic-failure injection points so the harness corpus can drive client-side rows.

Implementation: `apps/web-pwa/src/luma/evidence/`. Browser-only.

Telemetry: `luma_evidence_capture_started`, `_succeeded`, `_failed` (redacted reason). No raw evidence in telemetry.

Acceptance criteria:
- Capture flow works on iOS Safari and Android Chrome.
- Desktop runs in `view-only` fallback.
- Multi-tab lock test.
- Failed-attestation UX rendered; retry exercises a fresh nonce.
- A11y baseline.
- Evidence zeroization test: in-memory buffers contain no recoverable feature data after `evidenceDigest` commit.
- Adversarial harness rows for client-side capture pass.

Forbidden during M2.D: shipping raw biometric features off-device; reusing capture across nonces; running capture without explicit consent in the same session; a blocking first-run modal demanding attestation.

Open questions:
- M2.D-1 Web-VIO Plan B — default desktop tops out at beta-local.
- M2.D-2 WebAuthn for `deviceCredential` — default no for v0.
- M2.D-3 VIO accessibility alternate flow — default document limitation; future Bronze tier.

## Out of scope

Per spec §22. Implementations MUST NOT begin without a successor spec or RFC.

## Cross-cutting concerns (execution-time)

### Migration policy (tooling)

- Schema changes are additive within a release; deletions land one release later.
- The four-layer migration model is canonical (spec §15).
- On-chain attestation keying does not change.
- Vault: forward-only v1 → v2; v2 client refuses v1 vaults from non-`dev` profiles after one release.

### Compliance / legal interactions

- Beta-local stance documented at `/beta`, `/compliance`, `/privacy`, `/security`. Copy-review owner: open (X-2).
- KYC / Linkage Escrow deferred; M2.A must not introduce KYC fields.
- Sub-processor disclosure: `/privacy` lists sub-processors by name post-M2.C (X-8 default: yes).
- DSAR / privacy requests integrate with `/support` and `/data-deletion`; M2.C ships the response template.
- Bug bounty / responsible disclosure live at M2.C per spec §19.2.

### Latency budget

- `canPerform` cached <5 ms / cold <50 ms (spec §10.1).
- Verifier `/verify` p95 <1.5 s, p99 <3 s (M2.A draft).
- Vault read on cold start <200 ms p95.
- Safety-bulletin fetch on session creation <500 ms p95 (cached <50 ms).

### Identity recovery hints

- `/account/identity` shows a soft reminder that identity exists only on the device until Lazarus lands.
- Account merging across devices is explicitly not supported; copy in `/account/identity` says so.

### No-vault browser handling

- `isVaultAvailable()` returning false surfaces an explicit "this browser configuration does not support LUMA — vault storage is unavailable" UX. Lock-down enterprise environments hit this. Telemetry records the event.

## Open decisions index

The spec owns the locked decisions. The roadmap tracks decisions still required for execution.

### Locked (normative — see spec)

| ID | Topic | Spec section |
| --- | --- | --- |
| Identifier taxonomy | global-stable forum pseudonym; HKDF-SHA-256; four-layer migration; PII-bypass removal | §9, §15 |
| Session lifecycle | 7-day TTL; lifecycle default-on for non-dev profiles | §12 |
| Identity controls | Sign Out vs Reset Identity at `/account/identity` | §13 |
| Telemetry | local-only Season 0; redaction policy; lint rules | §16 |
| Profile taxonomy | `dev`, `e2e`, `public-beta`, `production-attestation`; rename from `production-proof` | §2 |
| DEV stub allow-list | `dev` and `e2e` only | §2, §8 |
| Type discipline | `PrincipalId` distinct from `principalNullifier`; `Clock` interface | §3, §12.2 |
| Reads not gated | `canPerform` gates only enumerated write audiences; first-run is read-only | §10 |
| Authority shape | `AssuranceEnvelope` replaces scalar `trustScore` | §4 |
| Write envelope | uniform `SignedWriteEnvelope`; idempotency 7-day window | §5 |
| Policy boundary | `canPerform`; closed `PolicyReason` / `PolicyRecoveryHint` enums; latency budget | §10 |
| Audience binding | required on every signed assertion | §5, §10 |
| Signature suites | RFC 8785 (JCS); named suites; PQ slots reserved | §6 |
| Constant-time discipline | required for hashes, signatures, salt fingerprints, idempotency, revocation | §6.4 |
| Transparency manifest | required; verifier identity pinned at build | §17 |
| Safety bulletin | required; root-key-signed; kill-switch fields | §18 |
| Continuity contract | beta-local → Silver preserves principal, public ids, XP, wallet, operator, history | §14 |
| Reset Identity | not deletion, not repudiation; historical artifacts persist | §13 |
| District-hash k-anonymity | threshold 100; aggregate-only; fail-closed | §9.4 |
| Adversarial harness | gates Silver claim at M2.C | §21.2 |
| Bug bounty | scope/SLA/window/rubric locked; payment ranges deferred | §19.2 |
| DSAR | via `/support` and `/data-deletion`; honest stance copy | §19.1 |
| Public mesh fields | `_protocolVersion` and `_writerKind` required | §15 |
| Forbidden claims | registry; release gate; runtime defense | §20 |
| Default signature suite | `jcs-ed25519-sha512-v1` for verifier-issued envelopes | §6.2 |
| Protocol RFC gate | adopted; gated paths require RFC artifact | §1.4 |
| Safety bulletin freshness window | 24 hours; `production-attestation` rejects stale bulletins | §18.1 |

### Open (still to decide)

| ID | Topic | Default proposal |
| --- | --- | --- |
| M0.B-3 | `~<devicePub>/outbox/sentiment/*` unchanged | yes |
| M0.D-2 | Real multi-device link in M0.D vs deferred | deferred |
| M0.D-3 | XP/reputation continuity across Sign Out | preserved |
| M0.D-4 | Legacy-vault migration policy | reuse existing `deviceKey` as `deviceCredential` |
| M0.E-1 | `NULLIFIER_SALT` policy | pinned per profile in checked-in config |
| M2.A-2 | Nonce window | 60 seconds |
| M2.A-3 | Verifier audit-log retention | TBD with ops |
| M2.A-4 | Verifier operating team | TBD |
| M2.A-6 | Signing-key rotation grace window | 7 days |
| M2.A-7 | Signing-key custody architecture | cold root + online subkeys + N=3 of K=5 quorum |
| M2.B-1 | Implementation language | TypeScript |
| M2.D-1 | Web-VIO Plan B | desktop tops out at beta-local; Silver-Mobile only |
| M2.D-2 | WebAuthn for `deviceCredential` in v0 | no; future hardening |
| M2.D-3 | VIO accessibility alternate flow | document limitation; future Bronze tier |
| X-2 | `/beta`, `/compliance`, `/privacy`, `/security` copy owner | TBD |
| X-4 | DEV banner UX | persistent slim banner |
| X-8 | Sub-processor disclosure | yes |
| X-11 | Bug bounty intake email | `security@<vh-domain>` |

## What this roadmap deliberately does not do

- Does not redefine canonical LUMA semantics; that lives in `docs/specs/spec-luma-service-v0.md` and `docs/specs/spec-identity-trust-constituency.md`.
- Does not ship cryptographic residency proof, BioKey, or DBA.
- Does not break the forbidden-claims discipline.
- Does not introduce new on-chain semantics.
- Does not modify the Rust DEV stub's behavior.
- Does not promise mesh-side state deletion.
- Does not allow the Rust DEV stub in `public-beta` or `production-attestation`.
- Does not rename `principalNullifier` despite introducing `PrincipalId` as a separate type.
- Does not extend the AssuranceEnvelope claim vector to foreign identity systems.
- Does not commit to a payment range for the bug bounty program.
- Does not promise that Reset Identity erases prior activity.
- Does not allow non-aggregate public records to carry `district_hash`.
- Does not hold wallet signing keys.
- Does not rotate `principalNullifier` on Sign Out or on M2 upgrade.
- Does not duplicate normative material from `docs/specs/spec-luma-service-v0.md`.

## Iteration log

| Version | Date | Author | Notes |
| --- | --- | --- | --- |
| 0.1 | 2026-05-02 | Reviewer | Initial draft. |
| 0.2 | 2026-05-02 | User | Header / scope updates. |
| 0.3 | 2026-05-02 | Reviewer | Eight user-flagged corrections + reviewer additions. |
| 0.4 | 2026-05-02 | Reviewer | Five v0.3 pushbacks + user's eight v0.4 contracts + user's five v0.4 additions + reviewer's high-leverage adds. Locked 25 defaults. |
| 0.5 | 2026-05-02 | Reviewer | Three P2 inline fixes; user's six v0.5 additions; six tuned items; four self-debt fills. Locked 11 more defaults; partitioned decisions index. Framing: release-operations and protocol-hardening pass. |
| 0.6 | 2026-05-03 | Reviewer | Docs-only M0.A extraction. Created `docs/specs/spec-luma-service-v0.md` containing all normative cross-cutting contracts. Slimmed roadmap to execution sequence: pointer table replaces cross-cutting contracts; locked defaults remain as execution stance with spec-section refs; milestones reference spec sections rather than duplicate type/schema bodies. Removed two forbidden authority phrases for docs-governance compliance. Stopped claiming an exact open-decision count anywhere. Added canon-map row for the new spec; rolled the identity-spec row's `Last Reviewed` to 2026-05-02. |
| 0.7 | 2026-05-04 | Reviewer | Mesh-coherence pass. M0.B expanded with adapter/materializer migration deliverables (`forumAdapters`, `directoryAdapters`, `aggregateAdapters`, `voteIntentMaterializer`, etc.), post-M0.B mesh re-run as exit gate, explicit M0.B/M0.C parallel write-set split with per-file ownership and shared-file sequencing rule. Pointer table adds rows for §1.5 mesh boundary and §16.5/§16.6 cross-spec trace allowance and profile-disablement canary rule. Locked defaults add mesh-coherence stance. Depends-on adds `spec-mesh-production-readiness.md` and `spec-signed-pin-custody-v0.md`. |
| 0.8 | 2026-05-04 | Reviewer | M0.E/M0.F foundation prep. Added `docs/ops/luma-verifier-current-state.md` as the current-state DEV verifier input for M2.A and mechanically moved the DEV-only verifier to `services/luma-verifier-dev`; release note: DEV-only verifier moved; behavior unchanged. No public adapters, public schemas, provider interfaces, or mesh drill harness paths were migrated. |
