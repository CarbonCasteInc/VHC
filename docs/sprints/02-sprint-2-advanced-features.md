02-sprint-2-advanced-features.md

# Sprint 2: The Civic Nervous System - Implementation Checklist

**Context:** `System_Architecture.md` v0.0.1 (Sprint 2: The "Civic Nervous System")
**Goal:** Harden the system for Mainnet, implement full Governance flows, and optimize AI performance within a polished UX.
**Status:** [ ] In Progress

### Guiding Constraints & Quality Gates
- [ ] **Non-Negotiables:**
    - [ ] **LOC Cap:** Hard limit of **350 lines** per file (tests/types exempt).
    - [ ] **Coverage:** **100%** Line/Branch coverage for new/modified modules.
    - [ ] **Browser-Safe:** No `node:*` imports in client code.
    - [ ] **Bundle Budget:** Initial < **1 MiB** (gzip). Lazy AI assets < **10 MiB** (gzip) & cached via SW.
    - [ ] **Offline E2E:** New flows (Topics/Vote) must pass with `VITE_E2E_MODE=true` (Mocked Clients).
    - [ ] **Performance:** "Expand to Analyze" < 2s (Warm Cache).
    - [ ] **Security:** Attestation/Trust gating required for all engagement/voting.

---

## Phase 1: Governance & Voting (GWC)

### 1.1 Quadratic Funding Logic
- [x] **Contract:** Enhance `QuadraticFunding.sol` with full pooling and distribution logic.
- [x] **Gating:** Voting and Matching MUST be gated by valid **Attestation** (`trust_score` check).
- [x] **Tests:** Add specific test cases for non-attested attempts (must revert).
- [ ] **Season 0 Scope:** Frontend governance in VENN remains off-chain for general users (seeded proposals, local vote tracking). QuadraticFunding.sol is exercised only by curated dev/test accounts for internal QF rounds; no on-chain QF interactions are exposed in the public UX in Sprint 2.

### 1.2 Proposal System
- [x] **Schema:** Define `Proposal` schema in `data-model` with validation (Zod).
- [x] **Flow:** Create "Submit Proposal" flow (requires minimum RVU stake + Attestation).
- [x] **E2E:** Verify "Submit -> Vote -> Match" flow in Offline Mock Mode.
- [x] **QF Wiring (Season 0):** Maintain an off-chain mapping from curated Proposal → on-chain `projectId` (if any). Do not send RVU from regular users via the app; `castVote()` is invoked by internal tools only in S2.
- [x] **Governance UI (Season 0):** Proposal list shows per-user vote status, prevents double-counting in the mock, and surfaces inline confirmation for recorded/updated/switched votes.

---

## Phase 2: The Civic Topics Stream & Nervous System (VENN)

### 2.1 The Topics Stream Experience (UX)
- [x] **Feed:** Virtualized infinite scroll over **Topics** (external headlines + user threads).
    - **Tests:** Component tests for windowing thresholds, empty/error states.
- [x] **Metrics:**
    - **Eye:** Read Interest derived from per-user `eye_weight ∈ [0,2]` (Civic Decay applied on each read/expand). UI may show Eye score plus unique readers (`eye_weight > 0`).
    - **Lightbulb:** Engagement Score derived from per-user `lightbulb_weight ∈ [0,2]` (Civic Decay applied on table interactions), used for topic-level engagement (not per-cell ratios).
- [x] **Transitions:** "Lift & Hover" effect (Scale + Z-Index) on expansion.
    - **Tests:** Verify lift state, metric rendering, and a11y/keyboard support.
- [x] **Analysis + Thread UI:**
    - Narrative Summary.
    - **Perspectives Table:** Two columns (Frame/Reframe).
    - **Voting:** Independent +/- toggle per cell (Frame & Reframe).
    - **Logic:** 3-state (Agree/Disagree/None). Toggling active state resets to None. Switching state flips vote.
    - **Stats:** Display aggregate sentiment ratio for each item.
    - **Thread:** Embedded discussion for the same `topicId` when available.
    - **Proposal threads:** Any thread can be elevated to a proposal by adding `thread.proposal` (fundingRequest + recipient), which enables the Support widget.
    - **Table provenance:** Frame/Reframe rows come from `CanonicalAnalysisV1.perspectives[]`.
    - **Quorum mode:** The first **N verified opens** (default 5) generate candidate analyses that critique/refine prior summaries/tables for accuracy before canonicalization.
    - **Reanalysis epochs (verified-only):** After every **10 verified** new comments (min 3 unique verified principals), the Topic is re-analyzed (article/topic seed + thread digest) and `perspectives[]` may update.
    - **Rate limits:** Debounce at most one refresh per 30 minutes; cap 4 per topic per day.
