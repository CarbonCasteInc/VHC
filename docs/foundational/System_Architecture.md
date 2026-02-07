# BIO-EC OS: Target Architecture

**Codename:** TRINITY (VENN/HERMES x LUMA x GWC)
**Version:** 0.2.1 (Sprint 4 — Agentic Foundation)
**Status:** APPROVED FOR EXECUTION

> ⚠️ **This document describes the target architecture, not current implementation.**
> For actual implementation status, see `STATUS.md`. For gaps between this document
> and code reality, see the "Docs vs. Code Alignment" section in `STATUS.md`.

-----

## 1. The Mission & Prime Directives

TRINITY is a **Parallel Institution**: A self-sovereign Operating System for Identity, Wealth, and Governance. It functions as a digital organism designed to operate without central intermediaries.

**The Triad:**

1.  **LUMA (The Immune System):** Biological reality (Hardware TEE + Biometrics) to filter Sybils.
2.  **GWC (The Circulatory System):** Resource-backed wealth (ZK-Rollup + Oracles) to distribute value.
3.  **VENN-HERMES (The Nervous System):** Local-first intent sensing (P2P Mesh + Edge AI) to act on information.

**Engineering Prime Directives:**

1.  **Local is Truth:** Canonical identity and civic state live on the user's device. Mesh and chain hold public or encrypted replicas; untrusted infrastructure sees routing metadata, not raw identity or constituency.
2.  **Physics is Trust:** Keys are bound to hardware (TEE/Enclave), not passwords.
3.  **Math is Law:** Governance is receipt-free (MACI) and anti-collusive.
4.  **Shared Reality:** Analysis is generated at the edge but deduplicated via the "First-to-File" protocol. Canonical analyses may be refreshed in discrete **reanalysis epochs** (e.g., after N trusted discussion additions), with first-to-file applying per epoch window.
5.  **Civic Facilitation:** We enable verified constituents to speak through user-initiated channels (email/phone/share/export). We do not automate form submission by default.
6.  **Human Sovereignty (Delegated Agents):** Familiars are delegated sub-processes of a verified human. They never hold independent influence. Every agent action is attributable to a principal nullifier, scoped, expiring, revocable, and budgeted per human.
7.  **Strict Discipline:** Modularization (350 LOC hard cap) and Testing (100% coverage) are non-negotiable.

-----

## 2. The 4-Layer Architecture

### Layer 0: Physics (The Root)

  * **Role:** Hardware Root of Trust.
  * **Tech:** Secure Enclave (iOS), StrongBox (Android), TPM (Desktop).
  * **Function:** Generates non-exportable keys. Attests to device integrity (AppAttest/Play Integrity). This layer prevents emulation and virtual machine attacks.

### Layer 1: Identity (LUMA - The Synapse)

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

### Layer 3: Application (VENN-HERMES - The Interface)

  * **Role:** User Interaction, Communication, Civic Action (HERMES).
  * **Tech:** React, Tauri/Capacitor, WebLLM (Edge AI), `@venn-hermes/*`.
  * **Function:** Canonical News Analysis, E2EE Messaging, Civic Action Kit (facilitation), and proposal-threads (threads elevated with funding metadata).
  * **Familiar Runtime (Delegated Agents):**
      * Local-first orchestration; keys never leave device.
      * **Suggest:** summaries, drafts, triage (low risk).
      * **Act:** post/comment/thread ops — trust gated + rate limited.
      * **High-impact:** votes/funding/civic action — explicit human approval + higher trust threshold.
      * **Defaults:** See `docs/specs/spec-identity-trust-constituency.md` §6 (scopes/tiers) and `docs/specs/spec-xp-ledger-v0.md` §4 (budget caps).
      * **Execution plan:** See `docs/sprints/04-sprint-agentic-foundation.md`.

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
  * **Automation:** Optional local tooling for user-initiated assist (no default automation).

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

