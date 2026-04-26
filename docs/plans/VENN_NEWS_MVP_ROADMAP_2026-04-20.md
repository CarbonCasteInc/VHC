# Venn News MVP Roadmap

> Status: Draft v4 docs-aligned implementation tracker
> Date: 2026-04-20
> Last alignment audit: 2026-04-25 after PR #542 merged into `main` at `fd7ed17e`
> Target: Four-week Web PWA MVP launch path after remaining Week 0 decisions and launch blockers are resolved
> Scope: News feed, story analysis, frame/reframe stance, threaded discussion, and durable aggregate civic metadata

## Executive decision

The launch target is the Venn News MVP, not the full foundational product.

The MVP is the vertically complete product loop:

1. User opens a usable news feed.
2. Feed contains singleton stories and bundled stories.
3. Feed can be tuned by explicit topic preferences.
4. User taps a headline.
5. Story detail shows Venn's analysis, the frame/reframe table, source evidence, related links, and threaded replies.
6. User casts stance on specific frame/reframe items, not on the story as a whole.
7. Those point-level stances persist, aggregate into public topic/story metadata, and participate in the capped influence-falloff model described by the Season 0 sentiment specs.
8. User returns later and sees coherent feed state, conversation state, their own stances, and aggregate public metadata.

The four-week launch surface is Web PWA. A literal App Store/TestFlight MVP is no longer on the critical path; it requires a native shell, signing, review assets, privacy/account-deletion compliance, and device testing. Native packaging can run as a parallel follow-on track only after a booting shell exists.

## Codebase reality check

This roadmap is grounded in the current codebase state rather than the desired architecture. Work that exists only on the active PR branch is marked explicitly so the next implementation slice does not start on unmerged assumptions.