- [x] **State Management:**
    - **Tests:** Unit tests for pagination, caching, and local persistence.
    - **E2E:** Mocked offline mode (no network).

### 2.2 The Nervous System (Engine)
- [x] **Civic Decay Algorithm:**
    - **Formula:** `next = current + (2.0 - current) * 0.3`.
    - **Tests:** Verify asymptotic ceiling (never > 2.0) and monotonic growth.
    - **Scope:** Applied to the user's per-topic Lightbulb weight. Each qualifying interaction = one decay step (engagement only per `docs/specs/spec-civic-sentiment.md` §4; reads update Eye separately).
- [x] **Local State:** Persist `topic_interaction_state` (current score) in Gun/IDB.
- [x] **Optimization:** Integrate `q4f16_1` (or optimal) weights.
    - **Validation:** Worker entry < 20KB, Lazy Chunk < 10MB.
- [x] **Caching:** Implement persistent caching (IndexedDB) for weights & analysis.
    - **Tests:** Verify Warm Cache latency < 2s and Cold Start fallback.
- [x] **System Prompt:** Implement `prompts.ts` using the following strict guidelines:
    - **Tests:** Coverage for prompt builder and response parsing.

    ```python
    GOALS_AND_GUIDELINES = """
    ---
    GOALS AND GUIDELINES FOR STORY/REPORT SUMMARY:
    1. **Accuracy and Key Facts**: 
        - Capture the main points—who, what, when, where, why—using only information from the article. 
        - Include specific details such as names, dates, and locations if they are central to the article's core message or events.
    2. **Balanced Length**: 
        - Produce summaries that are concise yet complete, typically 4-6 sentences. 
        - Focus on the core events, arguments, or developments, excluding minor details or tangential information while retaining context necessary for understanding the primary narrative.
    3. **Neutral, Objective Tone**: 
        - Present the facts without inserting opinions, emotive language, or personal interpretations.
    4. **Complete Representation of the Article**: 
        - Summarize all major viewpoints mentioned in the article accurately. 
        - Encapsulate without giving undue weight to any single viewpoint.

    GOALS AND GUIDELINES FOR BIAS DETECTION & COUNTERPOINT GENERATION:
    1. **Accuracy & Rigor**: Examine the article for potential biases or slanted viewpoints. 
        - Look for indicators such as:
            - logical fallacies (e.g., "straw man," "ad hominem," "false dichotomy," "slippery slope," "appeal to authority," etc.), 
            - loaded terms and emotionally charged language (e.g., "reckless," "radical," "terrorist," etc.), 
            - selective omissions and uneven sourcing (e.g., missing key perspectives, one-sided arguments)
    2. **Direct Quotes for Support**: For each potential bias/slanted viewpoint, provide a direct quote from the article that illustrates the bias/slant/omission, etc... 
        - Ensure the quote is relevant and *clearly demonstrates* the biased language/slant/omission, etc...
    3. **Justify Bias Claim**: Offer a concise, academic explanation of how the provided quote supports the identified bias. 
        - Clearly link the specific language, tone, or omission in the quote to the bias claim.
    4. **Balance & Perspectives**: Generate a concise counterpoint that directly challenges or rebuts each bias claim. 
        - Consider alternative interpretations of the evidence, opposing viewpoints, or additional context that could dispute the identified bias.
    5. **Biases of Discussed Groups/Individuals**: Even if the author is not implicitly/explicitly biased, 
        - the article may still have a slant, AND/OR 
        - may include the biased perspective of groups/individuals the author is writing about. 
        - These may also be used to identify biases/counterpoints.
    6. **No Redundancy**: Ensure each bias and its corresponding counterpoint address unique aspects of the article's slant. 
        - Focus on different elements of the text (e.g., language, sourcing, framing) to avoid overlap in the issues or evidence presented.
    7. **Bias Absence**: *THIS IS IMPORTANT*: If no clear bias is detected, you must include a single entry in the biases list stating "No clear bias detected" with a corresponding counterpoint of "N/A".

    GOALS AND GUIDELINES FOR VOICE AND STYLE:
    1. **Formulate Biases in the Voice of an Authoritative Advocate for the Article's Slant**: 
        - You must present each bias as a specific, debate-style claim that reflects an implied assertion/slant from the article. 
        - Craft these claims as authoritative statements, ensuring they are clear, succinct, and open to dispute. 
        - Focus on capturing the article's slant in a way that invites challenge or rebuttal, using terse language to keep the point sharp.
    2. **Formulate Counterpoints as Authoritative Rebuttals**: 
        - You must craft each counterpoint as a direct, debate-style counterclaim that challenges the corresponding bias. 
        - Present these rebuttals with authority and specificity, ensuring they are concise yet robust enough to stand as disputable assertions. 
        - Tie each counterpoint explicitly to its bias, using clear language to maintain focus and avoid ambiguity.
    3. **Use Terse, Clear Language Throughout**: 
        - You must employ succinct, straightforward wording in both biases and counterpoints. 
        - Strip away filler or overly complex phrasing to ensure each statement is direct and impactful, enhancing clarity and debate-readiness.
    """
    ```

