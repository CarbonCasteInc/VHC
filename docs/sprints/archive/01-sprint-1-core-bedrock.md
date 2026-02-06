01-sprint-1-core-bedrock.md

# Sprint 1: Core Bedrock - Implementation Checklist

**Context:** `System_Architecture.md` v0.0.1 (Sprint 1: The "Data Dividend" & Civic Beta)
**Note:** This sprint is archived. Canonical Analysis is now formalized in `System_Architecture.md` §6.3 and `docs/specs/canonical-analysis-v1.md`.
**Goal:** Connect the PWA to the Attestation Service, deploy Contracts to Testnet, and enable the "First-to-File" Canonical Analysis protocol.
**Status:** Archived

### Guiding Constraints & Quality Gates
- [ ] **Non-Negotiables:**
    - [ ] **LOC Cap:** Hard limit of 350 lines per file (enforced by CI).
    - [ ] **Coverage:** 100% Line/Branch coverage for every touched module.
    - [ ] **Testing:** Source-based testing (`src/`) with mocks honoring **Mock Fidelity** (realistic timing) and **True Offline Mode** (no default peers).
- [ ] **Attestation-Gated:** No session keys without valid hardware attestation (simulated in dev, real in prod).
- [ ] **Testnet-Ready:** Contracts deployed to Sepolia/Base Testnet with verifiable source code and strict env-var separation.
- [ ] **Canonical-First:** Analysis is deduplicated by URL hash; first valid claim wins.

---

## Phase 1: LUMA (Identity & Trust)

### 1.1 Attestation Integration
- [x] **Client:** Update `useIdentity` to fetch real/mock attestation from `AttestationVerifier` service.
- [x] **API Contract:** Ensure payload fields use `camelCase` per `packages/types`.
- [x] **Service:** Harden `attestation-verifier` to validate platform-specific chains (Apple AppAttest / Google Play Integrity).
- [x] **Session:** Implement `createSession` handshake: Client sends Attestation -> Service verifies -> Returns `trust_score` -> Client derives Nullifier.
    - *Constraint:* Session creation MUST fail if `trust_score` is insufficient.
    - *Constraint:* Default peers must be empty `[]` in offline/E2E mode (`VITE_E2E_MODE=true`).

### 1.2 Region Notary (ZK-Residency)
- [x] **Spec:** Define `RegionNotary` interface in `packages/types` and `packages/data-model`.
- [x] **Privacy:** Ensure "No Location Leakage" policy (Privacy Budget) is documented and enforced.
- [x] **Circuit:** Implement `prove_residency.circom` (Mock/Stub for Sprint 1).
- [ ] **Integration:** Client generates proof of region (e.g., "US-CA") without revealing exact location.
*Note:* Identity and RegionNotary shapes are canonicalized in `spec-identity-trust-constituency.md`; Sprint 1 implementation is a prototype and may differ.

### 1.3 Multi-Device Linking
- [x] **Graph:** Implement "Add Device" flow in `gun-client`.
- [x] **Sync:** Ensure profile and session keys sync across linked devices via Gun.
- [x] **Safety:** Respect **Hydration Barrier** (read-before-write) and prevent `ready` event race conditions.
- [x] **Docs:** Document key-rotation and linking flow in `packages/gun-client/README.md`.

**DoD:** A user can create an identity that is attested by the service (gated by trust score), and link a second device that inherits the identity. CI passes with True Offline Mode.

---

## Phase 2: GWC (Economics & Ledger)

### 2.1 Testnet Deployment
- [x] **Infra:** Configure Hardhat for Sepolia/Base Testnet deployment.
- [x] **Security:** Enforce strict separation of environment variables (no Mainnet keys in Testnet env).
- [x] **Script:** Create `deploy-testnet.ts` with **Etherscan verification**.
- [x] **Faucet:** Implement a simple testnet faucet for RVU tokens (rate-limited by Attestation).

### 2.2 UBE Drip (Universal Basic Equity)
- [x] **Contract:** Implement `UBE.sol` (Drip logic based on verified identity).
- [x] **Params (Season 0):** `minTrustScore = 5000 (0.5)`, `claimInterval = 1 day`, `dripAmount ~25 RVU`; no region gating and no lifetime cap in v0 (bounded by attestation expiry).
- [x] **Auditability:** Ensure all claim events are indexed for off-chain verification.
- [x] **Metrics:** Add aggregate counters (e.g., `totalDistributed`) for observability.
- [x] **Integration:** Connect PWA to `UBE` contract to claim daily drip.
- [x] **Coverage:** 100% test coverage for new `UBE` contract.