| Area | Current state | Roadmap consequence |
| --- | --- | --- |
| App shell | `/apps/` contains `web-pwa` only. No Capacitor, Expo, React Native, Xcode project, or iOS shell is present. | Web PWA is the selected four-week MVP target. TestFlight/App Store is a parallel follow-on, not a launch blocker. |
| Frame point identity | PR #527 is merged into `main`. Accepted `TopicSynthesisV2.frames[]` carry `frame_point_id` and `reframe_point_id`; candidate frames may supply optional ids; the pipeline fills missing ids; web readers prefer persisted ids with legacy text-derived alias fallback. | W0.1 is complete for the MVP base. Semantic id mapping across future regenerated syntheses remains a promotion-time responsibility. |
| Sentiment key | PR #527 is merged into `main`. Active sentiment docs, schemas, readers, writers, and aggregate paths now use `(topic_id, synthesis_id, epoch, point_id)`. Only archival sprint history still references older keys. | W0.2 is complete for the MVP base; new stance work should use the four-tuple only. |
| Topic preferences | `composeFeed(...)` consumes local category/topic preferences for muted exclusions and `Hottest` boosts; FeedShell exposes category tuning from discovered feed metadata. | W1 feed tuning is now implemented at MVP level. Follow-on work can improve preference onboarding, persistence UI polish, and richer topic/entity controls. |
| Story-level engagement summary | `PointAggregateSnapshotV1` and `TopicEngagementAggregateV1` exist. A materialized `StoryEngagementSummary` rollup does not. | Story aggregate metadata is net-new compute/read model work; do not show story-level sentiment beyond per-point aggregates until this lands. |
| Source split / related links | `StoryBundle.related_links`, item eligibility policy/ledger, and UI related-link rendering exist. PR #528 ensures bundle synthesis excludes `related_links` when present and uses `primary_sources` as the analysis source set. The generic cluster publication path still does not derive `primary_sources` / `related_links` from the item-eligibility ledger by default. | Related links may display below evidence, but only analysis-eligible sources may feed summaries/frame tables. Ledger-driven source-split enrichment remains a follow-on. |
| Bundle synthesis worker | PR #528 is merged into `main`. The news-aggregator now has `bundleSynthesisWorker`, `bundleSynthesisRelay`, queue wiring, guarded latest writes, model-sensitive idempotency, and story-detail UI provenance. | W0.4 is complete for publish-time accepted synthesis. Story detail can render accepted stored synthesis or explicit pending/unavailable state without hidden card-open analysis. |
| Click-time analysis | `NewsCard` now hydrates stored `TopicSynthesisV2` on expansion and no longer calls `useAnalysis(...)` as the normal detail path. The legacy `useAnalysis` hook remains for non-card/runtime analysis paths and tests. | The headline-click contract is accepted synthesis first. Missing synthesis is surfaced as loading/pending/unavailable instead of silently generating card-open analysis. |
| Story detail stance UI | PR #532 is merged into `main`. `NewsCardBack` renders accepted synthesis frame/reframe rows with persisted `frame_point_id` / `reframe_point_id` stance targets and disables voting when accepted point ids are absent. | W2 point-stance UI is implemented at MVP level. Remaining stance work is release evidence, aggregate freshness policy, and any product polish found in smoke testing. |
| Story discussion UI | PR #533 is merged into `main`. Story detail uses deterministic `news-story:<encoded story-or-topic token>` headline thread ids, resolves exact deterministic matches before legacy topic/source matches, renders the thread below the frame/reframe table, and exposes recoverable load/create/post errors. Story-thread comment hide/restore moderation now has a typed audit path and deterministic gate coverage. Story-thread comments can be reported into the operator queue and actioned through the existing audited hide/restore records. | W2 story-thread rendering, reply composer, minimum audited hide/restore moderation, and minimum report-to-action workflow are implemented at MVP level. Remaining thread work is user block UX, compliance/policy artifacts, and richer operator workflow polish. |
| Constituency proof | Runtime proof acquisition derives an attestation-bound deterministic proof from the identity nullifier and configured district; mock proofs are rejected by voting paths; accepted stance proof is exposed as beta-local assurance. This is still not cryptographic residency proof or production Sybil resistance. | `identity-honesty-scope` resolves the Web PWA beta path: copy must say beta-local identity/proof semantics unless real cryptographic proof is explicitly pulled into scope later. |
| Release gates | `pnpm check:mvp-release-gates` now composes source health, StoryCluster correctness, deterministic Web PWA feed/detail/stance/thread/moderation smokes, the curated launch-content snapshot gate, and the report-intake/admin-action smoke. It writes `.tmp/mvp-release-gates/latest/mvp-release-gates-report.json` with per-gate `pass`, `fail`, `setup_scarcity`, or `skipped_not_in_scope` status. Compliance checklist scripts remain separate. | Week 3A release evidence harness is present for the core news loop, curated fallback content, and minimum report-to-action workflow; public launch still needs compliance artifacts and broader ops/admin polish. |
| Launch content fallback | `packages/e2e/fixtures/launch-content/validated-snapshot.json` is the committed curated fallback snapshot. `pnpm check:launch-content-snapshot` validates coverage and writes `.tmp/launch-content-snapshot/latest/launch-content-snapshot-report.json`; validated-snapshot local stack mode falls back to this committed fixture when passing publisher-canary artifacts are absent. | Internal demo/QA can exercise representative singleton, bundled, preference, accepted synthesis, correction, thread, and moderation states without live ingestion. This does not prove live ingestion freshness or source operations. |

## Non-negotiable product contract

### What the user votes on

Users do not cast sentiment on the story object directly.

Users cast stance on individual frame/reframe table items. Each cell is a specific opinion, bias, counterpoint, institutional tension, stakeholder tradeoff, rights/safety dispute, or public argument about the story.

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

- accepted `TopicSynthesisV2.frames[]` must persist a `frame_point_id` for the frame item and a `reframe_point_id` for the reframe item.
- The canonical final stance key is `(topic_id, synthesis_id, epoch, point_id)`.
- Runtime text-hash ids from `deriveSynthesisPointId(...)` become a compatibility fallback for existing data and tests.
- `vh_sentiment_agreement_aliases_v1` remains in scope as a migration/read-compatibility tool until legacy text-hash votes are no longer served.

Required behavior:

- rewording a frame or reframe item must not orphan prior stance unless the product intentionally creates a new point;
- if a synthesis regenerates the same conceptual point with edited wording, generation/promotion must preserve or map the previous `point_id`;
- if a point is materially replaced, it receives a new `point_id` and old stance remains attached to the old point;
- migrations must report mapped, unmapped, and orphaned counts;
- compatibility reads must be sunset by explicit criteria, not by hope.

Implementation status from PR #527:

- `docs/specs/spec-civic-sentiment.md` and active foundational docs use the four-tuple;
- `TopicSynthesisV2` accepted frames require stable `frame_point_id` and `reframe_point_id`;
- candidate frames may carry optional point ids, and blank point ids are rejected;
- synthesis pipeline output fills missing ids without hashing mutable display text;
- web readers prefer persisted ids and retain text-derived ids only as compatibility aliases.

