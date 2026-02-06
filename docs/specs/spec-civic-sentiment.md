# Civic Sentiment & Engagement Spec

Version: 0.1  
Status: Canonical for Sprints 2–3

This document is the normative contract for engagement and sentiment across client, mesh, and chain. All implementations must conform to the types, formulas, and invariants defined here.

## 1. Domain Concepts

- `topic_id` – stable topic key (urlHash for URL topics; deterministic thread-derived hash for native threads).
- `analysis_id` – stable ID/hash of the canonical analysis object.
- `point_id` – ID for a bias/counterpoint/perspective cell.
- `user_id` / `nullifier` – identity linkage via LUMA.
- `weight` – per-user-per-topic Lightbulb engagement weight in `[0, 2]`.
- `agreement` – per `(topic_id, point_id)` stance in `{-1, 0, +1}`.
- `UniquenessNullifier` – stable, pseudonymous human key from LUMA.
- `district_hash` – hash of a region code (e.g., US-CA-12), used for constituency aggregation.
- `ConstituencyProof` – `{ district_hash, nullifier, merkle_root }` derived from RegionProof public signals.

## 2. Event-Level Contract: SentimentSignal

```ts
// One user, one point, one interaction
interface SentimentSignal {
  topic_id: string;       // Stable topic key (urlHash or thread-derived)
  analysis_id: string;    // Hash of the Canonical Analysis Object
  point_id: string;       // ID of the bias/counterpoint/perspective
  agreement: 1 | 0 | -1;  // 3-state Agree / None / Disagree
  weight: number;         // User’s per-topic Lightbulb (engagement), in [0, 2]

  constituency_proof: {
    district_hash: string;
    nullifier: string;     // UniquenessNullifier or its hash
    merkle_root: string;
  };

  emitted_at: number;     // Unix timestamp
}
```

`weight` is the user’s engagement Lightbulb for this topic (from table interactions), not their read score; Eye is derived separately from per-topic read events. Per cell the UI uses `+` / `-` toggles with neutral implicit; clicking the same stance again clears it. `constituency_proof` is derived from a RegionProof as defined in `spec-identity-trust-constituency.md`.

Invariants:

- `0 ≤ weight ≤ 2`.
- For any topic and user, `weight` is updated only via the Civic Decay function on engagement interactions.
- `agreement` is a 3-state toggle; there is no partial sentiment.
- `constituency_proof.nullifier` equals the user’s identity nullifier.
- `district_hash` MUST come from a valid RegionProof (or dev stub shape).
- Sentiment is per **principal nullifier** only; familiars cannot create additional voters or weight.
- Optional local-only debug metadata (e.g., `emitted_via_familiar_id`) MAY exist in memory but MUST NOT be published to mesh or chain.

Emission rules:

- Emit on any change to `agreement` for a `(topic_id, point_id)`.
- Emit when constituency proof changes for the user to preserve rollup integrity.
- `constituency_proof` is derived from a RegionProof as defined in `spec-identity-trust-constituency.md` (dev stub allowed; field shape must match).

## 3. Aggregate Contract: AggregateSentiment

```ts
interface PointStats {
  agree: number;
  disagree: number;
}

interface AggregateSentiment {
  topic_id: string;
  analysis_id: string;

  // Per point: committed votes only (neutral not counted)
  point_stats: Record<string, PointStats>;

  // Optional convenience: dominant stance per point based on point_stats
  bias_vector: Record<string, 1 | 0 | -1>;

  // Global engagement signal (function of all user weights)
  weight: number;          // Aggregate Lightbulb (sum)
  engagementScore: number; // Optional metric (entropy/variance) to show spread
}
```

Computation guidelines:

- `point_stats` are unweighted counts of final `agreement = +1` (agree) and `agreement = -1` (disagree); neutral (`0`) is not counted.
- `bias_vector` is derived from `point_stats` (e.g., sign of `agree - disagree`) or stored distribution.
- Aggregate Lightbulb should be deterministic (e.g., sum of weights or averaged per unique user) and documented in the consuming service; each user’s contribution is capped at `2`.

