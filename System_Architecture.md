# BIO-EC OS: Source of Truth

**Codename:** TRINITY (GWC x LHID x VENN)
**Version:** 0.2.0 (Sprint 2 Baseline)
**Status:** APPROVED FOR EXECUTION

-----

## 1. The Mission & Prime Directives

TRINITY is a **Parallel Institution**: A self-sovereign Operating System for Identity, Wealth, and Governance. It functions as a digital organism designed to operate without central intermediaries.

**The Triad:**

1.  **LHID (The Immune System):** Biological reality (Hardware TEE + Biometrics) to filter Sybils.
2.  **GWC (The Circulatory System):** Resource-backed wealth (ZK-Rollup + Oracles) to distribute value.
3.  **VENN (The Nervous System):** Local-first intent sensing (P2P Mesh + Edge AI) to act on information.

**Engineering Prime Directives:**

1.  **Local is Truth:** Data lives on the user's device. The cloud is merely an encrypted relay.
2.  **Physics is Trust:** Keys are bound to hardware (TEE/Enclave), not passwords.
3.  **Math is Law:** Governance is receipt-free (MACI) and anti-collusive.
4.  **Shared Reality:** Analysis is generated at the edge but deduplicated via the "First-to-File" protocol.
5.  **Sovereign Delivery:** We do not ask permission to speak. If APIs are blocked, we automate the delivery via headless browsers.
6.  **Strict Discipline:** Modularization (350 LOC hard cap) and Testing (100% coverage) are non-negotiable.

-----

## 2. The 4-Layer Architecture

### Layer 0: Physics (The Root)

  * **Role:** Hardware Root of Trust.
  * **Tech:** Secure Enclave (iOS), StrongBox (Android), TPM (Desktop).
  * **Function:** Generates non-exportable keys. Attests to device integrity (AppAttest/Play Integrity). This layer prevents emulation and virtual machine attacks.

### Layer 1: Identity (LHID - The Synapse)

  * **Role:** Sybil resistance, Data Sync, & Recovery.
  * **Tech:** Rust (Core), GUN (Sync Mesh), Pedersen Commitments, ZK-SNARKs.
  * **Function:**
      * **Bio-Tethering:** Liveness checks via TEE-signed biometrics.
      * **ZK-Residency:** Proof of constituency without doxxing.
      * **Recovery:** Multi-device linking and Social Recovery (M-of-N guardian signatures) to mitigate device loss.

### Layer 2: Economics (GWC - The Ledger)

  * **Role:** Value Transfer & Governance.
  * **Tech:** EVM (Layer 2 Rollup), Circom (ZK Circuits), MACI.
  * **Function:**
      * **RVU:** Real Value Unit (floating purchasing power mirror; not a peg).
      * **UBE:** Universal Basic Equity distribution.
      * **Holographic Oracle:** Medianized price feeds from Staked Nodes.
      * **Governance:** Anti-collusion voting via MACI.

### Layer 3: Application (VENN - The Interface)

  * **Role:** User Interaction, Communication, Civic Action.
  * **Tech:** React, Tauri/Capacitor, WebLLM (Edge AI), `@venn-hermes/*`.
  * **Function:** Canonical News Analysis, E2EE Messaging, Sovereign Legislative Bridge.

-----

## 3. Unified Tech Stack & Repositories

The system functions as a Monorepo with polyglot micro-services.

### 3.1 Client-Side (The "Super App")

  * **Shell:** Tauri (Desktop), Capacitor (Mobile).
  * **UI Framework:** React 18 + Vite (TypeScript).
  * **State/Sync:**
      * *Transient:* Zustand.
      * *Durable:* `@venn-hermes/gun-client` (Strictly isolated GUN wrapper).
  * **Edge AI:** **WebLLM (WASM)** running local inference (Llama-3-8B-Quantized or similar).
  * **Automation:** Playwright (bundled in Desktop) for Sovereign Delivery.

