# Venn News MVP Roadmap

> Status: Draft v2 for review
> Date: 2026-04-20
> Target: Four-week MVP launch path after Week 0 blockers are resolved
> Scope: News feed, story analysis, frame/reframe stance, threaded discussion, and durable aggregate civic metadata

## Executive decision

The launch target is the Venn News MVP, not the full foundational product.

The MVP is the vertically complete product loop:

1. User opens a usable news feed.
2. Feed contains singleton stories and bundled stories.
3. Feed can be tuned by explicit topic preferences.
4. User taps a headline.
5. Story detail shows Venn's analysis, the frame/reframe table, source evidence, related links, and threaded replies.
6. User casts stance on specific frame/reframe rows, not on the story as a whole.
7. Those point-level stances persist, aggregate into public topic/story metadata, and participate in the capped influence-falloff model described by the Season 0 sentiment specs.
8. User returns later and sees coherent feed state, conversation state, their own stances, and aggregate public metadata.

This plan assumes a Web PWA MVP unless Week 0 proves a booting iOS shell and release path. A literal App Store/TestFlight MVP is not a wording change; it requires a native shell, signing, review assets, privacy/account-deletion compliance, and device testing. If that shell is not booting by the Week 0 exit, the four-week target is a public Web PWA/beta and App Store packaging moves to a parallel follow-on track.

## Codebase reality check

This roadmap is grounded in the current mainline state rather than the desired architecture.

| Area | Current state | Roadmap consequence |
| --- | --- | --- |
| App shell | `/apps/` contains `web-pwa` only. No Capacitor, Expo, React Native, Xcode project, or iOS shell is present. | Web PWA is the default four-week target. TestFlight requires a Week 0 packaging spike and an explicit go/no-go. |
| Frame point identity | `TopicSynthesisV2` frames are `{ frame, reframe }` only. Point ids are derived from text by `deriveSynthesisPointId(...)`, and the client carries `vh_sentiment_agreement_aliases_v1`. | Persisted frame `point_id` is a Week 0 blocker. Text-hash ids become a compatibility path, not the future canonical identity. |
| Sentiment key | The sentiment interface includes `synthesis_id`, and implementation paths use `topic_id + synthesis_id + epoch + point_id`, but the normative prose still says one final stance per `(topic_id, epoch, point_id)`. | Patch the spec to the four-tuple before implementation branches split. |
| Topic preferences | Preference state exists in the discovery store, but ranking/filter composition does not consume it. | Preference tuning is net-new ranking work, not polish. |
| Story-level engagement summary | Per-point aggregate schemas exist. A materialized `StoryEngagementSummary` rollup does not. | Story aggregate metadata is net-new compute/read model work. |
| Bundle synthesis worker | Bundle synthesis is specified in the PR B contract and related branch work, but the worker is not landed on main. | Publish-time accepted synthesis and source split enrichment depend on PR B landing or an explicit replacement. |
| Constituency proof | Stance paths currently rely on mocked/permissive constituency proof plumbing. | MVP can ship with beta-local identity semantics only if the product copy is honest; verified-human claims are out of scope until real proof is active. |
| Release gates | Core repo gates exist. MVP feed/detail/stance/thread smokes and compliance checklist scripts do not. | Week 3 must build the release evidence harness; it cannot simply "run the gates." |

## Non-negotiable product contract

### What the user votes on

Users do not cast sentiment on the story object directly.

Users cast stance on individual frame/reframe table points. Each row is a specific opinion, bias, counterpoint, institutional tension, stakeholder tradeoff, rights/safety dispute, or public argument about the story.

Canonical stance target:

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

Story-level sentiment is only a derived aggregate over point-level stance activity. The UI can summarize story engagement, contested points, and divergence, but it must not imply that users voted for or against the story as a whole.

### Canonical point identity

Decision for this roadmap:

- `point_id` must become a persisted field on accepted `TopicSynthesisV2.frames[]`.
- The canonical final stance key is `(topic_id, synthesis_id, epoch, point_id)`.
- Runtime text-hash ids from `deriveSynthesisPointId(...)` become a compatibility fallback for existing data and tests.
- `vh_sentiment_agreement_aliases_v1` remains in scope as a migration/read-compatibility tool until legacy text-hash votes are no longer served.

Required behavior:

- rewording a frame must not orphan prior stance unless the product intentionally creates a new point;
- if a synthesis regenerates the same conceptual point with edited wording, generation/promotion must preserve or map the previous `point_id`;
- if a point is materially replaced, it receives a new `point_id` and old stance remains attached to the old point;
- migrations must report mapped, unmapped, and orphaned counts;
- compatibility reads must be sunset by explicit criteria, not by hope.

This requires a normative spec patch before Week 1 implementation:

- update `docs/specs/spec-civic-sentiment.md` so the prose matches the implementation-facing four-tuple;
- update `TopicSynthesisV2` schema/tests so accepted frames can carry stable `point_id`;
- document the dual-read/alias window.

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

MVP implication:

- no generic story like/dislike button as the primary sentiment mechanic;
- no public per-user/nullifier stance payloads;
- no claim that public beta stance equals verified one-human-one-vote while constituency proofs remain mocked;
- local/beta identity can enforce "one local final stance" but not full Sybil resistance.

### Source and analysis semantics

The MVP must keep the analysis evidence boundary explicit:

- only extractable, analysis-eligible article text may contribute to Venn summaries and frame/reframe rows;
- non-extractable or otherwise disqualified links must not be claimed as analysis evidence;
- relevant but non-analyzed links may appear as related links below the canonical evidence section;
- a useful source should not be removed globally because some links fail extraction;
- soak sampling can use the temporary `50%` over `8` item rule;
- product source admission remains a larger-sample `66%+` reliability target once enough accumulated data exists.

### Analysis cache and click behavior

The headline click must not silently run a fresh blocking analysis pass as the normal path.

Required:

- story detail renders accepted publish-time synthesis when present;
- if accepted synthesis is missing, detail shows an explicit `analysis pending` or `analysis unavailable` state;
- any background analysis request must be visible in telemetry and must not mutate the meaning of the source evidence boundary;
- detail must show `generated_at`, `epoch`, and enough provenance for users to understand freshness;
- stale or placeholder analysis must be rejected or clearly labeled as unavailable.

Week 0 must define the freshness budget for display labels. Until then, the UI should prefer explicit timestamps over unqualified "current" language.

## User-facing MVP

### Feed

Required:

- one primary feed surface;
- singleton stories and bundled stories share the same card anatomy;
- explicit topic preferences affect ranking/filtering;
- feed state survives reload;
- cards expose enough source/provenance information to avoid black-box trust;
- feed cards can open a stable story detail route or state.

Net-new work:

- apply `FeedPersonalizationConfig` in feed composition/ranking;
- define topic affinity, muted topics/categories, and exclusion semantics;
- test that preferences visibly change feed ordering or filtering.

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

The detail experience may start as an expanded card, but MVP quality requires stable restoration and shareability. If a full URL route is not built, the roadmap must explicitly accept "not shareable" as a beta limitation. The preferred path is a route/deep link keyed by story/topic identity.

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
- Lightbulb/engagement metadata uses capped influence falloff;
- rate limits and budgets apply to stance writes so aggregate spam is bounded.

Story-level metadata can include:

- number of active stance participants where privacy thresholds allow;
- point-level agree/disagree counts;
- high divergence markers;
- aggregate Lightbulb/Eye weights;
- top contested points;
- aggregate freshness label.

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
  synthesis: AcceptedStorySynthesis | null;
  sources: StorySourceSplit;
  thread: StoryThreadSummary;
  engagement: StoryEngagementSummary | null;
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

The split exists in schema/service work but must be plumbed through bundle publication, feed store hydration, and `NewsCardBack` rendering with the discriminator preserved.

### Point stance intent

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

The implementation may wrap this with existing proof, budget, and constituency fields from the canonical `SentimentSignal` path. The roadmap requirement is that the product path remains point-specific, idempotent, budgeted, and privacy-safe.

### Story engagement summary

`StoryEngagementSummary` is net-new materialized data. It should be treated as a read model derived from point aggregates and topic engagement state, not as the write model for stance.

```ts
type StoryEngagementSummary = {
  topic_id: string;
  synthesis_id: string;
  epoch: number;
  eye_weight: number;
  lightbulb_weight: number;
  readers?: number;
  engagers?: number;
  point_stats: Record<string, { agree: number; disagree: number }>;
  high_divergence_point_ids: string[];
  computed_at: number;
  freshness: "fresh" | "stale" | "unavailable";
};
```

Open design constraint:

- `readers` and `engagers` require privacy-safe identity counting. If the nullifier/proof layer remains beta-mocked, these fields should be omitted or labeled as beta-local estimates instead of public truth.

Public aggregate payloads must not include nullifiers, district proofs, wallet addresses, tokens, or raw per-user event records.

## Week 0: Blocker decisions before the four-week clock

Week 0 is mandatory. It prevents the team from starting Week 1 on incompatible assumptions.

### Week 0 implementation PR stack

Week 0 should be executed as a short PR stack, not as an open-ended planning loop. Each PR should be independently reviewable, but Week 1 product implementation should not start until the go/no-go table below is resolved.

| Order | PR slice | Scope | Required output |
| --- | --- | --- | --- |
| 1 | `point-id-contract` | Persist stable `point_id` on accepted `TopicSynthesisV2.frames[]`; keep text-derived ids as compatibility aliases. | Schema/tests/generator/readers agree on persisted point ids; alias behavior is documented. |
| 2 | `sentiment-four-tuple-spec` | Patch sentiment docs/tests around `(topic_id, synthesis_id, epoch, point_id)`. | No active spec text describes final stance as keyed only by `(topic_id, epoch, point_id)`. |
| 3 | `launch-surface-decision` | Decide Web PWA vs iOS/TestFlight for this four-week launch. | Either Web PWA is recorded as the MVP launch target, or an iOS shell boots with a named build gate. |
| 4 | `bundle-synthesis-dependency` | Resolve PR B / bundle synthesis dependency for accepted publish-time synthesis. | Story detail can render accepted stored synthesis or an explicit pending/unavailable state. |
| 5 | `identity-honesty-scope` | Decide beta-local identity vs real constituency proof for MVP copy and stance guarantees. | Product copy, release notes, and stance path claims match the actual proof layer. |
| 6 | `mvp-release-gates` | Add or name deterministic feed/detail/stance/thread release gates. | Missing smoke/check scripts have owners, fixtures, pass/fail semantics, and report locations. |
| 7 | `compliance-public-beta-minimums` | Privacy, terms, UGC/moderation, support, data deletion, telemetry consent, and content/copyright boundaries. | Public launch cannot proceed unless each compliance artifact has an owner and minimum accepted draft. |
| 8 | `launch-ops-and-correction-path` | Curated fallback snapshot, bad-analysis suppression/regeneration, report queue, model/cost telemetry, and release artifact visibility. | Operators have minimum levers for stale feed data, bad summaries, abusive threads, and runaway model usage. |

Recommended sequencing:

- PRs 1 and 2 should land first because every stance implementation depends on the point key.
- PRs 3 and 4 can run in parallel after PR 1 is drafted.
- PRs 5 through 8 can run in parallel once launch surface is known.
- Week 1 starts only after every row in the go/no-go table has a `go` decision or an explicit accepted no-go consequence.

### Week 0 go/no-go table

| Blocker | Go condition | No-go consequence |
| --- | --- | --- |
| Persisted frame `point_id` | Accepted synthesis frames carry stable `point_id`; regenerated wording can preserve or map ids; legacy text-hash ids are compatibility only. | Do not start point-stance implementation. Building on text-hash ids knowingly ships vote orphaning on frame edits. |
| Sentiment key | Docs, schemas, readers, writers, and tests agree on `(topic_id, synthesis_id, epoch, point_id)`. | Do not split stance work across contributors; conflicting three-tuple/four-tuple implementations will corrupt compatibility assumptions. |
| Launch surface | Web PWA is accepted, or iOS shell boots on simulator/device with build command, signing assumptions, and smoke expectations. | Default to Web PWA MVP. TestFlight/App Store becomes a parallel follow-on and is removed from the four-week critical path. |
| Bundle synthesis path | Accepted publish-time synthesis, source split, model id, generated time, warnings, and provenance are available to story detail, or pending/unavailable fallback is explicitly designed. | Story detail must not claim complete Venn analysis. It may ship with explicit pending/unavailable states, or Week 1 detail work waits. |
| Topic preferences | Ranking/filter semantics are defined and have at least one deterministic test proving preferences change feed output. | Do not market the feed as tunable. Keep preference UI hidden or label it as inactive. |
| Identity/proof | Real constituency proof is active, or beta-local identity constraints and copy are approved. | No verified-human, one-human-one-vote, district-proof, or Sybil-resistant claims in product copy. |
| Story engagement rollup | `StoryEngagementSummary` is either implemented as a derived read model or explicitly deferred from visible UI. | Do not show story-level aggregate sentiment beyond existing per-point aggregate data. |
| Release gates | Feed, story-detail, point-stance, and story-thread smokes have scripts or named owners/fixtures with pass/fail semantics. | No launch-readiness claim. The MVP can continue feature work, but cannot enter release freeze. |
| Compliance | Privacy, terms, UGC/moderation, support, data deletion, telemetry consent, and content/copyright minimums have accepted drafts. | No public beta or App Store/TestFlight submission. Internal-only testing can continue. |
| Launch content fallback | A curated validated snapshot exists with enough stories to exercise singleton, bundle, preferences, frames, stance, related links, and threads. | Live ingestion instability can block demos and QA; do not depend on the live feed as the only launch data path. |
| Correction/admin path | Operators can suppress bad analysis, mark analysis unavailable, hide abusive thread content, and preserve an audit trail. | Public launch is unsafe; a single bad summary or abusive thread has no controlled remediation path. |
| Ops/cost visibility | Model ids, model invocation counts, source health artifacts, release report path, and bad-analysis reports are visible. | Remote-model spend and product failures remain opaque; do not scale beyond a small internal beta. |

