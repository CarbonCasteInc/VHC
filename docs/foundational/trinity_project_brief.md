# TRINITY - VH/LUMA/GWC Project Brief  
*A parallel operating system for identity, wealth, and governance in the post‑labour era.*

---

## 0. One‑paragraph summary

We’re building a **parallel civic-and-economic OS for the post‑labour world**: a news app that turns engagement into real political and economic weight, backed by a cryptographic identity and wealth layer that can eventually track global wealth and pay people for being thoughtful, creative humans.

---

## 1. The problem this aims at

### Two big fractures

1. **Labour is decoupling from value.**  
   AI is steadily eating cognitive work. The old deal—*“work for a wage, earn dignity”*—is breaking. If we don’t redesign how value flows, “human usefulness” becomes a rounding error in GDP.

2. **Reality itself is fracturing.**  
   News is polluted, feeds are optimized for rage, and we’re atomized into echo chambers. Democratic systems still pretend “the public” is a coherent, well‑informed actor. It isn’t.

### The core bet

- People still **need** challenge, contribution, and belonging.
- In a world where AI can do the work, the scarce thing is not labour, but **verified human intent**: what we care about, what we judge, what we choose to build together.
- It is possible to build an infrastructure where:
  - Information is cleaner,
  - Human sentiment is trustworthy,
  - And value flows to people for contributing ideas, coordination, and culture.

---

## 2. The architecture in one diagram (in words)

The system operates three tightly‑coupled layers:

1. **LUMA – Identity / “Proof of Human”**  
   - Hardware‑attested identity (device secure enclave + biometrics / liveness).  
   - One real human → one **nullifier** (stable per-human key, reused everywhere).  
   - Outputs a **trustScore** (0..1) and a **scaledTrustScore** (0..10000) for gating actions (sessions, UBE, QF), with a metadata-minimizing, local-first architecture: sensitive identity and constituency data stays on-device; only aggregated or encrypted signals ever leave.  
   - Optional region proof → the person becomes a **constituent** in a district, without doxxing their address.

2. **GWC – Global Wealth Chain (Economics)**  
   - **RVU** (Real Value Unit): the v0 token on an EVM chain, the proto‑version of the future **GWU** that aims to track global wealth.  
   - **UBE** (Universal Basic Equity): a daily drip of RVU for attested humans (trust‑gated basic income).  
   - **Quadratic Funding (QF):** an on‑chain engine to route RVU toward public and community projects, amplifying widely supported ideas.  
   - **Median Oracle:** a commit‑reveal oracle that will eventually be used to tie GWU to a real‑world wealth index (RGU‑Real).

3. **VENN – Interface / Civic Layer**  
   - A local‑first “super app” that:
     - Shows a **Topics stream** (external headlines + user threads),  
     - Generates or fetches **canonical analyses** for articles,  
     - Lets users vote on biases and counterpoints,  
     - Hosts discussions and proposals,  
     - Unifies headlines and threads into a single Topic object (analysis + discussion in one place),  
     - Exposes a **control panel** for score/wallet and district‑level metrics,  
     - Includes a **Familiar Control Panel** (in Messaging) to manage delegated agents.

A useful mental model:

> LUMA = the immune system,  
> GWC = the circulatory system,  
> VENN = the nervous system.

---

## 3. Season 0 product: what users actually experience

In **Season 0**, the app is deliberately framed as a **news & participation app with points**, not as a “crypto wallet”.

### 3.1 The Civic Dignity Loop (news → influence → reward)

1. **Onboard & prove “humanness”**  
   - The user creates an identity.  
   - Behind the scenes, LUMA/attestors give them:
     - A **trust score** (0..1) and **scaledTrustScore** (0..10000),  
     - A unique **nullifier** (one per human, reused in VENN, GWC, and constituency proofs),  
   - Optional region proof → they become a constituent of district X.
   - Optional: configure a **familiar** (delegated agent) to draft/triage; it acts on the user’s behalf, consumes the user’s budgets, and never multiplies influence.

2. **Scroll a clean Topics stream**  
   - The stream is a list of **Topics** (external headlines + user threads), not just clickbait headlines.  
   - Each card has:
     - Headline,  
     - Source,  
     - Two metrics:
       - an **Eye** (how many humans have really read this),  
       - a **Lightbulb** (how much engagement/judgement it has attracted).

3. **Open canonical analysis instead of raw article**  
   - Tapping a headline opens a **canonical analysis**, not the original site.  
   - The view shows:
     - A **summary** that strips down to verifiable facts,  
     - A **bias / counterpoint table**:
       - Each row is a *perspective* → frame + reframe,  
       - Each cell has its own **+ / –** buttons.
   - **Early‑open accuracy:** the first **N** verified opens (default 5) each produce a candidate analysis that re‑reads the source and **critiques/refines** prior summaries/tables for maximum accuracy.
   - **Ongoing refresh:** after every **N verified comments** (default 10, min 3 unique principals), the synthesis is refreshed so the summary and frames evolve with the discussion.