### 4.1 LUMA: Bio-Tethering & Recovery

  * **Purpose:** Prevent "Account Renting" and mitigate device loss.
  * **Mechanism:**
    1.  **Session Start:** VIO (Visual Inertial Odometry) scan signed by TEE.
    2.  **Challenge:** Random micro-gesture (e.g., "Tilt left 15°") to prove liveness.
    3.  **Recovery:** Users designate Guardians or secondary devices. Restoring an identity requires `M-of-N` signatures to rotate the underlying Enclave Key without losing the Identity Nullifier.

#### 4.1.5 Identity, Trust & Constituency Model

We unify identity across LUMA, GWC, and VENN-HERMES using three primitives:

* **TrustScore (0–1):** Device/session trust derived from hardware attestation. On-chain representation: integer 0–10000 (`scaled = Math.round(trustScore * 10000)`, using `TRUST_SCORE_SCALE`). Thresholds (v0): 0.5 for session/UBE/Faucet, 0.7 for QF.
* **UniquenessNullifier:** Stable per-human key. Off-chain: string. On-chain: `bytes32` hash. Shared across PWA identity, `SentimentSignal.constituency_proof.nullifier`, Region proofs, and UBE/QF attestation.
* **ConstituencyProof:** Derived from a RegionProof SNARK. Public signals: `[district_hash, nullifier, merkle_root]`. Used to attribute civic signals to a district without exposing raw region codes; `district_hash` is never stored on-chain.

**Terminology standard:**
- `principalNullifier` = human’s `UniquenessNullifier`.
- `familiar` = delegated agent.
- `DelegationGrant` = scoped, expiring authority.
- `OnBehalfOfAssertion` = attached to any agent action.

Invariants: same human → same nullifier across all layers; scaled trustScore = `Math.round(trustScore * 10000)`. See `docs/specs/spec-identity-trust-constituency.md` for the canonical contract.

### 4.2 GWC: The Holographic Oracle

  * **Purpose:** Uncensorable pricing for the RVU.
  * **Mechanism:**
    1.  **Nodes:** 50+ Staked Economic Nodes.
    2.  **Privacy:** Price vectors encrypted via Pedersen Commitments.
    3.  **Calc:** Smart Contract calculates the **Median** homomorphically.
    4.  **Security:** No single node's specific feed is ever decrypted.

#### 4.2.1 RVU v0: Proto-GWU

Season 0 runs RVU as a standard ERC-20 with `MINTER_ROLE` / `BURNER_ROLE` and no on-chain index logic. It is an inflationary proto-asset with tightly controlled minters, used to harden economic plumbing before activating the full global wealth index.

**Sources (v0):**
* Bootstrap mint (testnet deploy script).
* UBE drip (per-human, per-interval).
* Faucet drip (dev/onboarding; not part of long-term dignity loop).

**Sinks/locks (v0):**
* QuadraticFunding holds contributions + matching until settlement.
* No automatic burns; `burn()` exists but is unused in Season 0.

Instrumentation focuses on:
* `RVU.totalSupply()`.
* `RVU.balanceOf(QuadraticFunding)`.
* Aggregate distribution counters (e.g., `UBE.totalDistributed`, `Faucet.totalDripped`, `QuadraticFunding.distributedMatching`) to monitor inflation and governance flow. See `docs/specs/spec-rvu-economics-v0.md` for the canonical Season 0 economic contract.

#### 4.2.2 XP Ledger v0 (Participation Weight)

XP is a per-nullifier, non-transferable, monotonic ledger that prototypes the future participation weight GWC will use for value distribution.

* **Shape (per UniquenessNullifier):**
  * `civicXP` (news, sentiment, Eye/Lightbulb interactions),
  * `socialXP` (messaging/HERMES, later),
  * `projectXP` (proposals, governance/QF actions),
  * `totalXP = f(civicXP, socialXP, projectXP)` (e.g., weighted sum),
  * `lastUpdated` (timestamp).
