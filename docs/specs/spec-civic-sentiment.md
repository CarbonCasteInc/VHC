# Civic Sentiment and Engagement Spec

Version: 0.3
Status: Canonical (V2-first)

Normative contract for sentiment, Eye, and Lightbulb behavior in Season 0.

## 1. Core identifiers

- `topic_id`: `TopicId` for a topic object (`NEWS_STORY`, `USER_TOPIC`, or `SOCIAL_NOTIFICATION`)
- `synthesis_id`: ID of accepted `TopicSynthesisV2` artifact
- `epoch`: synthesis epoch number for the topic
- `point_id`: claim/frame row identifier within synthesis
- `agreement`: `-1 | 0 | 1`
- `weight`: per-user Lightbulb contribution in `[0,2)` (runtime cap: **1.95**)

Legacy note:

- `analysis_id` is deprecated for new write paths.
- Compatibility readers may map `analysis_id` to `synthesis_id` during migration.

## 2. Event-level contract (sensitive)

```ts
interface SentimentSignal {
  topic_id: string;
  synthesis_id: string;
  epoch: number;
  point_id: string;
  agreement: -1 | 0 | 1;
  weight: number; // [0,2) with runtime cap 1.95

  constituency_proof: {
    district_hash: string;
    nullifier: string;
    merkle_root: string;
  };

  emitted_at: number;
}
```

Rules:

1. One user has one final stance per `(topic_id, epoch, point_id)`.
2. `agreement = 0` is neutral and non-counting in point aggregates.
3. Familiars cannot add separate sentiment identities.
4. Event-level signals are sensitive and must remain local/encrypted.

## 3. Aggregate contract (public)

```ts
interface PointStats {
  agree: number;
  disagree: number;
}

interface AggregateSentiment {
  topic_id: string;
  synthesis_id: string;
  epoch: number;
  point_stats: Record<string, PointStats>;
  bias_vector: Record<string, -1 | 0 | 1>;
  lightbulb_weight: number;
  eye_weight: number;
  engagement_score?: number;
}
```

Aggregation requirements:

- only aggregate outputs are public
- no nullifiers in aggregate payloads
- district dashboards expose aggregate-only slices

## 4. Civic Decay

Formula (executive WS8 decision):

`E_cap = 1.95`

`E_new = E_current + 0.3 * (E_cap - E_current)`

Properties:

- monotonic increase per qualifying interaction
- bounded to `[0, 1.95]` (strictly `< 2`)
- used for both Eye (reads) and Lightbulb (engagement) with separate state tracks
- prevents single-user over-amplification by enforcing a hard per-topic impact ceiling

## 5. Eye and Lightbulb semantics

Eye:

- tracks read interest per `(topic_id, user)`
- increments on full read/expand events
- aggregate Eye is derived from per-user Eye values

Lightbulb:

- tracks engagement per `(topic_id, user)`
- driven by stance interactions
- first active stance sets baseline, further active stances decay toward 1.95
- vote impact uses active non-neutral stance count per `(topic_id, synthesis_id, epoch)` (not raw click count) to reduce toggle-gaming potential

## 6. Storage and topology

- `SentimentSignal` event-level records: local or encrypted outbox only
- public mesh: aggregate-only projections
- on-chain civic/economic contracts remain aggregate-only with no district-identity linkage

## 7. District dashboard privacy rule

District dashboards must remain aggregate-only:

- no per-user lines
- no joinable `{district_hash, nullifier}` pairs
- publish only when cohort thresholds are met

## 8. Testing invariants

1. Signal schema validation for every emitted event.
2. Decay monotonic/bounded tests for Eye and Lightbulb.
3. Toggle semantics tests (`+/-` and neutral reset).
4. Aggregate projection determinism tests by `(topic_id, synthesis_id, epoch)`.
5. Privacy tests: ensure district dashboard payloads are aggregate-only.

## 9. FPD production-wiring clarifications (2026-02-19)

These clarifications are binding for the active production-wiring program.

1. **Unified vote admission policy (required):** Feed and AnalysisView MUST enforce identical admission rules (verified proof, valid synthesis context, budget checks). No bypass write path is allowed.
2. **Canonical point identity migration (required):** If point identity root changes, implementations MUST use dual-write + backfill + compatibility-read during migration window.
3. **Legacy sunset (required):** Compatibility read paths must have explicit sunset criteria (time + release-count) and telemetry to prove safe removal.
4. **Aggregate visibility (required):** UI sentiment counters MUST read mesh aggregates (with resilience controls), not local-write-only projections.
5. **Telemetry (required):** Vote attempts, denials by reason, projection retries/failures, and migration mapping outcomes must be observable.
6. **Per-user anti-gaming cap (required):** Topic-level engagement impact must use diminishing returns with a strict cap below 2 (`E_cap = 1.95`).

## 10. Migration safety requirements

1. Migration must be idempotent.
2. Migration must emit mapped/unmapped/orphaned counters.
3. Production cutover requires explicit threshold criteria defined in dispatch/delta contracts.
4. Rollback must preserve vote-state readability for both roots until sunset is complete.

## 11. Mesh persistence closure clarifications (2026-02-21)

These constraints are binding for AC1-AC5 production-wiring closeout.

1. **Analysis write/read determinism:** Analysis persistence MUST write under canonical mesh key and support deterministic read-by-key reuse before any latest-pointer fallback.
2. **Non-silent write outcomes:** Sentiment and analysis mesh writes MUST emit terminal telemetry for success/failure/timeout paths (no silent-success ambiguity).
3. **Multi-user convergence contract:** Per-cell aggregate counters MUST converge from shared mesh state under multi-user voting and remain stable across reload.
4. **Shared artifact readability:** Persisted analysis artifacts MUST be reusable by independent clients viewing the same topic/synthesis context.
5. **UI responsiveness envelope:** Mesh persistence instrumentation must not block UI completion indefinitely; bounded timeout behavior is required with observable state.