4. **Cast nuanced sentiment**  
   - For each bias or counterpoint, the user can:
     - Agree (+1),  
     - Disagree (‑1),  
     - Or stay neutral (0).  
   - It’s a tri‑state toggle (no spamming multiple votes).  
   - Under the hood:
     - Each cell has its own +/-; clicking the same stance again clears it,  
     - The first active stance on a topic sets Lightbulb to `1.0`; additional active stances decay toward `2.0`,  
     - Removing stances steps the engagement back (all neutral → `0`),  
     - Per‑user, per‑article engagement is capped, so no one can dominate metrics.

5. **See their voice in a constituent dashboard**  
   - A dashboard shows:
     - How **their district** feels about key frames,  
     - How that compares to global sentiment,  
     - Which topics are “hot” where they live.  
   - Anonymous guests see charts, but **only verified humans** move the canonical metrics.

6. **Get a daily “boost”**  
   - Once per day, an attested human can claim a **Daily Boost** (backed by UBE).  
   - Their visible **score** (XP) ticks up.  
   - Under the hood, that claim can also mint testnet **RVU** to their wallet. Only verified humans above threshold trustScore can claim or vote (QF).

The loop feels like:

> “I see the world more clearly, my judgement affects real metrics for my district, and the system acknowledges my presence and effort.”

### 3.2 The Governance Loop (idea → proposal → support)

For Season 0, the governance loop is **soft‑launched**, with hard economics incubating underneath.

1. **Start from a topic**  
   - On a topic page (e.g. public transit), there is a **“Related Proposals”** section:
     - “Community‑owned EV charging,”  
     - “Civic data trust,” etc.

2. **Explore proposals**  
   - A proposal card shows:
     - Title & summary,  
     - Requested budget (in RVU units),  
     - Recipient address,  
     - Current support (For/Against).
   - **Unified model:** proposals are elevated threads (proposal‑threads) within the Topic, not separate objects.

3. **Support with “weight”**  
   - The user chooses an amount (in RVU units) to back it with.  
   - The UI shows **voice credits = amount²** (quadratic feel).  
   - In Season 0:
     - For general users: this is tracked in an **off‑chain QF simulation** (and in XP),  
     - For testers: it can be wired directly to the **QuadraticFunding** contract on testnet.

4. **See hypothetical funding outcomes**  
   - The user sees:
     - “Your support: X”,  
     - “Total support: Σ”,  
     - “Estimated match: Z if this proposal were in a QF round with pool P”.

This establishes the mental model:

> “My engagement and earned weight don’t just stay as stats—they can be pointed at proposals and amplified into actual project funding.”

---

## 4. XP, RVU, and “when does this become money?”

### 4.1 XP now, RVU later (by design)

Right now:

- Users see **XP** / a “score”.  
- Under the hood, the system maintains a multi‑track ledger per human (keyed by nullifier):

  - `civicXP` – news & bias voting, civic actions, sentiment,  
  - `socialXP` – discussions, contributions in HERMES,  
  - `projectXP` – concrete proposal/project work.

XP is the **canonical record** of a human’s contribution in Season 0.

RVU exists on‑chain, but:

- Primarily for:
  - UBE pilot,  
  - Faucet (dev/onboarding),  
  - Quadratic Funding test rounds.  
- It is not yet surfaced as “money” to the broad user base.
- Season 0 RVU is an inflationary proto-asset (no index logic) minted via bootstrap, UBE, and Faucet; GWU mechanics come later.

### 4.2 Future: Global Wealth Unit (GWU) and REL

The long‑term GWC roadmap includes:

- **GWU (Global Wealth Unit)**  
  - An index‑tracking asset that aims to mirror a regulated benchmark of global wealth (RGU‑Real), not a fiat peg.  
  - Supply/price governed via:
    - Primary issuance auctions,  
    - Arbitrage vaults,  
    - Bounded open market operations.  
  - Legally positioned as a **benchmark‑referencing crypto asset**, not a classic “stablecoin”.

- **REL (Resource Exchange Layer)**  
  - A marketplace where **verified human intent** (Attention Units) is converted into:
    - Fee credits,  
    - Compute credits,  
    - And ultimately GWU/RVU flow, funded by AI labs and other buyers of high‑quality human signal.

Season 0 is about **building the rails and habits**: clean analyses, reliable sentiment, real humans. Once those are hardened and compliant, XP can be mapped into a proper RVU/GWU position and the “XP is just a number” phase naturally evolves into “this is your share of the system”.

---

## 5. Economic layer v0: what is already real

