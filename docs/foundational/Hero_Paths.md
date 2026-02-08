# E2E Hero Paths - Season 0 (V2-first)

Version: 0.3  
Status: Canonical storyboards for Season 0 implementation and testing

This document defines the core user loops and maps each loop to concrete contracts, trust gates, privacy boundaries, and test assertions.

References:

- `docs/foundational/TRINITY_Season0_SoT.md`
- `docs/foundational/System_Architecture.md`
- `docs/foundational/AI_ENGINE_CONTRACT.md`
- `docs/specs/topic-synthesis-v2.md`
- `docs/specs/spec-topic-discovery-ranking-v0.md`
- `docs/specs/spec-hermes-forum-v0.md`
- `docs/specs/spec-hermes-docs-v0.md`
- `docs/specs/spec-civic-action-kit-v0.md`
- `docs/specs/spec-civic-sentiment.md`
- `docs/specs/spec-data-topology-privacy-v0.md`

`CanonicalAnalysisV1` is legacy/compat only and is not the design target for these loops.

## 1. Hero Path A: Civic Dignity Loop

User sentence:

"I open one feed, understand a story from many sources, register my stance, and see district-level signal move without exposing who I am."

### 1.1 UX narrative (detailed)

1. I become a verified participant.

- I complete onboarding.
- I may complete proof-of-human and optionally constituency proof.
- I see role progression: Guest -> Human -> Constituent.
- If I link a familiar, it appears as a delegated assistant, not a separate identity.

2. I land on one unified feed.

- Feed includes three surfaces:
  - News story cards (clustered multi-source bundles)
  - Topic/thread cards (community-originated discussion)
  - Linked-social notification cards
- I can filter by `All`, `News`, `Topics`, `Social` and sort by `Latest`, `Hottest`, `My Activity`.

3. I open a topic and get stable synthesis + discussion.

- Topic detail renders one object with two lenses:
  - Synthesis panel (`TopicSynthesisV2`)
  - Thread lens (forum)
- Synthesis shows facts, frames/reframes, warnings, and epoch badge.
- I can inspect provenance and see when synthesis refreshed.

4. I express stance with bounded influence.

- For each point I select `+1`, `0`, or `-1`.
- Repeat taps toggle state; no multi-vote spamming.
- My per-topic engagement weight increases asymptotically and is capped.

5. I see district-level aggregates, not identities.

- Dashboard displays per-district aggregate trends.
- I never see per-user stance identity data.
- Public charts remain aggregate-only and cohort-safe.

6. I receive daily recognition.

- If eligible, I claim one daily boost.
- UX remains XP-first in Season 0.
- Advanced users can inspect wallet/claim details separately.

7. My familiar remains constrained.

- Familiar can suggest summaries or draft text.
- High-impact actions require explicit human confirmation.
- Familiar consumes my budgets; it does not mint extra influence.

### 1.2 Contract mapping

#### 1.2.1 Identity, trust, and constituency

```ts
interface PublishedIdentity {
  nullifier: string;
  trustScore: number; // 0..1
  scaledTrustScore: number; // 0..10000
}

interface ConstituencyProof {
  district_hash: string;
  nullifier: string;
  merkle_root: string;
}
```

Required gates:

- Write/vote in discourse requires `trustScore >= 0.5`.
- Higher-impact governance/forwarding requires `trustScore >= 0.7`.

#### 1.2.2 Topic and synthesis identity

```ts
type TopicId = string;

interface TopicRef {
  topic_id: TopicId;
  kind: 'NEWS_STORY' | 'USER_TOPIC' | 'SOCIAL_NOTIFICATION';
}

interface TopicSynthesisRef {
  topic_id: TopicId;
  synthesis_id: string;
  epoch: number;
}
```

Notes:

- News topics derive from clustered stories (`StoryBundle`).
- User topics and social notifications share the same TopicId abstraction.
- Legacy `analysis_id` is compatibility-only.

#### 1.2.3 Sentiment, Eye, and Lightbulb

```ts
interface SentimentSignal {
  topic_id: TopicId;
  synthesis_id: string;
  epoch: number;
  point_id: string;
  agreement: -1 | 0 | 1;
  weight: number; // [0, 2]
  constituency_proof: ConstituencyProof;
  emitted_at: number;
}
```

