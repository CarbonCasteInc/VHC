# Civic Sentiment and Engagement Spec

Version: 0.2
Status: Canonical (V2-first)

Normative contract for sentiment, Eye, and Lightbulb behavior in Season 0.

## 1. Core identifiers

- `topic_id`: `TopicId` for a topic object (`NEWS_STORY`, `USER_TOPIC`, or `SOCIAL_NOTIFICATION`)
- `synthesis_id`: ID of accepted `TopicSynthesisV2` artifact
- `epoch`: synthesis epoch number for the topic
- `point_id`: claim/frame row identifier within synthesis
- `agreement`: `-1 | 0 | 1`
- `weight`: per-user Lightbulb contribution in `[0,2]`

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
  weight: number; // [0,2]

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

Formula:

`E_new = E_current + 0.3 * (2.0 - E_current)`

Properties:

- monotonic increase per qualifying interaction
- bounded to `[0,2]`
- used for both Eye (reads) and Lightbulb (engagement) with separate state tracks

## 5. Eye and Lightbulb semantics

Eye:

- tracks read interest per `(topic_id, user)`
- increments on full read/expand events
- aggregate Eye is derived from per-user Eye values

Lightbulb:

- tracks engagement per `(topic_id, user)`
- driven by stance interactions
- first active stance sets baseline, further active stances decay toward 2.0

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