Under the hood, the contracts are concrete:

- **RVU (Real Value Unit)**  
  - ERC‑20 with role‑gated minters/burners.  
  - Currently **inflationary**, via:
    - Bootstrap mint,  
    - UBE drip,  
    - Faucet for dev/test.  
  - QF uses RVU for contributions and matching pools.

- **UBE (Universal Basic Equity)**  
  - Attestor‑managed per‑identity record:
    - `trustScore`, `expiresAt`, `nullifier`, `lastClaimAt`.  
  - `claim()`:
    - Enforces trust + expiry + cooldown,  
    - Mints a fixed RVU amount per interval.  
  - In the app, this is surfaced as a “Daily Boost” to XP.

- **Faucet**  
  - Similar pattern to UBE, used for onboarding and dev/testing.

- **QuadraticFunding**  
  - Attested participants (trust threshold),  
  - Projects registered by admin/curators,  
  - Voting in RVU with quadratic aggregation,  
  - Matching pool and withdrawals.  
  - Season 0: on-chain rounds are curated/internal; public proposal UI uses local-only voting to test UX before wiring real RVU.

**Privacy stance:** Canonical analyses and aggregate sentiment are public; per-user sentiment, region proofs, and wallet/identity mappings are treated as sensitive and never written to public meshes or chains.

- **MedianOracle**  
  - Commit–reveal median price oracle, ready to feed into future GWU index logic, not yet wired into RVU directly.

Season 0 provides a **live testbed** for economic research and engineering:
- Real humans,  
- Real engagement data,  
- Real contract flows in a controlled setting,  
- With the safety of “XP now, money later” for general users.

---

## 6. Who this is for and why it matters

### 6.1 For developers

- This is not “just another wallet” or “just another feed”: it is an **OS for a parallel institution**.  
- Key ingredients:
  - Local‑first, mesh‑synced app (React + P2P storage + Edge AI),  
  - EVM contracts (RVU, UBE, Faucet, QF, MedianOracle),  
  - Hardware‑attested identity with clear Guest vs Human vs Constituent semantics.  
- Engineering discipline:
  - Strong modularization and test coverage,  
  - “Physics is trust, math is law” as an actual design constraint.

### 6.2 For investors & partners

- The **economic engine** targets the post‑labour world:
  - Long‑term store of value not tied to a single fiat,  
  - Revenue from AI labs and other buyers of clean human signal (via REL),  
  - A built‑in **distribution mechanism** (UBE + QF) that routes value to humans who maintain the informational and civic commons.  

- Season 0–2 are:
  - **Low‑regret** (XP framing, testnets),  
  - **High‑leverage** (identity, analysis, and governance rails ready for scale).

### 6.3 For politicians & public officials

- The platform gives representatives a **real‑time, verifiable pulse** on their constituents:
  - Sentiment is:
    - **Per‑district**, not just “the internet thinks…”,  
    - **Human‑gated** (Proof of Human),  
    - **Frame‑aware** (e.g. “how many people agree with *this* framing vs *that* reframe”).  
- Instead of occasional, expensive polling, they can see:
  - Which topics are most salient in their district,  
  - How opinion breaks down across competing narratives,  
  - How proposals and projects are gaining or losing support over time.  

- Because identity is privacy‑preserving and attested, officials get:
  - Signals they can trust more than anonymous social media noise,  
  - A channel for **sending targeted questions** (“what do you think about option A vs B?”) and reading structured responses,  
  - A way to discover and support **bottom‑up proposals** that already have demonstrated backing from their actual constituents.

In short, it is a tool for moving from noisy outrage to **structured, district‑level input** that can plug directly into legislative and budget decisions.

### 6.4 For journalists & researchers

- A live testbed for:
  - **Bias-aware, multi‑perspective news consumption**,  
  - **Constituency‑aware sentiment tracking**,  
  - **Governance experiments** (QF, PoH‑gated polling, later MACI) in the wild.  

- It enables empirical study of:
  - How verified humans actually reason and coordinate in the presence of AI,  
  - How alternative wealth and governance mechanisms might stabilize a turbulent information ecosystem.

### 6.5 For the general public

- Right now:
  - A cleaner, less manipulative way to read the news,  
  - A way to see “all the frames at once” instead of falling into one echo chamber,  
  - A feeling that “my input shows up somewhere real,” not just in a comment abyss.

- Over time:
  - A place where:
    - Curiosity,  
    - Ideas,  
    - Cultural work,  
    - Civic projects  
    actually move resources, not just feed ad networks.

---

## 7. One‑line summary

This project quietly wires together a verified‑identity news app, a dignity‑first economic layer, and a governance engine so that when AI has eaten most “jobs”, humans still have a clear way to see reality, express will, and receive a fair, measurable share of the wealth their collective intent creates.
