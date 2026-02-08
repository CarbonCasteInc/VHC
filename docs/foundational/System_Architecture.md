# BIO-EC OS: Target Architecture

Codename: TRINITY (VENN/HERMES x LUMA x GWC)  
Version: 0.4.0 (Season 0 Ship Snapshot, V2-first)  
Status: Approved target architecture

This document defines target architecture contracts and defaults for Season 0.
For implementation truth and drift notes, use `docs/foundational/STATUS.md`.

## 1. Mission and Prime Directives

TRINITY is a local-first civic and economic operating system built around:

1. LUMA (identity and trust)
2. GWC (economics and governance rails)
3. VENN/HERMES (information, discourse, docs, and civic action)

Prime directives:

1. Local is Truth: identity and sensitive civic state stay on-device.
2. Physics is Trust: attestation-backed identity, not account-credential trust.
3. Math is Law: deterministic policies, bounded participation, anti-collusion rails.
4. Shared Reality: Topic Synthesis V2 is selected deterministically per epoch.
5. Civic Facilitation: forwarding is user-initiated; no default dark automation.
6. Human Sovereignty: familiars are delegated processes of a principal human.
7. Strict Discipline: modularity caps (350 LOC) and full coverage gates apply.

## 2. Layered Architecture

### 2.1 Layer 0: Physics (Root)

Role:

- hardware root of trust and attestation substrate

Functions:

- key material rooted in secure hardware
- anti-emulation and integrity signals

### 2.2 Layer 1: Identity (LUMA)

Role:

- trust scoring
- nullifier continuity
- constituency proof path

Functions:

- identity session establishment
- role gating (Guest/Human/Constituent)
- delegation grants and on-behalf assertions

### 2.3 Layer 2: Economics (GWC)

Role:

- economic and governance rails

Functions:

- RVU token plumbing
- UBE daily claim path
- QF contract flows (curated/internal in Season 0)
- oracle and future wealth-index progression

### 2.4 Layer 3: Application (VENN/HERMES)

Role:

- user-facing information, discourse, docs, and civic action surfaces

Functions:

- unified feed and topic detail
- forum and docs publishing
- nomination/elevation and forwarding flows

## 3. Product Surfaces (Season 0)

### 3.1 Unified feed

Feed contains three surfaces:

1. News (clustered stories)
2. Topics (user-born/evolving discussions)
3. Linked-social notifications

Feed controls:

- filters: `All`, `News`, `Topics`, `Social`
- sort modes: `Latest`, `Hottest`, `My Activity`

### 3.2 Topic detail (single object, two lenses)

Topic detail always presents:

1. Synthesis panel (`TopicSynthesisV2`)
2. Thread lens (forum)

Forum interaction defaults:

- reply hard limit 240 chars
- overflow path `Convert to Article`
- article publishing is docs-backed and topic-linked

### 3.3 Action surface

High-salience topics can progress through:

- nomination events
- elevation artifacts (`BriefDoc`, `ProposalScaffold`, `TalkingPoints`)
- representative forwarding (email/phone/share/export/manual)

## 4. Canonical Information Path (V2-first)

### 4.1 Legacy boundary

`CanonicalAnalysisV1` is legacy/compatibility-only.
New systems should not treat V1 as canonical.

### 4.2 Canonical path

1. News Aggregator ingests and clusters sources into `StoryBundle`.
2. Topic Digest Builder creates rolling digest from verified discourse.
3. Topic Synthesis V2 runs per epoch from candidate set.
4. Deterministic selection publishes accepted synthesis for the epoch.

### 4.3 Shared reality semantics

- key shape: `{topic_id, epoch}` plus accepted `synthesis_id`
- deterministic candidate ordering and acceptance
- all peers resolve the same accepted synthesis for the same epoch inputs

## 5. Core Domain Contracts

### 5.1 Topic identity

```ts
type TopicId = string;

interface TopicRef {
  topic_id: TopicId;
  kind: 'NEWS_STORY' | 'USER_TOPIC' | 'SOCIAL_NOTIFICATION';
}
```

Notes:

- `topic_id` is not globally equivalent to URL hash.
- URL hashes may contribute to `NEWS_STORY` derivation.

### 5.2 Story clustering

```ts
interface StoryBundle {
  story_id: string;
  topic_id: TopicId;
  headline: string;
  canonical_window_start: number;
  canonical_window_end: number;
  sources: Array<{
    source_id: string;
    url: string;
    publisher: string;
    published_at: number;
    url_hash: string;
  }>;
  cluster_method: 'semantic+entity+time';
  provenance_hash: string;
}
```

### 5.3 Topic digest