### 2.3 Engagement & Sentiment Unification

**Goal:** Make Eye, Lightbulb, and SentimentSignal consistent from UI → types → mesh.

- [x] **Canonical Types:**
  - [x] Replace generic `SentimentSignal` in `packages/types` with the event-level shape from `System_Architecture.md` §6.2.
  - [x] Introduce `AggregateSentimentSchema` in `packages/data-model` (formerly `SignalSchema`) for aggregate topic sentiment.
  - [x] Add `SentimentSignalSchema` (Zod) mirroring the event-level type; all emitted signals must validate against it in tests.

- [x] **Civic Decay Consolidation:**
  - [x] Update `packages/ai-engine/src/decay.ts`:
    - [x] `calculateDecay` is the only implementation of the Civic Decay formula.
    - [x] `applyDecay` delegates to `calculateDecay` and enforces `0 ≤ weight ≤ 2`.
  - [x] Ensure `CivicDecaySchema` bounds `weight` to `[0, 2]` and tests cover monotonic, asymptotic behavior.

- [x] **3-State Sentiment UI:**
  - [x] Replace float-based `useCivicState` with `useSentimentState` (`agreement ∈ {-1,0,1}` per `(topic_id, point_id)`).
  - [x] Update `AnalysisView` / `PerspectiveRow` to use per-cell +/- toggles with implicit neutral (same stance again clears; switching +↔- replaces).
  - [x] Update component tests to assert per-cell behavior and persistence.
  - [x] Per-cell aggregates use committed votes only: `agreement = +1` increments `agree`, `agreement = -1` increments `disagree`, `agreement = 0` is not counted.

