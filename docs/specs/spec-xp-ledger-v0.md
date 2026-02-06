# XP Ledger v0 – Participation Weight Spec

Version: 0.1  
Status: Canonical for Sprints 2–3

XP is the per-human (per `UniquenessNullifier`) participation weight ledger for Season 0. It is non-transferable, monotonic, and partitions contribution into stable tracks that future GWC value distribution can consume.

## 1. Ledger Shape

```ts
interface XpLedger {
  nullifier: string;   // human key (UniquenessNullifier)
  civicXP: number;     // news, sentiment, Eye/Lightbulb interactions
  socialXP: number;    // messaging / HERMES (future)
  projectXP: number;   // proposals, governance, QF-ish actions
  totalXP: number;     // derived: f(civicXP, socialXP, projectXP)
  lastUpdated: number; // unix timestamp (ms)
}
```

- `totalXP` is a deterministic function, e.g., weighted sum: `totalXP = a*civicXP + b*socialXP + c*projectXP` (coefficients configurable; ledger shape is stable).
- Invariants: per-nullifier, non-transferable, monotonic (no negative XP), tracks are stable even if emission coefficients change over time.

## 2. Distribution Model (Future Use)

XP prototypes the participation weight GWC will later use for allocations:

```
share_i = totalXP_i^γ / Σ_j totalXP_j^γ
RVU_i   = α * pool * share_i
```

Where `γ` (concavity) and `α` (pool fraction) are policy variables. Changing coefficients affects future accrual only; historic XP is not retro-edited.

## 3. Emission (Season 0 Candidates)

**Canonical Emission Policy:** See `docs/sprints/03-sprint-3-the-agora.md` §3.4 for the definitive Season 0 emission rules for Messaging, Forum, and Project XP. The section below provides a high-level summary.

**Summary by Track:**

- **Civic (`civicXP`):**
  - First Lightbulb interaction on a topic (+x civicXP).
  - Subsequent engagements (diminishing increments).
  - Full read sequences / Eye interactions (+z civicXP).
  - Forum thread creation (+2), substantive comments (+1), quality bonuses (+1/+2 on score thresholds).
  - Daily cap: +15/day.
- **Social (`socialXP`):**
  - First contact bonus (+2 per new DM contact).
  - Sustained conversation bonus (+1 per qualifying 48h window).
  - Daily cap: +5/day.
- **Project (`projectXP`):**
  - Project/Proposal thread creation (+2).
  - Milestone updates (+1 per update).
  - Quality-confirmed collaborator contributions (+1 per qualifying comment).
  - Outcome bonus (+5 for funded/selected projects, curator-driven).
  - Weekly cap: +20/week.
- **Economic:**
  - UBE claim ("Daily Boost") (+civicXP or +projectXP, configurable).

Exact coefficients are configurable; the ledger tracks the resulting monotonic totals.

## 4. Action & Compute Budgets (Per Nullifier)

To prevent agent swarms, each principal nullifier maintains local-first budgets. Agent-triggered actions consume the same budgets as human actions.

**Required counters (Season 0 defaults):**
- `posts/day`: 20
- `comments/day`: 50
- `sentiment_votes/day`: 200
- `governance_votes/day`: 20
- `moderation/day`: 10
- `analyses/day`: 25 (max 5 per topic)
- `civic_actions/day`: 3 (report generation / send)
- `shares/day`: 10

Elevation of a thread to a proposal consumes the `governance_votes/day` budget (governance action).

`analyses/day` applies to candidate submissions (v2) and canonical writes (v1/v2). Budgets are enforced locally and MAY be mirrored to an encrypted outbox for audits. They are not public and never increase influence.

## 5. Privacy & Topology

- XP ledger is **sensitive**:
  - Stored on-device per nullifier.
  - Optional encrypted replication to a Guardian node / trusted aggregator.
  - Never publish `{ district_hash, nullifier, XP }` together.
- Public exposure:
  - Only safe aggregates (e.g., district-level averages) with cohort thresholds (see `docs/specs/spec-data-topology-privacy-v0.md`).
- No on-chain storage in Season 0.

## 6. Integration Map

- `useIdentity`: provides `nullifier` as the XP key.
- `useXpLedger` (Season 0): maintains `XpLedger` locally; applies emission rules on qualified events.
- `useChatStore` / `useForumStore`: emit XP events to `useXpLedger` on qualifying actions (see `docs/sprints/03-sprint-3-the-agora.md` §3.4.6 for wiring details).
- Dashboards: may show totalXP and track breakdowns per user (local), and safe aggregates (district averages) when cohort rules are met.
- Future GWC: can read XP (or recompute from event history) to seed participation weights for RVU/GWU distributions.

**Cross-Reference:** The canonical Season 0 emission policy for HERMES Messaging, HERMES Forum, and Project XP is defined in `docs/sprints/03-sprint-3-the-agora.md` §3.4. That section specifies exact amounts, caps, windows, and quality thresholds.

## 7. Test Invariants

- XP updates are monotonic and per-nullifier.
- `totalXP` recomputes deterministically from track values.
- Emission rules are deterministic for given events (tests cover first vs subsequent interactions).
- No public data structure combines `{ district_hash, nullifier, XP }`.
- Optional: cohort-threshold tests for aggregate exposure.