### 3.2 Server-Side (The Untrusted Cloud)

  * **Network:** P2P Mesh via Encrypted WebSockets.
  * **Relays:** Node.js 20 (Stateless). Users are incentivized to run **Home Guardian Nodes** (Raspberry Pi/Mini PC) to decentralize storage and compute.
  * **Storage:** MinIO (S3 Compatible) for encrypted blobs > 100KB.
  * **Chain:** Hardhat/Foundry for EVM contracts.

### 3.3 Engineering Constraints

  * **LOC Caps:** Soft: 250 / Hard: 350 lines per file. (Exempt: Tests, Types, ABI bindings).
  * **Test Coverage:** 100% Line/Branch coverage required.
  * **Browser Discipline:** No Node.js APIs (`fs`, `crypto`) in Client code.

-----

## 4. Core Modules & Implementation Details

### 4.1 LHID: Bio-Tethering & Recovery

  * **Purpose:** Prevent "Account Renting" and mitigate device loss.
  * **Mechanism:**
    1.  **Session Start:** VIO (Visual Inertial Odometry) scan signed by TEE.
    2.  **Challenge:** Random micro-gesture (e.g., "Tilt left 15°") to prove liveness.
    3.  **Recovery:** Users designate Guardians or secondary devices. Restoring an identity requires `M-of-N` signatures to rotate the underlying Enclave Key without losing the Identity Nullifier.

### 4.2 GWC: The Holographic Oracle

  * **Purpose:** Uncensorable pricing for the RVU.
  * **Mechanism:**
    1.  **Nodes:** 50+ Staked Economic Nodes.
    2.  **Privacy:** Price vectors encrypted via Pedersen Commitments.
    3.  **Calc:** Smart Contract calculates the **Median** homomorphically.
    4.  **Security:** No single node's specific feed is ever decrypted.

### 4.3 VENN: The Canonical Bias Engine

  * **Purpose:** Shared Analysis without Centralization.
  * **Mechanism ("First-to-File"):**
    1.  **Lookup:** User opens URL. App queries Mesh for hash of URL.
    2.  **Scenario A (Exists):** User downloads shared Analysis. WebLLM (Local) audits it. If valid, User votes.
    3.  **Scenario B (New):** **WebLLM (Local)** generates Analysis. User signs and publishes it as the **Canonical Record**.
    4.  **Civic Decay (Asymptotic):**
          * Formula: $E_{new} = E_{current} + 0.3 * (2.0 - E_{current})$.
          * Logic: Engagement asymptotically approaches 2.0 to prevent brigading while rewarding depth.

### 4.4 HERMES: The Sovereign Legislative Bridge

  * **Purpose:** Verified influence that cannot be blocked.
  * **Mechanism:**
    1.  **Aggregate:** Nodes collect proposals via HRW hashing.
    2.  **Verify:** LHID attaches **ZK-Proof of Constituency**.
    3.  **Deliver (Sovereign Fallback):**
          * **Desktop:** Local Playwright instance fills the `.gov` form.
          * **Mobile:** Delegate delivery to **Home Guardian Node** (Trusted Relay). The Node fills the form using the user's signed payload.

-----

## 5. Unified Development Roadmap

### Sprint 0: The Foundation (Weeks 1–6) [COMPLETE]

**Goal:** Solvency, Identity Root, and Secure Mesh.

  * **Status:** **CLOSED**. Infra live, Core Logic 100% Coverage, E2E Tracer passing.

### Sprint 1: The "Data Dividend" & Civic Beta (Weeks 7–12) [IN PROGRESS]

**Goal:** User Growth & Canonical Analysis.

  * **GWC:** UBE Drip & Basic Quadratic Funding.
  * **VENN:** Canonical Analysis Protocol & Civic Decay Logic.
  * **LHID:** Region Notary (ZK-Residency) & Multi-Device Linking.
  * **Deliverable:** Public Beta (v0.1). Users verify, earn UBE, and use shared news analysis.

### Sprint 2: The Civic Nervous System (Weeks 13–20) [NEXT]

**Goal:** The Signal (Analysis, Decay, Voting).

  * **VENN:** The Civic Feed (Lazy Load, Z-Index Cards, Lightbulb Metrics).
  * **GWC:** Quadratic Funding & Proposal Governance.
  * **Engine:** AI Optimization (<2s) & Persistent Caching.
  * **Deliverable:** A fully functional "News App" with Governance capabilities.

