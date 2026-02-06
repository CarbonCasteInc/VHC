00-sprint-0-foundation.md:

# Sprint 0: The Foundation - Implementation Checklist

**Context:** `System_Architecture.md` v0.0.1 (Single Source of Truth)
**Note:** This sprint is archived. Canonical Analysis is now formalized in `System_Architecture.md` §6.3 and `docs/specs/canonical-analysis-v1.md`.
**Goal:** Establish the Monorepo, Hardware Roots of Trust, security posture, and basic mesh connectivity required for Milestone A readiness.
**Status:** Archived

### Guiding Constraints from the System Architecture
- [x] Zero-Trust & Forward Secrecy requirements captured in a visible checklist.
- [x] Local-First data plan documented (CRDT conflict policy, offline queues, hydration barrier).
- [x] AI-driven development guardrails codified (LOC caps, module boundaries, 200% coverage).
- [x] Vite + React + Node 20 + pnpm confirmed as the canonical toolchain.
- [x] Identity, trustScore, and constituency contracts are documented in `/docs/specs/spec-identity-trust-constituency.md` and referenced from `System_Architecture.md`.
- [x] Season 0 RVU/UBE/Faucet/QF economics are documented in `/docs/specs/spec-rvu-economics-v0.md` and referenced from `System_Architecture.md`.
- [x] AI analysis contract (prompt → JSON → validation → CanonicalAnalysis) is documented in `/docs/foundational/AI_ENGINE_CONTRACT.md` and referenced from `System_Architecture.md` and `docs/specs/canonical-analysis-v1.md`.
- [x] Data topology & privacy rules (public vs sensitive, mesh vs device vs chain) are documented in `/docs/specs/docs/specs/spec-data-topology-privacy-v0.md` and referenced from `System_Architecture.md`.

---

## Phase 0: Architecture Lock-In (Day 0)

### 0.1 Source-of-Truth Adoption
- [x] Publish `System_Architecture.md` to `/docs` and reference it from `README`.
- [x] Add `ARCHITECTURE_LOCK.md` summarizing Zero-Trust, Local-First, and Local-Only storage guarantees.
- [x] Capture risk register (Lamport overflow, TURN cost, AI drift) in `docs/risks.md`.
- [x] Civic engagement & sentiment contracts documented in `/docs/specs/docs/specs/spec-civic-sentiment.md` and referenced from `System_Architecture.md`.

### 0.2 Quality Gates & Tooling Alignment
- [x] Configure `.nvmrc` → Node 20 LTS and `.npmrc` → `strict-peer-dependencies=false`.
- [x] Document `200% coverage` expectations in `CONTRIBUTING.md`.
- [x] Add `pnpm test:quick`, `pnpm test:workflow`, `pnpm test:e2e` scripts as stubs that fail until implemented.

**DoD:** Architecture version referenced in every spec, guardrail scripts exist, and CI fails if scripts are missing.

---

## Phase 1: Repository & Infrastructure (Day 1-3)

### 1.1 Monorepo Scaffolding
- [x] **Init:** Initialize `pnpm` workspace with `apps/`, `packages/`, `services/`, `infra/`, `tools/`.
- [x] **Config:** Configure `tsconfig.base.json` (Strict Mode, no implicit any, no unchecked indexed access).
- [x] **Linting:** Configure `eslint` with **custom rule** to warn at 250 LOC and fail at 350 LOC.
- [x] **Testing:** Configure `vitest` workspace-wide.
- [x] **Pre-commit:** Setup `husky` to run lint + test:quick on commit.
- [x] **Module Graph:** Add `madge` (or `dpdm`) check to CI for circular dependencies.
- [x] **Browser Discipline:** Add ESLint rule to forbid Node built-ins in `apps/*` + `packages/ui`.

