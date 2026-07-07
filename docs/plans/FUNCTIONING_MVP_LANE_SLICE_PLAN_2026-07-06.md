# Functioning MVP Lane Slice Plan - 2026-07-06

> Status: Technical implementation and operating plan, v2 refined for initial release goals
> Owner: VHC Core Engineering + VHC Launch Ops
> Last Reviewed: 2026-07-06
> Target: Venn News Web PWA initial release MVP
> Depends On: `docs/foundational/STATUS.md`, `docs/plans/VENN_NEWS_MVP_ROADMAP_2026-04-20.md`, `docs/specs/topic-synthesis-v2.md`, `docs/specs/spec-civic-sentiment.md`, `docs/specs/spec-luma-service-v0.md`, `docs/specs/spec-identity-trust-constituency.md`, `docs/specs/spec-civic-action-kit-v0.md`, `docs/ops/BETA_SESSION_RUNSHEET.md`, `docs/ops/public-beta-launch-readiness-closeout.md`, `docs/ops/news-aggregator-production-service.md`, `docs/ops/public-feed-freshness-monitor.md`, `docs/ops/vhc-incident-response.md`, `docs/reports/phase5-scope-a-post-slice0-current-state-2026-07-06.md`

## Executive Decision

The initial release goal is narrower and sharper than "all MVP-adjacent VHC
features." Users must be able to:

1. register or sign in through a familiar account shell;
2. create or attach a beta-local LUMA identity to that account session;
3. read accepted Venn summaries on story detail;
4. see an accepted-current bias/framing table;
5. vote on frame/reframe points only when stable `frame_point_id` and
   `reframe_point_id` values exist;
6. have one final stance per user per point persist and converge across
   browsers;
7. have Eye/Lightbulb engagement accounting follow the Season 0 model; and
8. tie those civic sentiments to a beta-local constituency/representative
   mapping through aggregate-only district/office surfaces.

This is still a Web PWA release. Native app packaging, public WSS mesh
`release_ready`, LUMA Silver, verified-human proof, one-human-one-vote,
cryptographic residency, cross-device per-human nullifier binding, and Codex
live production execution are not part of the initial release claim.

## Review Verdict On The Previous Plan

The first plan had the right safety spine: keep Scope A raw-feed reliability in
front of enrichment, preserve the email alert guardrail, keep Codex execution
dry-run, and require release evidence on the intended commit. It was too broad
for the product goal, and it under-specified three release-critical joins.

Required refinements:

- Accepted summaries and the framing table must be the first product lane, not
  a generic "accepted synthesis later" note.
- Vote controls must be tied to `accepted-current` lifecycle joins, not merely
  the presence of a `TopicSynthesisV2`.
- The account lane must exist explicitly. Current repo reality has beta-local
  LUMA identity and linked-social storage primitives, but not a completed
  Apple/Google/X sign-in release flow.
- Social login must not be described as human uniqueness. It is account
  continuity/profile recovery; LUMA beta-local identity supplies the current
  release's device-bound `PrincipalId`/`Nullifier` semantics.
- Constituency/representative mapping must be a first-class lane. The current
  representative selector primitives exist, but `RepresentativeSelector` still
  calls `findRepresentatives('')`, so it cannot satisfy local-office mapping
  until the user's district hash is wired through.
- The release rehearsal must exercise the product proof loop directly:
  accepted summary/table, vote persistence, LUMA signed writes, account binding,
  constituency mapping, and the manual 3-browser persistence check.

This document is the refined plan that closes those gaps.

## Current State Of Play

As of this plan:

- Repo `main` is `76f3c77c` after PR #724 aligned docs with the post-Slice-0
  recovery state.
- PR #725 carries this plan on
  `coord/functioning-mvp-lane-plans-2026-07-06`.
- Live A6 was updated to `main@47ba218d` after PR #723 fixed the StoryCluster
  production timeout path. Treat newer docs-only commits as repo truth until an
  operator explicitly updates A6 again.
- Slice 0 is complete: host-private email alerting is configured, test
  delivery reached the operator device, and both
  `vh-public-feed-alert-watch.timer` and
  `vh-phase5-scope-a-watch-closure.timer` are enabled and active.
- The normal post-fix publisher tick completed at
  `2026-07-06T22:44:08.567Z` with `ingested_item_count=24`,
  `selected_bundle_count=8`, `raw_wrote_count=8`, and
  `raw_write_failed_count=0`.
- Public feed freshness, relay liveness, relay snapshot freshness,
  watch-closure input, and alert watch passed after recovery.
- The clean evidence window starts at `2026-07-06T22:44:08.567Z`.
- The 48-hour proof target is `2026-07-08T22:44:08Z`.
- The 14-day unattended target is `2026-07-20T22:44:08Z` if no operator touch
  or anomaly resets the window.
- No post-recovery 500 MB -> 700 MB early heap-summary pair exists yet.
- The current driver remains `heap_driver_off_graph_likely`; no memory
  remediation is authorized until secret-safe heap summaries name the retainer.