Civic Decay step:

```ts
next = current + 0.3 * (2 - current);
```

Invariants:

- monotonic and bounded in `[0, 2]`
- one qualifying interaction = one decay step
- event-level signals are sensitive and not public plaintext

#### 1.2.4 Synthesis refresh cadence

Defaults:

- early accuracy pass: first 5 verified opens can produce critique/refine candidates
- re-synthesis: every 10 verified comments with >=3 unique verified principals
- debounce: 30 minutes
- daily cap: 4/topic

### 1.3 E2E test outline (Civic Dignity)

1. Identity and role gates.

- create a mock identity
- assert guest cannot write/vote
- assert verified human can write/vote

2. Feed and story clustering.

- ingest multiple URLs into one story cluster
- assert one news card renders per cluster

3. Synthesis determinism.

- run candidate quorum path for same topic/epoch
- assert deterministic accepted synthesis

4. Tri-state stance behavior.

- toggle point `0 -> +1 -> 0 -> -1`
- assert expected state and weight changes

5. Aggregate privacy boundary.

- inspect public outputs for absence of nullifier + district pair
- assert only aggregate structures appear publicly

6. Daily boost gate.

- verify one claim/day policy
- verify trust threshold enforcement

## 2. Hero Path B: Reply-to-Article Loop

User sentence:

"I start with a quick thread reply and seamlessly escalate to longform when the idea needs space."

### 2.1 UX narrative (detailed)

1. I tap reply in thread context.

- Composer is bound to current `threadId` and `topicId`.
- Input counter shows 240-char max.

2. I exceed 240 chars.

- Send is blocked.
- I get a `Convert to Article` CTA.

3. I convert to article.

- A docs draft opens prefilled with my text.
- Draft carries source linkage (`topicId`, `threadId`, optional `parentPostId`).
- Draft is private-by-default and can be collaborative.

4. I publish article back to topic.

- Article appears in topic feed and forum surface.
- Comments/votes attach as normal discourse objects.
- Engagement can trigger nomination policy.

5. Familiar boundaries remain explicit.

- Familiar can propose edits and summarize comments.
- Familiar cannot publish article without explicit principal approval when configured for high-impact guardrails.

### 2.2 Contract mapping

```ts
interface ForumPost {
  id: string;
  threadId: string;
  topicId: string;
  type: 'reply' | 'article';
  content: string;
  articleRefId?: string;
  author: string;
  via?: 'human' | 'familiar';
  timestamp: number;
}

interface DocPublishLink {
  docId: string;
  topicId: string;
  threadId: string;
  articleId: string;
  publishedAt: number;
}
```

Rules:

- reply hard limit enforced at UI and schema boundaries
- article must reference a docs artifact
- published article must preserve topic linkage

### 2.3 E2E test outline (Reply-to-Article)

1. Reply hard cap enforcement.

- enter 241 chars
- assert send disabled and CTA visible

2. Conversion handoff.

- assert docs draft created with source linkage
- assert initial content copied correctly

3. Publish and feed/index update.

- publish draft
- assert article card appears in topic surface
- assert forum references `articleRefId`

4. Collaboration and offline behavior.

- edit draft offline, reconnect, and sync
- assert merged content deterministic

## 3. Hero Path C: Governance and Elevation Loop

User sentence:

"This topic matters, so we elevate it into concrete artifacts and forward a coherent packet to representatives."

### 3.1 UX narrative (detailed)

1. I nominate a source object.

- nomination target can be news, topic, or article
- client shows policy status (remaining threshold)

2. Threshold is crossed.

- system emits elevation job
- artifacts are generated:
  - BriefDoc
  - ProposalScaffold
  - TalkingPoints

3. I review and edit artifacts.

- packet preview in action center
- I can modify messaging before forwarding

4. I select representatives.

- rep list derives from my district proof
- available channels shown (email, phone, share, export, manual)

5. I initiate forwarding.

- I explicitly choose channel
- system opens native intent
- on completion/cancel, a local receipt is written

6. Public impact is aggregate-only.

