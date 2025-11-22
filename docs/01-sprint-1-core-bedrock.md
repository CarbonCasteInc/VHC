# Sprint 1: Core Bedrock - Implementation Checklist

**Context:** `System_Architecture.md` v0.0.1 (Sprint 1: The "Data Dividend" & Civic Beta)
**Goal:** Connect the PWA to the Attestation Service, deploy Contracts to Testnet, and enable the "First-to-File" Canonical Analysis protocol.
**Status:** [ ] In Progress

### Guiding Constraints & Quality Gates
- [ ] **Non-Negotiables:**
    - [ ] **LOC Cap:** Hard limit of 350 lines per file (enforced by CI).
    - [ ] **Coverage:** 100% Line/Branch coverage for every touched module.
    - [ ] **Testing:** Source-based testing (`src/`) with mocks honoring **Mock Fidelity** (realistic timing) and **True Offline Mode** (no default peers).
- [ ] **Attestation-Gated:** No session keys without valid hardware attestation (simulated in dev, real in prod).
- [ ] **Testnet-Ready:** Contracts deployed to Sepolia/Base Testnet with verifiable source code and strict env-var separation.
- [ ] **Canonical-First:** Analysis is deduplicated by URL hash; first valid claim wins.

---

## Phase 1: LHID (Identity & Trust)

### 1.1 Attestation Integration
- [ ] **Client:** Update `useIdentity` to fetch real/mock attestation from `AttestationVerifier` service.
- [ ] **API Contract:** Ensure payload fields use `camelCase` per `packages/types`.
- [ ] **Service:** Harden `attestation-verifier` to validate platform-specific chains (Apple AppAttest / Google Play Integrity).
- [ ] **Session:** Implement `createSession` handshake: Client sends Attestation -> Service verifies -> Returns `trust_score` -> Client derives Nullifier.
    - *Constraint:* Session creation MUST fail if `trust_score` is insufficient.
    - *Constraint:* Default peers must be empty `[]` in offline/E2E mode (`VITE_E2E_MODE=true`).

### 1.2 Region Notary (ZK-Residency)
- [x] **Spec:** Define `RegionNotary` interface in `packages/types` and `packages/data-model`.
- [x] **Privacy:** Ensure "No Location Leakage" policy (Privacy Budget) is documented and enforced.
- [x] **Circuit:** Implement `prove_residency.circom` (Mock/Stub for Sprint 1).
- [ ] **Integration:** Client generates proof of region (e.g., "US-CA") without revealing exact location.

### 1.3 Multi-Device Linking
- [ ] **Graph:** Implement "Add Device" flow in `gun-client`.
- [ ] **Sync:** Ensure profile and session keys sync across linked devices via Gun.
- [ ] **Safety:** Respect **Hydration Barrier** (read-before-write) and prevent `ready` event race conditions.
- [ ] **Docs:** Document key-rotation and linking flow in `packages/gun-client/README.md`.

**DoD:** A user can create an identity that is attested by the service (gated by trust score), and link a second device that inherits the identity. CI passes with True Offline Mode.

---

## Phase 2: GWC (Economics & Ledger)

### 2.1 Testnet Deployment
- [ ] **Infra:** Configure Hardhat for Sepolia/Base Testnet deployment.
- [ ] **Security:** Enforce strict separation of environment variables (no Mainnet keys in Testnet env).
- [ ] **Script:** Create `deploy-testnet.ts` with **Etherscan verification**.
- [ ] **Faucet:** Implement a simple testnet faucet for RGU tokens (rate-limited by Attestation).

### 2.2 UBE Drip (Universal Basic Equity)
- [ ] **Contract:** Implement `UBE.sol` (Drip logic based on verified identity).
- [ ] **Auditability:** Ensure all claim events are indexed for off-chain verification.
- [ ] **Integration:** Connect PWA to `UBE` contract to claim daily drip.
- [ ] **Coverage:** 100% test coverage for new `UBE` contract.

### 2.3 Quadratic Funding (Basic)
- [ ] **Contract:** Implement `QuadraticFunding.sol` (Pool matching logic).
- [ ] **Vote:** Implement `castVote` function (Attestation-gated).
- [ ] **Coverage:** 100% test coverage for `QuadraticFunding` contract.

**DoD:** Contracts deployed to Testnet, verified on Explorer, and PWA can claim UBE drip. All new contracts meet 100% coverage.

---

## Phase 3: VENN (Application & Nervous System)

### 3.1 Canonical Analysis Protocol
- [ ] **Schema:** Define `CanonicalAnalysis` schema in `packages/data-model`.
- [ ] **Protocol:** Implement "First-to-File" logic:
    1. Hash URL + Timestamp -> `canonicalId`.
    2. Query Gun for existing Analysis by `canonicalId`.
    3. If missing, generate via WebLLM (**Local-Only Inference**) and publish.
    4. If exists, display existing Analysis.

### 3.2 Civic Decay Logic
- [ ] **Algo:** Implement decay function (weight halves per interaction).
- [ ] **Storage:** Persist decay state locally to ensure idempotent application across sessions.

### 3.3 UI Polish & Integration
- [ ] **Feed:** Create a "News Feed" view showing recent Canonical Analyses.
- [ ] **Wallet:** Create a "Wallet" view showing RGU balance and UBE claim status.
- [ ] **Performance:** Enforce Bundle Budget (≤ 1 MiB gz) and Lighthouse Perf ≥ 90.

**DoD:** User can paste a URL, generate/view an Analysis (local inference), and see it appear in the global feed. UI meets performance budgets.

---

## Phase 4: Integration & Acceptance

### 4.1 E2E Tests
- [ ] **Flow:** Full "Zero to Hero" flow:
    1. Attest & Create Identity.
    2. Claim UBE (Mock Chain).
    3. Analyze a URL (First-to-File).
    4. Link Second Device.
    5. Verify Sync.
- [ ] **Constraint:** E2E tests must run with `VITE_E2E_MODE=true` forcing zero network access (True Offline Mode).

### 4.2 Performance & Security
- [ ] **Audit:** Internal security review of `AttestationVerifier`.
- [ ] **Perf:** Lighthouse CI gate passing (Perf ≥ 90).

**DoD:** All E2E tests pass, CI is green (Quality, Unit, Build, E2E, Bundle, Lighthouse), and public beta candidates are ready.

---

## Exit Criteria for Sprint 1
- [ ] **CI Green:** All gates (Quality, Unit, Build, E2E, Bundle, Lighthouse) passing.
- [ ] **Non-Negotiables:** 100% Coverage and LOC caps satisfied.
- [ ] **Attestation Enforced:** No session creation without verified `trust_score`.
- [ ] **Public Beta:** v0.1 released to internal testers.
- [ ] **Testnet:** Contracts live on Sepolia/Base.
