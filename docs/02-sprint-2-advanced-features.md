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
    - [ ] **Offline E2E:** New flows (Feed/Vote) must pass with `VITE_E2E_MODE=true` (Mocked Clients).
    - [ ] **Performance:** "Expand to Analyze" < 2s (Warm Cache).
    - [ ] **Security:** Attestation/Trust gating required for all engagement/voting.

---

## Phase 1: Governance & Voting (GWC)

### 1.1 Quadratic Funding Logic
- [x] **Contract:** Enhance `QuadraticFunding.sol` with full pooling and distribution logic.
- [x] **Gating:** Voting and Matching MUST be gated by valid **Attestation** (`trust_score` check).
- [x] **Tests:** Add specific test cases for non-attested attempts (must revert).

### 1.2 Proposal System
- [x] **Schema:** Define `Proposal` schema in `data-model` with validation (Zod).
- [x] **Flow:** Create "Submit Proposal" flow (requires minimum RVU stake + Attestation).
- [x] **E2E:** Verify "Submit -> Vote -> Match" flow in Offline Mock Mode.

---

## Phase 2: The Civic Feed & Nervous System (VENN)

### 2.1 The Civic Feed Experience (UX)
- [x] **Feed:** Virtualized infinite scroll.
    - **Tests:** Component tests for windowing thresholds, empty/error states.
- [x] **Metrics:**
    - **Eye:** Read Count (Unique Expansions).
    - **Lightbulb:** Global Engagement Score (Sum of all User Scores).
- [x] **Transitions:** "Lift & Hover" effect (Scale + Z-Index) on expansion.
    - **Tests:** Verify lift state, metric rendering, and a11y/keyboard support.
- [x] **Analysis UI:**
    - Narrative Summary.
    - **Perspectives Table:** Two columns (Frame/Reframe).
    - **Voting:** Independent +/- toggle per cell (Frame & Reframe).
    - **Logic:** 3-state (Agree/Disagree/None). Toggling active state resets to None. Switching state flips vote.
    - **Stats:** Display aggregate sentiment ratio for each item.
- [x] **State Management:**
    - **Tests:** Unit tests for pagination, caching, and local persistence.
    - **E2E:** Mocked offline mode (no network).

### 2.2 The Nervous System (Engine)
- [x] **Civic Decay Algorithm:**
    - **Formula:** `next = current + (2.0 - current) * 0.3`.
    - **Tests:** Verify asymptotic ceiling (never > 2.0) and monotonic growth.
    - **Scope:** Applied to the User's contribution to the Article's "Lightbulb" score.
- [x] **Local State:** Persist `article_interaction_state` (current score) in Gun/IDB.
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

---

## Exit Criteria for Sprint 2
- [ ] **CI Green:** All gates (Unit, Build, E2E, Bundle, Lighthouse) passing.
- [ ] **Governance Live:** Users can submit/vote (Attestation Enforced).
- [ ] **Civic Feed Polished:** UX is smooth, AI is fast (≤ 2s), and Decay is visible.
- [ ] **Docs:** `manual_test_plan.md` updated for Governance flows.