* **Distribution model (future):** `share_i = totalXP_i^γ / Σ totalXP_j^γ` (γ tunable; α pool fraction tunable when issuing RVU/GWU).
* **Emission (Season 0 candidates):** first Lightbulb interaction on a topic, subsequent engagements (diminishing), full read sequences, UBE claims ("Daily Boost"), proposal support/creation, REL tasks later.
* **Invariants:** per-nullifier, non-transferable, monotonic (no negative XP), tracks are stable even if emission coefficients change over time.
* **Privacy:** XP ledger is sensitive (per-nullifier); stored on-device, optionally encrypted to a trusted node; only safe aggregates (e.g., district averages with cohort thresholds) may leave the device. Never publish `{district_hash, nullifier, XP}` together.

See `docs/specs/spec-xp-ledger-v0.md` for the canonical Season 0 XP ledger contract. For HERMES Messaging/Forum/Project emission rules (amounts, caps, windows), see `docs/sprints/03-sprint-3-the-agora.md` §3.4.

### 4.3 VENN: The Canonical Bias Engine

  * **Purpose:** Shared Analysis without Centralization.
  * **Mechanism ("First-to-File"):**
    1.  **Lookup:** User opens URL. App queries Mesh for hash of URL.
    2.  **Scenario A (Exists):** User downloads shared Analysis. WebLLM (Local) audits it. If valid, User votes.
    3.  **Scenario B (New):** **WebLLM (Local)** generates Analysis. User signs and publishes it as the **Canonical Record**.
* **Canonical Record:** For each `urlHash`, at most one `CanonicalAnalysis` (schemaVersion `canonical-analysis-v1`) is stored and reused. Civic signals (votes, decay, messaging threads) key off the canonical `urlHash` and immutable timestamp. v1 is first-to-file; v2 will shift to quorum synthesis (first N candidate analyses → synthesis + divergence). See `docs/specs/canonical-analysis-v1.md`.
  * **Immutability:** CanonicalAnalysis objects are append-only in v1. Corrections or disputes are modeled as separate signals or future schema versions; they are not edited in place.
  * **Civic Decay (Asymptotic):**
          * Formula: $E_{new} = E_{current} + 0.3 * (2.0 - E_{current})$.
          * Logic: Engagement asymptotically approaches 2.0 to prevent brigading while rewarding depth.

#### 4.3.1 Civic Signals (Eye, Lightbulb, Sentiment)

For each canonical article (topic):

* **Eye (👁 Read Interest):**
  * For each `topic_id` and user, track a per-topic read score `eye_weight ∈ [0, 2]` updated via Civic Decay on each full read/expand.
  * The Eye metric displayed for a topic is an aggregate over all users’ `eye_weight` (sum) and may optionally show raw unique reader counts (`eye_weight > 0`).
  * Repeated reads contribute with diminishing returns and can never exceed 2 units of read interest.
* **Lightbulb (💡 Engagement Weight):**
  * Per-user-per-topic engagement weight `weight ∈ [0, 2]`, driven by engagement interactions (table stances, feedback) and independent from Eye read score; repeated reads alone do not change Lightbulb.
  * Derived from the count of active stances on that topic: first active stance sets weight to `1.0`, each additional active stance applies the Civic Decay step toward `2.0`; clearing stances decrements (all neutral → `0`).
  * Civic Decay step: `E_new = E_current + 0.3 * (2.0 - E_current)`.
  * Aggregate Lightbulb per topic is a function of all user weights (sum) stored in `AggregateSentiment`; each user’s contribution is capped at `2`.
* **Per-point Sentiment:**
  * For each `(topic_id, point_id)` (bias or counterpoint), each user has `agreement ∈ {-1, 0, +1}` representing Disagree / Neutral / Agree.
  * UI semantics: each cell has separate `+` / `-` toggles; neutral is implicit. Clicking the same stance again clears it; switching `+`→`-` (or vice-versa) replaces the prior stance.
  * For aggregation, only committed votes are counted (`+1` or `-1`); neutral (`0`) is tracked per user but does not contribute to per-cell ratios.
  * Changes in `agreement` plus the user’s current Lightbulb `weight` are emitted as `SentimentSignal` events.

