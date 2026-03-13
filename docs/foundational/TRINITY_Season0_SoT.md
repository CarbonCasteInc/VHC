# TRINITY (VENN/HERMES × LUMA × GWC) - Season 0 Ship Snapshot (V2-First)

> Status: Season Scope Contract
> Owner: VHC Product + Architecture
> Last Reviewed: 2026-03-13
> Depends On: docs/foundational/trinity_project_brief.md, docs/foundational/System_Architecture.md


**Purpose:** one **single tree** that gives **frontend + backend** devs the full picture (UX surfaces + contracts + privacy boundaries + gates).
**Stance:** **Design & build for Synthesis V2**. Anything labeled V1 is **legacy/compat only**.
**Legend:** ✅ Implemented · 🟡 Partial · 🔴 Stubbed · ⚪ Planned
**Last updated:** 2026-03-13

> Implementation-truth note: this document is season scope and target framing, not the current implementation ledger. For actual merged state and drift notes, use `/Users/bldt/Desktop/VHC/VHC/docs/foundational/STATUS.md`.

---

- **TRINITY Bio-Economic OS (Season 0)** - UX: "clean news + structured disagreement + legible recognition"; Tech: local-first identity + edge AI + mesh + economic rails
  - **Non-negotiables (Product / UX / Policy)**
    - **A - V2-first synthesis**: quorum + epochs + divergence; V1 is legacy/compat only
    - **B - Unified feed spans the current Season 0 surfaces**: **News**, **Topics/Threads**, **Linked-Social Notifications**, **Articles**, and **Action Receipts** (All filter only)
    - **C - Elevation to projects**: News/Topics/Articles can be nominated; thresholds → auto-draft brief + proposal scaffold; users can forward to reps via email/phone
    - **D - Reddit-like thread mechanics**: sort New/Top; peer-votes affect visibility; Reply ≤ **240 chars**; overflow → "Convert to Article" (Docs)
    - **E - Collaborative docs**: multi-author E2EE P2P drafting; private iteration → publish to feed
    - **F - GWC thesis**: value attention/thought-effort; redirect value to humans (not advertisers); REL/AU later
    - **G - AI provider switching**: default **WebLLM**; allow user-selected remote providers + local models; explicit opt-in + cost/privacy clarity

  - **Season 0 defaults (numbers devs should code against unless explicitly changed)**
    - **Trust gates:** Human ≥ **0.5** (`scaled ≥ 5000`); QF (future/curated) ≥ **0.7** (`scaled ≥ 7000`)
    - **Synthesis epochs:** debounce **30 min**; daily cap **4/topic**
    - **Topic re-synthesis (discussion-driven):** every **10 verified comments** with **≥3 unique verified principals** since last epoch
    - **Early accuracy pass:** first **5 verified opens** produce critique/refine candidates (per topic epoch)
    - **Budgets/day (per principal nullifier):** posts=20, comments=50, sentiment_votes=200, governance_votes=20, analyses=25 (max 5/topic), shares=10, moderation=10, civic_actions=3
    - **UBE ("Daily Boost"):** 1/day; `minTrustScore=5000`; drip ≈ **25 RVU** (Season 0 default)

  - **Prime Directives (engineering hard constraints)** ✅ (target architecture)
    - **Local is Truth** ✅ - UX: fast/offline; identity + sensitive civic state on device; mesh/chain only public or encrypted replicas
    - **Physics is Trust** 🟡/🔴 - UX: verified humans matter; Tech: hardware attestation intended; current verifier is dev-stub
    - **Math is Law** 🟡 - UX: support becomes legible + anti-plutocracy later; Tech: QF now, MACI later
    - **Shared Reality** 🟡 - UX: same synthesis view for everyone; Tech: deterministic V2 quorum selection per epoch
    - **Civic Facilitation (no dark automation)** ⚪ - UX: user-initiated email/phone/share/export; no default form submission
    - **Human Sovereignty (Familiars)** 🟡/⚪ - UX: assistants help but don't multiply influence; Tech: scoped/expiring/revocable grants; inherit principal budgets
    - **Strict Discipline** ✅ - 350 LOC cap (tests/types/ABI exempt) + 100% line/branch coverage gate

  - **Hero loops (what the user experiences)** 🟡
    - **Civic Dignity Loop** - UX: "I read, I judge; my district signal moves; I'm recognized"
      - Onboard → (optional) prove district → feed → open topic → stance on frames → see aggregates → claim Daily Boost
    - **Governance / Elevation Loop** - UX: "this matters → it becomes a project → support is visible → it reaches reps"
      - Nominate story/topic/article → threshold → auto-draft brief + proposal scaffold → simulated QF support → forward-to-rep (email/phone)
    - **Docs / Longform Loop** - UX: "draft privately → collaborate → publish → discuss → elevate"
      - E2EE doc draft → publish as topic → thread engagement → auto-nominate (articles) → elevate

  - **User-visible UI surfaces (front-end map)** 🟡
    - **App Shell / Navigation** ✅ - UX: stable app frame; boot/hydrate before high-impact actions
    - **Unified Topics Feed** 🟡 - UX: one stream; filter chips: All / News / Topics / Social / Articles; sort: Latest / Hottest / My Activity
      - **TopicCard (shared)** 🟡 - UX: headline/title + category tags + 👁 Eye + 💡 Lightbulb + comment count
      - **NewsCard (clustered story)** 🟡 - UX: **one headline = one story** synthesized across outlets; tap opens TopicDetail
      - **TopicCard (user topic/thread)** 🟡 - UX: looks like news once discussion is rich enough (summary + frames + thread)
      - **SocialNotificationCard** 🟡 - UX: platform badge; tap expands to embedded platform view; swipe-left returns & dismisses card (real-data rendering landed Wave 2 Gamma P3)
      - **ArticleFeedCard** 🟡 - UX: docs-backed longform in the same discovery stream
      - **Action receipts** 🟡 - UX: civic-action confirmations appear in `All` only
    - **Topic Detail ("one object, two lenses")** 🟡 - UX: synthesis up top; conversation below; stable, readable, non-churny
      - **Synthesis Panel (V2)** ⚪/🟡 - UX: "just-the-reported-facts" + Frame/Reframe table; epoch badge; warnings if sources disagree
      - **Frame/Reframe Table (stance grid)** 🟡 - UX: per row: Agree (+1) / Neutral (0) / Disagree (-1); toggles are 3-state, no spam
      - **Thread Lens (Forum)** ✅/🟡 - UX: Reddit-like; sort New/Top; votes float good replies; stance-aware threading
      - **Reply Composer** ⚪/🟡 - UX: 240-char hard limit; "Convert to Article" CTA when exceeded
      - **Article Viewer / Doc-backed Post** ⚪ - UX: longform reads like a doc; still has comments + votes underneath
      - **Proposal / Support Widget** 🟡 - UX: "Support" amount A → shows **voice credits = A²**; shows estimated match in hypothetical pool
    - **Control Panel / Profile** 🟡 - UX: "my score, my boosts, my impact"
      - **Daily Boost button** 🟡 - UX: claim once/day → XP bump; (optional) testnet RVU mint behind scenes
      - **XP Tracks** ✅ - UX: civicXP / socialXP / projectXP (simple bars/number)
      - **Wallet (Advanced)** 🟡 - UX: RVU balance + claim status for testers; hidden behind "Advanced"
      - **District Dashboard** ⚪/🟡 - UX: per-district aggregates + comparisons; never shows individual stance
    - **Messaging (HERMES)** 🟢 - UX: private chat + group coordination (also where Familiar control lives)
      - **Familiar Control Panel** 🟡/⚪ - UX: create/revoke grants; see what the familiar can do; review "high impact" requests
    - **Docs (HERMES Docs)** 🟡 - UX: collaborative editor (multi-author), private by default; publish as Topic/Article (store + ArticleEditor + CollabEditor foundation, flag-gated; Wave 2 Beta + Wave 3)
    - **Civic Action Kit (Bridge)** ⚪ - UX: "make it real" without creepy automation
      - **Rep Contact Directory** ⚪ - UX: picks reps for your district; shows public email + phone
      - **Export/Share actions** ⚪ - UX: generate brief PDF; open mailto/tel/share-sheet; store a receipt locally

  - **Core domain objects (shared contracts devs should align on)** 🟡
    - **Identity (LUMA primitives)** 🟡/🔴 - Tech: gates everything valuable; UX: "verified humans count"
      - `trustScore: 0..1`, `scaledTrustScore: 0..10000`
      - `principalNullifier` (UniquenessNullifier) - invariant across civic signals + XP ledger + economic attestations
      - `ConstituencyProof { district_hash, nullifier, merkle_root }` - district attribution without doxxing
      - **Roles:** Guest (read-only) → Human (PoH) → Constituent (PoH + RegionProof)
    - **Unified Topic (the feed atom)** 🟡 - Tech: one topicId across analysis + thread + metrics; UX: one card type
      - `topicId` (deterministic)
      - `kind: NEWS_STORY | USER_TOPIC | SOCIAL_NOTIFICATION`
      - `categories[]` (interest tailoring + discovery)
      - `thread` (always present): Thread carries `{ topicId, isHeadline, sourceUrl?, urlHash? }` ✅
      - `synthesis` (latest): `{ schemaVersion:'topic-synthesis-v2', epoch, synthesisId }` ⚪
      - `metrics`: `{ eye, lightbulb, comments, hotness }` 🟡
    - **News story clustering (Aggregator → StoryBundle)** 🟡 - Tech: 1 story = many sources; UX: 1 headline in feed
      - RSS ingest → normalize → cluster → **StoryBundle** (sources + dedup)
      - `StorylineGroup` is separate from canonical event bundles and supports related-coverage grouping/navigation
      - Synthesis input is **all reporting** on the story (not a single URL)
      - Frames/counterframes come from bias/perspective patterns *across outlets* (plus thread digest)
    - **Topic Synthesis V2 (epochal + quorum)** ⚪/🟡 - UX: stable "versioned" updates, not constant churn
      - Inputs:
        - News: `StoryBundle` (+ optional `TopicDigest`)
        - User topic: `TopicSeed` + rolling `TopicDigest`
      - Per-epoch pipeline:
        - gather **N=5** candidate syntheses (verified submission gate)
        - candidates must critique/refine prior epoch ("accuracy mandate")
        - quorum synthesizer emits: `factsSummary`, `frames[]`, `warnings[]`, `divergenceMetrics`, `provenance`
        - deterministic selection so all peers show the same accepted synthesis
    - **Civic signals (Eye / Lightbulb / Sentiment)** 🟡 - UX: simple toggles, capped influence
      - **Civic Decay** ✅ - `next = current + 0.3*(1.95-current)` (monotonic; bounded [0,1.95], i.e. strict `< 2`)
      - **Eye** 🟡 - per-user/topic read interest ∈ [0,1.95] (`< 2`); updated on "full read"; aggregate shown in feed/dashboards
      - **Lightbulb** 🟡 - per-user/topic engagement ∈ [0,1.95] (`< 2`); updated on stance changes; aggregate shown in feed/dashboards
      - **Sentiment** 🟡 - tri-state per `(topic_id, point_id)` in `{+1,0,-1}`
      - **Privacy boundary** ✅:
        - event-level `SentimentSignal` is sensitive (device / encrypted channel only)
        - public surfaces show aggregates only (`AggregateSentiment`, district rollups)
        - never publish `{district_hash, nullifier}` pairs
    - **Forum (HERMES Forum)** 🟢 - UX: threaded discourse under every topic
      - Threads/comments are public objects; votes affect visibility (not identity)
      - Stance-aware threading (concur/counter/discuss) ✅/🟡
    - **Docs (HERMES Docs)** 🟡 - UX: longform + collaboration (CRDT/Yjs provider, E2EE key management, collab editor, presence, sharing, access control - all flag-gated)
      - Convert Reply → Article; articles can be co-authored privately then published
    - **Projects / Proposals (proposal-threads)** 🟡/⚪ - UX: "topics can become funded projects"
      - Thread has `proposal?: ProposalExtension { fundingRequest, recipient, status, qfProjectId?, ... }` 🟡
      - Season 0 public: off-chain simulated support; internal: curated on-chain QF rounds
    - **Elevation artifacts** ⚪ - UX: "press-ready" civic packet
      - `BriefDoc` (communications brief)
      - `ProposalScaffold` (project framing + funding request)
      - `TalkingPoints[]` (phone script bullets)
      - `Receipt` (what was sent, when, to whom - stored locally)

  - **Data topology & privacy (what lives where)** 🟡
    - **On device (authoritative)** ✅
      - Identity vault: encrypted IndexedDB `vh-vault` / `vault`
      - XP ledger + budgets (per nullifier)
      - Raw sentiment events + per-user stance state
      - Linked-social OAuth tokens + notification objects (sensitive)
      - Draft docs (private, E2EE)
    - **Mesh / Gun (public)** 🟡
      - Public topics + threads/comments
      - Public syntheses (V2) + public aggregates (no identity leakage)
    - **Mesh / Gun (encrypted channels)** 🟢/⚪
      - E2EE messaging
      - Optional encrypted outbox to a Guardian Node (sensitive replication)
    - **Chain (EVM contracts)** 🟡
      - RVU v0, UBE v0, Faucet (dev), QuadraticFunding, MedianOracle
      - Season 0: safe defaults; public UX stays "XP-first"
    - **Cloud blob store (MinIO/S3)** ⚪
      - Encrypted attachments >100KB (docs exports, media), referenced from mesh objects

  - **Engines & services (back-end / infra pieces)** 🟡
    - **News Aggregator Service** 🟢 - Tech: RSS ingest → normalize → cluster → StoryBundle; UX: "one story, many sources" (fully implemented Wave 1)
    - **Synthesis Engine (V2 quorum + epochs)** 🟡 - Tech: candidate gather + critique/refine + synthesize + deterministic accept (core wiring present; hardening/consistency work ongoing)
    - **AI Engine Router (model switching)** 🟡
      - Default (current live profile): **API relay-backed analysis** ✅
      - Local-first target: **WebLLM / LocalMlEngine** when local-agent capability thresholds are met 🟡
      - Optional: Remote providers (OpenAI/Google/Anthropic/xAI) ⚪ - requires explicit opt-in + cost/privacy disclosure
      - Optional: device-local model (if available) ⚪ - "free but inconsistent"
    - **Topic Digest Builder** ⚪ - Tech: rolling digest from comments for re-synthesis input
    - **Rep Directory / District mapper** ⚪ - Tech: map `district_hash → reps`; UX: "one-click email/call"
    - **Guardian Node (optional)** ⚪/🟡 - Tech: encrypted storage for sensitive outbox; optional aggregate compute; never receives plaintext identity
    - **Attestor Bridge** 🟡/⚪ - Tech: takes session proofs → registers participants for UBE/QF; Season 0 mostly stubbed

  - **Participation governors (anti-swarm)** ✅/🟡 - UX: rate limits feel fair; denial explains why
    - **Action budgets (per nullifier/day)** ✅ - posts, comments, votes, analyses, shares, moderation, civic actions
    - **Compute budget** 🟡 - analyses/day + per-topic cap
    - **Familiar inheritance** 🟡 - familiars consume principal budgets; never multiply influence

  - **Implementation reality check (what exists today vs target)** 🟡
    - **VENN analysis pipeline** 🟡 - end-to-end pipeline exists; current live profile defaults to API relay; local-first remains a target-state default pending capability thresholds
    - **News Aggregator / StoryCluster** 🟡 - daemon-first bundling is real; fixture-backed browser gates are green; public semantic soak is still smoke-only
    - **Discovery feed / storyline UX** 🟡 - storyline publication, ranking/diversification, focus state, archive presentation, and deep-link restoration are merged; browser/live evidence hardening remains active
    - **HERMES Messaging** 🟢 - E2EE working
    - **HERMES Forum** 🟢 - threads + votes working; unified topics fields landed (`topicId`, `sourceUrl`, `urlHash`, `isHeadline`)
    - **HERMES Docs** 🟡 — foundation + CollabEditor wired into ArticleEditor (flag-gated; Wave 2 Beta + Wave 3)  
    - **Bridge / Civic Action Kit** 🟡 — 5-component UI, trust/XP/budget enforcement, receipt-in-feed (Wave 2 Gamma + Wave 3 CAK)
    - **LUMA** 🟡 - Wave 4 hardened: trust constants consolidated, session lifecycle (expiry/revocation), constituency proof verification (flag-gated). TEE/VIO/sybil still stubbed (Season 0 §9.2 deferred)
    - **GWC contracts** 🟡 - contracts implemented; public testnet deploy incomplete; Season 0 UX should remain XP-first

  - **Legacy / migration (explicitly non-blocking but must be tracked)** 🟡
    - CanonicalAnalysisV1 exists in code/specs - **do not design new UX around it**; use V2 TopicSynthesis and treat V1 as compat/migration only
