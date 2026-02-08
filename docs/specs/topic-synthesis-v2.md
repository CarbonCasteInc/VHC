# topic-synthesis-v2 Contract (Canonical)

Status: Canonical for Season 0 Ship Snapshot
Owner: VENN Engine / Data Model
References: `docs/foundational/System_Architecture.md`, `docs/foundational/TRINITY_Season0_SoT.md`

## 1. Goals

1. Canonicalize topic understanding from multi-source and discussion inputs.
2. Replace first-to-file URL ownership with quorum + epoch deterministic selection.
3. Preserve disagreements with explicit divergence metrics and warnings.
4. Keep artifacts identity-free on public paths.

## 2. Default parameters

- `quorumSize`: 5 candidates
- `candidateTimeoutMs`: `86_400_000` (24h)
- `epochDebounceMs`: `1_800_000` (30m)
- `dailyEpochCapPerTopic`: 4
- `resynthesisCommentThreshold`: 10 verified comments
- `resynthesisUniquePrincipalMin`: 3

## 3. Input contracts

```ts
type TopicId = string;

interface StoryBundleInput {
  story_id: string;
  topic_id: TopicId;
  sources: Array<{
    source_id: string;
    url: string;
    publisher: string;
    published_at: number;
    url_hash: string;
  }>;
  normalized_facts_text: string;
}

interface TopicDigestInput {
  digest_id: string;
  topic_id: TopicId;
  window_start: number;
  window_end: number;
  verified_comment_count: number;
  unique_verified_principals: number;
  key_claims: string[];
  salient_counterclaims: string[];
  representative_quotes: string[];
}

interface TopicSeedInput {
  seed_id: string;
  topic_id: TopicId;
  title: string;
  seed_text: string;
}
```

Rules:

- News topics require `StoryBundleInput`.
- User topics require `TopicSeedInput`.
- `TopicDigestInput` is optional at epoch 0 and expected on later epochs.

## 4. Candidate and synthesis types

```ts
interface CandidateSynthesis {
  candidate_id: string;
  topic_id: TopicId;
  epoch: number;
  based_on_prior_epoch?: number;
  critique_notes: string[];
  facts_summary: string;
  frames: Array<{ frame: string; reframe: string }>;
  warnings: string[];
  divergence_hints: string[];
  provider: {
    provider_id: string;
    model_id: string;
    kind: 'local' | 'remote';
  };
  created_at: number;
}

interface TopicSynthesisV2 {
  schemaVersion: 'topic-synthesis-v2';
  topic_id: TopicId;
  epoch: number;
  synthesis_id: string;
  inputs: {
    story_bundle_ids?: string[];
    topic_digest_ids?: string[];
    topic_seed_id?: string;
  };
  quorum: {
    required: number;
    received: number;
    reached_at: number;
    timed_out: boolean;
    selection_rule: 'deterministic';
  };
  facts_summary: string;
  frames: Array<{ frame: string; reframe: string }>;
  warnings: string[];
  divergence_metrics: {
    disagreement_score: number;   // [0,1]
    source_dispersion: number;    // [0,1]
    candidate_count: number;
  };
  provenance: {
    candidate_ids: string[];
    provider_mix: Array<{ provider_id: string; count: number }>;
  };
  created_at: number;
}
```

## 5. Epoch and quorum flow

### 5.1 Candidate gathering

- Collect candidates until `quorumSize` or timeout.
- Candidate submission requires verified principal context.
- Familiars may submit only on-behalf-of a verified principal and consume principal budgets.

### 5.2 Accuracy mandate

Each candidate must:

1. Re-read source inputs (`StoryBundle`/`TopicSeed` + optional `TopicDigest`)
2. Critique/refine prior epoch output when `epoch > 0`
3. Preserve disagreement when evidence is unresolved

### 5.3 Deterministic selection

Given same candidate set and input ordering, all peers must select the same synthesis.
Selection function must be deterministic and versioned.

### 5.4 Comment-driven re-synthesis

New epoch is eligible when both are true since last epoch:

- at least 10 new verified comments
- at least 3 unique verified principals

Plus scheduler guards:

- debounce 30 minutes
- max 4 epochs/day/topic

## 6. Storage conventions

Public mesh paths:

- `vh/topics/<topicId>/epochs/<epoch>/candidates/<candidateId>`
- `vh/topics/<topicId>/epochs/<epoch>/synthesis`
- `vh/topics/<topicId>/latest` (pointer)

Sensitive material (proofs, tokens, identity) is forbidden in these paths.

## 7. Invariants

1. `synthesis_id` uniquely identifies `{topic_id, epoch, content}`.
2. `provenance.candidate_ids.length === quorum.received`.
3. Public synthesis objects contain no `nullifier`, `district_hash`, or OAuth tokens.
4. `frames` may be empty only when warnings include explicit insufficiency reason.

## 8. Testing requirements

1. Candidate collection stop conditions (quorum vs timeout).
2. Deterministic selection reproducibility test.
3. Epoch trigger tests for comment/unique-principal thresholds.
4. Debounce and daily-cap enforcement tests.
5. Schema validation tests for synthesis and candidate payloads.
6. Privacy lint: forbidden sensitive fields in public synthesis paths.