Civic Decay is applied per-user-per-topic. Reads (expanding an analysis) advance the user’s `eye_weight`; engagement interactions (stance changes, feedback) advance the user’s Lightbulb `weight`, each step using `E_new = E_current + 0.3 * (2.0 - E_current)` toward a 2.0 ceiling. This ensures diminishing returns on repeat interactions while rewarding sustained engagement.

*Privacy semantics:* Per-user `SentimentSignal` events are sensitive and MUST NOT be replicated in plaintext on the mesh. Public surfaces and mesh projections use `AggregateSentiment` and per-district aggregates only (counts/ratios/average weights) with no nullifiers; `district_hash` appears only in aggregates, never in individual public events.

#### 4.3.2 AI Engine & Analysis Pipeline

Article analyses are generated via a fixed 5-step pipeline:

1. **Prompt Builder**
   * `buildPrompt(articleText: string)` constructs the full analysis prompt:
     * Includes GOALS/GUIDELINES (summary + bias detection),
     * Specifies the JSON wrapper shape,
     * Embeds the raw article text between `ARTICLE_START` / `ARTICLE_END`.
2. **Engine Router (Remote / Local / Hybrid)**
   * A pluggable engine interface (`JsonCompletionEngine`) abstracts over remote models (gateway API) and local models (WebLLM/MLC in a Worker).
   * `EngineRouter` selects an engine per `EnginePolicy` (`remote-first`, `local-first`, `remote-only`, `local-only`, `shadow`). Remote vs local is invisible to the rest of the system.
3. **Parser & Schema Validation**
   * All engine responses must be valid JSON with shape:
   ```jsonc
   {
     "step_by_step": ["..."],
     "final_refined": {
       "summary": "...",
       "bias_claim_quote": ["..."],
       "justify_bias_claim": ["..."],
       "biases": ["..."],
       "counterpoints": ["..."],
       "sentimentScore": 0.0,
       "confidence": 0.0
     }
   }
   ```
   * The worker extracts the outermost JSON object, unwraps `final_refined` if present, and validates it against `AnalysisResultSchema` (see `canonical-analysis-v1`).
4. **Hallucination Guardrails**
   * `validateAnalysisAgainstSource(articleText, analysis)` performs checks:
     * All `bias_claim_quote` entries must appear in the article text.
     * Obvious temporal inconsistencies (e.g., years in summary that never appear in the article) are flagged.
   * Guardrails produce warnings (non-fatal) attached to the canonical record.
5. **Canonicalization & Storage**
   * A `CanonicalAnalysisV1` object is built:
     * `schemaVersion`, `url`, `urlHash`, `timestamp`,
     * Fields from `AnalysisResult`,
     * Optional engine provenance `{ id, kind, modelName }`,
     * Optional `warnings`.
   * `CanonicalAnalysisSchema.parse(...)` enforces the contract before persistence in the mesh.

This pipeline is independent of model choice; swapping remote/local engines only changes the engine implementation/policy, not the canonical analysis contract. See `docs/foundational/AI_ENGINE_CONTRACT.md` for the detailed AI engine contract.

#### 4.3.3 Participation Governors (Anti-Swarm)

We enforce three distinct governors to prevent agent swarms from overrunning the system:

1. **Influence Falloff (Value Share Governor):** Diminishing returns across active projects/topics per principal nullifier.
2. **Action Budget (Spam Governor):** Posts/votes/moderation actions per time window per principal nullifier.
3. **Compute/Analysis Budget (Analysis Governor):** Analyses/day plus per-topic throttles per principal nullifier.

All governors apply to the **principal**; familiars consume the same budgets and never multiply influence.

### 4.4 HERMES: The Civic Action Kit

  * **Purpose:** Verified constituent voice via user-initiated civic contact.
  * **Mechanism:**
    1.  **Aggregate:** Nodes collect proposals via HRW hashing.
    2.  **Verify:** LUMA attaches **ZK-Proof of Constituency**.
    3.  **Facilitate (User-Initiated):**
          * **Desktop/Mobile:** Generate a local report (PDF) and open native actions (`mailto:`, `tel:`, share sheet).
          * **Fallback:** Always expose representative contact info for manual submission.
          * **Automation:** Optional, local-only assist may be explored later; no default form submission.