### 1.2 The `vh` CLI (Developer Experience)
- [x] **Scaffold:** Create `tools/scripts/vh` entry point (Node.js CLI).
- [x] **Cmd:** Implement `vh bootstrap init` (Generate local secrets for MinIO/Turn/JWT).
- [x] **Cmd:** Implement `vh bootstrap up` (Docker Compose orchestration).
- [x] **Docker:** Create `infra/docker/docker-compose.yml` (MinIO, Gun-Relay, CoTURN, Aggregators).
- [x] **Cmd:** Implement `vh bootstrap check` to run TLS/TURN diagnostics defined in System Architecture §6.2.
- [x] **Cmd:** Add `vh dev` (stack + PWA) and `vh test:quick` wrappers.

### 1.3 CI/CD Pipeline
- [x] **Workflow:** Create `.github/workflows/main.yml`.
- [x] **Gate:** Ensure pipeline fails on Coverage < 100%.
- [x] **Gate:** Ensure pipeline fails on Circular Dependencies (`madge` or `dpdm`).
- [x] **Gate:** Ensure pipeline fails on LOC violations (350 line hard cap).
- [x] **Gate:** Add Lighthouse budget placeholder (Perf ≥ 90, A11y ≥ 90).
- [x] **Gate:** Enforce bundle size alert (PWA ≤ 1 MiB gzipped).

**DoD:** `pnpm lint` + `pnpm test:quick` + `vh bootstrap up` succeed locally and on CI, and automation reflects all Section 5 & 9 requirements.

---

## Phase 2: Core Packages & Identity (The Bedrock)

### 2.1 Core Libraries
- [x] **Types:** Create `packages/types` (Zod schemas & TS Interfaces), including shared civic data contracts (SentimentSignal, AggregateSentiment, Eye read semantics) as defined in `System_Architecture.md` and `docs/specs/docs/specs/spec-civic-sentiment.md`.
- [x] **Crypto:** Create `packages/crypto` (E2EE primitives, wrappers for `window.crypto.subtle`).
- [x] **CRDT:** Create `packages/crdt` (Lamport, LWW, Vector Clocks).
- [x] **Data:** Create `packages/data-model` (High-level Entities: Msg, Post).
- [x] **Gun Client:** Create `packages/gun-client` with hydration barrier + graph pruning scaffolding.

### 2.2 Hardware Attestation (The Root)
- [x] **Spec:** Define `AttestationPayload` interface in `packages/types`.
- [x] **Native (iOS):** Implement Capacitor plugin stub for `DCAppAttestService` (Swift).
- [x] **Native (Android):** Implement Capacitor plugin stub for `KeyGenParameterSpec` (Kotlin).
- [x] **Service:** Build `services/attestation-verifier` (Rust/WASM) to verify Apple/Google cert chains.
- [x] **Test:** Write `attestation.test.ts` using mock certificates.

### 2.3 LUMA Core & Networking
- [x] **Graph:** Initialize `packages/gun-client` (Strict Isolation - The ONLY package importing `gun`).
- [x] **Auth:** Implement `createSession(attestation)` -> returns `UniquenessNullifier`.
- [x] **Storage:** Implement `EncryptedStorageAdapter` (IndexedDB + WebCrypto).
- [x] **Outbox:** Scaffold offline queue + retry policy following Local-First mandate.
- [x] **Docs:** Capture hydration barrier and conflict resolution strategy (Lamport + LWW + CRDT sets) in `packages/crdt/README.md`.

**DoD:** Demo script can issue attestation, exchange encrypted payload through `gun-client`, and pass unit tests for CRDT conflict resolution.

---

## Phase 2.2: Guardian Node Deployment (Geekom)

- [x] **OS:** Ubuntu Server 24.04 installed & SSH secured.
- [x] **Deps:** Docker, Node 20, pnpm installed.
- [x] **Repo:** Cloned to `/opt/venn-hermes`.
- [x] **Secrets:** Production `.env` generated via `vh bootstrap init` (run with `--force` when rotating).
- [x] **Launch:** Stack running via `vh bootstrap up`.
- [x] **Verify:** MinIO (port 9001) and Traefik (port 8081) reachable from LAN clients; TURN (3478/udp) accessible through firewall.