- counter increments by representative
- no identity linkage leaks in public projections

### 3.2 Contract mapping

```ts
interface NominationEvent {
  id: string;
  topicId: string;
  sourceType: 'news' | 'topic' | 'article';
  sourceId: string;
  nominatorNullifier: string;
  createdAt: number;
}

interface ElevationArtifacts {
  briefDocId: string;
  proposalScaffoldId: string;
  talkingPointsId: string;
  sourceTopicId: string;
  sourceSynthesisId: string;
  sourceEpoch: number;
  generatedAt: number;
}

interface CivicAction {
  id: string;
  author: string;
  representativeId: string;
  intent: 'email' | 'phone' | 'share' | 'export' | 'manual';
  status: 'draft' | 'ready' | 'completed' | 'failed';
  sourceArtifactId: string;
  sourceTopicId: string;
  sourceSynthesisId: string;
}
```

Required gates:

- elevation finalize and forwarding require trust `>= 0.7`
- valid constituency proof required
- `civic_actions/day` budget enforced per principal

### 3.3 E2E test outline (Governance and Elevation)

1. Nomination threshold behavior.

- simulate multiple nominators
- assert elevation job only on policy satisfaction

2. Artifact generation integrity.

- assert all three artifacts generated
- assert references to `topicId/synthesisId/epoch`

3. Representative routing.

- lookup reps by `district_hash`
- assert matching district behavior

4. Delivery and receipts.

- trigger email/share/export flows
- assert local receipt for success/failure/cancel

5. Privacy boundary.

- assert public stats contain counts only
- assert no profile PII in public paths

## 4. Hero Path D: Linked-Social Notification Loop

User sentence:

"I can include social-platform alerts in the same civic feed and pivot quickly into deeper context."

### 4.1 UX narrative (detailed)

1. I connect social account with explicit consent.

- token scope and privacy boundary shown before connect
- user can revoke at any time

2. Notification card appears in unified feed.

- card includes platform badge and summary
- I can open for context or dismiss

3. Topic linkage remains consistent.

- notification maps to a `TopicId` of kind `SOCIAL_NOTIFICATION`
- can enter thread/synthesis context if linked

4. Sensitive data stays protected.

- OAuth tokens are vault-only
- public projections are sanitized and token-free

### 4.2 Contract mapping

```ts
interface SocialNotification {
  id: string;
  topicId: string;
  platform: string;
  summary: string;
  link?: string;
  createdAt: number;
}
```

Data policy:

- tokens and raw provider secrets are never public
- card projections must redact sensitive payload fields

### 4.3 E2E test outline (Linked-Social)

1. OAuth consent path shows explicit disclosure.
2. Tokens are persisted only in vault/local sensitive storage.
3. Social cards render in feed and filter correctly.
4. Public object audit confirms token-free projections.

## 5. Cross-Loop Invariants

1. One topic abstraction across all surfaces (`NEWS_STORY`, `USER_TOPIC`, `SOCIAL_NOTIFICATION`).
2. V2 synthesis linkage by `{topicId, synthesisId, epoch}`.
3. Event-level identity/sentiment/profile data is sensitive and not public plaintext.
4. Familiars act on behalf of principals and inherit principal budgets.
5. High-impact actions require explicit user approval and higher trust threshold.

## 6. Regression Checklist (Developer Use)

Use this checklist before considering a major feed/forum/docs/bridge refactor complete.

1. Feed still supports `All/News/Topics/Social` filtering and canonical sort modes.
2. Reply hard cap (`240`) still enforced and conversion path still reachable.
3. Article publication still links docs artifact and returns to topic/feed surfaces.
4. Nomination thresholding still deterministic under concurrent events.
5. Artifact generation still emits all required packet artifacts.
6. Forwarding remains user-initiated with local receipt semantics.
7. Public projections still pass privacy linting (no nullifier+district linkage).
8. Trust and budget gates still enforced for familiar and human actions.

## 7. Out of Scope for Season 0

- Autonomous submission to legislative web forms.
- Public exposure of per-user stance history.
- Familiar-owned independent influence lanes.
- Fully on-chain public governance for general users (remains curated/internal in Season 0).
