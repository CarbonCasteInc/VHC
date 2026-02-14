# Identity, Trust & Constituency Spec

Version: 0.2
Status: Canonical for Season 0 (Sprints 2-5)

This spec is the single contract for identity, trustScore, and constituency across LUMA (identity), GWC (economics/governance), and VENN (civic signals). All client, mesh, and chain components must conform to these types and invariants.

References:
- LUMA whitepaper: `docs/foundational/LUMA_BriefWhitePaper.md`
- CAK trust thresholds: `docs/specs/spec-civic-action-kit-v0.md` §7.1
- Data topology: `docs/specs/spec-data-topology-privacy-v0.md`
- Architecture lock: `docs/foundational/ARCHITECTURE_LOCK.md`

## 1. Domain Concepts

- `TrustScore` (0..1 float); `ScaledTrustScore` (int 0..10000, `scaled = Math.round(trustScore * 10000)`).
- `UniquenessNullifier` (string off-chain; `bytes32` on-chain) - target is stable per-human key.
- Region code (private, e.g., `US-CA-12`) vs `district_hash` (hashed public form).
- `RegionProof` public signals: `[district_hash, nullifier, merkle_root]`.
- `ConstituencyProof`: `{ district_hash, nullifier, merkle_root }` decoded from RegionProof.

## 2. Off-Chain Session Model

- `AttestationPayload` (hardware attestation input).
- `VerificationResult` → `trustScore: number` in `[0,1]`.
- `derive_nullifier(device_key: string) -> string` (deterministic, collision-resistant enough for scale; v0 reference: `sha256(device_key)`).
- **v0 implementation note:** nullifier derivation is currently device-bound. Per-human binding remains the target state and depends on higher-assurance attestation + multi-device linking/recovery hardening.
- `SessionResponse`:
  - `token` = per-session string.
  - `trustScore` = float `[0,1]`.
  - `scaledTrustScore` = `Math.round(trustScore * 10000)`.
  - `nullifier` = `UniquenessNullifier` (stable).
- **Canonical `TRUST_THRESHOLDS` (Season 0):**

  All gated surfaces MUST reference these canonical thresholds. Hardcoded magic numbers in implementation files are transitional; the target state is a single imported constant table.

  | Surface | Threshold | Scaled | Rationale | Current Implementation |
  |---------|-----------|--------|-----------|----------------------|
  | Session creation | ≥ 0.5 | ≥ 5000 | Minimum bar for verified human | `useIdentity.ts:115` |
  | Forum participation (TrustGate) | ≥ 0.5 | ≥ 5000 | Read/write gating for threads | `TrustGate.tsx:12` |
  | Gun auth (mesh write) | ≥ 0.5 | ≥ 5000 | Prevents unauthenticated mesh writes | `gun-client/auth.ts:23` |
  | CAK view rep list | ≥ 0.5 | ≥ 5000 | Rep directory browsing | `RepresentativeSelector.tsx:36` |
  | CAK draft action | ≥ 0.5 | ≥ 5000 | Compose civic packet | `ActionComposer.tsx:75` (per CAK §7.1) |
  | Bridge layout access | ≥ 0.5 | ≥ 5000 | Civic bridge entry point | `BridgeLayout.tsx:49` |
  | XP faucet / UBE claim | ≥ 0.5 | ≥ 5000 | Daily Boost eligibility | `xpLedger.ts:319`, `WalletPanel.tsx:70` |
  | Dashboard tier display | ≥ 0.5 / ≥ 0.7 | ≥ 5000 / ≥ 7000 | Visual tier indicator | `dashboardContent.tsx:183,178` |
  | QF / governance votes | ≥ 0.7 | ≥ 7000 | High-impact civic action | `useGovernance.ts:30` (`MIN_TRUST_TO_VOTE`) |
  | CAK send/finalize + receipt | ≥ 0.7 | ≥ 7000 | Outbound civic forwarding | `ActionComposer.tsx:73` (per CAK §7.1) |
  | Future moderation actions | ≥ 0.7 | ≥ 7000 | Placeholder - not yet implemented | - |
  | Future high-privilege | 0.7-0.8 | 7000-8000 | Reserved range for Season 1+ | - |

  **Consolidation target (impl guidance, not spec-normative):** Extract a single `TRUST_THRESHOLDS` constant (e.g., in `packages/types/src/identity.ts` or a shared constants module) and replace all inline magic numbers. This is an implementation task, not a spec requirement - but implementations SHOULD converge on one import.

