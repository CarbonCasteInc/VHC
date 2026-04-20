# Venn News MVP Roadmap

> Status: Draft for review
> Date: 2026-04-20
> Target: Four-week MVP launch path
> Scope: News feed, story analysis, frame/reframe stance, threaded discussion, and durable sentiment metadata

## Executive decision

The four-week launch target is the Venn News MVP, not the full foundational product.

The MVP is a vertically complete user loop:

1. User opens a usable news feed.
2. Feed contains singleton stories and bundled stories.
3. Feed can be tuned by explicit topic preferences.
4. User taps a headline.
5. Story detail shows Venn's analysis, the frame/reframe table, source evidence, related links, and threaded replies.
6. User casts stance on specific frame/reframe rows, not on the story as a whole.
7. Those point-level stances persist, aggregate into public story/topic metadata, and participate in the capped influence-falloff model described by the Season 0 sentiment specs.
8. User returns later and sees coherent feed state, conversation state, their own stances, and aggregate public metadata.

The MVP is not complete if it only renders a feed. The MVP is complete when a user can move from headline to analysis to opinion-specific stance to discussion, and the system can preserve that civic signal without widening the meaning of the analysis evidence.

## Non-negotiable product contract

### What the user votes on

Users do not cast sentiment on the story object directly.

Users cast stance on individual frame/reframe table points. Each row is a specific opinion, bias, counterpoint, institutional tension, stakeholder tradeoff, rights/safety dispute, or public argument about the story.

Canonical identifier:

```ts
type StanceTarget = {
  topic_id: string;
  synthesis_id: string;
  epoch: number;
  point_id: string;
};
```

Canonical user stance:

```ts
type PointAgreement = -1 | 0 | 1;
```

Interpretation:

- `+1`: user agrees with this frame/reframe point.
- `0`: user is neutral or clears their stance.
- `-1`: user disagrees with this frame/reframe point.

This is the civic primitive. Story-level sentiment is only a derived aggregate over point-level stance activity.

### Influence and falloff

The MVP must preserve the Season 0 influence model:

- one user has one final stance per `(topic_id, synthesis_id, epoch, point_id)`;
- neutral stance is non-counting in point aggregates;
- familiars cannot create independent sentiment identities;
- event-level signals are sensitive and must remain local or encrypted;
- public mesh surfaces aggregate-only projections;
- Lightbulb impact is capped below `2`;
- additional active stance interactions decay toward the cap instead of adding linear influence.

Canonical falloff:

```text
E_cap = 1.95
E_new = E_current + 0.3 * (E_cap - E_current)
```

Implication for product design:

- The UI may show story-level engagement, but it must be computed from point-level stance state.
- The app must not implement a generic story like/dislike as the primary sentiment mechanic.
- The aggregate public metadata can say "users are engaging with these positions" or "this story has high disagreement", but the underlying write path remains point-specific.

### Source and analysis semantics

The MVP must keep the analysis evidence boundary explicit:

- only extractable, analysis-eligible article text may contribute to Venn summaries and frame/reframe rows;
- non-extractable or otherwise disqualified links must not be claimed as analysis evidence;
- relevant but non-analyzed links may appear as related links below the canonical evidence section;
- a useful source should not be removed globally because some links fail extraction;
- soak sampling can use the temporary `50%` over `8` item rule;
- product source admission remains a larger-sample `66%+` reliability target once enough accumulated data exists.

## User-facing MVP

### Feed

Required:

- one primary feed surface;
- singleton stories and bundled stories share the same card anatomy;
- topic preference controls affect ranking/filtering in a way the user can understand;
- feed state survives reload;
- cards expose enough source/provenance information to avoid black-box trust.

Not required for MVP:

- broad social notification ingestion;
- civic action kit;
- governance surfaces;
- retained-publication automation as a user-facing feature.

### Story detail

Required sections, in order:

1. Headline and story status.
2. Source strip with singleton/bundle affordance.
3. Just-the-reported-facts summary.
4. Frame/reframe table.
5. Point-level stance controls on each frame/reframe row.
6. Aggregate point metadata and story/topic engagement summary.
7. Analyzed sources.
8. Related links that were not used as analysis evidence.
9. Threaded replies for the story.

The headline click must land the user in this detail experience without requiring a separate forum mode or analysis pass.

### Conversation

Required:

- every news story has a stable thread identity;
- thread identity is derived from the story/topic identity, not transient route state;
- users can reply to the story thread;
- replies persist across reload;
- thread count and latest activity can appear on feed cards;
- basic safety affordances exist: report, hide, block, and moderation queue/path.

The forum system should be reused. The MVP should not create a second comment model.

### Point-level stance

Required:

- each frame/reframe row has three-state stance controls: Agree, Neutral, Disagree;
- stance writes use the canonical `(topic_id, synthesis_id, epoch, point_id)` key;
- one active final stance per user per point;
- toggling from agree to disagree updates the final stance rather than double-counting;
- neutral clears the active contribution for point aggregates;
- local stance state restores after reload;
- public aggregate counters converge from mesh aggregate state, not from local-only projections;
- Lightbulb/engagement metadata uses capped influence falloff.

Story-level metadata can include:

- number of active stance participants;
- point-level agree/disagree counts;
- high divergence markers;
- aggregate Lightbulb/Eye weights;
- top contested points.

Story-level metadata must not imply the user voted for or against the entire story.

## Data contracts to stabilize

### Story detail view model

```ts
type VennNewsStoryDetail = {
  topic_id: string;
  story_id: string;
  bundle_kind: "singleton" | "bundle";
  title: string;
  published_at: string;
  updated_at: string;
  topic_preferences: string[];
  synthesis: AcceptedStorySynthesis;
  sources: StorySourceSplit;
  thread: StoryThreadSummary;
  engagement: StoryEngagementSummary;
  provenance: StoryProvenance;
};
```

### Accepted synthesis

```ts
type AcceptedStorySynthesis = {
  synthesis_id: string;
  epoch: number;
  facts_summary: string;
  frames: FrameReframePoint[];
  warnings: string[];
  generated_at: string;
  model_id?: string;
};

type FrameReframePoint = {
  point_id: string;
  frame: string;
  reframe: string;
  stance_summary?: PointAggregateSnapshot;
};
```

### Source split

```ts
type StorySourceSplit = {
  analyzed: AnalyzedSource[];
  related_links: RelatedLink[];
  excluded_count: number;
};

type AnalyzedSource = {
  source_id: string;
  publisher: string;
  url: string;
  title: string;
  analysis_eligible: true;
  eligibility_reason: "readable_text";
};

type RelatedLink = {
  source_id: string;
  publisher: string;
  url: string;
  title: string;
  analysis_eligible: false;
  related_reason:
    | "text_extraction_failed"
    | "paywall_or_access_limited"
    | "non_article_link"
    | "duplicate_or_near_duplicate"
    | "manual_related_context";
};
```

### Point stance event

```ts
type PointStanceIntent = {
  topic_id: string;
  synthesis_id: string;
  epoch: number;
  point_id: string;
  agreement: -1 | 0 | 1;
  emitted_at: number;
  idempotency_key: string;
};
```

The implementation may wrap this with existing proof, budget, and constituency fields from the canonical `SentimentSignal` path. The roadmap requirement is that the product path remains point-specific and idempotent.

### Public aggregate

```ts
type StoryEngagementSummary = {
  topic_id: string;
  synthesis_id: string;
  epoch: number;
  eye_weight: number;
  lightbulb_weight: number;
  readers: number;
  engagers: number;
  point_stats: Record<string, { agree: number; disagree: number }>;
  high_divergence_point_ids: string[];
  computed_at: number;
};
```

Public aggregate payloads must not include nullifiers, district proofs, wallet addresses, tokens, or raw per-user event records.

## Four-week roadmap

### Week 1: MVP spine and data contracts

Objective: make the complete product loop explicit and testable.

Deliverables:

- `StoryDetail` view model normalized around `topic_id`, `story_id`, `synthesis_id`, `epoch`, and frame `point_id`.
- Publish-time bundle enrichment carries analyzed sources and related links.
- Story cards can open deterministic detail state without a fresh analysis pass.
- Story-to-thread mapping is stable.
- Point-level stance write path is selected and documented against the existing sentiment adapters.
- Product copy stops describing this as generic story sentiment.
- Launch branch has clear MVP gate commands.

Acceptance checks:

- singleton story detail fixture renders;
- bundled story detail fixture renders;
- story with related links renders related links separately from analyzed sources;
- frame/reframe rows expose stable point ids;
- docs and tests reference point-level sentiment, not story-level voting.

### Week 2: Detail, thread, and point stance implementation