### W0.1 Persisted point ids

Decision: make persisted `point_id` the canonical path.

Required:

- extend `TopicSynthesisV2.frames[]` schema with stable `point_id`;
- update synthesis generation/promotion to assign/preserve point ids;
- keep text-hash derived ids as legacy aliases;
- document rewording behavior;
- add tests for preserved point id across text edits and new point id for material replacement.

Exit criteria:

- spec, schema, generator, readers, and tests agree on the four-tuple key;
- alias map is documented as compatibility, not core product design.

### W0.2 Spec key patch

Decision: the canonical key is `(topic_id, synthesis_id, epoch, point_id)`.

Required:

- patch `docs/specs/spec-civic-sentiment.md`;
- patch related tests/docs that still describe a three-tuple;
- call out dual-write/backfill/compatibility-read expectations.

Exit criteria:

- no normative doc says final stance is keyed only by `(topic_id, epoch, point_id)`.

### W0.3 Launch surface decision

Decision: default to Web PWA MVP unless iOS shell is proved by Week 0 exit.

Required if App Store/TestFlight remains in scope:

- choose Capacitor/Expo/native path;
- boot app on simulator/device;
- define signing/team/profile requirements;
- add a build command;
- add smoke test expectations;
- budget privacy/account deletion/moderation assets.

Exit criteria:

- either "Web PWA MVP" is accepted, or "iOS MVP" has a booting shell and named build gate.

### W0.4 Bundle synthesis dependency

Decision: launch detail should use accepted publish-time synthesis.

Required:

- merge or replace PR B / bundle synthesis worker;
- ensure bundle publication carries accepted synthesis, source split, model id, generated time, warnings, and provenance;
- define fallback when accepted synthesis is absent.

Exit criteria:

- headline click can render from stored bundle/detail data without an invisible blocking analysis pass.

### W0.5 Identity honesty

Decision: MVP ships with beta-local identity unless real constituency proof is pulled into scope.

Required:

- product copy must avoid verified-human or one-human-one-vote claims if proof remains mocked;
- stance path must still enforce local final stance and budgets;
- release notes must distinguish beta-local identity from future LUMA proof.

Exit criteria:

- no user-facing claim exceeds the actual proof layer.

### W0.6 Release evidence backlog

Decision: build deterministic MVP gates instead of relying on the retired scheduled automation wave.

Required new scripts/checks:

- feed smoke;
- story-detail smoke;
- point-stance persistence/convergence smoke;
- thread persistence smoke;
- privacy/UGC/data-deletion checklist;
- iOS build gate only if iOS is in scope.

Exit criteria:

- the missing gates have owners, names, fixtures, and pass/fail semantics.

## Four-week roadmap after Week 0

### Week 1: MVP spine and data contracts

Objective: make the complete product loop explicit and testable in the codebase.

Deliverables:

- `StoryDetail` view model normalized around `topic_id`, `story_id`, `synthesis_id`, `epoch`, and frame `point_id`;
- analyzed-source/related-link discriminator plumbed from bundle publication into feed hydration and rendering;
- topic preference ranking/filter semantics implemented in `composeFeed`;
- story-to-thread mapping stabilized;
- story engagement summary designed as a derived read model, with privacy limits for `readers` and `engagers`;
- analysis cache contract implemented: accepted synthesis first, explicit pending/unavailable state on miss;
- deep-link/shareability decision made and implemented or explicitly deferred as beta limitation;
- launch branch has clear MVP gate commands.

Acceptance checks:

- singleton story detail fixture renders;
- bundled story detail fixture renders;
- story with related links renders related links separately from analyzed sources;
- frame/reframe rows expose persisted point ids;
- preferences visibly change feed output;
- no click path performs an unannounced blocking analysis pass;
- docs and tests reference point-level stance, not story-level voting.

### Week 2: Detail, thread, and point stance implementation

Objective: make headline click valuable and interactive.

Deliverables:

- polished story detail surface;
- frame/reframe stance controls on every eligible row;
- ARIA/keyboard behavior for stance controls;
- local stance restore after reload;
- mesh/event enqueue for stance intents;
- rate limits and budgets on stance write attempts;
- aggregate counters render from public aggregate or a clearly labeled fallback;
- aggregate freshness labels;
- story thread renders below the frame/reframe table;
- reply composer and reply list are usable on story detail;
- report/hide/block affordances exist for replies.

Acceptance checks:

- user can agree with one point and disagree with another on the same story;
- toggling stance does not double-count;
- neutral clears the active contribution;
- reload preserves local final stance;
- aggregate projection updates or reports bounded pending/stale state;
- thread reply persists and remains attached to the same story;
- keyboard-only user can operate stance and reply controls.

### Week 3A: Release gates

Objective: prove the MVP path works with deterministic evidence.

Deliverables:

- one release command/report for MVP gates;
- source health evidence is fresh and not blocked;
- story correctness gate passes;
- feed render smoke passes;
- story detail smoke passes;
- point stance persistence/convergence smoke passes or returns setup-scarcity rather than false correctness failure;
- thread persistence smoke passes;
- iOS build smoke only if iOS survived Week 0.

Acceptance checks:

- clean install opens the feed;
- topic preferences change ranking/filtering;
- headline click opens story detail;
- analysis and frame/reframe render;
- point stance persists;
- thread reply persists;
- app survives reload/restart;
- release report is generated from deterministic checks rather than the retired Codex scheduled automation pipe.

### Week 3B: Compliance and policy

Objective: remove the non-code blockers for public users.

Deliverables:

- privacy policy;
- terms of use;
- UGC/moderation policy;
- support contact/page;
- account/data deletion path if accounts or durable identities are present;
- telemetry consent/opt-out decision;
- copyright/content-use guidance for summaries, snippets, source links, and stored article text;
- correction/takedown path for bad summaries, bad source attribution, or moderation issues.

Acceptance checks:

- no public launch or App Store submission proceeds without these artifacts;
- product copy is consistent with actual identity, analysis, and source-evidence guarantees.

### Week 4: Freeze, hardening, and submission

Objective: stop broadening scope and ship the MVP.

Deliverables:

- feature freeze;
- launch-blocking bugs only;
- final copy pass to avoid overclaiming analysis coverage, freshness, or verified identity;
- public Web PWA beta package or TestFlight/App Store package depending on Week 0 decision;
- screenshots and metadata if App Store/TestFlight is in scope;
- final release evidence bundle.

Acceptance checks:

- release branch is clean;
- required checks pass;
- known limitations are documented in-product and in release notes;
- submission/beta package is complete for the chosen launch surface.

## Release gate inventory

| Gate | Current script/status | MVP action |
| --- | --- | --- |
| Typecheck | `pnpm typecheck` exists | Required. |
| Lint | `pnpm lint` exists | Required. |
| Quick tests | `pnpm test:quick` exists | Required. |
| Story correctness | `pnpm check:storycluster:correctness` exists | Required. |
| Web build | `pnpm build` exists | Required. |
| Source health | `pnpm check:news-sources:health` exists | Required from a reliable runner. |
| Feed smoke | Missing dedicated MVP script | Add Week 3A. |
| Story-detail smoke | Missing dedicated MVP script | Add Week 3A. |
| Point-stance persistence/convergence smoke | Existing sentiment tests exist, but no MVP release gate | Add Week 3A release gate around story detail. |
| Thread persistence smoke | Forum tests exist, but no story-thread release gate | Add Week 3A. |
| iOS build | Missing because no iOS shell | Only required if Week 0 chooses iOS. |
| Privacy/UGC/deletion checklist | Missing | Add Week 3B; public launch blocker. |