## 2.1 Session Lifecycle Contract

This section defines the full lifecycle of an identity session. The v0.1 spec defined session *shape* (`SessionResponse`) but not lifecycle transitions. This is the primary v0.2 addition.

### 2.1.1 Session Creation Flow

```
attestation_input (VIO liveness / dev stub)
  → Verifier (or mock verifier)
  → VerificationResult { trustScore }
  → derive_nullifier(device_key)
  → SessionResponse { token, trustScore, scaledTrustScore, nullifier }
  → Store in useIdentity state + IndexedDB vault
```

**Invariants:**
- Session creation MUST fail if `trustScore < 0.5` (the minimum session threshold per `TRUST_THRESHOLDS`).
- `nullifier` is derived deterministically from device key material; it MUST NOT change across sessions on the same device.
- `token` is unique per session and MUST NOT be reused across re-attestation.
- Session creation is local-first: no network round-trip is required for the session itself (attestation may require network for non-stub verifiers).

### 2.1.2 Session Expiry and Refresh

**Current state (Season 0 transitional):** Sessions have no TTL - once created, they persist in local storage indefinitely until the user clears app data or re-attests. `useIdentity` has no expiry check.

**Target state (Season 0 v0.2):**
- Sessions SHOULD carry an `expiresAt` timestamp (recommended: 7 days from creation for Silver assurance).
- `useIdentity` SHOULD check `expiresAt` on hydration and on each trust-gated action.
- When expired, the session enters `degraded` state (see §2.1.5) rather than being silently dropped.
- Refresh = full re-attestation (new VIO liveness check); there is no silent token refresh in Season 0.

**Schema addition:**

```ts
interface SessionResponse {
  token: string;
  trustScore: number;       // [0, 1]
  scaledTrustScore: number; // Math.round(trustScore * 10000)
  nullifier: string;        // UniquenessNullifier (stable per device)
  createdAt: number;        // epoch ms
  expiresAt: number;        // epoch ms; 0 = no expiry (transitional)
}
```

### 2.1.3 Session Revocation

**Current state:** Session revocation is not implemented. There is no mechanism to invalidate a session.

**Target contract:**
- A user MAY revoke their own session via an explicit "Sign Out" / "Clear Identity" action.
- Revocation MUST:
  1. Clear `SessionResponse` from local state and IndexedDB vault.
  2. Clear any cached `ConstituencyProof`.
  3. Invalidate the session token (local-only; no server-side token list in Season 0).
  4. Revoke all active `DelegationGrant` records for familiars bound to this session.