- Codex live execution/autonomy is disabled. The executor stays dry-run.
- The custom pager/PWA exists in repo after PR #722, but email remains the
  active live alert path until a later pager deployment outside A6.

## Non-Negotiable Release Semantics

### Summary And Framing Table

The release experience must use accepted `TopicSynthesisV2`, not provisional
card-open analysis, as the votable release artifact.

Per `docs/specs/topic-synthesis-v2.md`, story detail may enable vote controls
only after joining the story lifecycle record and synthesis record:

- lifecycle record status is `accepted_available`;
- lifecycle `source_set_revision` matches the current `StoryBundle.provenance_hash`;
- lifecycle `synthesis_id` and `epoch` match the `TopicSynthesisV2`;
- `TopicSynthesisV2.inputs.story_bundle_ids` includes the current `story_id`;
- `facts_summary` is non-empty;
- frame/reframe rows are present; and
- every votable row has stable `frame_point_id` and `reframe_point_id` values
  that are not derived from mutable display text.

If any of those joins fail, the UI may show summary/table status as loading,
pending, retryable failure, terminal unavailable, or suppressed by correction,
but it must not show active vote controls.

### Vote And Engagement Semantics

Per `docs/specs/spec-civic-sentiment.md`:

- users vote on individual frame/reframe points, not whole stories;
- one user has one final stance per
  `(topic_id, synthesis_id, epoch, point_id)`;
- `agreement = 0` is neutral and non-counting;
- event-level signals with constituency proof are sensitive and must stay
  local/encrypted;
- public paths contain aggregate-only projections;
- public aggregate voter nodes use topic/epoch-scoped `voterId`, never raw
  nullifier; and
- Eye and Lightbulb are capped by the Season 0 decay model, with
  `E_cap = 1.95`.

### Account And LUMA Semantics

Initial release account language must say this clearly:

- Apple/Google/X sign-in is account continuity and profile recovery.
- Social login is not proof of human uniqueness.
- In the current public-beta profile, LUMA provides beta-local identity:
  `PrincipalId`, `principalNullifier`, `forumAuthorId`,
  `identityDirectoryKey`, and topic/epoch-scoped `voterId`.
- Current `principalNullifier` is device-bound. A user signing in on another
  device does not automatically prove the same human and must not silently
  inherit old votes as the same principal.
- LUMA Silver, verified-human, one-human-one-vote, Sybil resistance,
  cryptographic residency, and cross-device per-human binding remain deferred.

Internally, the release may describe the beta-local LUMA `principalNullifier`
as the current device-bound uniqueness identifier. User-facing copy must not
call it a verified-human identifier.

### Constituency And Representative Semantics

Per `docs/specs/spec-identity-trust-constituency.md`:

- `ConstituencyProof` shape is
  `{ district_hash, nullifier, merkle_root }`;
- `district_hash` and `nullifier` together are sensitive;
- the pair must not appear in public mesh documents or on-chain storage;
- district dashboards and representative-facing surfaces are aggregate-only;
- `district_hash` may appear publicly only in allowed aggregate/dashboard
  records that meet cohort thresholds; and
- Season 0 proof acquisition is beta-local, not cryptographic residency proof.

For initial release, "register opinion with local reps/offices" means:

- capture a beta-local constituency proof at vote admission time;
- verify the proof matches the active LUMA principal and configured district;
- map the district hash to representative directory snapshots;
- materialize aggregate district/office sentiment only when privacy thresholds
  allow it; and
- never expose raw address, raw region code, nullifier, proof material, OAuth
  tokens, or per-user district rows in public records.

Actual outbound delivery to a representative office is a separate Civic Action
Kit send lane unless release copy explicitly includes and proves that behavior.

## Hard Operational Boundaries

These boundaries still apply while product lanes progress:

- Do not restart the publisher while feed freshness remains green.
- Do not restart relays while relay liveness and snapshot freshness remain
  green.
- Do not enable Codex live execution or production autonomy.
- Do not deploy/cut over the custom pager before the email path continues to
  prove itself and the pager is deployed outside A6 with its own dead-man.
- Do not run retention, relay compaction, publisher clear, eviction, pruning,
  or memory remediation before the first post-recovery 500 MB -> 700 MB
  analyzer summary classifies the retainer.
- Do not promote raw-feed recovery into accepted-synthesis, mesh, native,
  identity-assurance, or production-readiness claims.
- Treat a new alert email as an incident, not setup noise.

## Parallel Lane Map

```text
Safety rail:
  Scope A raw-feed freshness + email alert proof + heap evidence boundary

Initial release product lanes:
  A. Accepted summary and framing table readiness
  B. Stance/vote persistence and aggregate engagement
  C. Account and sign-in shell
  D. LUMA public-beta identity binding
  E. Constituency and representative mapping
  F. Release evidence rehearsal

Post-initial-release rails:
  Pager/PWA incident system, Codex dry-run responder, Scope B storylines,
  Silver/production attestation, native app, public WSS mesh, live executor
```

The product lanes can proceed in parallel in local/staging/repo work. A6 live
mutation remains gated by the safety rail.