Remaining follow-on:

- synthesis regeneration/promotion must preserve or map previous point ids when the same conceptual point is edited in a new accepted synthesis;
- generated fallback ids are deterministic per synthesis/row and are safe as a non-text fallback, but they are not a semantic migration strategy for materially replaced points;
- compatibility alias reads need explicit telemetry and sunset criteria before removal.

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
- no claim that public beta stance equals verified one-human-one-vote while proof semantics remain beta-local and non-cryptographic;
- local/beta identity can enforce "one local final stance" but not full Sybil resistance.

### Source and analysis semantics

The MVP must keep the analysis evidence boundary explicit:

- only extractable, analysis-eligible article text may contribute to Venn summaries and frame/reframe items;
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
5. Point-level stance controls on each frame/reframe item.
6. Aggregate point metadata and story/topic engagement summary.
7. Analyzed sources.
8. Related links that were not used as analysis evidence.
9. Threaded replies for the story.

The detail experience may start as an expanded card, but MVP quality requires stable restoration and shareability. If a full URL route is not built, the roadmap must explicitly accept "not shareable" as a beta limitation. The preferred path is a route/deep link keyed by story/topic identity.

### Conversation

Required:

- every news story has a stable thread identity (implemented for story detail in PR #533);
- thread identity is derived from the story/topic identity, not transient route state (implemented as deterministic `news-story:*` ids in PR #533);
- users can reply to the story thread (implemented in story detail in PR #533);
- replies persist across reload (covered by forum storage paths, component/store tests, and the `story_thread` MVP gate);
- thread count and latest activity can appear on feed cards;
- basic safety affordances exist: audited hide/restore moderation exists for story-thread comments, and report intake can route story-thread reports to audited hide/restore actions; user block UX, trust-gated operator roles, and broader moderation workflow polish remain open.

The forum system should be reused. The MVP should not create a second comment model.

### Point-level stance

Required:

- each frame/reframe item has three-state stance controls: Agree, Neutral, Disagree;
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
  frame_point_id: string;
  frame: string;
  reframe_point_id: string;
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

The split exists in schema/service work, feed hydration, and `NewsCardBack`
rendering. PR #528 preserves the analysis boundary for bundle synthesis by using
`primary_sources` when present and excluding `related_links` from prompt input.
The remaining source-split implementation gap is ledger-driven enrichment in
the generic bundle publication path, so bundled stories reliably publish
`primary_sources` and `related_links` with the discriminator preserved.

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

| Order | PR slice | Current status | Scope | Required output |
| --- | --- | --- | --- | --- |
| 1 | `point-id-contract` | Complete; merged in PR #527. | Persist stable `frame_point_id` and `reframe_point_id` on accepted `TopicSynthesisV2.frames[]`; keep text-derived ids as compatibility aliases. | Schema/tests/generator/readers agree on persisted point ids; alias behavior is documented. |
| 2 | `sentiment-four-tuple-spec` | Complete; merged in PR #527. | Patch sentiment docs/tests around `(topic_id, synthesis_id, epoch, point_id)`. | No active spec text describes final stance as keyed only by `(topic_id, epoch, point_id)`. |
| 3 | `launch-surface-decision` | Resolved: Web PWA. | Remove native iOS/TestFlight from the four-week critical path. | Web PWA is recorded as the MVP launch target; native packaging is a parallel follow-on. |
| 4 | `bundle-synthesis-dependency` | Complete; merged in PR #528. | Resolve PR B / bundle synthesis dependency for accepted publish-time synthesis and source split handling. | Story detail renders accepted stored synthesis or explicit pending/unavailable state without a hidden card-open analysis pass. |
| 5 | `identity-honesty-scope` | Complete; merged in PR #530. Web PWA beta uses beta-local proof assurance; real constituency proof remains deferred. | Decide beta-local identity vs real constituency proof for MVP copy and stance guarantees. | Product copy, release notes, and stance path claims match the actual proof layer. |
| 6 | `mvp-release-gates` | Complete; merged in PR #535 and hardened in PR #536; launch-content snapshot and report-intake/admin-action gates added as follow-on closeout slices. | Deterministic feed/detail/stance/thread/correction/moderation, launch-content fallback, and report-to-action release gates are named and report-backed. | `.tmp/mvp-release-gates/latest/mvp-release-gates-report.json` records command, artifact refs, timestamps, and pass/fail/setup-scarcity semantics for source health, story correctness, feed render, story detail, synthesis correction, point stance, story thread, story-thread moderation, `launch_content_snapshot`, and `report_intake_admin_action` gates. |
| 7 | `compliance-public-beta-minimums` | Open. | Privacy, terms, UGC/moderation, support, data deletion, telemetry consent, and content/copyright boundaries. | Public launch cannot proceed unless each compliance artifact has an owner and minimum accepted draft. |
| 8 | `launch-ops-and-correction-path` | Partial; accepted synthesis correction merged in PR #537 and hardened in PR #538; story-thread comment hide/restore moderation merged in PR #539; curated validated snapshot fallback is implemented; minimum report intake and operator action queue are implemented. | Model/cost telemetry, richer admin UX, and release artifact visibility remain open; bad accepted synthesis, abusive story-thread comments, and stale live-feed/demo scarcity now have minimum audited or deterministic fallback paths. | Operators have typed audit records for suppressing/unavailable accepted synthesis artifacts and hiding/restoring story-thread comments, plus a typed report queue that routes user reports to those existing actions or dismissal. Internal QA/demo has a committed curated fallback snapshot and `pnpm check:launch-content-snapshot`. Remaining launch-ops work must cover broader admin workflow UX, compliance artifacts, trust-gated operator roles, escalation policy, and runaway model visibility. |

Recommended sequencing:

- PR #527, PR #528, PR #530, PR #531, PR #532, PR #533, PR #535, PR #536, PR #537, PR #538, PR #539, and PR #542 are now in `main`; feed/detail stance/thread work can base on stable point ids, accepted publish-time synthesis, honest beta-local proof semantics, active personalization ranking, deterministic story discussion threads, release-gate evidence, accepted synthesis correction, story-thread comment hide/restore moderation, and curated fallback launch content.
- Compliance, broader admin workflow UX, trust-gated operator roles, and ops/cost visibility are now the highest-value Week 0 blockers. The core feed/detail/stance/thread product loop, minimum correction/moderation remediation paths, report intake/admin action path, and curated fallback launch content have implementation and deterministic release-gate coverage.
- Week 1 starts only after every row in the go/no-go table has a `go` decision or an explicit accepted no-go consequence.

### Week 0 go/no-go table

| Blocker | Current decision | Go condition | No-go consequence |
| --- | --- | --- | --- |
| Persisted frame/reframe point ids | Go; PR #527 is merged into `main`. | Accepted synthesis frames carry stable `frame_point_id` and `reframe_point_id`; legacy text-hash ids are compatibility only. | Do not regress to text-hash ids. Building on text-hash ids knowingly ships vote orphaning on frame edits. |
| Sentiment key | Go; PR #527 is merged into `main`. | Docs, schemas, readers, writers, and tests agree on `(topic_id, synthesis_id, epoch, point_id)`. | Do not split stance work across contributors; conflicting three-tuple/four-tuple implementations will corrupt compatibility assumptions. |
| Launch surface | Go: Web PWA. | Web PWA remains the launch target; native shell work is outside the four-week critical path. | If native packaging becomes required again, restart scope and schedule around a real iOS build gate. |
| Bundle synthesis path | Go; PR #528 is merged into `main`. | Accepted publish-time synthesis, model id, generated time, warnings, and provenance are available to story detail; missing synthesis has explicit loading/pending/unavailable states. | Do not reintroduce hidden card-open analysis as the normal path. |
| Topic preferences | Go; PR #531 is merged into `main`. | Ranking/filter semantics are defined and have deterministic tests proving preferences change feed output. | Do not regress to inert preference controls. |
| Identity/proof | Go for Web PWA beta. Current stance path is beta-local and must stay labeled that way. | Real cryptographic constituency proof is active, or beta-local identity constraints and copy are approved. | No verified-human, one-human-one-vote, district-proof, or Sybil-resistant claims in product copy. |
| Story detail stance UI | Go; PR #532 is merged into `main`. | Accepted synthesis frame/reframe items expose persisted point ids and missing point ids produce non-votable cells. | Do not reintroduce text-derived canonical write ids for accepted synthesis. |
| Story discussion UI | Go for MVP interaction; PR #533 is merged into `main`. | Story detail uses deterministic `news-story:*` ids, exact deterministic ids win over legacy topic/source matches, and load/create/post failures are visible. | Do not create a second story comment model or route story replies through transient card state. |
| Story engagement rollup | No-go for visible story aggregate sentiment. | `StoryEngagementSummary` is either implemented as a derived read model or explicitly deferred from visible UI. | Do not show story-level aggregate sentiment beyond existing per-point aggregate data. |
| Release gates | Go for the core Web PWA news loop. | `pnpm check:mvp-release-gates` passes and writes `.tmp/mvp-release-gates/latest/mvp-release-gates-report.json`. | Do not claim release-readiness from source health or story correctness alone; the MVP gate report is the required loop evidence. |
| Compliance | No-go for public beta. | Privacy, terms, UGC/moderation, support, data deletion, telemetry consent, and content/copyright minimums have accepted drafts. | No public beta or App Store/TestFlight submission. Internal-only testing can continue. |
| Launch content fallback | Go for internal demo/QA fallback. | A curated validated snapshot exists with enough stories to exercise singleton, bundle, preferences, accepted synthesis frames, stance targets, analyzed sources, related links, deterministic story threads, synthesis correction, and comment moderation states. `pnpm check:launch-content-snapshot` passes and `pnpm check:mvp-release-gates` includes `launch_content_snapshot`. | This does not make live ingestion healthy or compliant for public launch. Keep live freshness/source-ops claims separate from curated fallback readiness. |
| Correction/admin path | Go for minimum MVP remediation controls; accepted synthesis correction, story-thread comment hide/restore moderation, and report intake/admin action queue are implemented. | Users can report accepted synthesis artifacts and story-thread comments; operators can dismiss reports or apply existing suppress/unavailable/hide/restore actions with typed audit metadata and `source_report_id` provenance; story detail hides stale summary/frame rows and moderated comment content; `pnpm check:mvp-release-gates` includes deterministic `synthesis_correction`, `story_thread_moderation`, and `report_intake_admin_action` smokes. | Public launch still needs compliance artifacts, policy text, trust-gated operator roles, notification/escalation workflow, and broader admin UX polish; do not imply a full trust-and-safety operations console exists. |
| Ops/cost visibility | Partial. | Model ids, model invocation counts, source health artifacts, release report path, and bad-analysis reports are visible. | Remote-model spend and product failures remain opaque; do not scale beyond a small internal beta. |

### W0.1 Persisted point ids

Decision: make persisted frame/reframe point ids the canonical path.

Status: implemented in PR #527 and merged into `main`.

Implemented:

- extend `TopicSynthesisV2.frames[]` schema with stable `frame_point_id` and `reframe_point_id`;
- update synthesis generation/promotion to assign/preserve point ids;
- keep text-hash derived ids as legacy aliases;
- document rewording behavior;
- add tests for preserved point id across text edits and blank/invalid point id rejection.

Still required in the synthesis promotion layer:

- preserve or map point ids across regenerated accepted syntheses when a conceptual point survives wording edits;
- assign a new point id when a point is materially replaced.

Exit criteria:

- spec, schema, generator, readers, and tests agree on the four-tuple key;
- alias map is documented as compatibility, not core product design.

### W0.2 Spec key patch

Decision: the canonical key is `(topic_id, synthesis_id, epoch, point_id)`.

Status: implemented in PR #527 and merged into `main`.

Implemented:

- patch `docs/specs/spec-civic-sentiment.md`;
- patch related tests/docs that still describe a three-tuple;
- call out dual-write/backfill/compatibility-read expectations.

Exit criteria:

- no normative doc says final stance is keyed only by `(topic_id, epoch, point_id)`.

### W0.3 Launch surface decision

Decision: Web PWA MVP. Native iOS/TestFlight is a parallel follow-on.

Required only if App Store/TestFlight is reintroduced into launch scope:

- choose Capacitor/Expo/native path;
- boot app on simulator/device;
- define signing/team/profile requirements;
- add a build command;
- add smoke test expectations;
- budget privacy/account deletion/moderation assets.

Exit criteria:

- "Web PWA MVP" remains the four-week launch surface.
- If "iOS MVP" is later required, it must have a booting shell and named build gate before entering the critical path.

### W0.4 Bundle synthesis dependency

Decision: launch detail should use accepted publish-time synthesis.

Status: implemented in PR #528 and merged into `main`.

Implemented:

- news-aggregator bundle synthesis worker and relay;
- model-sensitive idempotency and duplicate-candidate recovery;
- guarded latest synthesis writes;
- publish-time synthesis provenance surfaced in story detail;
- explicit loading, pending, and unavailable states when accepted synthesis is absent;
- card detail no longer treats runtime `useAnalysis(...)` as the normal path.

Remaining follow-on:

- ledger-driven `primary_sources` / `related_links` enrichment in the generic bundle publication path;
- correction/admin controls for suppressing or regenerating bad accepted synthesis artifacts;
- deterministic release smoke that proves current feed snapshots contain accepted synthesis coverage.

Exit criteria:

- headline click renders from stored bundle/detail data without an invisible blocking analysis pass.

### W0.5 Identity honesty

Decision: MVP ships with beta-local identity unless real constituency proof is pulled into scope.

Required:

- product copy must avoid verified-human or one-human-one-vote claims if proof remains beta-local and non-cryptographic;
- stance path must still enforce local final stance and budgets;
- release notes must distinguish beta-local identity from future LUMA proof.
- runtime proof state must expose assurance metadata so UI copy can distinguish beta-local stance persistence from future production proof.

Exit criteria:

- no user-facing claim exceeds the actual proof layer;
- accepted deterministic proof is labeled beta-local in the stance UI;
- missing-proof and blocked-stance copy tells the user to create/sign in or restore beta-local proof without claiming production verification.

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

- `StoryDetail` view model normalized around `topic_id`, `story_id`, `synthesis_id`, `epoch`, and frame/reframe `point_id` (implemented through the accepted `NewsCardBack` story detail path in PR #532);
- analyzed-source/related-link discriminator plumbed from bundle publication into feed hydration and rendering;
- topic preference ranking/filter semantics implemented in `composeFeed` (implemented in PR #531);
- story-to-thread mapping stabilized (implemented in PR #533 with deterministic `news-story:*` ids);
- story engagement summary designed as a derived read model, with privacy limits for `readers` and `engagers`;
- analysis cache contract implemented: accepted synthesis first, explicit pending/unavailable state on miss (implemented in PR #528);
- deep-link/shareability decision made and implemented or explicitly deferred as beta limitation;
- launch branch has clear MVP gate commands.

Acceptance checks:

- singleton story detail fixture renders;
- bundled story detail fixture renders;
- story with related links renders related links separately from analyzed sources;
- frame/reframe items expose persisted point ids;
- preferences visibly change feed output;
- no click path performs an unannounced blocking analysis pass;
- docs and tests reference point-level stance, not story-level voting.

### Week 2: Detail, thread, and point stance implementation

Objective: make headline click valuable and interactive.

Deliverables:

- polished story detail surface (implemented for accepted synthesis detail in PR #528, PR #532, and PR #533; smoke testing may still force polish fixes);
- frame/reframe stance controls on every eligible item (implemented in PR #532);
- ARIA/keyboard behavior for stance controls (implemented for current stance controls; retain in release smoke coverage);
- local stance restore after reload;
- mesh/event enqueue for stance intents;
- rate limits and budgets on stance write attempts;
- aggregate counters render from public aggregate or a clearly labeled fallback;
- aggregate freshness labels;
- story thread renders below the frame/reframe table (implemented in PR #533);
- reply composer and reply list are usable on story detail (implemented in PR #533);
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
| Feed smoke | `pnpm check:mvp-release-gates` includes `feed_render` | Fixture-backed Web PWA smoke proves feed render plus preference ranking/filtering. |
| Story-detail smoke | `pnpm check:mvp-release-gates` includes `story_detail` | Fixture-backed smoke opens headline detail from accepted `TopicSynthesisV2`. |
| Synthesis correction smoke | `pnpm check:mvp-release-gates` includes `synthesis_correction` | Fixture-backed smoke proves a corrected accepted synthesis does not render stale summary/frame rows and exposes audit provenance. |
| Point-stance persistence/convergence smoke | `pnpm check:mvp-release-gates` includes `point_stance` | Story detail smoke writes/restores final stance against accepted synthesis point ids. |
| Thread persistence smoke | `pnpm check:mvp-release-gates` includes `story_thread` | Deterministic `news-story:*` thread id, reply persistence, and reload attachment are covered. |
| Story-thread moderation smoke | `pnpm check:mvp-release-gates` includes `story_thread_moderation` | Fixture-backed smoke proves audited hide/restore moderation hides abusive reply content while preserving the deterministic story thread. |
| Launch-content fallback snapshot | `pnpm check:mvp-release-gates` includes `launch_content_snapshot`; separate command is `pnpm check:launch-content-snapshot` | Curated snapshot validates singleton stories, bundles, preference ranking/filtering, accepted synthesis point ids, analyzed-source versus related-link boundaries, deterministic story threads, persisted replies, synthesis correction, and hidden/restored comment moderation states. |
| Report intake/admin action smoke | `pnpm check:mvp-release-gates` includes `report_intake_admin_action` | Deterministic Web PWA smoke proves pending synthesis and story-thread reports appear in the operator queue and route to audited remediation/dismissal actions. |
| iOS build | Missing because no iOS shell | Only required if Week 0 chooses iOS. |
| Privacy/UGC/deletion checklist | Missing | Add Week 3B; public launch blocker. |

## Additional risks not in the first draft

### Summary accuracy and correction path

The MVP's value rests on accurate summaries and frame/reframe items. The release plan needs a correction path:

- users can report inaccurate analysis;
- users can report abusive story-thread comments;
- operators can dismiss reports or route them to existing remediation records;
- operators can suppress or mark unavailable a bad analysis artifact;
- report audit metadata links operator remediation artifacts back through `source_report_id`;
- accepted `TopicSynthesisV2` artifacts now have a typed correction record for `suppressed` or `unavailable` state, with operator id, reason code, timestamp, and audit metadata;
- story detail hides corrected accepted synthesis summaries/frame rows and shows the correction provenance instead;
- story-thread comments now have a typed hide/restore moderation record with operator id, reason code, timestamp, and audit metadata;
- story detail hides moderated abusive reply content and shows a moderation placeholder instead;
- launch copy does not imply editorial omniscience.

Still required: regeneration workflow polish, compliance policy artifacts, trust-gated operator roles, notifications/escalation policy, and broader admin workflow UX.

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
- moderation/reporting budgets for thread abuse beyond the minimum report queue.

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

## Resolved decisions from the alignment audit

1. The four-week launch surface is Web PWA.
2. Native App Store/TestFlight work is a parallel follow-on until a real shell/build gate exists.
3. Persisted frame/reframe point ids are canonical.
4. The canonical stance key is `(topic_id, synthesis_id, epoch, point_id)`.
5. Text-derived point ids are compatibility aliases, not the future write identity.
6. Story sentiment remains derived metadata over point-level stance; there is no generic story vote in the MVP.
7. Story discussion uses the existing Hermes forum model with deterministic story-linked headline threads; no second comment model is needed for the MVP.

## Open review questions

1. What is the aggregate freshness budget before counts are labeled stale or hidden?
2. What is the minimum public aggregate display: raw agree/disagree counts per point, percentage bars, high-divergence badges, or all three?
3. Should story cards show aggregate stance previews, or should point-level sentiment remain detail-only for MVP?
4. What is the minimum acceptable mesh persistence proof for launch: local enqueue plus public aggregate fallback, or full multi-user convergence evidence?
5. Should related links be visible by default or collapsed below analyzed sources?
6. Are beta-local identity semantics acceptable for launch copy, or must real constituency proof move into Week 0 scope?

## Definition of done for this plan

The plan is ready to build when reviewers agree on:

- Web PWA launch surface remains accepted;
- PR #527 is in the implementation base for persisted point ids and the four-tuple sentiment contract;
- PR #528 is in the implementation base for accepted publish-time bundle synthesis;
- PR #531 is in the implementation base for feed personalization ranking;
- PR #532 is in the implementation base for accepted-synthesis stance UI;
- PR #533 is in the implementation base for deterministic story-thread detail integration;
- PR #535 and PR #536 are in the implementation base for deterministic MVP release-gate evidence;
- PR #537 and PR #538 are in the implementation base for accepted synthesis correction;
- PR #539 is in the implementation base for audited story-thread comment hide/restore moderation;
- story-level sentiment as aggregate metadata only;
- analyzed-source versus related-link evidence boundaries;
- accepted publish-time synthesis as the headline-click data contract;
- reuse of existing forum threads for story discussion;
- deterministic release checks replacing the broken scheduled automation gate;
- curated launch-content fallback snapshot coverage replacing live-feed luck for internal demos and QA;
- beta identity claims that match the actual proof layer;
- the Week 0 plus four-week sequence above as the working launch plan.
