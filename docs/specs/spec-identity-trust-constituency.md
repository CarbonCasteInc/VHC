# Identity, Trust & Constituency Spec

Version: 0.1  
Status: Canonical for Sprints 2–3

This spec is the single contract for identity, trustScore, and constituency across LUMA (identity), GWC (economics/governance), and VENN (civic signals). All client, mesh, and chain components must conform to these types and invariants.

## 1. Domain Concepts

- `TrustScore` (0..1 float); `ScaledTrustScore` (int 0..10000, `scaled = Math.round(trustScore * 10000)`).
- `UniquenessNullifier` (string off-chain; `bytes32` on-chain) — stable per-human key.
- Region code (private, e.g., `US-CA-12`) vs `district_hash` (hashed public form).
- `RegionProof` public signals: `[district_hash, nullifier, merkle_root]`.
- `ConstituencyProof`: `{ district_hash, nullifier, merkle_root }` decoded from RegionProof.

## 2. Off-Chain Session Model

- `AttestationPayload` (hardware attestation input).
- `VerificationResult` → `trustScore: number` in `[0,1]`.
- `derive_nullifier(device_key: string) -> string` (deterministic, collision-resistant enough for scale; v0 reference: `sha256(device_key)`).
- `SessionResponse`:
  - `token` = per-session string.
  - `trustScore` = float `[0,1]`.
  - `scaledTrustScore` = `Math.round(trustScore * 10000)`.
  - `nullifier` = `UniquenessNullifier` (stable).
- Thresholds v0:
  - Session / UBE / Faucet: `trustScore ≥ 0.5` (scaled ≥ 5000).
  - QF votes: `trustScore ≥ 0.7` (scaled ≥ 7000).
  - Future high-privilege: 0.7–0.8 range.

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
  - `nullifier` equals the user’s `UniquenessNullifier` (or its hash on-chain).
  - `merkle_root` binds to the residency set.
- Dev mode: stubs may use `district_hash = "mock-district"` and `merkle_root = "mock-root"`; shapes must match.
- Usage constraints:
  - `district_hash` and `nullifier` together are **sensitive**; this pair MUST NOT appear in public mesh documents or on-chain storage.
  - `district_hash` MAY appear inside encrypted outbox payloads (e.g., SentimentSignal → Guardian Node) or in aggregated per-district stats (without nullifiers) that are published to reps or dashboards.
  - On-chain contracts never store `district_hash`; governance/economics are region-agnostic at the contract level.
  - See `docs/specs/spec-data-topology-privacy-v0.md` for placement rules.

## 5. Multi-Device & Recovery Semantics

- Identity = `UniquenessNullifier`; devices are entry points.
- Multi-device linking: prove “same human”, reuse nullifier.
- Recovery: preserve nullifier (hence UBE/QF rewards, sentiment history); rotate wallet addresses, mesh keys, session tokens.

## 6. Agentic Familiars (Delegation)

Familiars are delegated sub-processes of a verified human. They inherit the principal’s trust gate and never multiply influence.

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

- Familiars MUST NOT have their own `trustScore`; they inherit the principal’s session gating.
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
