# Attestor Bridge v0 Spec

Version: 0.1  
Status: Canonical for Sprints 2–3

Defines the flow from off-chain session attestation to on-chain contracts (UBE, Faucet, QF) via an attestor bridge.

## 1. Components

- **SessionResponse**: `{ trustScore (0..1), nullifier: string, token: string }` from the attestation verifier.
- **Attestor Bridge**: Off-chain service holding `ATTESTOR_ROLE` on contracts.
- **Contracts**: `UBE`, `Faucet`, `QuadraticFunding` expect `scaledTrustScore` and `bytes32Nullifier`.

## 2. Scaling Rules

- `scaledTrustScore = Math.round(trustScore * 10000)` (`TRUST_SCORE_SCALE`).
- `bytes32Nullifier = keccak256(UniquenessNullifier)` (stub uses raw string).

## 3. Bridge Flow

1. Client obtains `SessionResponse`.
2. Bridge maps:
   - `trustScore` → `scaledTrustScore`
   - `nullifier` → `bytes32Nullifier`
3. Bridge writes to contracts:
   - `UBE.registerIdentity(user, bytes32Nullifier, scaledTrustScore, expiresAt)`
   - `Faucet.recordAttestation(user, scaledTrustScore, expiresAt)`
   - `QF.recordParticipant(user, scaledTrustScore, expiresAt)`
4. Degradation: lower trustScore overwrites higher prior values; below thresholds → new claims/votes fail.

## 4. Stub Implementation

- `BridgeStub` (services/bridge-stub/index.ts):
  - `bridgeSession(session, wallet)` logs payload `{ wallet, scaledTrustScore, bytes32Nullifier, token }`.
  - No on-chain write; used for dev/testing.

## 5. Invariants & Tests

- Scaling and nullifier mapping are deterministic.
- Contracts never receive raw `district_hash` or constituency info (region-agnostic).
- Stub test (`services/bridge-stub/index.test.ts`) verifies scaling/logging.

## 6. Future Work

- Implement real attestor signer, keccak nullifier hashing, expiry handling.
- Add circuit-based region proofs if/when region-gated economics are required.