-----

### 4.5 Data Topology & Privacy v0

TRINITY is local-first, not local-only. Devices hold canonical state; mesh and chain hold public or encrypted replicas. We distinguish:

* **Public-by-design objects:** shared civic/economic data (public articles, canonical analyses, aggregate sentiment, project funding).
* **Sensitive objects:** identity, constituency, per-user sentiment, messages, and wallet↔identity mappings.

In Season 0, main objects:

| Object            | On Device                                                        | Mesh / Gun                                     | On-chain                                        | Cloud / MinIO | Class      |
|-------------------|------------------------------------------------------------------|------------------------------------------------|--------------------------------------------------|--------------|-----------|
| CanonicalAnalysis | `localStorage: vh_canonical_analyses`, IndexedDB `vh-ai-cache`   | `vh/analyses/<urlHash> = CanonicalAnalysis`    | –                                                | –            | Public    |
| Sentiment (v0)    | `localStorage: vh_civic_scores_v1` (per item:perspective)        | –                                              | –                                                | –            | Sensitive |
| Proposals (v0 UI) | React state only                                                 | –                                              | QF `Project` (recipient/amounts, no metadata)    | –            | Public    |
| Wallet balances   | React state (`balance`, `claimStatus`)                           | –                                              | `RVU.balanceOf`, `UBE.getClaimStatus`, tx log    | –            | Sensitive |
| IdentityRecord    | IndexedDB `vh-vault` (`vault` store, encrypted with per-device master key) + in-memory provider runtime | `user.devices.<deviceKey> = { linkedAt }`      | `nullifier` + scaled trustScore in UBE/QF/Faucet | –            | Sensitive |
| RegionProof       | Local-only (per `spec-identity-trust-constituency.md`)           | – (no v0 usage)                                | –                                                | –            | Sensitive |
| XP Ledger         | `localStorage: vh_xp_ledger` (per nullifier XP tracks)           | – (or encrypted outbox to Guardian node)       | –                                                | –            | Sensitive |
| Messages (future) | TBD                                                              | `vh/chat/*`, `vh/outbox/*` (guarded; see below)| –                                                | Attachments  | Sensitive |

Rules:

* Only **public** objects may be stored in plaintext under `vh/*` in the mesh.
* **Sensitive** objects must either remain on-device only, or be sent via encrypted user-scoped channels (e.g., Gun SEA / outbox) to trusted aggregators.
* CanonicalAnalysis is public content and never includes nullifiers, district hashes, or wallet addresses.
* Runtime identity reads use the in-memory identity provider: `getPublishedIdentity()` exposes only a public snapshot (`nullifier`, `trustScore`, `scaledTrustScore`), while `getFullIdentity()` is for same-process consumers that require private fields.
* Legacy key `vh_identity` is migration-only input (read once, then deleted) and is **not** an active persistence layer.
* `vh:identity-published` is a hydration signal `CustomEvent` with no identity payload.

See `docs/specs/spec-data-topology-privacy-v0.md` for the canonical Season 0 topology and invariants.

## 5. Unified Development Roadmap

### Sprint 0: The Foundation (Weeks 1–6) [COMPLETE]

**Goal:** Solvency, Identity Root, and Secure Mesh.

  * **Status:** **CLOSED**. Infra live, Core Logic 100% Coverage, E2E Tracer passing.

### Sprint 1: The "Data Dividend" & Civic Beta (Weeks 7–12) [IN PROGRESS]

**Goal:** User Growth & Canonical Analysis.

  * **GWC:** UBE Drip & Basic Quadratic Funding.
  * **VENN:** Canonical Analysis Protocol & Civic Decay Logic.
  * **LUMA:** Region Notary (ZK-Residency) & Multi-Device Linking.
  * **Deliverable:** Public Beta (v0.1). Users verify, earn UBE, and use shared news analysis.