## Safety Rail - Scope A Reliability And Evidence Accrual

### Goal

Keep the recovered raw public feed fresh, observable, and untouched while the
product lanes advance off-host. The MVP cannot ship on a stale or silent feed.

### Grounded Surfaces

- `docs/reports/phase5-scope-a-post-slice0-current-state-2026-07-06.md`
- `docs/ops/news-aggregator-production-service.md`
- `docs/ops/public-feed-freshness-monitor.md`
- `tools/scripts/public-feed-alert-watch.mjs`
- `tools/scripts/phase5-scope-a-watch-closure.mjs`
- `tools/scripts/analyze-early-heap-captures.mjs`
- `services/news-aggregator/src/index.ts`
- `packages/ai-engine/src/newsRuntime.ts`

### Slices

1. **No-change watch window.** Leave publisher, StoryCluster, relays, alert
   timers, and watch-closure timers in their current healthy state. Record
   readbacks only on scheduled review or alert.
2. **Alert-first incident branch.** Any new alert pauses enrichment work.
   Diagnose read-only first: latest tick, StoryCluster stage, raw write counts,
   relay liveness, snapshot freshness, latest public index age, alert verdict.
3. **Heap evidence intake.** When the post-recovery 500 MB -> 700 MB pair
   appears, run only secret-safe analyzer summaries. Do not remediate until the
   retainer is named.
4. **`system-writer-validation-failed` watch.** One warning stays a watch item
   while writes/readbacks/freshness pass. Repetition across normal ticks opens
   a focused repo-side investigation.

### Done

- 48-hour proof target passes or a precise incident report exists.
- Heap evidence is handled by analyzer summary only.
- No live mutation happens merely because product lanes are ready.

## Lane A - Accepted Summary And Framing Table Readiness

### Goal

Make the release story-detail experience dependable: users open a story, read
an accepted summary, see the accepted-current bias/framing table, and get vote
controls only when the table is safe to vote on.

### Grounded Surfaces

- `docs/specs/topic-synthesis-v2.md`
- `services/news-aggregator/src/bundleSynthesisWorker.ts`
- `services/news-aggregator/src/bundleSynthesisRelay.ts`
- `services/news-aggregator/src/bundleSynthesisDaemonConfig.ts`
- `services/news-aggregator/src/bundleSynthesisQueue.ts`
- `packages/gun-client/src/synthesisAdapters.ts`
- `packages/gun-client/src/analysisAdapters.ts`
- `apps/web-pwa/src/components/feed/NewsCard.tsx`
- `apps/web-pwa/src/components/feed/NewsCardBack.tsx`
- `apps/web-pwa/src/components/feed/CellVoteControls.tsx`
- `apps/web-pwa/src/hooks/useAnalysis.ts`
- `docs/ops/news-aggregator.env.example`

### Slice A1 - Accepted-Current Read Model

Implementation plan:

- Make the story-detail read path explicitly join:
  `StoryBundle`, `vh/news/stories/<storyId>/synthesis_lifecycle/latest`,
  `vh/topics/<topicId>/epochs/<epoch>/synthesis`, and
  `vh/topics/<topicId>/latest`.
- Define one UI-ready object for story detail:
  `acceptedCurrentSynthesis | pending | retryable_failure |
  terminal_unavailable | suppressed_by_correction | invalid`.
- Reject as votable when lifecycle source revision, synthesis id, epoch, story
  id, or system-writer validation does not match.
- Keep provisional/card-open analysis labeled non-votable if it remains
  reachable in any dev path.

Tests:

- lifecycle/synthesis mismatch keeps vote controls disabled;
- missing point ids keep vote controls disabled for that row;
- corrected/suppressed synthesis is not votable;
- invalid system-writer record fails closed with observable state.

### Slice A2 - Summary And Table UX

Implementation plan:

- Story detail must show:
  - summary/facts text;
  - generated time and epoch;
  - source evidence boundary;
  - frame/reframe table;
  - warning/divergence labels when present; and
  - pending/unavailable reason class when accepted synthesis is absent.
- Table rows must bind each visible frame cell to `frame_point_id` and each
  reframe cell to `reframe_point_id`.
- Vote buttons render only when the specific cell has a valid point id and
  accepted-current context.

Tests:

- accepted synthesis renders summary and frame/reframe rows;
- terminal unavailable renders honest non-votable state;
- retryable failure remains visible but non-votable;
- no public synthesis object contains nullifier, district hash, OAuth tokens,
  or provider secrets.

### Slice A3 - Production Canary Plan

Implementation plan:

- Do not start this on A6 until the safety rail allows enrichment.
- Keep storylines/topic synthesis enrichment disabled for first canary unless a
  separate packet explicitly includes them.
- Keep raw publication first and accepted synthesis decoupled from raw write
  success.
- Canary env deltas must be explicit and reversible:
  - `VH_BUNDLE_SYNTHESIS_ENABLED=true`
  - `VH_BUNDLE_SYNTHESIS_WRITE_RELAY_REST=true`
  - `VH_BUNDLE_SYNTHESIS_RELAY_WRITE_MIN_SUCCESS=2`
  - bounded timeout/rate/cap values
  - rollback to accepted synthesis disabled
