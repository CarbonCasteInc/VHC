# Sprint 1: Core Bedrock - Implementation Checklist

**Context:** `System_Architecture.md` v0.0.1 (Sprint 1: The "Data Dividend" & Civic Beta)  
**Goal:** Connect the PWA to the Attestation Service, deploy Contracts to Testnet, and enable the "First-to-File" Canonical Analysis protocol.  
**Status:** [ ] In Progress

### Guiding Constraints
- [ ] **Attestation-Gated:** No session keys without valid hardware attestation (simulated in dev, real in prod).
- [ ] **Testnet-Ready:** Contracts deployed to Sepolia/Base Testnet with verifiable source code.
- [ ] **Canonical-First:** Analysis is deduplicated by URL hash; first valid claim wins.

---

## Phase 1: LHID (Identity & Trust)

### 1.1 Attestation Integration
- [ ] **Client:** Update `useIdentity` to fetch real/mock attestation from `AttestationVerifier` service.
- [ ] **Service:** Harden `attestation-verifier` to validate platform-specific chains (Apple AppAttest / Google Play Integrity).
- [ ] **Session:** Implement `createSession` handshake: Client sends Attestation -> Service verifies -> Returns Trust Score -> Client derives Nullifier.

### 1.2 Region Notary (ZK-Residency)
- [ ] **Spec:** Define `RegionNotary` interface in `packages/types`.
- [ ] **Circuit:** Implement `prove_residency.circom` (Mock/Stub for Sprint 1).
- [ ] **Integration:** Client generates proof of region (e.g., "US-CA") without revealing exact location.

### 1.3 Multi-Device Linking
- [ ] **Graph:** Implement "Add Device" flow in `gun-client`.
- [ ] **Sync:** Ensure profile and session keys sync across linked devices via Gun.

**DoD:** A user can create an identity that is attested by the service, and link a second device that inherits the identity.

---

## Phase 2: GWC (Economics & Ledger)

### 2.1 Testnet Deployment
- [ ] **Infra:** Configure Hardhat for Sepolia/Base Testnet deployment.
- [ ] **Script:** Create `deploy-testnet.ts` with Etherscan verification.
- [ ] **Faucet:** Implement a simple testnet faucet for RVU tokens (rate-limited by Attestation).

### 2.2 UBE Drip (Universal Basic Equity)
- [ ] **Contract:** Implement `UBE.sol` (Drip logic based on verified identity).
- [ ] **Integration:** Connect PWA to `UBE` contract to claim daily drip.
- [ ] **Indexer:** Simple event indexer to track UBE claims.

### 2.3 Quadratic Funding (Basic)
- [ ] **Contract:** Implement `QuadraticFunding.sol` (Pool matching logic).
- [ ] **Vote:** Implement `castVote` function (Attestation-gated).

**DoD:** Contracts deployed to Testnet, verified on Explorer, and PWA can claim UBE drip.

---

## Phase 3: VENN (Application & Nervous System)

### 3.1 Canonical Analysis Protocol
- [ ] **Schema:** Define `CanonicalAnalysis` schema in `packages/data-model`.
- [ ] **Protocol:** Implement "First-to-File" logic:
    1. Hash URL.
    2. Query Gun for existing Analysis.
    3. If missing, generate via WebLLM and publish.
    4. If exists, display existing Analysis.

### 3.2 Civic Decay Logic
- [ ] **Algo:** Implement decay function (weight halves per interaction).
- [ ] **Storage:** Track user interactions locally to enforce decay.

### 3.3 UI Polish & Integration
- [ ] **Feed:** Create a "News Feed" view showing recent Canonical Analyses.
- [ ] **Wallet:** Create a "Wallet" view showing RVU balance and UBE claim status.

**DoD:** User can paste a URL, generate/view an Analysis, and see it appear in the global feed.

---

## Phase 4: Integration & Acceptance

### 4.1 E2E Tests
- [ ] **Flow:** Full "Zero to Hero" flow:
    1. Attest & Create Identity.
    2. Claim UBE (Mock Chain).
    3. Analyze a URL (First-to-File).
    4. Link Second Device.
    5. Verify Sync.

### 4.2 Performance & Security
- [ ] **Audit:** Internal security review of `AttestationVerifier`.
- [ ] **Perf:** Lighthouse CI gate passing (Perf ≥ 90).

**DoD:** All E2E tests pass, CI is green, and public beta candidates are ready.

---

## Exit Criteria for Sprint 1
- [ ] Public Beta (v0.1) released to internal testers.
- [ ] Contracts live on Testnet.
- [ ] Attestation Service enforcing hardware roots of trust.