- [x] **Eye & Lightbulb Wiring:**
  - [x] Implement `useReadTracker` / `useReadState` to store per-topic `eye_weight ∈ [0,2]`, applying `calculateDecay` on each expand/read.
  - [x] Aggregate Eye metrics for display from per-user `eye_weight` (sum of unique readers (where no individual reader's `eye_weight` is greater than 2 (decay falloff))).
  - [x] Implement `useEngagementState` (per-topic `lightbulb_weight ∈ [0,2]`), deriving Lightbulb from active stances: first active stance sets weight to `1.0`, additional active stances apply decay toward `2.0`; clearing stances decrements (all neutral → `0`); never exceeds `2` per user.
  - [x] Render per-user Lightbulb from `useEngagementState` in `HeadlineCard`
        (global aggregate will later come from `AggregateSentiment`).

- [x] **SentimentSignal Emission:**
  - [x] Implement `buildSentimentSignal()` helper in the PWA that constructs an event from:
        `(topic_id, analysis_id, point_id, agreement, weight)`.
  - [x] Wire `PerspectiveRow` (or container) to emit a `SentimentSignal`
        on every agreement change and log/store it in a local queue.
  - [x] Add tests that validate emitted objects via `SentimentSignalSchema.parse`.

### 2.4 AI Engine Contract & Routing

**Goal:** Make the analysis pipeline (prompt → engine → JSON → validation → canonical analysis) explicit, testable, and decoupled from engine choice (remote vs local).

- [x] **Prompt Builder:**
  - [x] Implement `buildPrompt(articleText)` in `packages/ai-engine/src/prompts.ts` as the canonical entry point.
  - [x] Ensure the prompt embeds GOALS/GUIDELINES, specifies the JSON wrapper (`step_by_step` + `final_refined`), and includes the full article between `ARTICLE_START` / `ARTICLE_END`.
  - [x] Tests: assert required keys (`summary`, `bias_claim_quote`, `justify_bias_claim`, `biases`, `counterpoints`, `sentimentScore`) appear in the prompt.

- [x] **Engine Abstraction:**
  - [x] Introduce `JsonCompletionEngine` and `EnginePolicy` types in `packages/ai-engine/src/engines.ts`.
  - [x] Implement `RemoteApiEngine` (calls `/api/analyze` proxy) and `LocalMlEngine` (wraps WebLLM/MLC).
  - [x] Implement `EngineRouter` supporting `remote-first`, `local-first`, `remote-only`, `local-only`, and `shadow` modes with fallback behavior.
  - [x] Tests: simulate engine failures and verify correct fallback per policy.
  - [!] **Direction Update (2026-02-02):** Default policy is now `local-only` until explicit user opt-in for remote engines. Real engine wiring remains pending; current worker uses a mock engine for output.

- [x] **Parsing & Schema Validation:**
  - [x] Add `AnalysisResultSchema` and `parseAnalysisResponse(raw)` in `packages/ai-engine/src/schema.ts` mirroring `AnalysisResult` from `canonical-analysis-v1`.
  - [x] Support wrapped (`{ step_by_step, final_refined }`) and bare `AnalysisResult` forms.
  - [x] Define `AnalysisParseError` with `NO_JSON_OBJECT_FOUND`, `JSON_PARSE_ERROR`, `SCHEMA_VALIDATION_ERROR`.
  - [x] Tests: verify correct error kinds for malformed responses.

- [x] **Hallucination Guardrails:**
  - [x] Implement `validateAnalysisAgainstSource(articleText, analysis)` in `packages/ai-engine/src/validation.ts` (quotes present, simple date/year checks).
  - [x] Attach warnings to the analysis payload; do not block canonicalization.
  - [x] Tests: quotes/year mismatch produce warnings.

- [x] **Worker Integration:**
  - [x] Update `packages/ai-engine/src/worker.ts` to use `EngineRouter`, run `parseAnalysisResponse`, `validateAnalysisAgainstSource`, cache by `urlHash`, and attach `{ engine, warnings }`.
  - [x] Tests: success path + parse-error path, caching behavior.

- [x] **Canonicalization:**
  - [x] Update `getOrGenerate` to accept a generator returning `ValidatedAnalysisResult` + `{ engine?, warnings? }`, construct `CanonicalAnalysisV1`, and validate with `CanonicalAnalysisSchema`.
  - [x] Tests: invalid generator payload fails; engine metadata preserved.

### 2.5 Canonical Analysis Hard Contract (VENN Engine)
- [x] **Schema Lock:** `canonical-analysis-v1` Zod schema implemented in `packages/data-model` and exported as the single `CanonicalAnalysis` type (used by ai-engine, storage, and UI); spec anchored in `docs/specs/canonical-analysis-v1.md`.
- [x] **AI Engine Alignment:**
    - [x] `AnalysisResult` in `packages/ai-engine/src/prompts.ts` matches the contract:
        - `summary`
        - `bias_claim_quote`
        - `justify_bias_claim`
        - `biases`
        - `counterpoints`
        - `sentimentScore`
        - `confidence?`
        - `perspectives?`
    - [x] `PRIMARY_OUTPUT_FORMAT_REQ` shows `sentimentScore` and `confidence` in the sample JSON.
    - [x] Canonical metadata (`schemaVersion`, `url`, `urlHash`, `timestamp`) is added in `getOrGenerate` when constructing `CanonicalAnalysis`, not emitted by the model.
- [x] **Worker Contract:**
    - [x] `worker.ts` unwraps `{ step_by_step, final_refined }` and validates raw `AnalysisResult` fallback.
    - [x] Tests cover wrapped + raw responses and validation failures.
- [x] **First-to-File Logic:**
  - [x] `getOrGenerate(url, store, generate)` enforces strict first-to-file on `urlHash`.
  - [x] Tests cover `reused=true` for existing and storing once for new.
  - [!] **Direction Update (2026-02-02):** v1 remains first-to-file; v2 will shift canonicalization to quorum synthesis (first N candidate analyses → synthesis + divergence).
- [x] **Array Invariants:**
    - [x] Zod refine enforces equal lengths for `bias_claim_quote`, `justify_bias_claim`, `biases`, `counterpoints`.
    - [x] Tests prove valid payload passes and mismatched lengths fail.
- [x] **Fact-Only Enforcement:**
    - [x] Checker flags summaries/biases introducing entities absent from source text.
    - [x] Fuzz tests: truncating article text cannot produce longer/more specific summaries; invalid outputs are rejected.
- [x] **Deterministic JSON:**
    - [x] Stable field set/ordering; snapshot example payload stored in tests.
- [x] **Docs Wiring:**
    - [x] `System_Architecture.md` §6.3 and `docs/specs/canonical-analysis-v1.md` are referenced in code comments or README where the schema is consumed.

## Phase 2.6 Identity, Trust & Constituency Unification

**Goal:** Align off-chain sessions, on-chain attestation, and civic signals around a single human key (nullifier) and trustScore model.

- [x] **Canonical Types (`packages/types`):**
  - [x] Add `TrustScore` (0..1), `ScaledTrustScore` (0..10000), and `UniquenessNullifier` (string) type aliases.
  - [x] Update `SessionResponse` to use `TrustScore` and `UniquenessNullifier` (stable) for `nullifier`.
  - [x] Define `RegionProof` as a tuple-shaped `publicSignals: [district_hash, nullifier, merkle_root]`.
  - [x] Add `ConstituencyProof` and `decodeRegionProof()` helper.

- [x] **Attestation-Verifier (`services/attestation-verifier`):**
  - [x] Implement `derive_nullifier(device_key)` (stable hash).
  - [x] Construct `SessionResponse` with:
        `token = "session-<device>-<nonce>-<timestamp>"`,
        `nullifier = derive_nullifier(device_key)`.
  - [x] Document trustScore thresholds (0.5 min, 0.7+ strong) and mapping to scaled on-chain values.

- [x] **Identity Hook (`useIdentity`):**
  - [x] Extend `IdentityRecord` to store `nullifier` (identity-level) and `scaledTrustScore`.
  - [x] In `createIdentity`, compute `scaledTrustScore = Math.round(trustScore * 10000)` and persist it.
  - [x] Update downstream code (sentiment, proposals) to use `identity.nullifier` as the human key.

- [x] **Region & Constituency:**
  - [x] Add client-side `RegionProof` placeholder (mock in dev, real later) and persist it alongside identity.
  - [x] Use `decodeRegionProof()` wherever a `ConstituencyProof` is required (SentimentSignal, proposal creation).
  - [x] Enforce that emitting a `SentimentSignal` requires a `RegionProof` (or explicit dev stub).

- [x] **On-Chain Bridge Design (stub):**
  - [x] Document a minimal "attestor bridge" flow:
        `SessionResponse (trustScore, nullifier)` + `wallet address` →
        `scaledTrustScore`, `bytes32Nullifier` →
        `UBE.registerIdentity`, `Faucet.recordAttestation`, `QF.recordParticipant`.
  - [x] Provide a placeholder script/service interface even if not fully wired this sprint.

- [x] **Tests & Invariants:**
  - [x] Unit tests for `derive_nullifier` (stable for same device_key).
  - [x] Tests for `decodeRegionProof` mapping to `ConstituencyProof`.
  - [x] Assert `wallet.trustScore` ≈ `identity.scaledTrustScore` once the bridge is wired.

## Phase 2.7 Season 0 Economics & Metrics (RVU / UBE / Faucet / QF)

### 2.8 Data Topology & Privacy v0

**Goal:** Make data placement explicit and enforce public vs sensitive object rules across device, mesh, and chain.

- [x] **Topology Spec:**
  - [x] Add `docs/specs/docs/specs/spec-data-topology-privacy-v0.md` capturing object locations (device, mesh, chain, cloud).
  - [x] Ensure `System_Architecture.md` §4.5 mirrors this table.

- [x] **Mesh Policy:**
  - [x] Restrict plaintext Gun usage to `vh/analyses/<urlHash>` (CanonicalAnalysis) and aggregate sentiment namespaces (no per-user IDs).
  - [x] Audit current Gun writes; remove or guard any sensitive writes under `vh/*`.

- [x] **Sentiment Flow:**
  - [x] Keep event-level `SentimentSignal` local-only or in encrypted outbox.
  - [x] Expose only aggregated per-topic/per-district stats to mesh or dashboards.
  - [x] Tests: ensure no public data structure combines `{ district_hash, nullifier }`.

- [x] **Chat / Outbox Guardrails:**
  - [x] Mark `chat` and `outbox` namespaces as “E2EE required” in `@vh/gun-client`.
  - [x] Add feature flags to prevent plaintext usage in production until encryption is implemented.

- [x] **Aggregation Safety:**
  - [x] Implement minimal cohort size checks (e.g., N ≥ 20) for per-district stats.
  - [x] Apply rounding/binning to small counts in public dashboards.
  - [x] Tests: simulate small district samples and assert we do not render raw counts.

### 2.9 XP Ledger (Participation Weight)

**Goal:** Treat XP as the prototype GWC participation ledger (per nullifier, monotonic, partitioned tracks) and wire Season 0 emissions.

- [x] **Spec & Types:**
  - [x] Add `docs/specs/spec-xp-ledger-v0.md` and mirror types in `packages/types` (`XpLedger`, `XpTrack`, `TotalXpFunction`).
  - [x] `totalXP` computed via a deterministic function over tracks (e.g., weighted sum).

- [x] **Storage & Privacy:**
  - [x] Store XP ledger per nullifier on-device (e.g., `vh_xp_ledger`); optionally encrypt to a trusted node.
  - [x] Ensure no public mesh writes of `{ district_hash, nullifier, XP }`; only safe aggregates exposed.

- [x] **Emission Rules (Season 0):**
  - [x] Define and implement XP increments for: first Lightbulb interaction on a topic, subsequent engagements (diminishing), full read sequences, UBE claim, proposal support/creation; stubs for REL tasks later.
  - [x] Make coefficients configurable; changing coefficients affects future accrual only (no retro-edits).

- [x] **Hooks & UI:**
  - [x] Add `useXpLedger` (per nullifier) consuming events from sentiment/UBE/proposal flows.
  - [x] Surface XP totals and track breakdown in wallet/control panel; mark as “proto participation weight.”

- [x] **Tests & Consistency:**
  - [x] Tests for monotonic updates, track-to-totalXP determinism, and event-driven increments (first vs subsequent interactions).
  - [x] Tests/linters to ensure no `{ district_hash, nullifier, XP }` appears in public data paths.

**Goal:** Make RVU v0, UBE, Faucet, and QF behavior explicit, measurable, and aligned with Season 0 UX.

- [x] **RVU v0 Instrumentation:**
  - [x] Expose `RVU.totalSupply()` and `RVU.balanceOf(QuadraticFunding)` in a dev-only "Global Wealth" dashboard.
  - [x] Add and wire contract counters: `UBE.totalDistributed`, `Faucet.totalDripped`, `QuadraticFunding.distributedMatching`.

- [x] **UBE v0 UX & Policy:**
  - [x] Ensure Wallet "Daily Boost" button is gated by `trustScore ≥ 0.5`.
  - [x] Support two modes: pure XP simulation vs real testnet RVU claim (configurable).
  - [x] Document UBE abuse policy (attestation expiry, trustScore lowering) in code comments/docs.

- [x] **Faucet v0 Scope:**
  - [x] Restrict Faucet usage to dev/tester accounts or flagged early testers in Sprint 2.
  - [x] Hide or clearly mark any Faucet UI in production builds.

- [x] **Governance Gating:**
  - [x] Ensure only attested accounts with sufficient trustScore can participate in any test QF runs.
  - [x] Add CI/QA checks that the public PWA does not expose direct QF contract calls in S2.

---

## Exit Criteria for Sprint 2
- [x] **CI Green:** All gates (Unit, Build, E2E, Bundle, Lighthouse) passing.
- [x] **Governance Live:** Users can submit/vote (Attestation Enforced).
- [x] **Topics Stream Polished:** UX is smooth, AI is fast (≤ 2s), Decay is visible, Eye/Lightbulb behave according to `docs/specs/spec-civic-sentiment.md`, and SentimentSignal events are emitted and validated locally.
- [x] **Canonical Contract Locked:** `canonical-analysis-v1` defined, validated, and used end-to-end (LLM → worker → storage → UI) with tests green.
- [x] **Docs:** `manual_test_plan.md` updated for Governance flows.