### Sprint 3: The Agora (Weeks 21–28)

**Goal:** The Action (Messaging, Bridge).

  * **HERMES:** Sovereign Legislative Bridge (Playwright).
  * **HERMES:** E2EE Messaging & Collaborative Docs.
  * **Deliverable:** Beta v0.9 (Full Feature Set).

### Sprint 4: The Ironclad Hardening (Weeks 29–36)

**Goal:** Sovereignty & Anti-Collusion (Mainnet Prep).

  * **LHID:** Memory-Hard VDF (to slow Sybil attacks) & Full Social Recovery.
  * **GWC:** MACI Governance (Mainnet).
  * **VENN:** Chaos Testing, Audits, & Performance Tuning.
  * **Deliverable:** Mainnet "Ironclad" Release (v1.0).

-----

## 6. Data Models

### 6.1 The "Proof of Human" Session

```json
{
  "type": "GWC_BioTethered_Session",
  "version": "3.1",
  "device_id": "DEVICE_PUBKEY_HASH",
  "timestamp": 1699982735,
  "client_integrity": { "app_attestation": "Apple_AppAttest_v1" },
  "proof": {
    "uniqueness_nullifier": "0xZK_NULLIFIER...",
    "vio_integrity_score": 0.99,
    "tee_signature": "BASE64_SIGNED_BLOB"
  }
}
```

### 6.2 The Civic Sentiment Signal

```typescript
interface SentimentSignal {
  topic_id: string; // Hash of Canonical URL
  analysis_id: string; // Hash of the Canonical Analysis Object
  bias_vector: { 
    point_id: string; 
    agreement: 1 | 0 | -1; // 3-State Logic (Agree/None/Disagree)
  };
  weight: number; // Asymptotic Engagement Score (1.0 -> 2.0)
  constituency_proof: {
      district_hash: string; 
      nullifier: string;
      merkle_root: string;
  }
}
```

-----

## 7. Risk Register

| ID | Threat | Layer | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **R-01** | Injection / Emulation | L0 | **Hardware Attestation:** TEE Signatures required. |
| **R-02** | Account Renting | L1 | **Bio-Tethering:** Random micro-gestures prevent hand-offs. |
| **R-03** | Reality Fragmentation | L3 | **Canonical Analysis:** First-to-file protocol + AI Audit. |
| **R-04** | Legislative Blocking | L3 | **Sovereign Delivery:** Headless Browser Automation (Playwright). |
| **R-05** | Device Loss | L1 | **Recovery:** Multi-device linking & Social Recovery. |
| **R-06** | Malicious Analysis | L3 | **Distributed Moderation:** Local AI audits & community override votes. |

-----

## 8. Developer Quickstart

```bash
# 1. Clone the Monorepo
git clone git@github.com:trinity-os/core.git
cd core

# 2. Install Dependencies
pnpm i

# 3. Start Local Universe (Docker: Gun, MinIO, Anvil)
vh bootstrap up

# 4. Initialize Keys & Contracts
vh bootstrap init --deploy-contracts

# 5. Run the Client (PWA + Edge AI)
pnpm --filter apps/web-pwa dev
```

-----

## 9. System Prompt for AI Agents

*Paste this context at the start of every AI coding session.*

```text
You are a Senior Engineer building the TRINITY Bio-Economic OS (GWC x LHID x VENN).

Core Constraints:
1.  **Local-First:** User data stays on device. Cloud is for encrypted transport only.
2.  **Hardware-Rooted:** Critical actions require TEE/Secure Enclave signatures.
3.  **Shared Reality:** VENN Analysis is generated locally but deduplicated via Mesh.
4.  **Strict Modularity:** Files MUST NOT exceed 350 LOC. Split logic aggressively.
5.  **Testing:** 100% Line/Branch coverage required.
6.  **Stack:** React, Rust (WASM), Solidity, GUN (via wrapper only), WebLLM.

Current Task: [Insert Task]
```