### Sprint 2: The Civic Nervous System (Weeks 13–20) [NEXT]

**Goal:** The Signal (Analysis, Decay, Voting).

  * **VENN:** The Civic Feed (Lazy Load, Z-Index Cards, Lightbulb Metrics).
  * **GWC:** Quadratic Funding & Proposal Governance.
  * **Engine:** AI Optimization (<2s) & Persistent Caching.
  * **Deliverable:** A fully functional "News App" with Governance capabilities.

### Sprint 3: The Agora - Communication (Weeks 21–26)

**Goal:** The Dialogue (Messaging, Forum).

  * **HERMES:** P2P E2EE Messaging (Direct & Group).
  * **HERMES:** Threaded Civic Forum (Debate & Counterpoints).
  * **Deliverable:** Beta v0.8 (Secure Communication).

### Sprint 4: Agentic Foundation (Weeks 27–32)

**Goal:** Safety baseline + unified topics + analysis robustness.

  * **LUMA/HERMES:** Delegation grants + familiar runtime (scopes, budgets).
  * **VENN:** Quorum synthesis + comment-driven re-synthesis flow.
  * **Interface:** Unified Topics model (analysis + thread).
  * **Deliverable:** Safe agentic foundation + unified feed.

### Sprint 5: The Agora - Action (Weeks 33–40)

**Goal:** The Bridge (Docs, Civic Action).

  * **HERMES:** Collaborative Documents (CRDTs).
  * **HERMES:** Civic Action Kit (facilitation: reports + contact channels).
  * **Deliverable:** Beta v0.9 (Full Feature Set).

### Sprint 6: The Ironclad Hardening (Weeks 41–48)

**Goal:** Sovereignty & Anti-Collusion (Mainnet Prep).

  * **LUMA:** Memory-Hard VDF (to slow Sybil attacks) & Full Social Recovery.
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
  "trustScore": 0.95,
  "scaledTrustScore": 9500,
  "nullifier": "nullifier-abc123...",
  "session_token": "session-device-nonce-timestamp",
  "client_integrity": { "app_attestation": "Apple_AppAttest_v1" },
  "proof": {
    "uniqueness_nullifier": "nullifier-abc123...",
    "vio_integrity_score": 0.99,
    "tee_signature": "BASE64_SIGNED_BLOB"
  }
}
```

AttestationVerifier derives a stable nullifier from device- or LUMA-bound keys and issues a per-session token. The nullifier is the canonical human key shared with GWC contracts (via UBE/QF attestation) and VENN civic signals; session tokens are per-session.

### 6.2 The Civic Sentiment Signal

We distinguish between event-level signals and aggregate sentiment.

```typescript
// Event-level: one user, one point, one interaction
interface SentimentSignal {
  topic_id: string;       // Hash of Canonical URL
  analysis_id: string;    // Hash of the Canonical Analysis Object
  point_id: string;       // ID of the bias/counterpoint/perspective
  agreement: 1 | 0 | -1;  // 3-state Agree / None / Disagree
  weight: number;         // User’s per-topic Lightbulb from engagement, in [0, 2]

  constituency_proof: {
      district_hash: string; 
      nullifier: string;
      merkle_root: string;
  };

  emitted_at: number;     // Unix timestamp
}

interface PointStats {
  agree: number;    // distinct users with final agreement = +1
  disagree: number; // distinct users with final agreement = -1
}

// Aggregate-level: mesh / ledger projection
interface AggregateSentiment {
  topic_id: string;
  analysis_id: string;

  // Per point: committed votes only (neutral not counted)
  point_stats: Record<string, PointStats>;

  // Optional convenience: derived dominant stance per point based on point_stats
  bias_vector: Record<string, 1 | 0 | -1>;

