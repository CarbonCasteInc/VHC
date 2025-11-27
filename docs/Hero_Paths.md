# E2E Hero Paths – Season 0

Version: 0.1  
Status: Canonical Storyboards for Sprints 2–3

This document captures two end-to-end “hero paths” for Season 0:

- **Civic Dignity Loop** (news → influence → reward)
- **Governance Loop** (idea → proposal → support)

Each path is described from the user’s point of view and then mapped to concrete types, contracts, and tests across LUMA (identity), VENN (application), and GWC (economics). These loops must remain consistent with:

- `System_Architecture.md`
- `docs/spec-identity-trust-constituency.md`
- `docs/spec-civic-sentiment.md`
- `docs/spec-rvu-economics-v0.md`
- `docs/canonical-analysis-v1.md`
- `docs/AI_ENGINE_CONTRACT.md`
- `docs/spec-data-topology-privacy-v0.md`

---

## 1. Hero Path 1 – Civic Dignity Loop

> *“I read, I judge, my district’s signal moves, and the system recognizes that.”*

### 1.1 Narrative (User Perspective)

1. **I become “real” in the system**

   - I install the app or open the PWA.
   - I go through onboarding and end up with an account that is “me”: one human, not just one device.
   - At some point I complete Proof of Human (attestation). Optionally, I prove my region so the app knows I am a constituent of District X.
   - After this, the app treats me differently from a guest:
     - My actions can move civic metrics,
     - I am eligible for a small daily boost.

2. **I scroll the civic feed**

   - I see a list of topics (stories).
   - Each card shows:
     - Headline & source,
     - A small **Eye** indicator (how much real reading interest the story has),
     - A **Lightbulb** indicator (how much engaged judgment the story has attracted).
   - I can scroll this feed even as a guest; but only as an attested human do my actions move those metrics.

3. **I open a canonical analysis**

   - Tapping a card opens a **canonical analysis**, not the raw website.
   - I see:
     - A neutral **summary** of the article (facts only),
     - A **bias / counterpoint table**:
       - Each row is a *perspective* (`frame` + `reframe`),
       - Each cell has its own **+ / –** control.

4. **I express my judgement**

   - For each cell (frame or reframe) I can:
     - Agree (**+1**),
     - Disagree (**-1**),
     - Or stay neutral (**0**).
   - The controls are simple 3‑state toggles:
     - Tapping + again returns to neutral,
     - Switching from + to – flips the stance.
   - When I interact:
     - The row’s local sentiment indicator moves (ratio of agree/disagree),
     - The article’s **Lightbulb** (engagement) increases slightly for *me*,
     - My personal “score” on the control panel ticks up (civic XP track).

5. **I see my district’s signal**

   - In a **Constituent Dashboard**, I can see:

     - For my district:
       - % agree / disagree on specific claims (aggregated per bias row),
       - Which topics are “hot” by engagement.
     - For the wider network:
       - How my district compares to others on the same topic.

   - My individual stance is not displayed; I only see aggregated results. But it’s clear that my actions contribute to these curves.

6. **I get a small daily boost**

   - Once per day, as an attested human, I can claim a **Daily Boost**.
   - In the UI this shows up as:
     - A “Boost” button / status in the control panel,
     - An increase in my visible score (XP).
   - Under the hood, this is backed by a UBE claim (Season 0) and/or an off‑chain XP ledger.

7. **Being a good citizen is legible**

   - My feed is cleaner than a standard doomscroll,
   - I can see all sides of stories,
   - My reactions roll up into district‑level signals,
   - I get tangible recognition (score now, RVU later) for participating thoughtfully.

This is the **Civic Dignity Loop**: identity → news → analysis → stance → district‑level influence → daily recognition.

---

### 1.2 Under the Hood (S0–S2 Implementation)

#### 1.2.1 Identity & Trust (LUMA)

- **Types & specs:**
  - `TrustScore` (0..1) and `ScaledTrustScore` (0..10000) per `spec-identity-trust-constituency.md`.
  - `UniquenessNullifier` – stable per-human key (string off-chain, `bytes32` on-chain).
  - `RegionProof` → `ConstituencyProof { district_hash, nullifier, merkle_root }`.

- **Client:**
  - `useIdentity` calls the attestation-verifier and stores an `IdentityRecord` in `localStorage: vh_identity` with:
    - `session.token`,
    - `session.trustScore`,
    - `session.scaledTrustScore`,
    - `session.nullifier` (UniquenessNullifier).