Objective: make headline click valuable and interactive.

Deliverables:

- polished story detail surface;
- frame/reframe stance controls on every eligible row;
- local stance restore after reload;
- mesh/event enqueue for stance intents;
- aggregate counters render from public aggregate or resilient fallback;
- story thread renders below the frame/reframe table;
- reply composer and reply list are usable on story detail;
- report/hide/block affordances exist for replies.

Acceptance checks:

- user can agree with one point and disagree with another on the same story;
- toggling stance does not double-count;
- neutral clears the active contribution;
- reload preserves local final stance;
- aggregate projection updates or reports bounded pending state;
- thread reply persists and remains attached to the same story.

### Week 3: Reliability and mobile readiness

Objective: prove the MVP path works on the release target.

Deliverables:

- deterministic release command/report for MVP gates;
- source health evidence is fresh and not blocked;
- story correctness gate passes;
- feed render smoke passes;
- story detail smoke passes;
- point stance convergence smoke passes or returns setup-scarcity rather than false correctness failure;
- iOS shell boots if App Store submission remains the target;
- privacy, terms, support, moderation, and data deletion materials exist.

Acceptance checks:

- clean install opens the feed;
- topic preferences change ranking/filtering;
- headline click opens story detail;
- analysis and frame/reframe render;
- point stance persists;
- thread reply persists;
- app survives reload/restart;
- release report is generated from deterministic checks rather than the retired Codex scheduled automation pipe.

### Week 4: Freeze, hardening, and submission

Objective: stop broadening scope and ship the MVP.

Deliverables:

- feature freeze;
- launch-blocking bugs only;
- final copy pass to avoid overclaiming analysis coverage;
- TestFlight/App Store package or public beta package;
- screenshots and metadata;
- final release evidence bundle.

Acceptance checks:

- release branch is clean;
- required checks pass;
- App Store or beta submission package is complete;
- known limitations are documented in-product and in release notes.

## Release gates

Required before MVP release:

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm test:quick`
4. storycluster correctness gate
5. web build
6. native/iOS build if App Store submission is literal
7. source health ready/pass from a reliable runner
8. feed smoke
9. story detail smoke
10. point stance persistence/convergence smoke
11. thread persistence smoke
12. privacy/UGC/data deletion checklist

The retired scheduled Codex automation wave is not a release gate. It produced environmental noise instead of dependable product evidence. The replacement release evidence must directly exercise the MVP user loop.

## Implementation sequence

1. Audit existing feed/story detail/sentiment/thread modules for the shortest path that reuses current contracts.
2. Normalize story detail view data.
3. Ensure publish-time story bundles include analyzed-source and related-link sidecars.
4. Render frame/reframe points with stable `point_id`.
5. Wire stance controls to the existing civic sentiment admission/event/projection path.
6. Attach existing forum threads to story detail through stable topic identity.
7. Add deterministic fixture coverage for the full headline-click path.
8. Add mobile shell and App Store support only after the core loop is working in web.

## Open review questions

1. Should the MVP stance taxonomy remain strictly `Agree / Neutral / Disagree`, or should the UI copy use more civic language while preserving the same `-1 | 0 | 1` data contract?
2. What is the minimum public aggregate display: raw agree/disagree counts per point, percentage bars, high-divergence badges, or all three?
3. Should story cards show aggregate stance previews, or should point-level sentiment remain detail-only for MVP?
4. What is the minimum acceptable mesh persistence proof for launch: local enqueue plus public aggregate fallback, or full multi-user convergence evidence?
5. Should related links be visible by default or collapsed below analyzed sources?

## Explicit deferrals

Deferred from this MVP:

- generic story-level like/dislike;
- broad OAuth social stream ingestion;
- civic action kit;
- governance and proposal workflows;
- advanced identity tiers and production Sybil resistance;
- full retained-publication automation;
- source-promotion automation as a launch blocker;
- familiar-assisted voting or delegated sentiment.

These are foundational-project goals, but they are not required to ship the Venn News MVP loop.

## Definition of done

The plan is ready to build when reviewers agree on:

- point-level stance as the primary sentiment primitive;
- story-level sentiment as aggregate metadata only;
- analyzed-source versus related-link evidence boundaries;
- reuse of existing forum threads for story discussion;
- deterministic release checks replacing the broken scheduled automation gate;
- the four-week sequence above as the working launch plan.