```ts
interface TopicDigest {
  topic_id: TopicId;
  window_start: number;
  window_end: number;
  verified_comment_count: number;
  unique_verified_principals: number;
  key_claims: string[];
  salient_counterclaims: string[];
  representative_quotes: string[];
}
```

### 5.4 Topic synthesis v2

```ts
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
  facts_summary: string;
  frames: Array<{ frame: string; reframe: string }>;
  warnings: string[];
  divergence_metrics: {
    disagreement_score: number;
    source_dispersion: number;
    candidate_count: number;
  };
  quorum: {
    required: number;
    received: number;
    reached_at: number;
    timed_out: boolean;
    selection_rule: 'deterministic';
  };
  provenance: {
    candidate_ids: string[];
    provider_mix: Array<{ provider_id: string; count: number }>;
  };
  created_at: number;
}
```

Canonical wire-shape is owned by `docs/specs/topic-synthesis-v2.md`; this architecture copy should match that spec.

### 5.5 Sentiment identifiers

```ts
interface SentimentSignal {
  topic_id: TopicId;
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

Civic Decay function:

```ts
next = current + 0.3 * (2 - current);
```

## 6. Identity and Trust Model (Cross-Cutting)

### 6.1 Identity primitives

Primary identity primitives:

- `principalNullifier` (stable per human)
- `trustScore` (`0..1`) and `scaledTrustScore` (`0..10000`)
- `ConstituencyProof` from region proof signals

Invariant:

- same human -> same principal nullifier across identity, sentiment, and economic attestations

### 6.2 Trust thresholds

Season 0 defaults:

| Capability | Threshold |
|------------|-----------|
| Verified participation (write/vote) | `trustScore >= 0.5` |
| UBE daily claim | `scaledTrustScore >= 5000` |
| High-impact forwarding/elevation/QF-ready actions | `trustScore >= 0.7` |

### 6.3 Roles and familiar delegation

Roles:

- Guest: read-only or low-impact views
- Human: verified participant
- Constituent: verified + district proof

Delegation model:

- familiar grants are scoped, revocable, and expiring
- familiar actions are attributable to principal
- familiar never gets independent influence budget

## 7. Services and Runtime Components

### 7.1 News Aggregator and clustering

Responsibilities:

- RSS ingest
- normalization and dedupe
- clustering into `StoryBundle`
- provenance capture for all source URLs

### 7.2 Synthesis services

Responsibilities:

- candidate generation and validation
- quorum synthesis and deterministic acceptance
- epoch scheduler and debounce/cap enforcement

Default scheduler parameters:

- debounce 30 minutes
- daily cap 4/topic
- discussion-trigger threshold 10 verified comments + 3 unique principals

### 7.3 AI engine router

Default path:

- local inference runtime

Optional paths:

- remote providers (`openai`, `google`, `anthropic`, `xai`) with explicit user consent
- device-local third-party models where available

Provider invariants:

1. provider ID explicit in settings and provenance metadata
2. consent UI exposes cost and privacy boundary
3. telemetry excludes source plaintext and identity fields

### 7.4 HERMES forum/docs/publishing

Capabilities:

- public thread discourse
- reply-to-article conversion
- docs-based longform collaboration and publishing
- nomination signals into elevation flow

### 7.5 Civic Action Kit (Bridge)

Capabilities:

1. representative lookup by `district_hash`
2. artifact packet generation from elevated topics
3. native user-initiated forwarding channels
4. local receipts and aggregate-only public counters

## 8. Participation Governors and Defaults

Governors prevent swarm behavior and keep influence bounded.

### 8.1 Governor categories

1. Action Budget Governor: posts/comments/votes/moderation/actions
2. Compute Governor: analyses/day and per-topic caps
3. Influence Governor: bounded contribution semantics through caps and decay

### 8.2 Season 0 default budgets (per principal/day)

| Budget Key | Default |
|------------|---------|
| `posts` | 20 |
| `comments` | 50 |
| `sentiment_votes` | 200 |
| `governance_votes` | 20 |
| `analyses` | 25 |
| `analyses_per_topic` | 5 |
| `shares` | 10 |
| `moderation` | 10 |
| `civic_actions` | 3 |

### 8.3 Governor invariants

- budgets apply to principals; familiars consume same budget pools
- denied actions must provide explicit reason in UI
- caps and thresholds are configuration-driven and auditable

## 9. Economics and Governance Rails

### 9.1 RVU v0

Season 0 RVU posture:

- inflationary proto-asset for ecosystem hardening
- role-gated minting and controlled distribution channels
- supports UBE/QF rails and test environment validation

### 9.2 UBE (Daily Boost)

Season 0 default semantics:

- trust-scaled gate (`>= 5000`)
- claim interval 1 day
- drip amount ~25 RVU

Product framing:

- presented as Daily Boost and XP-friendly UX
- wallet detail remains advanced/secondary

### 9.3 Quadratic funding

Season 0 posture:

- contracts active and tested for curated/internal rounds
- public UX remains simulated/off-chain for most users
- progression path toward broader on-chain participation remains future-sprint work

### 9.4 XP ledger relationship

XP is the Season 0 participation substrate:

- tracks: civic/social/project
- local-first storage and privacy boundaries
- no public per-user XP export

## 10. Data Topology and Privacy

### 10.1 Placement matrix

| Object | Device | Mesh public | Mesh encrypted | Chain | Cloud | Class |
|---|---|---|---|---|---|---|
| StoryBundle | Cache/index | `vh/news/stories/<storyId>` | - | - | optional blobs | Public |
| TopicDigest | Cache/index | `vh/topics/<topicId>/digests/<digestId>` | optional | - | - | Public-derived |
| TopicSynthesisV2 | Cache/index | `vh/topics/<topicId>/epochs/<epoch>/synthesis` | - | optional anchor hash | - | Public |
| SentimentSignal (event) | Authoritative | forbidden | `~<devicePub>/outbox/sentiment/*` | - | - | Sensitive |
| AggregateSentiment | Cache | `vh/aggregates/topics/<topicId>/epochs/<epoch>` | - | optional aggregate anchor | - | Public |
| Linked-social OAuth tokens | Vault only | forbidden | optional encrypted backup | - | - | Secret |
| Linked-social notifications | Vault/local cache | sanitized card projection only | optional | - | - | Sensitive |
| Docs drafts | Vault/E2EE stores | forbidden | `~<devicePub>/docs/*` encrypted | - | encrypted attachments | Sensitive |
| Published articles | Local cache | `vh/topics/<topicId>/articles/<articleId>` | - | optional anchor hash | media blobs | Public |
| Elevation artifacts | Local authoritative | metadata only | optional encrypted payload | - | optional export blob | Sensitive/Public-mixed |
| Civic receipts | Local authoritative | aggregate counters only | optional encrypted backup | - | - | Sensitive |

### 10.2 Path and secrecy rules

- Public V2 namespaces:
  - `vh/news/stories/*`
  - `vh/topics/*/epochs/*`
  - `vh/topics/*/digests/*`
  - `vh/discovery/*`
  - `vh/forum/*`
- Vault-only secrets never belong under public `vh/*` paths.
- No public object may include both district hash and human identifier.

## 11. Sprint Alignment (Direction)

This is target direction; actual progress lives in `STATUS.md`.

### 11.1 Sprint summary map

| Sprint | Intent | Architecture emphasis |
|--------|--------|-----------------------|
| 0 | Foundation | monorepo, contracts, baseline runtime |
| 1 | Core bedrock | identity and analysis baseline |
| 2 | Civic nervous system | feed quality, sentiment, governance UX scaffolding |
| 3 | Agora communication | messaging + forum reliability |
| 4 | Agentic foundation | delegation, budgets, V2 synthesis path |
| 5 | Bridge/action | docs, reply/article, elevation, forwarding |
| 6 | Hardening | security, performance, audit readiness |

### 11.2 Near-term implementation priorities

1. News aggregator and story clustering completion
2. Topic Synthesis V2 quorum and epoch services
3. Linked-social integration path and privacy boundaries
4. Docs-backed longform publishing
5. Elevation artifact generation and policy engine
6. Representative forwarding and receipt loop
7. Consent-forward provider switching UI

## 12. Risk Register (Current)

| ID | Threat | Layer | Mitigation |
|----|--------|-------|------------|
| R-01 | Identity spoofing / emulation | L0/L1 | attestation hardening + trust gating |
| R-02 | Swarm amplification by delegated agents | L1/L3 | principal budgets + explicit high-impact approvals |
| R-03 | Drift between synthesis contracts and UI | L3 | single V2 spec + shared types/tests |
| R-04 | Public leakage of sensitive civic data | L1/L3 | strict topology rules + schema linting |
| R-05 | Spam in civic forwarding | L3 | trust >= 0.7 + constituency checks + action budgets |
| R-06 | Model/provider behavior drift | L3 | explicit provider policy + provenance + consent UI |
| R-07 | Legacy naming regressions (`analysis_id`) | L3 | V2-first writes, read-only aliases for migration |

## 13. Developer Quickstart (Reference)

```bash
# 1. Clone and install
pnpm i

# 2. Boot local infra
pnpm vh bootstrap up

# 3. Initialize keys/contracts
pnpm vh bootstrap init --deploy-contracts

# 4. Run web app
pnpm --filter @vh/web-pwa dev
```

Use this architecture as contract guidance; verify code reality and drift in `docs/foundational/STATUS.md`.