- **Roles:**
  - **Guest:** no trustScore/nullifier in state; can read but does not move canonical metrics or earn XP.
  - **Human (PoH):** trustScore ≥ 0.5 (scaled ≥ 5000).
    - Eligible for UBE/Faucet.
    - Their sentiment & engagement contribute to aggregates.
  - **Constituent:** Human + valid RegionProof.
    - Their sentiment participates in district-level aggregates (by `district_hash`).

> Invariant: For the same human, the `nullifier` is consistent across identity, sentiment (SentimentSignal.constituency_proof.nullifier), and UBE/QF attestations.

#### 1.2.2 Feed → Canonical Analysis (VENN + AI Engine)

- **Data model:**
  - `CanonicalAnalysisV1` from `docs/canonical-analysis-v1.md`:
    - `url`, `urlHash`,
    - `summary`,
    - `bias_claim_quote`, `justify_bias_claim`, `biases`, `counterpoints`,
    - Optional `perspectives: { frame, reframe }[]`,
    - `sentimentScore`, `confidence?`,
    - Optional `engine` metadata and `warnings[]`.

- **Generation:**
  - AI pipeline per `AI_ENGINE_CONTRACT.md`:
    - `buildPrompt(articleText)` constructs the prompt with goals/guidelines and JSON wrapper.
    - `EngineRouter` chooses a remote or local model (Season 0: `remote-first` in prod, `local-only` in E2E).
    - Model returns wrapped JSON (`step_by_step` + `final_refined`) parsed and validated via `AnalysisResultSchema`.
    - Output is canonicalized into `CanonicalAnalysisV1` and validated by `CanonicalAnalysisSchema`.

- **Storage & topology:**
  - Per `spec-data-topology-privacy-v0.md`:
    - CanonicalAnalyses are **public**:
      - Stored on-device: `localStorage: vh_canonical_analyses` and IndexedDB `vh-ai-cache/analyses`.
      - Optionally replicated plaintext to mesh: `vh/analyses/<urlHash>`.
    - They do **not** include any identity or constituency data.

- **UI:**
  - Civic feed reads `CanonicalAnalysisV1` to render summary and bias table.
  - Eye & Lightbulb are computed from per-topic Eye/Lightbulb weights (see below).

#### 1.2.3 Sentiment, Eye & Lightbulb (VENN + Sentiment Spec)

- **Types & schemas:**
  - `SentimentSignal` and `AggregateSentiment` from `spec-civic-sentiment.md`.
  - Event-level:

    ```ts
    interface SentimentSignal {
      topic_id: string;
      analysis_id: string;
      point_id: string;
      agreement: 1 | 0 | -1;
      weight: number; // Lightbulb engagement weight [0,2]

      constituency_proof: {
        district_hash: string;
        nullifier: string;
        merkle_root: string;
      };

      emitted_at: number;
    }
    ```

  - Aggregate:

    ```ts
    interface PointStats {
      agree: number;
      disagree: number;
    }

    interface AggregateSentiment {
      topic_id: string;
      analysis_id: string;
      point_stats: Record<string, PointStats>;
      bias_vector: Record<string, 1 | 0 | -1>;
      weight: number;          // aggregate Lightbulb
      engagementScore: number; // optional dispersion/spread metric
    }
    ```

- **Per-user state (client):**
  - `useSentimentState`:
    - Stores `agreement ∈ {-1,0,1}` per `(topic_id, point_id)` (3‑state toggle).
  - `useEngagementState`:
    - Stores **Lightbulb** `lightbulb_weight(topic_id, user)` ∈ `[0,2]`.
    - Updates via Civic Decay on *engagement interactions* (stance changes).
  - `useReadState` (or `useReadTracker`):
    - Stores **Eye** `eye_weight(topic_id, user)` ∈ `[0,2]`.
    - Updates via Civic Decay on each full read/expand of the analysis.