## Additional risks not in the first draft

### Summary accuracy and correction path

The MVP's value rests on accurate summaries and frame/reframe rows. The release plan needs a correction path:

- users can report inaccurate analysis;
- operators can suppress or regenerate a bad analysis artifact;
- story detail can show corrected/updated provenance;
- launch copy does not imply editorial omniscience.

### Cost and model budget

If accepted synthesis uses remote models, the MVP needs:

- model id surfaced in provenance;
- cost ceilings or run budgets;
- clear retry/backoff behavior;
- no hidden model invocation on every card open.

### Accessibility

Frame/reframe stance is central to the product. Minimum launch accessibility includes:

- keyboard operation;
- visible focus states;
- ARIA labels/pressed state on stance controls;
- screen-reader labels that distinguish frame, reframe, agree, neutral, and disagree;
- reduced-motion-safe interaction.

### Offline and mesh-unreachable behavior

The MVP must define what happens when mesh writes fail:

- local intent queued and visibly pending;
- retry on reconnect;
- bounded failure state if persistence cannot complete;
- no fake aggregate success when public projection failed.

### Deep links and shareability

If stories cannot be linked or restored, discussion growth suffers. Preferred MVP behavior:

- story detail URL includes stable story/topic identity;
- route restores expanded detail state;
- stale/missing story shows a useful unavailable state.

### Abuse and rate limits

The stance path must be budgeted:

- one final stance per point;
- bounded write attempts;
- local cooldown against rapid toggling;
- aggregate projection must not count raw clicks;
- moderation/reporting budgets for thread abuse.

### Data retention and deletion

If users have accounts or durable local identities, deletion must cover:

- local stance state;
- local profile/preferences;
- local thread author state where possible;
- sensitive outbox records;
- public aggregate limitations clearly explained.

### Telemetry consent

Telemetry around sentiment writes and analysis failures is useful, but launch needs:

- consent/notice decision;
- opt-out behavior if telemetry contains anything beyond essential diagnostics;
- no sensitive nullifier/proof fields in telemetry.

## Explicit deferrals

Deferred from this MVP unless a Week 0 decision pulls them in:

- generic story-level like/dislike;
- broad OAuth social stream ingestion;
- civic action kit;
- governance and proposal workflows;
- production Sybil resistance;
- real constituency proof if not explicitly scoped in Week 0;
- full retained-publication automation;
- source-promotion automation as a launch blocker;
- familiar-assisted voting or delegated sentiment;
- i18n/localization;
- full offline-first collaboration;
- native App Store launch if the iOS shell does not pass Week 0.

These are foundational-project goals, but they are not required to ship the Venn News MVP loop.

## Open review questions

1. Do we accept Web PWA as the four-week launch surface, with App Store/TestFlight as a parallel track only after an iOS shell exists?
2. Should persisted `point_id` be generated deterministically from a semantic point seed, or assigned as a stable id during synthesis promotion and preserved through edits?
3. What is the aggregate freshness budget before counts are labeled stale or hidden?
4. What is the minimum public aggregate display: raw agree/disagree counts per point, percentage bars, high-divergence badges, or all three?
5. Should story cards show aggregate stance previews, or should point-level sentiment remain detail-only for MVP?
6. What is the minimum acceptable mesh persistence proof for launch: local enqueue plus public aggregate fallback, or full multi-user convergence evidence?
7. Should related links be visible by default or collapsed below analyzed sources?
8. Are beta-local identity semantics acceptable for launch copy, or must real constituency proof move into Week 0 scope?

## Definition of done for this plan

The plan is ready to build when reviewers agree on:

- Web PWA vs iOS launch surface;
- persisted frame `point_id` as canonical, or an explicit alternative with migration cost accepted;
- four-tuple sentiment key in docs, schema, and implementation;
- story-level sentiment as aggregate metadata only;
- analyzed-source versus related-link evidence boundaries;
- accepted publish-time synthesis as the headline-click data contract;
- reuse of existing forum threads for story discussion;
- deterministic release checks replacing the broken scheduled automation gate;
- beta identity claims that match the actual proof layer;
- the Week 0 plus four-week sequence above as the working launch plan.
