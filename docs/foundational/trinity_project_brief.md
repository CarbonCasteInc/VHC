# TRINITY Project Brief (Season 0, V2-first)

A local-first civic-and-economic operating system that turns verified human attention and thought effort into legible civic signal and project momentum.

## 0. One paragraph summary

TRINITY Season 0 ships a unified civic product: one feed that blends clustered news stories, user-born topics, and linked-social notifications; one topic detail view that combines deterministic Topic Synthesis V2 with thread discourse; and one elevation path that turns high-salience topics into editable civic artifacts and user-initiated representative forwarding. Identity and trust (LUMA), discourse/docs/action UX (VENN/HERMES), and economic rails (GWC) are designed to work together while preserving strict privacy boundaries.

## 1. Problem and thesis

### 1.1 Two fractures we target

1. Information fracture.

- public discourse is fragmented and manipulation-prone
- users see isolated URLs, not integrated story context

2. Participation fracture.

- individual civic effort is often invisible and non-compounding
- people cannot easily move from discussion to coordinated action

### 1.2 Core thesis

- verified human intent is scarce and economically/civically meaningful
- cleaner synthesis + structured disagreement improves civic signal quality
- participation should remain legible to the user without exposing identity

## 2. Architecture in plain language

TRINITY combines three systems:

1. LUMA (identity and trust)
2. VENN/HERMES (information, discourse, docs, and action UX)
3. GWC (economic and governance rails)

### 2.1 LUMA: identity and trust primitives

LUMA provides the trust substrate:

- stable principal nullifier
- trust score (`0..1`) and scaled trust (`0..10000`)
- optional constituency proof (`district_hash`, `nullifier`, `merkle_root`)

Role ladder:

- Guest: can read
- Human: verified (`trustScore >= 0.5`), can participate in weighted civic flows
- Constituent: verified + constituency proof, can contribute to district-level aggregates

### 2.2 VENN/HERMES: product surfaces and interaction loop

VENN/HERMES is the visible product experience:

- one feed with three surfaces:
  - News
  - Topics/Threads
  - Linked-social notifications
- one topic detail with two lenses:
  - Synthesis panel (`TopicSynthesisV2`)
  - Thread/forum lens
- one longform path:
  - reply hard cap 240 chars
  - overflow -> Convert to Article -> Docs draft -> publish back to topic

### 2.3 GWC: economic and governance rails

GWC provides Season 0 rails:

- RVU token infrastructure
- UBE daily claim path (surfaced as Daily Boost)
- QF contracts for curated/internal rounds
- XP-first public UX with governance economics incubating beneath

## 3. Season 0 product contract

### 3.1 Unified feed and discovery

Feed contract:

- cards from three surfaces in one stream
- filter chips: `All`, `News`, `Topics`, `Social`
- sort modes: `Latest`, `Hottest`, `My Activity`

News contract:

- one card represents one clustered story, not one URL
- ingest and clustering produce `StoryBundle` as synthesis input

### 3.2 Topic detail and synthesis

Topic detail contract:

- synthesis + thread always appear as one object
- synthesis is epochal and deterministic (`TopicSynthesisV2`)
- warnings/divergence shown when candidate disagreement is meaningful

Synthesis cadence defaults:

- early accuracy pass: first 5 verified opens can generate critique/refine candidates
- re-synthesis: every 10 verified comments with >=3 unique verified principals
- debounce: 30 minutes
- daily cap: 4 per topic

### 3.3 Forum and longform publishing

Forum contract:

- write/vote trust gate at `>= 0.5`
- sort modes: New/Top/Hot
- reply hard cap 240 chars

Longform contract:

- overflow reply path to docs-backed article
- private-first drafting, optional collaboration
- publish article back into topic/feed and forum context

### 3.4 Civic elevation and representative forwarding

Elevation contract:

- nomination targets: news/topic/article
- threshold crossing emits artifact generation
- artifacts:
  - BriefDoc
  - ProposalScaffold
  - TalkingPoints

Forwarding contract:

- rep selection by `district_hash`
- channels: `mailto`, `tel`, share, export, manual fallback
- no default automated form submission
- local receipt authoritative; public counters aggregate-only

## 4. Trust gates, budgets, and safety defaults

### 4.1 Trust thresholds

- Human participation threshold: `trustScore >= 0.5` (`scaled >= 5000`)
- High-impact (forwarding/elevation finalize/QF-ready) threshold: `trustScore >= 0.7` (`scaled >= 7000`)

### 4.2 Participation budgets (per principal per day)

Season 0 coding defaults:

- posts: 20
- comments: 50
- sentiment votes: 200
- governance votes: 20
- analyses: 25 (max 5/topic)
- shares: 10
- moderation: 10
- civic actions: 3

Familiars inherit these budgets and consume principal limits.

### 4.3 Familiar boundary

- familiar supports draft/triage/suggest by policy
- high-impact actions require explicit human approval
- familiar actions are attributable and revocable

## 5. Civic and economic legibility

### 5.1 XP tracks (public-facing now)

Season 0 participation appears as XP tracks:

- `civicXP` (reading, stance, civic forwarding)
- `socialXP` (discussion and communication)
- `projectXP` (proposal/project-oriented work)

XP is local-first and per principal nullifier.

### 5.2 RVU/UBE/QF rails (active but backgrounded)

- UBE is exposed as Daily Boost UX
- RVU and QF infra exist for internal/curated rounds
- public Season 0 experience remains XP-first

### 5.3 District dashboard

Dashboard intent:

- show district-level aggregates and trend comparisons
- avoid individual exposure
- maintain strict aggregate-only public semantics

## 6. Data topology and privacy posture

### 6.1 Local-first placement

Authoritative on device:

- identity vault data
- per-user sentiment events
- profile/contact data for forwarding
- draft docs and private artifacts
- XP ledger and budget state

### 6.2 Mesh and chain boundaries

Public mesh/chain should contain:

- public topic/thread/synthesis objects
- aggregate civic metrics
- aggregate forwarding counters

Sensitive data must remain:

- local only
- or encrypted in user-scoped channels

Never public:

- OAuth tokens
- private keys
- raw profile/contact PII
- identity linkage pairs that de-anonymize users

## 7. AI strategy and user control

Default:

- local inference path (WebLLM / local model runtime)

Optional:

- remote providers with explicit user opt-in
- provider selector must expose cost/privacy boundary

Provider switching is a product feature with clear consent and provenance semantics, not a hidden implementation detail.

## 8. Season 0 north-star epics

1. News aggregator + story clustering
2. Topic Synthesis V2 quorum/epoch pipeline
3. Linked-social notifications in unified feed
4. Reply-to-Article docs publishing flow
5. Nomination thresholds + elevation artifacts
6. Representative directory + forwarding + receipts
7. Provider switching consent UX

## 9. Who this brief serves

### 9.1 Developers

- provides cross-system contracts and defaults to code against
- clarifies trust/budget/privacy boundaries before implementation
- anchors migration away from V1 analysis semantics

### 9.2 Partners and operators

- explains why product is XP-first while economic rails mature
- clarifies governance and compliance boundaries in Season 0
- details where operational risk controls exist (trust gates, budgets, privacy)

### 9.3 Public stakeholders

- shows how the system converts civic discussion into structured, non-anonymous-but-private aggregate signal
- explains why representative forwarding is user-initiated, not dark automation

## 10. Legacy boundary and migration note

- `CanonicalAnalysisV1` remains compatibility-only.
- New specs, UX contracts, and sprint plans should key on V2 (`TopicId`, `StoryBundle`, `TopicSynthesisV2`, `synthesis_id`, `epoch`).
- Any retained V1 naming should be treated as read-compat aliases only.