- Revocation MUST NOT delete the nullifier derivation material (device key) - re-attestation should yield the same nullifier.
- Remote revocation (e.g., revoking a lost device's session from another device) is DEFERRED to multi-device recovery (§5) + Gold assurance.

### 2.1.4 Timeout Semantics

**Current state:** `useIdentity` has no TTL or timeout. Sessions are checked only at creation time.

**Target contract:**
- Each trust-gated action SHOULD re-validate `expiresAt` before proceeding.
- If `expiresAt > 0 && Date.now() > expiresAt`, the session is stale and the action MUST be blocked with a user-facing prompt to re-attest.
- The UI SHOULD show a non-blocking warning when the session is within 24 hours of expiry.
- No background polling or heartbeat - expiry is checked lazily on action boundaries.

### 2.1.5 Mid-Session Trust Degradation

**Scenario:** A user's `trustScore` drops below a gated threshold (e.g., due to re-attestation with a lower score, or future dynamic trust adjustment).

**Contract:**
- The session remains valid; the user is NOT forcibly logged out.
- Actions gated at a threshold above the user's current `trustScore` MUST be blocked at the action boundary with an explanatory message (e.g., "Trust score (0.45) below 0.50 - verify identity to continue").
- Actions gated at or below the user's current `trustScore` continue to work normally.
- On-chain attestations MAY be updated to the lower `scaledTrustScore` - the attestor bridge allows degradation (lower overwrites higher; see §3).
- Recovery path: re-attest to obtain a new (potentially higher) `trustScore`.

### 2.1.6 E2E and Dev Mode Behavior (Transitional)

The following mock behaviors exist in the codebase and are documented here as **Season 0 transitional** - they MUST NOT ship in production builds without the `VITE_E2E_MODE` or dev-mode guard.

| Mode | trustScore | nullifier | Source |
|------|-----------|-----------|--------|
| E2E (`VITE_E2E_MODE=true`) | `1.0` | `mock-nullifier-<random>` | `useIdentity.ts:93` |
| Dev fallback (attestation timeout) | `0.95` | real derivation | `useIdentity.ts:106` |
| Stub constituency proof | N/A | `mock-nullifier` | `constituencyProof.ts:17` |

**Invariants for mock sessions:**
- Mock sessions MUST pass all trust gates (they use scores ≥ 0.95).
- Mock sessions MUST NOT be distinguishable from real sessions at the type level (same `SessionResponse` shape).
- E2E mode MUST bypass VIO/attestation initialization entirely (per ARCHITECTURE_LOCK §2.2).
- The `0.95` dev fallback exists because the real verifier may be unreachable in local dev; it is gated behind `VITE_ATTESTATION_TIMEOUT_MS` (default 2s).

## 3. On-Chain Attestation Model

- Scaling: `ScaledTrustScore = Math.round(trustScore * 10000)`; display as `(scaled / 100).toFixed(1)`.
- Nullifier mapping: `bytes32Nullifier = keccak256(UniquenessNullifier)`.
- Contracts (examples):
  - `UBE.registerIdentity(user, bytes32Nullifier, scaledTrustScore, expiresAt)`
  - `Faucet.recordAttestation(user, scaledTrustScore, expiresAt)`
  - `QF.recordParticipant(user, scaledTrustScore, expiresAt)`
- Attestor bridge:
  - Inputs: `SessionResponse (trustScore, nullifier)` + `wallet address`.
  - Writes scaled trust and `bytes32Nullifier` under `ATTESTOR_ROLE`.
  - Degradation allowed: lower trustScore overwrites prior higher values; below threshold → new claims/votes fail.

## 4. Region & Constituency

- `RegionProof.publicSignals = [district_hash, nullifier, merkle_root]`.
- `decodeRegionProof(publicSignals) -> ConstituencyProof`.
- Invariants:
  - `district_hash` must be deterministic for a region code and context.
  - `nullifier` equals the user's `UniquenessNullifier` (or its hash on-chain).
  - `merkle_root` binds to the residency set.
- Dev mode: stubs may use `district_hash = "mock-district"` and `merkle_root = "mock-root"`; shapes must match.
- Usage constraints:
  - `district_hash` and `nullifier` together are **sensitive**; this pair MUST NOT appear in public mesh documents or on-chain storage.
  - `district_hash` MAY appear inside encrypted outbox payloads (e.g., SentimentSignal → Guardian Node) or in aggregated per-district stats (without nullifiers) that are published to reps or dashboards.
  - On-chain contracts never store `district_hash`; governance/economics are region-agnostic at the contract level.
  - See `docs/specs/spec-data-topology-privacy-v0.md` for placement rules.

### 4.1 Constituency Proof Interface (Canonical)

The `ConstituencyProof` interface is the canonical shape for all constituency verification across the system. Current implementation in `getMockConstituencyProof()` (`apps/web-pwa/src/store/bridge/constituencyProof.ts`) returns this shape.

```ts
interface ConstituencyProof {
  district_hash: string;   // deterministic hash of region code + context
  nullifier: string;       // principal's UniquenessNullifier
  merkle_root: string;     // binding to the residency set snapshot
}
```

### 4.2 Verification Contract

The verifier MUST check:

1. **Nullifier match:** `proof.nullifier === action.author` (the submitter's principal nullifier). Error: `nullifier_mismatch`.
2. **District match:** `proof.district_hash === representative.districtHash` (the target rep's jurisdiction). Error: `district_mismatch`.
3. **Freshness:** `proof.merkle_root` must be from a recent residency set snapshot. Error: `stale_proof`.

```ts
type ProofVerificationError =
  | 'nullifier_mismatch'
  | 'district_mismatch'
  | 'stale_proof'
  | 'malformed_proof';

interface ProofVerificationResult {
  valid: boolean;
  error?: ProofVerificationError;
}
```

**Freshness requirements (Season 0):**
- `merkle_root` SHOULD be validated against a known-good set. In Season 0 (stub acquisition), mock roots are accepted — the freshness check is a no-op that always passes for non-empty roots.
- Target state: `merkle_root` must match a root published within the last 30 days by the residency set authority.

### 4.3 Proof Acquisition: Season 0 Stub Status

**Season 0 reality:** Constituency proof acquisition is **STUBBED**. The `getMockConstituencyProof()` function returns hardcoded mock values. Real acquisition requires:
- DBA acoustic residency proof (Phase 5 per LUMA whitepaper §3.4) — requires physical hardware anchor
- ZK-SNARK enrollment for privacy-preserving proof generation (Phase 4 per LUMA whitepaper)

**Stub behavior:**
- `getMockConstituencyProof(districtHash)` returns `{ district_hash: districtHash, nullifier: 'mock-nullifier', merkle_root: 'mock-root' }`.
- The stub satisfies the type interface and passes verification in dev/E2E mode.
- Production builds MUST NOT rely on stub proofs for real constituency claims.

### 4.4 Stub → Real Migration Contract

When real constituency proof acquisition becomes available (Phase 4–5):

1. **Interface stability:** The `ConstituencyProof` shape (`{ district_hash, nullifier, merkle_root }`) is stable and MUST NOT change. Real proofs populate the same fields with cryptographically valid values.
2. **Acquisition path change:** Replace `getMockConstituencyProof()` with a real acquisition flow:
   - User initiates residency proof (DBA acoustic check or VIO-based geo attestation).
   - Proof is generated locally (ZK-SNARK circuit).
   - `merkle_root` references the current residency set published by the region notary.
3. **Verification tightening:** The freshness check transitions from no-op to real root validation.
4. **Feature flag:** The transition SHOULD be gated behind a feature flag (`ENABLE_REAL_CONSTITUENCY_PROOF`) to allow gradual rollout.
5. **Data migration:** Existing mock proofs in local storage MUST be invalidated on upgrade. Users will need to re-acquire proofs through the real flow.

## 5. Multi-Device & Recovery Semantics

- Identity = `UniquenessNullifier`; devices are entry points.
- Multi-device linking: prove "same human", reuse nullifier.
- Recovery: preserve nullifier (hence UBE/QF rewards, sentiment history); rotate wallet addresses, mesh keys, session tokens.

## 6. Agentic Familiars (Delegation)

Familiars are delegated sub-processes of a verified human. Per LUMA whitepaper §2.5, they inherit the principal's trust gate and daily participation budgets, never multiply influence, and never create a new influence lane. All agent actions resolve to the human principal's nullifier.

### 6.1 Trust Inheritance Invariants (Normative)

1. **Trust gate inheritance (MUST):** A familiar's effective trust score for all gated actions equals the principal's current `trustScore`. Familiars MUST NOT have an independent `trustScore` field or separate trust computation.
2. **Budget inheritance (MUST):** Familiar actions consume the principal's daily participation budgets (posts, comments, votes, analyses, shares, moderation, civic_actions). There is no separate familiar budget pool.
3. **No independent influence lane (MUST):** Familiars MUST NOT create new influence channels — no independent forum identity, no separate voting weight, no distinct civic signal source.
4. **No influence multiplication (MUST):** All platform actions performed by a familiar resolve to the principal's `UniquenessNullifier`. Two familiars of the same principal MUST NOT produce two distinct votes, two distinct sentiment signals, or two distinct civic actions for the same target.
5. **Scope limitation (MUST):** Grants are least-privilege, short-lived (minutes/hours default), and explicitly scoped.
6. **Expiry (MUST):** Every `DelegationGrant` has an `expiresAt` timestamp. Expired grants are invalid; the familiar MUST re-request delegation.
7. **Revocability (MUST):** The principal MAY revoke any grant immediately. Revocation is local-first (kill grant in local state; background jobs stop). Revocation MUST propagate to all active familiar sessions within the current device context.

**Types (doc-only, minimal):**

```ts
interface FamiliarRecord {
  id: string;
  label: string;
  createdAt: number;
  revokedAt?: number;
  capabilityPreset: string;
}

interface DelegationGrant {
  grantId: string;
  principalNullifier: string;
  familiarId: string;
  scopes: string[];
  issuedAt: number;
  expiresAt: number;
  signature: string;
}

interface OnBehalfOfAssertion {
  principalNullifier: string;
  familiarId: string;
  grantId: string;
  issuedAt: number;
  signature: string;
}
```

**Hard invariants (MUST):**

- Familiars MUST NOT have their own `trustScore`; they inherit the principal's session gating.
- All platform actions MUST resolve to a principal nullifier; agents never multiply weight.
- Grants MUST be least-privilege and short-lived (minutes/hours default).
- Recursive delegation MUST attenuate (sub-agents can only receive a strict subset of parent scopes).
- Revocation MUST be immediate and local-first (kill grant; background jobs stop).

**Default scopes (by tier):**

- **Tier 1 (Suggest):** `draft`, `triage`
- **Tier 2 (Act):** `analyze`, `post`, `comment`, `share`
- **Tier 3 (High-Impact):** `moderate`, `vote`, `fund`, `civic_action`

**Tier rule (MUST):**
- Tier 3 scopes require explicit human approval at time of action (not just grant issuance).
- Proposal elevation is a Tier 3 (High-Impact) action.

## 7. Test Invariants

- `derive_nullifier` is deterministic for the same input and sufficiently collision-resistant for expected scale.
- Scaling is invertible for display: `scaled / 10000` ≈ `trustScore`.
- `decodeRegionProof` always yields consistent `ConstituencyProof`.
- On-chain attestations reflect off-chain trustScore within rounding tolerance.

## 8. Integration Map

- `useIdentity` / `useWallet`: store `nullifier`, `trustScore`, `scaledTrustScore`, and (when present) `RegionProof`.
- `SentimentSignal.constituency_proof.nullifier` equals the identity nullifier; `district_hash` and `merkle_root` come from `RegionProof`.
- UBE/QF/Faucet contracts consume `bytes32Nullifier` and `scaledTrustScore` emitted by the attestor bridge.

### 8.1 Hook and Stub Locations (Season 0)

| Component | Path | Status | Notes |
|-----------|------|--------|-------|
| `useIdentity` hook | `apps/web-pwa/src/hooks/useIdentity.ts` | Season 0 transitional | Session creation, trust check at 0.5, dev fallback at 0.95. No TTL/expiry yet. |
| `useIdentity` tests | `apps/web-pwa/src/hooks/useIdentity.test.ts` | Season 0 transitional | Covers mock session paths. |
| `TrustGate` component | `apps/web-pwa/src/components/hermes/forum/TrustGate.tsx` | Spec-aligned | Threshold-gated UI wrapper; checks `trustScore < 0.5`. |
| `getMockConstituencyProof()` | `apps/web-pwa/src/store/bridge/constituencyProof.ts` | Season 0 transitional (STUB) | Returns mock proof shape. Will be replaced by real acquisition in Phase 4–5. |
| `useGovernance` hook | `apps/web-pwa/src/hooks/useGovernance.ts` | Spec-aligned | `normalizeTrustScore()`, `MIN_TRUST_TO_VOTE = 0.7`. |
| `ActionComposer` | `apps/web-pwa/src/components/bridge/ActionComposer.tsx` | Spec-aligned | Draft gate at 0.5, send gate at 0.7 (per CAK §7.1). |
| `RepresentativeSelector` | `apps/web-pwa/src/components/bridge/RepresentativeSelector.tsx` | Spec-aligned | View gate at 0.5 with constituency proof requirement. |
| `BridgeLayout` | `apps/web-pwa/src/components/bridge/BridgeLayout.tsx` | Spec-aligned | Entry gate at 0.5. |
| XP budget gates | `apps/web-pwa/src/store/xpLedgerBudget.ts` | Spec-aligned | `checkCivicActionsBudget()`, `consumeCivicActionsBudget()` — budget enforcement per nullifier. |
| XP ledger trust gate | `apps/web-pwa/src/store/xpLedger.ts` | Spec-aligned | UBE/faucet gate at `trustScore < 0.5 → return 0`. |
| Gun auth trust gate | `packages/gun-client/src/auth.ts` | Spec-aligned | Mesh write gate at `trustScore < 0.5`. |
| Dashboard tier display | `apps/web-pwa/src/routes/dashboardContent.tsx` | Season 0 transitional | Visual tier indicators at 0.5 and 0.7 boundaries. |
| Wallet UBE claim | `apps/web-pwa/src/routes/WalletPanel.tsx` | Season 0 transitional | Claim eligibility at `trustScore >= 0.5`. |

## 9. Season 0 Boundary

This section explicitly defines the boundary between what Season 0 implements and what is deferred to later phases. This fence is **normative** — implementations MUST NOT build features from the "Deferred" list.

### 9.1 Season 0 Enforces (In Scope)

| Capability | Description | LUMA Phase |
|-----------|-------------|------------|
| VIO-based Silver liveness | Software-only attestation via Visual-Inertial Odometry (camera + IMU sensor fusion) | Phase 1 |
| Off-chain session model | `SessionResponse` with `trustScore`, `nullifier`, `scaledTrustScore` | Phase 1 |
| Trust-gated surfaces | All UI/action boundaries enforce `TRUST_THRESHOLDS` (§2) | Phase 1 |
| Constituency proof interface | `ConstituencyProof { district_hash, nullifier, merkle_root }` shape is stable | Phase 1 |
| Stub proof acquisition | `getMockConstituencyProof()` — satisfies interface, not cryptographically valid | Phase 1 (stub) |
| On-chain scaled attestation | Attestor bridge writes `scaledTrustScore` and `bytes32Nullifier` to UBE/QF/Faucet | Phase 1 |
| Daily participation budgets | Per-nullifier action caps (posts, comments, votes, analyses, shares, moderation, civic_actions) | Phase 1 |
| Familiar delegation | Scoped, expiring, revocable grants; trust + budget inheritance; Tier 3 human approval | Phase 1 |
| Device-bound nullifier | `derive_nullifier(device_key)` — deterministic, device-bound | Phase 1 |

### 9.2 Deferred (Out of Scope for Season 0)

| Capability | Description | Target LUMA Phase | Why Deferred |
|-----------|-------------|-------------------|-------------|
| Gold assurance (CAPoW) | BioKey hardware ($20) with Continuously Attested Proof-of-Work | Phase 3 | Requires custom hardware manufacturing and distribution |
| Platinum assurance | Multi-factor (VIO + BioKey + DBA) for highest-trust actions | Phase 3+ | Depends on Gold hardware |
| BioKey hardware | Physical security key with memory-hard biometric computation (300ms timing check) | Phase 3 | Hardware supply chain |
| DBA acoustic residency proof | Distance-Bounding Anchor with acoustic fingerprinting for physical presence verification | Phase 5 | Requires home anchor hardware + acoustic matching infrastructure |
| Pedersen uniqueness vectors | Homomorphic encryption of biometric features for decentralized uniqueness checking | Phase 4 | Cryptographic infrastructure not ready |
| ZK-SNARK enrollment | Zero-knowledge proof generation for privacy-preserving identity verification | Phase 4 | Circuit design + trusted setup required |
| Linkage Escrow | Cryptographic seal between legal identity (KYC) and anonymous DDNA | Phase 2 | Requires escrow infrastructure + legal framework |
| Intent-Based Decryption | User-biometric-authorized warrant/recovery decryption (replaces platform-breakable seals) | Phase 2 | Depends on Linkage Escrow |
| Lazarus Protocol | Shamir's Secret Sharing for social recovery of identity keys | Phase 2 | Depends on multi-device linking |
| Canary System | Synthetic identity injection for auditing uniqueness index integrity | Phase 4+ | Depends on real uniqueness index |
| Region Notary (IETF ARC) | Anonymous Rate-Limited Credentials for residency oracle privacy | Phase 5 | Depends on DBA infrastructure |
| Per-human nullifier binding | Nullifier stable across devices (not just per-device) | Phase 3+ | Requires Gold+ assurance for cross-device identity linking |
| Dynamic trust adjustment | Trust score changes mid-session based on behavioral signals | Season 1+ | Requires trust model maturity |
| Remote session revocation | Revoke a lost device's session from another device | Phase 3+ | Requires multi-device identity graph |

### 9.3 Season 0 Transitional Items (Tech Debt)

These items work in Season 0 but are explicitly marked as transitional and MUST be addressed before Season 1:

1. **Hardcoded magic numbers:** Trust thresholds (0.5, 0.7) are inline across 10+ files. Target: single `TRUST_THRESHOLDS` constant (see §2 consolidation target).
2. **No session expiry:** `useIdentity` has no TTL. Target: `expiresAt` field + lazy expiry check (see §2.1.2).
3. **No session revocation UI:** No "Sign Out" or "Clear Identity" flow. Target: explicit revocation path (see §2.1.3).
4. **Mock constituency proofs:** `getMockConstituencyProof()` is a stub. Target: real acquisition flow (see §4.4).
5. **Device-bound nullifier:** Nullifier is per-device, not per-human. Target: multi-device linking with higher assurance (see §5).
6. **Dev fallback trust score:** `0.95` fallback on attestation timeout is convenient but masks real verifier issues. Target: remove or gate behind explicit dev flag.

## 10. Changelog

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2026-01-15 | Initial spec: domain concepts, session model, on-chain attestation, region/constituency, multi-device, familiar delegation, test invariants, integration map. |
| 0.2 | 2026-02-14 | **W3-LUMA identity hardening.** Added: canonical `TRUST_THRESHOLDS` table (§2); full session lifecycle contract (§2.1) covering creation, expiry, revocation, timeout, degradation, and E2E/dev mode; constituency proof interface formalization + verification contract + stub→real migration (§4.1–4.4); normative familiar trust inheritance invariants (§6, §6.1); Season 0 boundary fence with enforced/deferred/transitional lists (§9); implementation handoff with hook/stub location table (§8.1). Updated references and status line. |