  // Global engagement signal (function of all user Lightbulb weights, e.g. sum)
  weight: number;          // Aggregate Lightbulb
  engagementScore: number; // Additional metric if needed (e.g. entropy, variance)
}
```

Invariants:

* For any SentimentSignal, `0 ≤ weight ≤ 2`.
* For any topic and user, Lightbulb `weight` is updated only via the Civic Decay function on engagement interactions.
* Per-point aggregates ignore neutral (`0`) when computing `point_stats`; `bias_vector` is derived from `point_stats` (e.g., sign of `agree - disagree`).
* `AggregateSentiment` is a deterministic function of the stream of SentimentSignal events.
* `constituency_proof` MUST be derived from a valid RegionProof: `district_hash = publicSignals[0]`, `nullifier = publicSignals[1]` (same UniquenessNullifier as identity), `merkle_root = publicSignals[2]`.

See `docs/specs/spec-civic-sentiment.md` for the normative contract across client, mesh, and chain.

-----

### 6.3 Canonical Analysis (v1)

Canonical Analysis is the canonical record of "what this URL means in VENN-world."

**Schema (`canonical-analysis-v1`):**

```typescript
type BiasEntry = {
  bias: string;        // Debate-style claim capturing article’s slant
  quote: string;       // Direct quote from the article supporting the claim
  explanation: string; // Why this quote evidences the bias (short, academic)
  counterpoint: string;// Direct rebuttal / alternative framing
};