**DoD:** Guardian node advertises all services on the LAN, Docker containers stay healthy, and secrets are stored securely on the Geekom host.

---

## Phase 3: GWC (Economic Layer) Foundation

### 3.1 Contracts (Solidity)
- [x] **Env:** Setup Hardhat/Foundry in `packages/contracts`.
- [x] **Token:** Implement `RVU.sol` (ERC-20 with AccessControl).
- [x] **Oracle:** Implement `MedianOracle.sol` (Simple commit-reveal logic).
- [x] **Test:** 100% coverage for Token Mint/Burn and Oracle math.
- [x] **Audit Prep:** Document threat model + zero-trust assumptions for contracts.

### 3.2 Local Chain
- [x] **Script:** Update `vh bootstrap up` to spin up local Anvil node.
- [x] **Deploy:** Create deterministic deployment script for Genesis Block.
- [x] **Monitor:** Add health-check endpoints consumed by `vh bootstrap check`.

**DoD:** Local CLI can deploy contracts deterministically, emit events consumed by `packages/gun-client`, and all Solidity tests report 100% coverage.

---

## Phase 4: VENN (Application Layer) Skeleton

### 4.1 VENN Client (Tauri/React)
- [x] **Shell:** Init Tauri app in `apps/desktop`.
- [x] **Shell:** Init Capacitor app in `apps/mobile`.
- [x] **Web:** Init React app in `apps/web-pwa`.
- [x] **UI:** Create `packages/ui` (Atomic Design Components).
- [x] **Stack:** Setup React + Vite + Tailwind + TanStack Router.
- [x] **State:** Setup `Zustand` store connected to `@venn-hermes/gun-client`.
- [x] **Query:** Integrate TanStack Query for health checks + aggregator reads.
- [x] **Security:** Implement secure logout/wipe flow placeholder aligning with Milestone E goal.
- [x] **Accessibility:** Add axe-core smoke test to `pnpm test:quick`.

### 4.2 WebLLM Integration (The Nervous System)
- [x] **Engine:** Create `packages/ai-engine`.
- [x] **WASM:** Integrate `mlc-llm` WebLLM runtime.
- [x] **Worker:** Move AI inference to a Web Worker (off main thread).
- [x] **Prompt:** Port the "Bias Detection" prompt (from Python) to TypeScript template literals.
- [x] **Privacy:** Ensure inference requests only operate on encrypted / local data blobs per System Architecture §2.

**DoD:** Tauri/Capacitor/Web shells render initial navigation, can call into `@venn-hermes/gun-client`, and trigger a placeholder AI inference completed inside a Worker.

---

## Phase 5: Integration & Acceptance

- [x] **E2E:** Create `packages/e2e` (Playwright Specs).
- [x] **Test:** Write a Playwright test that:
    1. Starts the stack (`vh bootstrap up`).
    2. Launches the Web App.
    3. Generates a (Mock) Attestation.
    4. Creates an Identity.
    5. Connects to Gun Relay.
    6. Generates a "Hello World" Analysis via WebLLM.
    7. Verifies data persistence.
- [x] **Chaos:** Add placeholder chaos test (network flap) verifying offline queue reliability.
- [x] **Lighthouse:** Automate budget runs with artifacts uploaded to CI.

**DoD:** End-to-end run demonstrates Milestone A (Home Server Bring-Up) and seeds requirements for Milestone B, with artifacts captured in CI.

---

## Exit Criteria for Sprint 0
- [x] `vh bootstrap check` passes against a clean environment.
- [x] Two independent peers can exchange encrypted messages with offline/online transitions (Milestone B preview).
- [x] Coverage + lint + bundle gates block regressions (Sections 5 & 9).
- [x] Risk mitigations logged with owners.