- Stop if raw publication fails, relay quorum falls below 2-of-3, accepted
  synthesis readback fails repeatedly, or heap behavior changes materially.

Done:

- At least one singleton and one bundled story have accepted-current readback
  and a safe votable table in Web PWA detail.

## Lane B - Stance/Vote Persistence And Aggregate Engagement

### Goal

Harden the actual civic loop: one final stance per user per point, local or
encrypted event-level signal, public aggregate-only counts, Eye/Lightbulb
accounting, and 3-browser persistence proof.

### Grounded Surfaces

- `docs/specs/spec-civic-sentiment.md`
- `apps/web-pwa/src/hooks/useSentimentState.ts`
- `apps/web-pwa/src/hooks/voteAdmission.ts`
- `apps/web-pwa/src/hooks/voteIntentQueue.ts`
- `apps/web-pwa/src/hooks/voteIntentMaterializer.ts`
- `apps/web-pwa/src/hooks/voteIntentProjection.ts`
- `apps/web-pwa/src/hooks/lumaAggregateVoterRecords.ts`
- `apps/web-pwa/src/components/feed/CellVoteControls.tsx`
- `apps/web-pwa/src/components/feed/voteSemantics.ts`
- `packages/gun-client/src/sentimentAdapters.ts`
- `packages/gun-client/src/sentimentEventAdapters.ts`
- `packages/gun-client/src/aggregateAdapters.ts`
- `packages/gun-client/src/topicEngagementAdapters.ts`
- `packages/data-model/src/schemas/hermes/sentiment.ts`

### Slice B1 - Unified Vote Admission

Implementation plan:

- Feed and any analysis/detail surface must use identical admission rules:
  valid active identity, valid beta-local constituency proof, valid
  accepted-current synthesis context, valid point id, and budget/policy pass.
- Admission success means a `VoteAdmissionReceipt` and durable local intent,
  not guaranteed remote projection completion.
- Denial reasons must be visible enough for support and telemetry:
  missing identity, expired identity, missing proof, invalid proof, non-current
  synthesis, missing point id, budget/policy denial, write queue failure.

Tests:

- no bypass write path exists for feed/detail voting;
- stale or non-current synthesis denies voting;
- mock/transitional proof is rejected in strict mode;
- denial telemetry contains no nullifier or proof material.

### Slice B2 - Intent, Projection, And Last-Write-Wins

Implementation plan:

- Preserve last-write-wins per `(voter_id, topic_id, synthesis_id, epoch,
  point_id)`.
- Keep `VoteIntentRecord` local durable queue state; never copy it to public
  mesh paths.
- Publish `aggregate-voter-node-v1` with `_writerKind: 'luma'`,
  `_authorScheme: 'voter-v1'`, and `SignedWriteEnvelope.audience =
  'vh-aggregate-voter'`.
- Verify path `voterId`, payload `voter_id`, envelope `publicAuthor`, and
  signed payload tuple all match before aggregate fan-in.

Tests:

- `+1`, `-1`, neutral reset, and vote mutation converge correctly;
- public aggregate voter node uses topic/epoch-scoped `voterId`;
- raw nullifier, district hash, merkle root, and address never appear in
  public aggregate paths.

### Slice B3 - Eye/Lightbulb And Aggregate Summary

Implementation plan:

- Eye increments on full read/expand events.
- Lightbulb is driven only by active stance interactions, never by source count,
  synthesis quorum, or other proxy values.
- Use capped diminishing returns with `E_cap = 1.95`.
- Public feed counters read topic engagement aggregate first, with documented
  fallback to feed snapshot plus local persisted decayed weight.
- Topic engagement summary writes remain system-writer records.

Tests:

```bash
corepack pnpm@9.7.1 check:public-feed:stance-aggregate-decay
corepack pnpm@9.7.1 check:luma-topic-engagement-summary-system-v1
corepack pnpm@9.7.1 check:luma-aggregate-voter-v1
```

### Slice B4 - Three-Browser Persistence Proof

Implementation plan:

- Elevate the manual 3-browser check in
  `docs/ops/BETA_SESSION_RUNSHEET.md` to a release rehearsal requirement.
- Browser A, B, and C each get their own identity.
- All three open the same accepted-current story.
- A votes; B and C see aggregate.
- B votes; A and C see aggregate.
- C votes opposite; A and B see aggregate.
- A changes vote; all clients converge.
- All reload; analysis, vote cells, and aggregate state survive reload.

Done:

- Manual 3-browser check passes with no privacy leaks and no local-only
  aggregate illusion.

## Lane C - Account And Sign-In Shell

### Goal

Provide a user-facing registration/sign-in shell with Apple, Google, and X as
account providers while preserving the LUMA boundary: account sign-in is
continuity and recovery, not human uniqueness proof.

### Grounded Surfaces