### 2.3 Quadratic Funding (Basic)
- [x] **Contract:** Implement `QuadraticFunding.sol` (Pool matching logic).
- [x] **Vote:** Implement `castVote` function (Attestation-gated).
- [x] **Coverage:** 100% test coverage for `QuadraticFunding` contract.
- [x] **Season 0 Scope:** Contract hardened and deployed, but public governance UI remains off-chain; on-chain QF rounds run only with dev/test accounts in S1/S2.

**DoD:** Contracts deployed to Testnet, verified on Explorer, and PWA can claim UBE drip. All new contracts meet 100% coverage.

---

## Phase 3: VENN (Application & Nervous System)

### 3.1 Canonical Analysis Protocol
*Note:* CanonicalAnalysis shape is now governed by `docs/specs/canonical-analysis-v1.md`; this section captures the historical first implementation.
- [x] **Schema:** Define `CanonicalAnalysis` with:
      - `topic_id` (urlHash)
      - `analysis_id` (canonical analysis hash)
      - summary, biases, counterpoints, metadata
- [x] **Protocol:** Implement `getOrGenerate` (First-to-File) and `applyDecay` logic.

### 3.2 Civic Decay Logic
- [x] **Storage:** Persist decay state locally to ensure idempotent application across sessions.

Note: Civic Decay logic implemented in Sprint 1 is a prototype. The canonical Civic Decay semantics (including 0–2 Lightbulb bounds and SentimentSignal emission) are defined in `System_Architecture.md` §6.2 and `docs/specs/spec-civic-sentiment.md`, and fully enforced in Sprint 2.
*Note:* The Sprint 1 analysis pipeline is a prototype. The canonical AI engine contract (prompt, JSON wrapper, schema validation, and hallucination guardrails) is defined in `docs/foundational/AI_ENGINE_CONTRACT.md` and `docs/specs/canonical-analysis-v1.md` and fully enforced in Sprint 2. Season 1 data placement (analyses, sentiment) is proto; Season 0 topology/privacy rules (public CanonicalAnalyses, local-only sentiment, no constituency in mesh) are defined in `docs/specs/spec-data-topology-privacy-v0.md` and enforced starting in Sprint 2.

### 3.3 UI Polish & Integration
- [x] **Feed:** Create a "Topics stream" (formerly News Feed) showing recent Canonical Analyses.
- [x] **Wallet:** Create a "Wallet" view showing RVU balance and UBE claim status.
- [x] **Performance:** Enforce Bundle Budget (≤ 1 MiB gz) and Lighthouse Perf ≥ 90.

**DoD:** User can paste a URL, generate/view an Analysis (local inference), and see it appear in the global Topics stream. UI meets performance budgets.

---

## Phase 4: Integration & Acceptance

### 4.1 E2E Tests
- [x] **Flow:** Full "Zero to Hero" flow:
    1. Attest & Create Identity.
    2. Claim UBE (Mock Chain).
    3. Analyze a URL (First-to-File).
    4. Link Second Device.
    5. Verify Sync.
- [x] **Constraint:** E2E tests must run with `VITE_E2E_MODE=true` forcing zero network access (True Offline Mode).

### 4.2 Performance & Security
- [x] **Audit:** Internal security review of `AttestationVerifier`.
- [x] **Perf:** Lighthouse CI gate passing (Perf ≥ 90).

**DoD:** All E2E tests pass, CI is green (Quality, Unit, Build, E2E, Bundle, Lighthouse), and public beta candidates are ready.

---

## Exit Criteria for Sprint 1
- [x] **CI Green:** All gates (Quality, Unit, Build, E2E, Bundle, Lighthouse) passing.
- [x] **Non-Negotiables:** 100% Coverage and LOC caps satisfied.
- [x] **Attestation Enforced:** No session creation without verified `trust_score`.
- [x] **Public Beta:** v0.1 released to internal testers.
- [x] **Testnet:** Contracts live on Sepolia/Base.