interface CanonicalAnalysisV1 {
  schemaVersion: 'canonical-analysis-v1';
  url: string;
  urlHash: string; // Stable hash of normalized URL
  summary: string; // 4–6 sentence neutral summary
  bias_claim_quote: string[];
  justify_bias_claim: string[];
  biases: string[];
  counterpoints: string[];
  perspectives?: Array<{ frame: string; reframe: string }>;
  sentimentScore: number; // [-1, 1] overall slant
  confidence?: number;    // [0, 1] model self-confidence
  timestamp: number;      // ms since epoch (first write)
}
```

**Invariants**

1. `bias_claim_quote.length === justify_bias_claim.length === biases.length === counterpoints.length`.
2. Summary and all arrays are derived only from the article text (**fact-only rule**).
3. `schemaVersion` is required and immutable once written.

**Fact-only rule**

Summaries and bias tables MUST NOT introduce information absent from the source article (no new entities, dates, locations, quantities, or motives).

**First-to-file semantics (v1)**

* Canonical analysis is keyed by `urlHash`.
* The first successfully validated analysis for a `urlHash` is reused; later writes cannot overwrite it in v1.
* Corrections/disagreements are separate signals (votes, sentiment, replies), not mutations of the canonical object.
* Future versions (e.g., `canonical-analysis-v2`) will introduce quorum synthesis and explicit amendment/supersession; v1 treats the record as append-only. See `docs/specs/canonical-analysis-v2.md`.

URLs are normalized upstream; the canonical schema enforces `url` as a valid URL (Zod `.url()`), and hashing always uses the normalized form.

See `docs/specs/canonical-analysis-v1.md` for the precise wire-format contract and validation rules.

-----

### 6.4 UBE v0 (Universal Basic Equity)

* **Trust scale:** 0–10000 (`TRUST_SCORE_SCALE`); `minTrustScore = 5000` (0.5).
* **Cadence:** `claimInterval = 1 day`; `dripAmount` ~25 RVU (Season 0 default).
* **Eligibility:** Identity exists, `trustScore ≥ minTrustScore`, `expiresAt > now`, cooldown satisfied.
* **Scope:** Per-human (per nullifier), not region-based in v0; no lifetime cap, bounded by attestation expiry/policy.
* **UX:** Surfaced as “Daily Boost” to XP; may mint RVU on testnet or simulate XP-only while contracts harden.
* **Abuse controls:** Attestation expiry, lowering trustScore, modest payout (floor, not upside).

### 6.5 Faucet v0

Mirrors UBE’s trust- and time-gated pattern for dev/onboarding/early tester bonuses. Separate `dripAmount`, cooldown, and `minTrustScore`; mints RVU via `rvu.mint(msg.sender, dripAmount)`. Not part of the long-term dignity loop.

### 6.6 Quadratic Funding v0

Implements attested participant registration, project registration, quadratic aggregation, matching pool logic, and withdrawals. In Season 0 the contract is exercised by curators/testers with dev accounts; the public governance UI runs off-chain (seeded proposals, local-only votes/voice credits) and does not expose on-chain QF rounds yet.

See `docs/specs/spec-rvu-economics-v0.md` for detailed Season 0 economic semantics.

## 7. Risk Register

| ID | Threat | Layer | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **R-01** | Injection / Emulation | L0 | **Hardware Attestation:** TEE Signatures required. |
| **R-02** | Account Renting | L1 | **Bio-Tethering:** Random micro-gestures prevent hand-offs. |
| **R-03** | Reality Fragmentation | L3 | **Canonical Analysis:** First-to-file protocol + AI Audit. |
| **R-04** | Legislative Blocking | L3 | **Civic Facilitation:** User-initiated contact via reports + native channels; no automated form submission by default. |
| **R-05** | Device Loss | L1 | **Recovery:** Multi-device linking & Social Recovery. |
| **R-06** | Malicious Analysis | L3 | **Distributed Moderation:** Local AI audits & community override votes. |
| **R-07** | Civic Signal Drift (types/math diverge between client, mesh, and chain) | L1/L3 | **Canonical Contract:** Enforce single spec (`docs/specs/spec-civic-sentiment.md`), shared types in `packages/types`, and Zod schemas in `packages/data-model`. CI blocks on schema mismatch. |
| **R-08** | Identity/Trust Drift | L1/L2/L3 | **Canonical Contract:** Enforce single spec (`spec-identity-trust-constituency.md`), shared types (`TrustScore`, `UniquenessNullifier`, `ConstituencyProof`), and bridge logic. CI blocks on schema mismatch. |
| **R-09** | AI Contract Drift | L3 | **Canonical Contract:** Enforce `AI_ENGINE_CONTRACT.md`, `canonical-analysis-v1` schema, and worker/schema tests on prompt/parse/validation. |
| **R-10** | Constituency De-anonymization | L1/L3 | **Aggregation Only:** Keep `SentimentSignal` local/encrypted; publish only per-district aggregates with cohort thresholds; no `district_hash` on-chain; see `docs/specs/spec-data-topology-privacy-v0.md`. |
| **R-11** | Mesh Metadata Leakage | L1/L3 | **Mesh Hygiene:** Only public objects in plaintext `vh/*`; sensitive data via encrypted outbox; audit Gun paths; feature-flag chat/outbox until E2EE; see `docs/specs/spec-data-topology-privacy-v0.md`. |

-----

## 8. Developer Quickstart

```bash
# 1. Clone the Monorepo
git clone git@github.com:trinity-os/core.git
cd core

# 2. Install Dependencies
pnpm i

# 3. Start Local Universe (Docker: Gun, MinIO, Anvil)
pnpm vh bootstrap up

# 4. Initialize Keys & Contracts
pnpm vh bootstrap init --deploy-contracts

# 5. Run the Client (PWA + Edge AI)
pnpm --filter @vh/web-pwa dev
```

-----

## 9. System Prompt for AI Agents

*Paste this context at the start of every AI coding session.*

```text
You are a Senior Engineer building the TRINITY Bio-Economic OS (GWC x LUMA x VENN).

Core Constraints:
1.  **Local-First:** User data stays on device. Cloud is for encrypted transport only.
2.  **Hardware-Rooted:** Critical actions require TEE/Secure Enclave signatures.
3.  **Shared Reality:** VENN Analysis is generated locally but deduplicated via Mesh.
4.  **Strict Modularity:** Files MUST NOT exceed 350 LOC. Split logic aggressively.
5.  **Testing:** 100% Line/Branch coverage required.
6.  **Stack:** React, Rust (WASM), Solidity, GUN (via wrapper only), WebLLM.

Current Task: [Insert Task]
```