- **Civic Decay function:**

  From `spec-civic-sentiment.md`:

  ```ts
  // One step toward 2.0
  next = current + 0.3 * (2.0 - current);

Invariants:
	•	Monotonic,
	•	Bounded in [0,2],
	•	One qualifying interaction = one step.
	•	Metrics semantics:
	•	Eye (Read Interest):
	•	Per-user-per-topic eye_weight updated on read/expand.
	•	Aggregate Eye:
	•	Deterministic function of all eye_weight values (sum or average).
	•	Optional secondary metric: count of users with eye_weight > 0.
	•	Lightbulb (Engagement):
	•	Per-user-per-topic lightbulb_weight updated on each stance change / engagement.
	•	SentimentSignal.weight = current lightbulb_weight for that topic.
	•	Aggregate Lightbulb:
	•	Deterministic aggregate of per-user lightbulb_weight (sum/avg).
	•	Per-point sentiment:
	•	agreement changes update local state per (topic_id, point_id).
	•	Aggregate point_stats[point_id] count only committed votes:
	•	agree = count of agreement = +1,
	•	disagree = count of agreement = -1,
	•	Neutral (0) is excluded from counts.
	•	Privacy & topology:
	•	Per spec-data-topology-privacy-v0.md:
	•	Event-level SentimentSignal is sensitive:
	•	Lives on-device and/or is sent encrypted to a Guardian Node.
	•	Never stored plaintext in the public mesh.
	•	Mesh / public:
	•	Only AggregateSentiment and other aggregates appear.
	•	No {district_hash, nullifier} pairs in any public structure.

1.2.4 XP & Daily Boost (GWC)
	•	Contracts:
	•	RVU.sol, UBE.sol, Faucet.sol, QuadraticFunding.sol per spec-rvu-economics-v0.md.
	•	UBE parameters (Season 0):
	•	minTrustScore = 5000 (0.5),
	•	claimInterval = 1 day,
	•	dripAmount ~25 RVU.
	•	UX decision (Season 0):
	•	UBE is surfaced in the app as a Daily Boost, not as a DeFi income product.
	•	Behind the scenes:
	•	Successful UBE.claim() can:
	•	Mint testnet RVU to the user’s wallet, and/or
	•	Increment a per-nullifier civic XP ledger.
	•	Faucet remains dev/onboarding-only and is not part of the visible dignity loop.
	•	UI:
	•	useWallet + WalletPanel:
	•	For advanced users/testers, shows RVU balance and raw UBE claim status.
	•	Control panel:
	•	Shows “Daily Boost” status and XP growth.

⸻

1.3 E2E Test Outline – Civic Dignity Loop

A Season 0 E2E test suite should demonstrate:
	1.	Identity and trust gating
	•	Create a new identity via useIdentity with mocked attestation:
	•	Ensure trustScore ≥ 0.5.
	•	Ensure nullifier is present.
	•	Optionally attach a mock RegionProof and verify ConstituencyProof decoding.
	2.	Daily Boost / UBE link
	•	Call UBE.claim() in mock mode (or equivalent XP-only path).
	•	Assert:
	•	Claim succeeds only if trustScore ≥ minTrustScore.
	•	User’s civic XP track increases by the expected amount.
	3.	Canonical analysis loading
	•	Paste a known URL into the app.
	•	Assert:
	•	CanonicalAnalysisV1 is generated or reused (First-to-File behavior).
	•	Entry passes CanonicalAnalysisSchema.parse.
	•	It is stored in local feed and, if configured, appears in vh/analyses/<urlHash> in the mesh.
	4.	Bias table interaction
	•	On a canonical analysis:
	•	Toggle + on a specific point_id.
	•	Assert:
	•	agreement(topic_id, point_id) moves from 0 → +1.
	•	lightbulb_weight(topic_id, user) increases via Civic Decay.
	•	Aggregate sentiment for that point (point_stats) reflects this vote.
	5.	Eye/Lightbulb updates
	•	Open and close the same analysis multiple times:
	•	Assert eye_weight(topic_id, user) increases monotonically and is bounded in [0,2].
	•	Engage multiple times with the table:
	•	Assert lightbulb_weight(topic_id, user) increases monotonically and is bounded in [0,2].
	6.	District dashboard
	•	With a mock district_hash:
	•	Feed several SentimentSignal events (or mocked equivalents) into an aggregate pipeline.
	•	Assert:
	•	Per-district aggregates (point_stats, Eye, Lightbulb) are computed correctly.
	•	No per-user identifiers appear in the public dashboard data structures.

⸻

2. Hero Path 2 – Governance Loop

“This article is biased → here’s a better idea → look, people support it.”

2.1 Narrative (User Perspective)
	1.	I start from a topic
	•	I’m on a topic (e.g., “local transit funding”) reading a canonical analysis and its bias/counter table.
	•	Below the analysis, I see a section like “Ideas & Proposals”.
	2.	I explore ideas
	•	I see a list of proposals related to this topic.
	•	Each proposal card shows:
	•	Title & short summary,
	•	Requested budget (in RVU units),
	•	Recipient (who would receive funds),
	•	Current support level (For/Against or a support score).
	3.	I read and decide to back a proposal
	•	I open a proposal and read the details:
	•	What it is,
	•	Why it matters,
	•	How it connects to this topic.
	•	A simple control lets me decide:
	•	Whether I support or oppose it,
	•	How strongly I support it (a numeric input).
	4.	I stake my support (Season 0)
	•	I enter an amount (in “RVU units”) representing my support weight.
	•	The UI shows voice credits = amount² to give me the quadratic feel.
	•	I submit my support:
	•	The proposal’s support metrics update,
	•	My governance/project XP increases,
	•	My control panel shows that I’ve backed this proposal.
	•	In Season 0:
	•	This does not move real RVU for general users;
	•	It is tracked off-chain (and optionally in the mesh) as simulated QF-style voting.
	5.	I see hypothetical funding outcomes
	•	The proposal UI shows “What if this were in a QF round?”:
	•	Estimated matching given a hypothetical pool,
	•	How this proposal compares to others in terms of voice credits.
	•	I can tell which ideas are resonating, even before money flows.
	6.	Later, projects become QF-eligible
	•	In future seasons, some proposals become QF projects:
	•	They get a real projectId in the QuadraticFunding contract,
	•	My attested votes can actually route RVU (subject to trust gates).
	•	My earlier participation (XP footprint) influences how the system invites me into these higher-stakes rounds.

This is the Governance Loop: news → idea → proposal → committed support → eventual routing of value through QF.

⸻

2.2 Under the Hood (S0–S2 Implementation)

2.2.1 Proposal & vote data model
	•	Proposal schema:
	•	ProposalSchema in packages/data-model/src/schemas.ts:

export const ProposalSchema = z.object({
  id: z.string().uuid(),
  author: z.string().min(1),      // pubkey
  title: z.string().min(10),
  summary: z.string().max(500),
  fundingRequest: z.string().regex(/^\d+$/), // RVU units as string
  recipient: z.string().min(1),   // address or identifier
  attestationProof: z.string().min(1),
  timestamp: z.number().int().nonnegative()
});


	•	Vote representation (off-chain):
	•	Season 0: votes are represented as off-chain objects (e.g., ProposalVote) with fields like:
	•	proposalId,
	•	direction (“for” / “against”),
	•	amount (numeric),
	•	voter (pubkey or nullifier in private context),
	•	timestamp.
	•	Front-end:
	•	useGovernance (PWA):
	•	Seeds example proposals and maintains votesFor / votesAgainst locally.
	•	In future, will persist Proposal and ProposalVote via mesh or local storage.
	•	Topology & privacy:
	•	Per spec-data-topology-privacy-v0.md:
	•	Proposals themselves are public objects and may be stored in mesh.
	•	Raw per-user vote events may be considered sensitive depending on whether they are linked to identity/constituency:
	•	Publicly: only aggregate vote counts and voice credits per proposal.
	•	Privately: structured vote histories keyed by nullifier may be kept on-device or via encrypted channels.

2.2.2 Quadratic Funding Engine (GWC)
	•	Contract: QuadraticFunding.sol
	•	Supports:
	•	recordParticipant(address, scaledTrustScore, expiresAt) – attested participants (trust-gated).
	•	registerProject(recipient) – admin/curator registers projects.
	•	castVote(projectId, amount) – contributions (RVU) from participants.
	•	Quadratic weight accounting (sumOfSqrtContributions).
	•	Matching pool funding (fundMatchingPool / poolFunds).
	•	Settlement (closeRound, matchFunds, withdraw).
	•	Season 0 scope (per spec-rvu-economics-v0.md):
	•	Public UX:
	•	Off-chain simulated QF voting (no direct castVote from general users).
	•	Internal/developer use:
	•	Curators and dev accounts exercise full QF flows on testnet with RVU:
	•	Register projects,
	•	Record participants,
	•	Cast votes,
	•	Close and match rounds,
	•	Withdraw funds.

2.2.3 Season 0 decision: sandboxed public governance
	•	Public PWA:
	•	Proposal creation & voting:
	•	Remains off-chain and (initially) local/mesh-only.
	•	Votes update proposal-level aggregates (votesFor, votesAgainst, derived voice credits).
	•	XP:
	•	Supporting proposals increases governance/project XP for the user (ledger keyed by nullifier off-chain).
	•	No on-chain RVU is moved directly from public PWA interactions in Season 0.
	•	Internal QF testing:
	•	Curated proposals are mapped to QF projectIds:
	•	Off-chain mapping: proposalId → projectId.
	•	Curators and test participants:
	•	Use wallets, attestation bridge, and QF contracts to run real matches.
	•	This validates the economic engine without exposing public users to real-money governance yet.

2.2.4 Proposal lifecycle in S0
Off-chain / app level:
	1.	Draft:
	•	User with identity (nullifier) creates a proposal via UI.
	•	Proposal is validated by ProposalSchema.
	•	Proposal references:
	•	Topic(s) (topic_id / URL),
	•	Optional tags/categories,
	•	Optional attestationProof that the author is in an affected district.
	2.	Distribution & discussion:
	•	Proposal appears in:
	•	Topic-specific views (“Related Proposals”),
	•	General governance lists.
	•	HERMES (future) provides threaded discussion tied to proposalId.
	3.	Support / voting:
	•	When a user votes via VoteControl:
	•	A ProposalVote is created locally and/or in mesh/private storage.
	•	Proposal aggregates (votesFor, votesAgainst, voice credits) update.
	•	The user’s project/governance XP increases.

On-chain / internal:
	4.	Curation & registration:
	•	Admin/curators select certain proposals for on-chain QF testing.
	•	They call QuadraticFunding.registerProject(recipient) and maintain mapping to proposalId.
	5.	QF test rounds:
	•	Using dev/test accounts:
	•	Participants are attested (recordParticipant).
	•	They cast real castVote transactions.
	•	After the round, curators call closeRound, matchFunds, and withdraw.
	•	Internal dashboards compare:
	•	Off-chain simulated outcomes vs. on-chain actual matches.

Future seasons:
	6.	Public QF activation:
	•	ProposalSchema grows an onChainProjectId field.
	•	For QF-enabled proposals, public PWA:
	•	Allows attested users (trustScore ≥ QF threshold) to cast real RVU votes via castVote.
	•	Shows both:
	•	Off-chain voice metrics,
	•	On-chain contribution/match status.

⸻

2.3 E2E Test Outline – Governance Loop

Season 0 tests should demonstrate that the governance loop works end-to-end at the UX and contract levels (even though they are only partially wired together for public users).

2.3.1 App-level governance tests
	1.	Proposal creation
	•	With an attested identity:
	•	Create a proposal via the UI.
	•	Assert it passes ProposalSchema.parse.
	•	Assert it appears in:
	•	Topic-specific proposal lists,
	•	Global proposal list.
	2.	Voting & aggregates
	•	On a proposal:
	•	Submit a “For” vote with amount A.
	•	Assert:
	•	Local aggregates (votesFor, derived voice credits) update as expected.
	•	A ProposalVote record is stored (local or mesh/private).
	•	User’s governance/project XP increased.
	3.	Hypothetical QF projection
	•	Provide a mock QF pool and emulate QF math client-side.
	•	Assert:
	•	The UI’s “Estimated match” matches the math used in QuadraticFunding tests (for the same inputs).

2.3.2 Contract-level QF tests (internal)
	1.	Participant & project registration
	•	Deploy RVU and QuadraticFunding to a testnet/anvil.
	•	Register:
	•	Two projects via registerProject.
	•	Several participants via recordParticipant with trustScore ≥ min QF threshold.
	2.	Voting & matching
	•	Mint RVU to participants.
	•	Have participants cast QF votes (castVote) with varying amounts.
	•	Fund the matching pool via fundMatchingPool / poolFunds.
	•	Close the round and call matchFunds.
	3.	Assertions
	•	Verify:
	•	Quadratic contributions and matching weights align with spec.
	•	withdraw(projectId) transfers the correct total (contributions + matches) to the recipient.
	•	Trust gating works: unregistered/low-trust participants cannot cast votes.
	4.	Simulation alignment
	•	Cross-check:
	•	Off-chain simulated matches (used in the UI) against on-chain matches for the same contributions.

⸻

3. Summary

These two hero paths tie together:
	•	LUMA identity (nullifier, trustScore, RegionProof),
	•	VENN’s AI analysis and sentiment mechanics,
	•	GWC’s UBE, RVU, and Quadratic Funding,
	•	And the Season 0 data topology & privacy rules.

They should be treated as contractual storyboards: if a feature or change breaks one of these loops, it should be considered an architectural regression, not just a UI tweak.

---
