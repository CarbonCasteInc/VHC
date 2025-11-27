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

- Civic:
  - First Lightbulb interaction on a topic (+x civicXP).
  - Subsequent engagements (diminishing increments).
  - Full read sequences / Eye interactions (+z civicXP).
- Project/Governance:
  - Proposal support vote (+u projectXP).
  - Authored proposals crossing support thresholds (+v projectXP).
- Social (later):
  - High-signal messaging/HERMES contributions (+w socialXP).
- Economic:
  - UBE claim (“Daily Boost”) (+civicXP or +projectXP, configurable).

Exact coefficients are configurable; the ledger tracks the resulting monotonic totals.

## 4. Privacy & Topology

- XP ledger is **sensitive**:
  - Stored on-device per nullifier.
  - Optional encrypted replication to a Guardian node / trusted aggregator.
  - Never publish `{ district_hash, nullifier, XP }` together.
- Public exposure:
  - Only safe aggregates (e.g., district-level averages) with cohort thresholds (see `spec-data-topology-privacy-v0.md`).
- No on-chain storage in Season 0.

## 5. Integration Map

- `useIdentity`: provides `nullifier` as the XP key.
- `useXpLedger` (Season 0): maintains `XpLedger` locally; applies emission rules on qualified events.
- Dashboards: may show totalXP and track breakdowns per user (local), and safe aggregates (district averages) when cohort rules are met.
- Future GWC: can read XP (or recompute from event history) to seed participation weights for RVU/GWU distributions.

## 6. Test Invariants

- XP updates are monotonic and per-nullifier.
- `totalXP` recomputes deterministically from track values.
- Emission rules are deterministic for given events (tests cover first vs subsequent interactions).
- No public data structure combines `{ district_hash, nullifier, XP }`.
- Optional: cohort-threshold tests for aggregate exposure.