## 4. Civic Decay

Formula: `E_new = E_current + 0.3 * (2.0 - E_current)`.

Pseudocode:

```ts
export function calculateDecay(current: number): number {
  return current + 0.3 * (2.0 - current);
}

export function applyDecay(current: number): number {
  return Math.min(2, Math.max(0, calculateDecay(current)));
}
```

Example progression (starting at `0.0`): `0.0 → 0.6 → 1.02 → 1.314 → 1.5198 → 1.6639 → …` approaching `2.0`.

Invariants:

- Monotonic increase per step; cannot exceed `2.0`.
- Idempotent per interaction: one qualifying interaction = one decay step.
- Only this function may update `weight`.
- For Eye: each read (expanding an analysis) applies one decay step to `eye_weight(topic, user)`.
- For Lightbulb: each engagement interaction (stance change, feedback) applies one decay step to `lightbulb_weight(topic, user)` and drives `SentimentSignal.weight`. Lightbulb is derived from the number of active stances on the topic: first active stance sets weight to `1.0`, each additional active stance applies the decay step toward `2.0`; clearing stances decrements accordingly (all neutral → `0`).

## 5. Lifecycle & Storage

- **Client state:** `useSentimentState` stores `agreement` per `(topic_id, point_id)`; `useEngagementState` stores per-topic engagement `weight`; `useReadTracker` (or `useReadState`) stores per-topic `eye_weight` applying decay on each expand/read.
- **Types:** `packages/types` exports `SentimentSignal` and `AggregateSentiment`.
- **Schemas:** `packages/data-model` hosts `SentimentSignalSchema` and `AggregateSentimentSchema` (Zod) mirroring the above.
- **Engine:** `packages/ai-engine/src/decay.ts` implements `calculateDecay` / `applyDecay` using this spec.
- **Persistence:** Local store → Gun mesh → chain/ledger projections consume the same validated events.

## 6. Test Invariants

- All emitted events validate via `SentimentSignalSchema.parse`.
- Civic Decay tests prove monotonic, bounded progression and clamp behavior at 0 and 2.
- Eye read scores use the decay function: repeated reads yield monotonic increase in `eye_weight(topic, user)`, bounded in `[0, 2]`.
- Neutral (`agreement = 0`) is tracked per user but never appears in `point_stats`.
- Lightbulb uses the decay output on engagement interactions only.
- UI tests enforce 3-state sentiment toggles and persistence across reloads.
- Integration tests round-trip: UI interaction → `SentimentSignal` → `AggregateSentiment` projection with deterministic results.

## 7. Eye (Read Interest) Semantics

- For each `(topic_id, user)` track a per-topic read score `eye_weight ∈ [0, 2]`.
- On each full read/expand of the analysis, apply `calculateDecay`/`applyDecay` to update `eye_weight`.
- Aggregated Eye for a topic is a deterministic function of all `eye_weight` values (sum). An optional secondary metric is the count of users with `eye_weight > 0`.
- Eye reflects reading interest, including repeat visits; it does not use `SentimentSignal` and does not affect Lightbulb `weight`.

## 8. Privacy & Topology

Event-level `SentimentSignal` objects are **sensitive**:

- They bind `agreement` and `weight` to a `constituency_proof` (district_hash + nullifier).
- They MUST NOT be stored in plaintext on the public mesh or chain.
- They SHOULD remain on-device or be sent via encrypted outbox to a trusted aggregator (e.g., Guardian Node).

Public-facing and mesh-replicated data must use **AggregateSentiment** and similar aggregate structures only:

- No per-user nullifiers.
- No raw `RegionProof` or `ConstituencyProof`.
- `district_hash` appears only in per-district aggregates, never joined with individual identifiers.

On-chain contracts (UBE, Faucet, QF) remain region-agnostic; they do not consume `district_hash` or per-user sentiment. See `docs/specs/spec-data-topology-privacy-v0.md` for placement rules.