- `apps/web-pwa/src/hooks/useIdentity.ts`
- `apps/web-pwa/src/routes/AccountIdentityPage.tsx`
- `apps/web-pwa/src/store/identityProvider.ts`
- `apps/web-pwa/src/store/linkedSocial/accountStore.ts`
- `apps/web-pwa/src/store/linkedSocial/tokenVault.ts`
- `apps/web-pwa/src/store/identityProvider.browser.test.ts`
- `apps/web-pwa/src/store/news/hydration.identity.test.ts`
- `packages/identity-vault/src/vault.ts`
- `packages/identity-vault/src/compartments/deviceCredential.ts`
- `packages/identity-vault/src/compartments/delegationSigningKey.ts`
- `docs/specs/secure-storage-policy.md`

### Slice C1 - Account Provider Contract

Implementation plan:

- Define a closed provider enum for the release: `apple`, `google`, `x`.
- Use OAuth/OIDC with PKCE through a backend/callback boundary where provider
  client secrets never enter the browser bundle.
- Store only non-secret display/account metadata in the account shell.
- Store provider tokens, if retained at all, in the existing token/vault path;
  never write them to public mesh, logs, support issues, telemetry, or release
  evidence.
- Normalize provider subject to a private account binding. Public projections
  may use a provider/account display label only after sanitization.

Tests:

- provider tokens cannot appear in public projections;
- account records validate against a closed schema;
- unsupported provider ids are rejected;
- sign-out clears session state without claiming network deletion.

### Slice C2 - Account-To-LUMA Binding

Implementation plan:

- Sign-in flow:
  1. user chooses Apple/Google/X;
  2. account shell authenticates provider subject;
  3. app hydrates or creates beta-local LUMA identity from the vault;
  4. app binds account shell to the active device-bound `PrincipalId` /
     `principalNullifier` locally;
  5. stance/forum/report writes use LUMA signed-write envelopes, not raw social
     account identity.
- If a user signs in on a new device, the MVP must not silently merge the old
  LUMA principal. It may show account continuity/profile state, but old votes
  remain under the old device-bound principal unless a later multi-device link
  feature is built and approved.
- If a user resets identity, account binding must record that the old public
  artifacts are not deleted or re-authored.

Tests:

- same browser sign-out/sign-in preserves the local LUMA identity unless Reset
  Identity is invoked;
- Reset Identity rotates the LUMA principal and leaves historical artifacts
  under the prior pseudonyms;
- another browser/device sign-in does not claim same-human continuity;
- copy and telemetry avoid verified-human/one-human-one-vote language.

### Slice C3 - Account UI And Recovery Copy

Implementation plan:

- Account page must show:
  - sign-in provider status;
  - LUMA beta-local identity status;
  - session expiry/renewal state;
  - sign-out action;
  - reset identity action with irreversible-effects explanation;
  - linked provider management;
  - clear limitation copy for device-bound identity.
- First vote attempt without account/identity should route user into sign-in
  or beta-local identity creation, then back to the same story/point.
- Sign-in failure must not strand the user with a partially admitted vote.

Done:

- A new user can register/sign in, create or attach beta-local LUMA identity,
  return to the story, and vote without hidden identity claims.

## Lane D - LUMA Public-Beta Identity Binding

### Goal

Use the current public-beta LUMA model for all write actions: beta-local
`PrincipalId`/`Nullifier`, `SignedWriteEnvelope`, topic/epoch-scoped `voterId`,
and action-policy enforcement. Keep the copy and topology honest.

### Grounded Surfaces

- `docs/specs/spec-luma-service-v0.md`
- `docs/ops/luma-verifier-current-state.md`
- `packages/luma-sdk/src/assurance.ts`
- `packages/luma-sdk/src/signedWrites.ts`
- `packages/luma-sdk/src/linkabilityDomains.ts`
- `packages/luma-sdk/src/providers/index.ts`
- `packages/types/src/identity.ts`
- `packages/types/src/constituency-proof.ts`
- `packages/types/src/constituency-verification.ts`
- `apps/web-pwa/src/luma/mvpActionPolicy.ts`
- `apps/web-pwa/src/hooks/useIdentity.ts`
- `apps/web-pwa/src/hooks/useConstituencyProof.ts`
- `apps/web-pwa/src/hooks/lumaAggregateVoterRecords.ts`
- `apps/web-pwa/src/store/forum/lumaRecords.ts`
- `apps/web-pwa/src/store/newsReportLumaRecords.ts`

### Slice D1 - Public-Beta Profile Enforcement

Implementation plan:

- Build/deploy profile for initial release is `public-beta`.
- Attestation provider is `BetaLocalAttestationProvider`.
- Constituency provider is `BetaLocalConstituencyProvider`.
- Lifecycle is enforced.
- Dev fallback and mock providers are not available in release builds.
- Direct trust-score comparisons outside policy helpers remain forbidden.

Tests:

```bash
corepack pnpm@9.7.1 check:luma:mvp-production-readiness
corepack pnpm@9.7.1 check:luma-provider-surface
corepack pnpm@9.7.1 check:luma-identity-lifecycle
corepack pnpm@9.7.1 check:luma-multidevice-stubs
```

### Slice D2 - Signed-Write Coverage

Implementation plan:

- Stance/vote writes use aggregate voter envelope.
- Forum posts/comments use forum author envelope.
- News reports use forum author reporter id envelope.
- Account-provider state does not become a LUMA public author scheme.
- Session references are hash/digest references; raw tokens are forbidden.

Tests:

```bash
corepack pnpm@9.7.1 check:luma-signed-write-surface
corepack pnpm@9.7.1 check:luma-aggregate-voter-v1
corepack pnpm@9.7.1 check:luma-forum-author-v1
corepack pnpm@9.7.1 check:luma-forum-post-v1
corepack pnpm@9.7.1 check:luma-news-report-v1
```

### Slice D3 - Forbidden Claims And Telemetry Redaction

Implementation plan:

- User-facing copy must avoid forbidden claims including verified-human,
  one-human-one-vote, Sybil-resistant, district-proof, cryptographic
  residency, anonymous, and untraceable.
- Telemetry/logging must redact raw nullifier, device credential,
  district hash, region code, provider tokens, raw signed-write envelope, and
  provider secrets.
- Account/support flows must route sensitive account details out of public
  GitHub issues.

Tests:

```bash
corepack pnpm@9.7.1 check:luma-forbidden-claims
corepack pnpm@9.7.1 check:luma-telemetry-redaction
corepack pnpm@9.7.1 check:public-beta-compliance
```

Done:

- Every release write path is LUMA-gated, every public author id is scoped to
  the right linkability domain, and public copy stays within beta-local claims.

## Lane E - Constituency And Representative Mapping

### Goal

Tie civic sentiment to local offices in the release-safe way: beta-local
constituency proof at vote admission, representative-directory mapping by
district hash, and aggregate-only district/office sentiment surfaces.

### Grounded Surfaces

- `docs/specs/spec-identity-trust-constituency.md`
- `docs/specs/spec-civic-sentiment.md`
- `docs/specs/spec-civic-action-kit-v0.md`
- `apps/web-pwa/src/hooks/useRegion.ts`
- `apps/web-pwa/src/hooks/useConstituencyProof.ts`
- `apps/web-pwa/src/store/bridge/districtConfig.ts`
- `apps/web-pwa/src/store/bridge/representativeDirectory.ts`
- `apps/web-pwa/src/components/bridge/RepresentativeSelector.tsx`
- `packages/luma-sdk/src/providers/index.ts`
- `packages/types/src/constituency-verification.ts`
- `packages/gun-client/src/civicRepresentativeAdapters.ts`
- `packages/data-model/src/schemas/hermes/bridgeRepresentative.ts`

### Slice E1 - District Acquisition And Proof Binding

Implementation plan:

- Initial release may use `VITE_DEFAULT_DISTRICT_HASH` or a user-selected
  district profile, but it must label the proof as beta-local.
- `useRegion()` derives proof from active LUMA nullifier plus configured
  district.
- `useConstituencyProof()` remains the write-path guard and rejects missing,
  mock, malformed, or strict-mode transitional proofs.
- Vote admission stores only proof reference/sensitive outbox material, never
  raw proof in public paths.

Tests:

- missing identity blocks proof;
- proof nullifier mismatch blocks vote admission;
- configured district mismatch blocks representative action;
- telemetry/support artifacts do not expose raw proof material.

### Slice E2 - Representative Directory Lookup

Implementation plan:

- Fix representative lookup to use the current proof/configured district hash
  instead of `findRepresentatives('')`.
- Load representative directory snapshots through system-writer validated
  records at `vh/civic/reps/<jurisdictionVersion>`.
- Expose empty-state copy when no reps are loaded for a district without
  leaking district proof material.
- Keep directory snapshots as system records; do not migrate identity
  directory or browser signing surfaces into those records.

Tests:

```bash
corepack pnpm@9.7.1 check:luma-civic-reps-system-v1
```

Targeted component tests:

- `RepresentativeSelector` passes current district hash to
  `findRepresentatives`;
- wrong district shows no matched offices;
- system-writer validation failure refuses snapshot data.

### Slice E3 - Aggregate District/Office Sentiment

Implementation plan:

- Build district/office aggregate read model from accepted vote tuples and
  representative directory mapping.
- Publish only aggregate/dashboard records that meet cohort thresholds.
- Do not publish `{district_hash, nullifier}` pairs, raw address, raw region
  code, provider account id, or per-user lines.
- Office-level display should answer:
  - which office/district the aggregate refers to;
  - which topic/synthesis/epoch;
  - aggregate agree/disagree by point;
  - cohort size / threshold status;
  - computed time and source snapshot version.
- If cohort size is below threshold, show "not enough local signal yet" rather
  than a small-cell count.

Tests:

- topology guard fails any public non-aggregate record containing
  `district_hash`;
- aggregate records require `cohortSize >= MIN_DISTRICT_COHORT_SIZE`;
- representative dashboard payloads contain no nullifiers/proofs/tokens;
- district/office aggregate is recomputable from aggregate-only source inputs.

### Slice E4 - Opinion Registration Claim

Implementation plan:

- Product copy may say users can register their opinion in VHC's beta-local
  civic sentiment aggregate for their configured/local office.
- Product copy must not say the system has verified residence, verified human
  uniqueness, or submitted an official message to an office unless those
  separate flows are implemented and proven.

Done:

- A signed-in beta user can vote on a framing point and see that the opinion
  participates in an aggregate district/office view without exposing sensitive
  identity material.

## Lane F - Release Evidence Rehearsal

### Goal

Prove the initial release loop independently of Scope A live stability work:
accepted synthesis detail, stance persistence, account/LUMA binding,
constituency mapping, support/compliance, and 3-browser convergence.

### Grounded Surfaces

- `docs/ops/BETA_SESSION_RUNSHEET.md`
- `docs/ops/public-beta-launch-readiness-closeout.md`
- `packages/e2e/src/live/bias-vote-convergence.live.spec.ts`
- `packages/e2e/src/live/vote-mutation.live.spec.ts`
- `packages/e2e/src/live/public-feed-lifecycle-accountability.mjs`
- `packages/e2e/src/live/public-feed-composition-freshness-gate.mjs`
- `packages/e2e/src/luma/mvp-production-readiness.mjs`
- `packages/e2e/src/luma/account-identity-controls.spec.ts`
- `packages/e2e/src/mvp-release-gates.mjs`
- `tools/scripts/regenerate-mvp-release-evidence.mjs`
- `tools/scripts/check-public-beta-compliance.mjs`
- `tools/scripts/check-public-beta-launch-closeout.mjs`

### Slice F1 - Local Product Proof

Commands:

```bash
corepack pnpm@9.7.1 live:stack:up:analysis-stub
corepack pnpm@9.7.1 test:live:five-user-engagement
corepack pnpm@9.7.1 check:launch-content-snapshot
```

Required proof:

- accepted summaries and framing tables render;
- vote controls appear only for accepted-current stable point ids;
- stance persists and aggregates;
- account/identity controls do not overclaim;
- story threads/reporting remain non-regressed if they stay in release copy.

### Slice F2 - Strict Matrix And 3-Browser Session

Commands:

```bash
VH_RUN_LIVE_MATRIX=true \
VH_LIVE_MATRIX_REQUIRE_FULL=true \
corepack pnpm@9.7.1 --filter @vh/e2e test:live:matrix:strict:stability
```

Manual proof from `docs/ops/BETA_SESSION_RUNSHEET.md`:

- Browser A/B/C each get a distinct identity.
- All three open the same vote-capable story.
- All see the same accepted-current table from mesh.
- Vote changes converge across all clients.
- Reload preserves analysis, vote cells, and aggregate state.

Done:

- `strictStabilityAchieved: true`, `passCount: 3`, `scarcityCount: 0`, and
  manual 3-browser PASS.

### Slice F3 - Release Gate Packet

Commands:

```bash
corepack pnpm@9.7.1 check:mvp-release-evidence
corepack pnpm@9.7.1 check:mvp-release-gates
corepack pnpm@9.7.1 check:mvp-closeout
corepack pnpm@9.7.1 check:public-beta-launch-closeout
corepack pnpm@9.7.1 check:public-beta-compliance
corepack pnpm@9.7.1 docs:check
git diff --check
```

Release packet must record:

- release commit;
- deployed Web PWA target;
- live A6 state or explicit non-touch boundary;
- accepted synthesis coverage;
- vote persistence and 3-browser evidence;
- account/LUMA binding evidence;
- constituency/rep aggregate evidence;
- support/compliance evidence;
- known limitations and forbidden claims;
- rollback path.

## Pager And Codex Responder Follow-On

The custom pager, GitHub incident bridge, responder/reviewer/verifier, and
pull-executor implementation are important but not the next product-release
lane. Sequence:

1. keep email fallback active;
2. deploy pager outside A6;
3. run signed alert test-fire A6 -> pager -> GitHub issue -> iPhone/email ->
   authenticated ack;
4. enable pager dead-man;
5. keep Codex responder dry-run only until the alert/incident loop proves
   itself under real operation and explicit drills pass.

Validation:

```bash
corepack pnpm@9.7.1 check:vhc-incident-response
```

## Deferred Non-Initial-Release Tracks

These stay outside the initial release claim unless a later release packet
explicitly adds and proves them:

- native iOS/TestFlight/App Store shell;
- public WSS mesh `release_ready`;
- full production app canary;
- LUMA Silver or stronger assurance;
- verified-human identity;
- one-human-one-vote;
- Sybil resistance;
- cryptographic residency;
- cross-device per-human nullifier binding;
- official outbound delivery to representative offices;
- Scope B storylines/topic synthesis enrichment;
- memory remediation before heap evidence names the retainer;
- Codex live production execution/autonomy;
- full trust-and-safety console, appeals workflow, SLA desk, and complete RBAC
  membership management;
- commercial/legal approval beyond implemented public-beta policy/support
  minimums.

## PR Sequencing

### PR A - Plan Refinement

This document. It is plan-only and must not mutate production behavior.

Validation:

```bash
corepack pnpm@9.7.1 docs:check
git diff --check
corepack pnpm@9.7.1 check:luma-forbidden-claims
corepack pnpm@9.7.1 check:vhc-incident-response
```

### PR B - Accepted Summary/Table Readiness

Scope:

- accepted-current read model;
- lifecycle/synthesis join;
- vote-control gating by stable point ids;
- UI states for pending/retryable/terminal/suppressed;
- tests for mismatch and non-votable states.

### PR C - Vote Persistence And Aggregate Engagement

Scope:

- unified vote admission;
- local intent queue and projection hardening;
- aggregate voter node validation;
- Eye/Lightbulb counters;
- three-browser persistence proof improvements.

### PR D - Account And Sign-In Shell

Scope:

- Apple/Google/X provider contract;
- account-provider UI;
- account-to-LUMA local binding;
- token redaction/storage;
- sign-out/reset identity copy and tests.

### PR E - LUMA Binding And Forbidden-Claim Hardening

Scope:

- public-beta profile enforcement;
- signed-write coverage;
- telemetry redaction;
- forbidden-claim gates;
- account/identity copy audit.

### PR F - Constituency And Representative Mapping

Scope:

- district acquisition/review;
- representative lookup wired to active district hash;
- representative snapshot system-writer readback;
- aggregate district/office sentiment read model;
- privacy threshold/topology tests.

### PR G - Release Rehearsal And Go/No-Go Packet

Scope:

- strict matrix;
- manual 3-browser proof;
- MVP release gates;
- release evidence report;
- claim review and launch decision.

## Validation Matrix

| Lane | Main Commands | Required Manual/Live Evidence |
| --- | --- | --- |
| Safety rail | `check:public-feed:alert-watch`, `check:scope-a-watch-closure`, heap analyzer when triggered | timers active, latest tick, freshness, relay liveness, relay snapshot |
| Accepted summary/table | `check:public-feed:lifecycle-accountability`, `check:luma-topic-synthesis-system-v1`, `check:mvp-release-gates` | story detail shows accepted-current summary/table; non-current table is non-votable |
| Vote persistence | `check:public-feed:stance-aggregate-decay`, `check:luma-aggregate-voter-v1`, strict matrix | 3-browser vote convergence and reload persistence |
| Account/sign-in | account identity tests, provider/token tests, `check:public-beta-compliance` | Apple/Google/X account flow binds to current-device LUMA identity without overclaim |
| LUMA binding | `check:luma:mvp-production-readiness`, `check:luma-signed-write-surface`, `check:luma-forbidden-claims`, `check:luma-telemetry-redaction` | signed writes use correct public author schemes; no forbidden claims |
| Constituency/reps | `check:luma-civic-reps-system-v1`, topology/privacy tests | active district hash maps to reps; aggregate-only district/office sentiment |
| Release rehearsal | `check:mvp-release-evidence`, `check:mvp-release-gates`, `check:mvp-closeout`, `docs:check`, `git diff --check` | release packet names commit, artifacts, limitations, rollback |
| Incident follow-on | `check:vhc-incident-response` | pager test-fire/dead-man later; Codex remains dry-run |

## Functioning Initial Release Acceptance Criteria

The initial release is functioning when all of these are true on the intended
release commit:

- Users can register/sign in with the approved provider shell.
- Sign-in binds to or creates a beta-local LUMA identity on the current device.
- Account copy does not claim verified-human, one-human-one-vote, Silver,
  Sybil resistance, or residency proof.
- Users can open a story and read an accepted summary.
- The bias/framing table renders only from accepted-current `TopicSynthesisV2`
  joined to the current story lifecycle.
- Vote controls appear only for rows with stable accepted point ids.
- One final stance per user per point persists and can be changed.
- Public aggregate counts converge across at least three browser identities and
  survive reload.
- Eye/Lightbulb accounting follows the Season 0 cap and does not use proxy
  signals.
- LUMA signed-write envelopes cover stance/forum/report release writes.
- Constituency proof is beta-local, validated at write admission, and kept out
  of public paths.
- Representative mapping uses the active district hash and system-writer
  validated directory snapshots.
- District/office sentiment surfaces are aggregate-only and thresholded.
- Public beta support/compliance routes pass.
- Scope A alerting remains active, and live A6 is not touched unless a separate
  operator packet authorizes it.
- Release gates, docs governance, and whitespace checks pass.

## Failure Handling Rules

- If a new A6 alert arrives, pause product-lane work and run the read-only
  incident branch first.
- If the heap pair appears, run the analyzer first; do not remediate before the
  retainer is named.
- If accepted-current lifecycle joins fail, keep story detail non-votable.
- If vote convergence fails, fix the vote/projection lane before widening beta.
- If sign-in works but LUMA binding fails, do not admit votes.
- If LUMA forbidden-claim gates fail, change copy/product surfaces; do not
  weaken the gate.
- If representative mapping cannot prove active district lookup and aggregate
  privacy thresholds, remove local-office sentiment claims from release copy.
- If release gates fail, fix the lane or narrow the release envelope; do not
  override the packet.
