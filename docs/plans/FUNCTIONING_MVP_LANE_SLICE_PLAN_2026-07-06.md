# Functioning MVP Lane Slice Plan - 2026-07-06

> Status: Technical implementation and operating plan
> Owner: VHC Core Engineering + VHC Launch Ops
> Last Reviewed: 2026-07-06
> Target: functioning Venn News Web PWA MVP
> Depends On: `docs/foundational/STATUS.md`, `docs/plans/VENN_NEWS_MVP_ROADMAP_2026-04-20.md`, `docs/ops/public-beta-launch-readiness-closeout.md`, `docs/ops/news-aggregator-production-service.md`, `docs/ops/public-feed-freshness-monitor.md`, `docs/ops/vhc-incident-response.md`, `docs/reports/phase5-scope-a-post-slice0-current-state-2026-07-06.md`

## Executive Decision

The MVP target is the Web PWA news loop already defined in
`docs/plans/VENN_NEWS_MVP_ROADMAP_2026-04-20.md`, not a native app, not the
public WSS mesh, not production-attested LUMA/Silver, and not autonomous
production execution.

The functioning MVP is the smallest end-to-end product that can honestly be
used and released as a public beta:

1. A user opens a fresh usable news feed.
2. The feed contains singleton stories and bundled stories.
3. Topic preferences change feed ranking/filtering.
4. A story opens into a durable detail surface.
5. The detail surface shows accepted Venn analysis when the release claim says
   analysis/frame/reframe is part of the MVP; otherwise it must clearly say
   analysis is pending or unavailable.
6. Users can take point-level stance on frame/reframe items, not on the story
   as a whole.
7. Stance persists, aggregates under the capped influence-falloff model, and is
   visible after reload/cross-user readback.
8. The story has a deterministic thread where beta users can reply, report, and
   observe moderated state.
9. Public-beta identity, support, policy, telemetry, and forbidden-claim gates
   remain honest about beta-local proof semantics.
10. A release evidence packet passes on the intended release commit.

This plan intentionally puts Scope A reliability before enrichment. A stale or
silent public feed cannot be rescued by a polished detail surface. The first
MVP lane is therefore the already-live raw-feed/alert proof window, followed by
accepted synthesis canary work only after the feed remains healthy or a clearly
approved operator session widens the boundary.

## Current State Of Play

As of this plan:

- Repo `main` is `76f3c77c` after PR #724 aligned the docs with the
  post-Slice-0 recovery state.
- Live A6 was updated to `main@47ba218d` after PR #723 fixed the
  StoryCluster production timeout path. Treat any newer docs-only merge as repo
  truth until an operator explicitly updates A6 again.
- Slice 0 is complete: the host-private email alert path is configured, test
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

## Hard Boundaries

These boundaries are part of the plan, not footnotes:

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

## MVP Dependency Graph

```text
Lane 0: Scope A raw feed + alert proof
  -> Lane 1: heap evidence and memory-decision boundary
  -> Lane 2: source supply and feed density
  -> Lane 3: accepted synthesis/story detail canary
  -> Lane 4: civic stance + discussion + beta identity
  -> Lane 5: public beta shell/support/compliance
  -> Lane 6: release evidence packet and go/no-go

Lane 7: pager/incident hardening runs after email proof and outside A6
Lane 8: deferred non-MVP tracks stay outside the MVP release claim
```

The dependency that matters most is Lane 0 before Lane 3. Accepted synthesis
can increase product value, but it must not disturb the raw publication loop
until the raw loop has either banked its proof window or a specific incident
requires action.

## Lane 0 - Scope A Reliability And Evidence Accrual

### Goal

Keep the recovered raw public feed fresh, observable, and untouched while the
clean window accrues. This lane converts "we recovered" into evidence that the
MVP feed foundation is actually stable enough to build on.

### Grounded Surfaces

- `docs/reports/phase5-scope-a-post-slice0-current-state-2026-07-06.md`
- `docs/ops/news-aggregator-production-service.md`
- `docs/ops/public-feed-freshness-monitor.md`
- `tools/scripts/public-feed-alert-watch.mjs`
- `tools/scripts/phase5-scope-a-watch-closure.mjs`
- `tools/scripts/analyze-early-heap-captures.mjs`
- `tools/scripts/install-news-aggregator-user-service.mjs`
- `services/news-aggregator/src/index.ts`
- `packages/ai-engine/src/newsRuntime.ts`

### Slice 0.1 - No-Change Watch Window

Implementation:

- Leave `vh-news-aggregator.service`, `vh-storycluster-engine.service`, relay
  services, alert timers, and watch-closure timers in their current healthy
  state.
- Record readbacks only when there is an operator-approved check-in or an
  alert.
- Preserve the current raw-only profile: accepted synthesis disabled,
  replay disabled, storylines disabled, raw cap `8`, raw write concurrency `2`,
  repair interval `86400000`, prune disabled, relay REST min-success `2`.

Verification:

- `vh-public-feed-alert-watch.timer` remains enabled/active.
- `vh-phase5-scope-a-watch-closure.timer` remains enabled/active.
- Alert watch reports delivery health and does not silently stall.
- Watch closure remains `in_progress` only because the proof window is short,
  not because freshness/liveness failed.

Done when:

- The 48-hour proof target passes without anomaly, or a new alert interrupts
  the lane and opens an incident.

### Slice 0.2 - Alert-First Incident Branch

Trigger:

- Any fresh email from the alert watch for freshness, relay liveness, relay
  snapshot, watch-closure input, publisher park, or critical class.

Implementation:

- Stop planned MVP enrichment work.
- Run read-only diagnosis first:
  - publisher active state and latest tick summary;
  - StoryCluster active state and timeout/error stage;
  - raw write attempted/wrote/failed counts;
  - relay REST auth/readiness/liveness;
  - relay snapshot freshness;
  - latest public index age;
  - alert/watch-closure verdict files.
- Decide the smallest operator action from the readback:
  - publisher active but stale/no clean tick: restart publisher onto current
    approved main only if the evidence says it is stuck/old;
  - writes/readbacks fail: diagnose relay write path;
  - writes pass but snapshots stale: repair snapshot/watch path;
  - everything green: classify alert/watch issue before touching services.

Verification:

- Recovery email or pass readback arrives.
- Latest normal production tick writes 2-of-3 or better.
- Public freshness and relay snapshot return to pass.

Done when:

- Incident report captures cause, action, and recovery evidence, or the issue
  remains open with a precise unresolved blocker.

### Slice 0.3 - Heap Evidence Intake

Trigger:

- The first post-recovery early heap-capture summary pair appears for the
  500 MB -> 700 MB climb.

Implementation:

- Run only the secret-safe analyzer summary path.
- Do not move `.heapsnapshot` or `.heapprofile` artifacts through GitHub,
  email, pager issues, or model prompts.
- Classify the retainer before proposing remediation.
- If classification points to off-graph runtime pressure, open a focused
  memory-design PR/plan. If classification points to graph data, reconcile
  against graph scan, soul count, tombstone, and userValueBytes evidence.

Verification:

- Analyzer output names the dominant retainer class or explicitly reports that
  evidence remains insufficient.
- No production state is mutated as part of analysis.

Done when:

- A memory-remediation decision packet exists, or the analyzer states why the
  next capture threshold is required.

### Slice 0.4 - Repeated `system-writer-validation-failed` Watch

Trigger:

- The warning repeats across normal ticks while raw writes/readbacks/freshness
  still pass.

Implementation:

- Open a repo-side investigation scoped to system-writer validation only.
- Inspect `packages/gun-client/src/analysisAdapters.ts`,
  `tools/scripts/check-luma-topic-synthesis-system-v1.mjs`, and current
  writer/readback fixtures before touching live services.
- Treat one isolated warning as non-actionable while the live raw path is
  passing.

Done when:

- Either the repeated warning is fixed by a repo PR with deterministic coverage,
  or the investigation records why it is a benign diagnostic false positive.

## Lane 1 - Source Supply And Feed Freshness

### Goal

Keep the MVP feed useful enough for public beta without weakening source
readability and safety discipline. The feed should have fresh singleton and
bundled stories, but only from sources that can satisfy the extraction and
evidence boundary.

### Grounded Surfaces

- `docs/ops/NEWS_SOURCE_ADMISSION_RUNBOOK.md`
- `services/news-aggregator/src/sourceHealthReport.ts`
- `services/news-aggregator/src/sourceHealthPolicy.ts`
- `services/news-aggregator/src/sourceScout.ts`
- `services/news-aggregator/src/index.ts`
- `services/storycluster-engine/src/benchmarkCorpusKnownEventOngoingFixtures.ts`
- `services/storycluster-engine/src/benchmarkCorpusReplayKnownEventOngoingScenarios.ts`
- `packages/e2e/src/live/daemon-first-feed-semantic-audit.live.spec.ts`
- `packages/e2e/fixtures/launch-content/validated-snapshot.json`

### Slice 1.1 - Source Health Packet Refresh

Implementation:

- Refresh source health evidence only from repo scripts and current artifacts.
- Use the existing health/admission/scout tools rather than hand-curating
  source changes.
- Classify results as release-green, review-required, or blocked. Do not treat
  `warn` as release-green.

Commands:

```bash
corepack pnpm@9.7.1 check:news-sources:health
corepack pnpm@9.7.1 report:news-sources:health
corepack pnpm@9.7.1 check:storycluster:production-readiness
```

Done when:

- The source-health artifact is fresh enough for the intended release claim.
- Any non-green source class is either fixed or explicitly excluded from the
  public beta claim.

### Slice 1.2 - Candidate Admission

Implementation:

- If source breadth is insufficient, run scouting and admit candidates through
  `docs/ops/NEWS_SOURCE_ADMISSION_RUNBOOK.md`.
- Add one source set per PR so failures can be attributed.
- Require extraction safety, recent-run coverage, headline correctness, and no
  evidence-boundary overclaim before admission.

Commands:

```bash
corepack pnpm@9.7.1 scout:news-sources:candidates
corepack pnpm@9.7.1 report:news-sources:admission
corepack pnpm@9.7.1 check:news-sources:liveness
```

Done when:

- New sources improve feed density without increasing extraction failures or
  leaking non-analyzed links into analysis evidence.

### Slice 1.3 - Feed Composition And Propagation Gate

Implementation:

- Verify singleton/bundled composition from the public feed path.
- Verify raw RSS-to-product-feed propagation.
- Verify lifecycle accountability for pending/accepted/unavailable analysis
  states.

Commands:

```bash
corepack pnpm@9.7.1 check:public-feed:composition-freshness
corepack pnpm@9.7.1 check:public-feed:fresh-propagation
corepack pnpm@9.7.1 check:public-feed:lifecycle-accountability
```

Done when:

- Public feed composition/freshness, propagation, and lifecycle gates pass on
  the intended release commit or on the current evidence commit for pre-release
  readiness.

## Lane 2 - Accepted Synthesis And Story Detail

### Goal

Enable the Venn analysis/frame-reframe part of the MVP without regressing the
raw publication loop. A functioning Venn News MVP cannot claim analysis,
frames, reframes, or point-level stance over points unless accepted synthesis
exists for the stories under that claim.

### Explicit Synthesis Scope Decision

There are two honest product envelopes:

- **Raw-news beta envelope:** fresh feed, story cards, source/provenance,
  discussion, support/compliance, and explicit `analysis pending/unavailable`
  states. This can be useful, but it is not the full Venn News MVP loop.
- **Functioning Venn News MVP envelope:** fresh feed plus accepted
  `TopicSynthesisV2` detail, frame/reframe rows, stable point ids, point
  stance, aggregates, and discussion. This is the target of this plan.

The implementation path below therefore includes accepted synthesis, but it is
sequenced after Lane 0 proof and bounded as a canary before broader rollout.

### Grounded Surfaces

- `services/news-aggregator/src/bundleSynthesisWorker.ts`
- `services/news-aggregator/src/bundleSynthesisRelay.ts`
- `services/news-aggregator/src/bundleSynthesisDaemonConfig.ts`
- `services/news-aggregator/src/bundleSynthesisQueue.ts`
- `packages/ai-engine/src/newsRuntime.ts`
- `packages/gun-client/src/synthesisAdapters.ts`
- `packages/gun-client/src/analysisAdapters.ts`
- `packages/e2e/fixtures/launch-content/validated-snapshot.json`
- `apps/web-pwa/src/components/feed/NewsCard.tsx`
- `apps/web-pwa/src/components/feed/NewsCardBack.tsx`
- `apps/web-pwa/src/hooks/useAnalysis.ts`
- `docs/ops/news-aggregator.env.example`

### Slice 2.1 - Local/Fixture Story Detail Proof

Implementation:

- Prove the full product loop locally before touching A6.
- Use the deterministic analysis stub path to avoid live-model volatility.
- Confirm detail renders accepted synthesis first and never silently launches a
  blocking click-time analysis as the normal story-open path.
- Confirm missing synthesis surfaces as pending/unavailable, not fake analysis.

Commands:

```bash
corepack pnpm@9.7.1 live:stack:up:analysis-stub
corepack pnpm@9.7.1 test:live:five-user-engagement
corepack pnpm@9.7.1 check:launch-content-snapshot
```

Done when:

- Five local beta users can open singleton and bundled stories, see accepted
  synthesis detail, stance on frame/reframe points, reply in threads, reload,
  and observe cross-user readback.

### Slice 2.2 - Production Canary Preconditions

Preconditions:

- Lane 0 48-hour proof target is green, or an operator-approved incident
  packet explicitly authorizes canary timing.
- No active freshness, relay liveness, relay snapshot, or watch-closure alert.
- Heap-capture analysis is not actively pointing at a synthesis-path blocker.
- OpenAI/model auth is configured only in host-private env.
- The release owner confirms the product claim requires accepted synthesis now.

Implementation:

- Keep storylines and topic synthesis enrichment disabled for the first canary.
- Keep publish-time synthesis decoupled from raw write success. Raw publication
  remains the first safety contract.
- Use narrow caps and explicit relay REST quorum settings from
  `docs/ops/news-aggregator.env.example`:
  - `VH_BUNDLE_SYNTHESIS_ENABLED=true`
  - `VH_BUNDLE_SYNTHESIS_WRITE_RELAY_REST=true`
  - `VH_BUNDLE_SYNTHESIS_RELAY_WRITE_MIN_SUCCESS=2`
  - `VH_BUNDLE_SYNTHESIS_TIMEOUT_MS=120000`
  - `VH_BUNDLE_SYNTHESIS_RATE_PER_MIN=20` or lower for canary
  - `VH_NEWS_RUNTIME_MAX_PUBLISHED_BUNDLES=96` only after canary expansion
  - first-tick raw caps remain conservative
- Do not enable storylines (`VH_NEWS_STORYLINES_ENABLED`) in the first accepted
  synthesis canary unless the canary plan explicitly includes it.

Done when:

- The host-private canary plan names env deltas, rollback env deltas, readback
  files, expected accepted-synthesis count, and exact stop conditions.

### Slice 2.3 - Accepted Synthesis Canary

Implementation:

- Enable the smallest accepted synthesis canary that can prove the path.
- Let the publisher complete a clean raw tick before expecting queued accepted
  synthesis.
- Read back accepted synthesis from relay/storage, not just local logs.
- Confirm detail UI shows:
  - generated timestamp;
  - epoch;
  - accepted `TopicSynthesisV2`;
  - stable `frame_point_id` and `reframe_point_id`;
  - source evidence limited to analysis-eligible sources;
  - related links separated from analyzed evidence.

Stop conditions:

- Raw publication fails or parks.
- Relay writes drop below 2-of-3.
- Synthesis write/readback repeatedly fails.
- Story detail displays unlabeled stale, placeholder, or source-unsafe
  analysis.
- Heap growth sharply changes before the first canary can be read back.

Done when:

- At least one canary story has accepted synthesis readback and Web PWA detail
  renders it correctly, while raw feed freshness remains green.

### Slice 2.4 - Expansion To MVP Coverage

Implementation:

- Increase accepted synthesis coverage only after the canary passes and raw feed
  freshness remains green.
- Add evidence for singleton and bundled story paths.
- Preserve point identity across regenerations or record unmapped/orphaned
  point counts before promotion.
- Keep click-time analysis out of the normal detail path.

Verification:

```bash
corepack pnpm@9.7.1 check:public-feed:lifecycle-accountability
corepack pnpm@9.7.1 check:public-feed:stance-aggregate-decay
corepack pnpm@9.7.1 check:mvp-release-gates
```

Done when:

- The intended MVP release commit can pass accepted synthesis/frame reliability
  gates for the release envelope.

## Lane 3 - Civic Stance, Discussion, Moderation, And Beta Identity

### Goal

Make the product interactive in the exact MVP way: beta-local identity,
point-level stance, deterministic story threads, report intake, and trusted
operator moderation, without implying verified-human/Silver proof.

### Grounded Surfaces

- `packages/gun-client/src/sentimentAdapters.ts`
- `packages/gun-client/src/topicEngagementAdapters.ts`
- `packages/gun-client/src/forumAdapters.ts`
- `packages/gun-client/src/newsReportAdapters.ts`
- `apps/web-pwa/src/hooks/useSentimentState.ts`
- `apps/web-pwa/src/components/feed/NewsCardBack.tsx`
- `apps/web-pwa/src/components/forum/ForumThreadView.tsx`
- `apps/web-pwa/src/lib/luma/actionPolicy.ts`
- `tools/scripts/check-luma-topic-synthesis-system-v1.mjs`
- `docs/specs/spec-civic-sentiment.md`
- `docs/specs/spec-luma-service-v0.md`
- `docs/ops/luma-verifier-current-state.md`

### Slice 3.1 - LUMA Beta Identity Honesty

Implementation:

- Keep public beta copy on beta-local identity and signed-write semantics.
- Do not claim production attestation, Silver, verified-human identity,
  one-human-one-vote, cryptographic residency, Sybil resistance, or full
  section 21.4 replay.
- Confirm action policy covers directory/forum/news-report/aggregate/stance
  write actions.

Commands:

```bash
corepack pnpm@9.7.1 check:luma:mvp-production-readiness
corepack pnpm@9.7.1 check:luma-forbidden-claims
corepack pnpm@9.7.1 check:luma-production-profile
corepack pnpm@9.7.1 check:luma-telemetry-redaction
```

Done when:

- LUMA gates pass and release copy does not overstate identity guarantees.

### Slice 3.2 - Point-Level Stance And Aggregate Readback

Implementation:

- Keep the canonical stance target:
  `(topic_id, synthesis_id, epoch, point_id)`.
- Ensure neutral stance clears or becomes non-counting in aggregates.
- Ensure users cannot stance on a row without an accepted stable point id.
- Verify aggregate falloff follows the Season 0 cap:
  `E_new = E_current + 0.3 * (1.95 - E_current)`.

Commands:

```bash
corepack pnpm@9.7.1 check:public-feed:stance-aggregate-decay
corepack pnpm@9.7.1 test:live:five-user-engagement
```

Done when:

- Stance writes persist, aggregate, survive reload, and remain public as
  aggregate-only metadata.

### Slice 3.3 - Story Threads, Reports, And Moderation

Implementation:

- Use the existing forum system. Do not create a second comment model.
- Keep deterministic story thread ids in the `news-story:*` family.
- Verify reply persistence, cross-user visibility, report intake, audited
  hide/restore moderation, and trusted-operator authorization on current
  remediation writes.

Commands:

```bash
corepack pnpm@9.7.1 test:live:five-user-engagement
corepack pnpm@9.7.1 check:mvp-release-gates
```

Done when:

- The five-user lane proves comments, replies, report-to-action, and moderated
  state without relying on non-MVP admin polish.

## Lane 4 - Web PWA Shell, Launch Content, And Public Beta Support

### Goal

Ship the MVP as a Web PWA with honest public-beta surfaces and representative
fallback content for demos/QA, while leaving native packaging and full app-store
compliance out of the critical path.

### Grounded Surfaces

- `apps/web-pwa/`
- `apps/web-pwa/src/components/layout/Footer.tsx`
- `apps/web-pwa/src/pages/CompliancePage.tsx`
- `apps/web-pwa/src/pages/BetaPage.tsx`
- `apps/web-pwa/src/pages/PrivacyPage.tsx`
- `apps/web-pwa/src/pages/TermsPage.tsx`
- `apps/web-pwa/src/pages/ModerationPage.tsx`
- `apps/web-pwa/src/pages/SupportPage.tsx`
- `apps/web-pwa/src/pages/DataDeletionPage.tsx`
- `apps/web-pwa/src/pages/TelemetryPage.tsx`
- `apps/web-pwa/src/pages/CopyrightPage.tsx`
- `.github/ISSUE_TEMPLATE/public-beta-support.yml`
- `packages/e2e/fixtures/launch-content/validated-snapshot.json`
- `docs/ops/public-beta-launch-readiness-closeout.md`

### Slice 4.1 - Public Beta Route And Support Gate

Implementation:

- Confirm the footer links every required policy/support route.
- Confirm `/support` points to the public beta GitHub Issue Form.
- Confirm private escalation protocol remains documented without exposing
  secrets or private contact paths in code.

Command:

```bash
corepack pnpm@9.7.1 check:public-beta-compliance
```

Done when:

- Compliance/support gate passes on the release commit.

### Slice 4.2 - Launch Content Fallback

Implementation:

- Keep `packages/e2e/fixtures/launch-content/validated-snapshot.json`
  representative enough to cover singleton, bundle, accepted synthesis,
  correction, thread, moderation, and preference states.
- Use this only for local demo/QA fallback; do not treat it as live ingestion
  proof.

Command:

```bash
corepack pnpm@9.7.1 check:launch-content-snapshot
```

Done when:

- The snapshot gate passes and any release demo clearly distinguishes fixture
  mode from live public-source freshness.

### Slice 4.3 - Browser Smoke And PWA Usability

Implementation:

- Run the browser smoke against the intended public/local target.
- Confirm feed opens, cards expand, detail content does not overlap on mobile,
  support/policy routes are reachable, and pending/unavailable synthesis states
  are visibly honest.

Commands:

```bash
corepack pnpm@9.7.1 test:public-feed:browser-smoke
corepack pnpm@9.7.1 check:public-beta-launch-closeout
```

Done when:

- Browser smoke and launch closeout pass on the release candidate target.

## Lane 5 - Pager And Incident Loop After Email Proof

### Goal

Replace silent failure with a durable incident loop, without putting custom
pager deployment or Codex automation in front of the already-working email
guardrail.

### Grounded Surfaces

- `services/vhc-pager/`
- `tools/scripts/public-feed-alert-watch.mjs`
- `tools/scripts/vhc-incident-codex-triage.mjs`
- `tools/scripts/vhc-incident-reviewer-worker.mjs`
- `tools/scripts/vhc-incident-executor.mjs`
- `tools/scripts/vhc-incident-readback-verifier.mjs`
- `tools/scripts/verify-vhc-incident-packet.mjs`
- `.github/workflows/vhc-pager-deadman.yml`
- `.github/ISSUE_TEMPLATE/a6-incident.yml`
- `docs/ops/vhc-incident-response.md`
- `docs/ops/vhc-pager-iphone-setup.md`
- `docs/ops/vhc-codex-responder.md`
- `docs/plans/AUTONOMOUS_INCIDENT_RESPONSE_SLICES_2026-07-06.md`

### Slice 5.1 - Pager Deployment Outside A6

Implementation:

- Host the pager outside A6.
- Configure secrets in the pager host only.
- Keep the existing email alert channel enabled permanently.
- Add the pager PWA to the operator iPhone Home Screen only after hosted
  service health is verified.
- Preserve platform honesty: iOS Web Push cannot override silent/Focus mode,
  so email remains fallback.

Done when:

- Pager health endpoint passes and iPhone PWA enrollment succeeds without
  changing A6 production behavior.

### Slice 5.2 - Signed Webhook Cutover

Implementation:

- Configure A6 alert watch to send signed alerts to the pager endpoint.
- The pager must durably persist before returning 2xx.
- The pager creates/updates a public-safe GitHub incident issue.
- The alert fans out to iPhone PWA and email.
- Ack requires authenticated enrolled device token.

Test-fire proof:

- A6 emitted the alert.
- Pager accepted and persisted it.
- GitHub issue was created/updated.
- iPhone/email received it.
- Ack succeeded only with the device token.

Done when:

- A synthetic alert completes the full loop and the email fallback remains
  active.

### Slice 5.3 - Pager Dead-Man

Implementation:

- Enable the external dead-man after pager cutover.
- Confirm deliberate pager outage opens a GitHub incident instead of silently
  failing.
- Keep weekly test-fire discipline until the 14-day proof target is banked.

Done when:

- Pager outage drill produces the expected dead-man incident and recovery note.

### Slice 5.4 - Codex Responder Dry-Run Only

Implementation:

- Codex may investigate, write tests, draft PRs, and draft operator packets.
- Reviewer/verifier can exercise signed packet paths.
- A6 live executor stays dry-run and must refuse unapproved live execution.
- Do not enable live A6 execution until the alert/pager loop has worked under
  real operation for the required proof window and explicit drills pass.

Command:

```bash
corepack pnpm@9.7.1 check:vhc-incident-response
```

Done when:

- Incident-response checks pass and live execution remains disabled.

## Lane 6 - Release Evidence And Go/No-Go Packet

### Goal

Make the release decision from evidence on the intended commit, not from a
stale local memory of which lanes used to pass.

### Grounded Surfaces

- `tools/scripts/check-mvp-release-gates.mjs`
- `tools/scripts/regenerate-mvp-release-evidence.mjs`
- `tools/scripts/check-mvp-closeout.mjs`
- `tools/scripts/check-public-beta-launch-closeout.mjs`
- `.tmp/mvp-release-gates/latest/mvp-release-gates-report.json`
- `.tmp/mvp-release-evidence/latest/`
- `docs/ops/public-beta-launch-readiness-closeout.md`
- `docs/foundational/STATUS.md`

### Slice 6.1 - Release Commit Freeze

Implementation:

- Select a release candidate commit.
- Confirm local `main`, `origin/main`, and any deployed Web PWA target are
  actually at or intentionally derived from that commit.
- Record any live A6 lag separately. A6 raw feed can be healthy at one commit
  while docs or Web PWA release artifacts are at a newer commit.

Done when:

- The release packet names one commit and one deployment target set.

### Slice 6.2 - Evidence Regeneration

Commands:

```bash
corepack pnpm@9.7.1 check:mvp-release-evidence
corepack pnpm@9.7.1 check:mvp-release-gates
corepack pnpm@9.7.1 check:mvp-closeout
corepack pnpm@9.7.1 check:public-beta-launch-closeout
corepack pnpm@9.7.1 docs:check
git diff --check
```

Implementation:

- Treat `setup_scarcity` as a blocker unless the release envelope explicitly
  excludes that lane.
- Treat `skipped_not_in_scope` as acceptable only when the release copy makes
  the same exclusion.
- Preserve generated artifacts only when the runbook says they are meant to be
  committed; otherwise record paths and hashes in the evidence packet.

Done when:

- All release-in-scope gates pass on the release candidate commit.

### Slice 6.3 - Claim Review

Implementation:

- Compare the release copy to the gates that actually passed.
- Explicitly reject claims for:
  - native app/TestFlight/App Store availability;
  - production-attested/Silver LUMA;
  - verified one-human-one-vote;
  - public WSS mesh `release_ready`;
  - full production app canary;
  - autonomous production execution;
  - 14-day Scope A unattended stability before the target date passes.

Done when:

- The public beta claim is narrower than or equal to the verified evidence.

### Slice 6.4 - Go/No-Go Packet

Implementation:

- Produce a final go/no-go report with:
  - release commit;
  - commands run;
  - artifacts and hashes;
  - live A6 state;
  - Web PWA target state;
  - known limitations;
  - explicit non-goals;
  - rollback path;
  - operator contacts and support routing.

Done when:

- A reviewer can reproduce the evidence and approve or block without needing
  unwritten tribal context.

## Lane 7 - Deferred Non-MVP Tracks

These are important, but they do not belong in the functioning MVP critical
path unless the release claim expands:

- Native iOS/TestFlight/App Store shell.
- Public WSS mesh `release_ready`.
- Production app canary as a full product-readiness claim.
- LUMA production-attestation/Silver, verified-human identity,
  Sybil-resistance, one-human-one-vote, and full section 21.4 recorded product
  replay.
- Scope B topic synthesis enrichment, storyline overlays, and broad storylines.
- Retention/compaction/eviction/memory remediation before heap evidence names
  the retainer.
- Codex live production execution/autonomy.
- Full trust-and-safety console, appeals workflow, SLA desk, and complete RBAC
  membership management.
- Commercial/legal approval beyond the already-implemented public-beta policy
  route and support-surface minimums.

## PR Sequencing

### PR A - Plan And Alignment

This document. It is plan-only and should not mutate production behavior.

Validation:

```bash
corepack pnpm@9.7.1 docs:check
git diff --check
```

### PR B - Scope A Evidence Update

Open only after:

- the 48-hour proof target passes;
- a new alert triggers an incident; or
- the first 500 MB -> 700 MB heap summary pair appears.

Scope:

- update current-state reports;
- record analyzer summaries or incident evidence;
- do not change live behavior unless the incident packet authorizes it.

### PR C - Source Supply Refresh

Open only if source-health/feed-density evidence says the MVP needs source
changes.

Scope:

- source admission through the runbook;
- source-health report updates;
- feed composition/freshness evidence.

### PR D - Accepted Synthesis Canary Plan/Guard

Open after Lane 0 allows enrichment work.

Scope:

- canary env plan;
- host-private operator session outline;
- any missing guard tests for synthesis write/readback, lifecycle states, or
  point-id preservation.

### PR E - Civic Interaction Release Evidence

Scope:

- five-user engagement evidence;
- LUMA beta identity checks;
- stance aggregate decay checks;
- report/moderation gate fixes if any fail.

### PR F - Pager Deployment Packet

Open after email proof remains reliable and before signed webhook cutover.

Scope:

- pager deployment outside A6;
- full test-fire packet;
- dead-man enablement;
- Codex dry-run proof only.

### PR G - MVP Release Packet

Scope:

- release evidence regeneration;
- go/no-go report;
- public beta claim review;
- no unrelated refactors.

## Validation Matrix

| Lane | Main Commands | Live/Operator Readback |
| --- | --- | --- |
| Scope A reliability | `check:public-feed:alert-watch`, `check:scope-a-watch-closure`, heap analyzer when triggered | timer active states, latest tick, public freshness, relay liveness, relay snapshot |
| Source supply | `check:news-sources:health`, `report:news-sources:health`, `check:storycluster:production-readiness` | no live mutation unless source admission PR requires deployment |
| Feed composition | `check:public-feed:composition-freshness`, `check:public-feed:fresh-propagation`, `check:public-feed:lifecycle-accountability` | latest-index age, singleton/bundle mix, raw write/readback counts |
| Accepted synthesis | `live:stack:up:analysis-stub`, `test:live:five-user-engagement`, `check:mvp-release-gates` | accepted synthesis readback, stable point ids, raw feed still fresh |
| Civic interaction | `check:public-feed:stance-aggregate-decay`, `check:luma:mvp-production-readiness`, `test:live:five-user-engagement` | cross-user persistence, aggregate-only public metadata |
| Public beta shell | `check:public-beta-compliance`, `check:launch-content-snapshot`, `test:public-feed:browser-smoke` | support route reachable, policy/footer links present |
| Incident loop | `check:vhc-incident-response` | email fallback active, pager test-fire, GitHub issue, device ack, dead-man drill |
| Release packet | `check:mvp-release-evidence`, `check:mvp-release-gates`, `check:mvp-closeout`, `docs:check`, `git diff --check` | release commit matches deployment targets and claim boundaries |

## Functioning MVP Acceptance Criteria

The MVP is functioning when all of the following are true on the intended
release commit:

- The public feed is fresh and observable through the active alert/watch
  channel.
- Singleton and bundled stories render in the Web PWA feed.
- Topic preferences visibly affect feed ordering/filtering.
- Story detail renders accepted synthesis for the release envelope, or the
  release envelope explicitly excludes analysis and the UI honestly shows
  pending/unavailable states.
- Frame/reframe rows have stable point ids before stance controls are enabled.
- Point stance persists, aggregates with falloff, survives reload, and exposes
  aggregate-only public metadata.
- Deterministic story threads support replies, reports, and audited moderation.
- Public-beta LUMA identity gates pass without forbidden identity claims.
- Public beta policy/support routes and GitHub support issue form are reachable.
- Launch content fallback is valid for QA/demo and not confused with live
  ingestion proof.
- MVP release gates, closeout gates, docs check, and whitespace check pass.
- A6 live state is either fresh/green or explicitly excluded from the release
  action because the release is not touching A6.
- Any remaining limitations are listed in the go/no-go packet and reflected in
  public copy.

## Failure Handling Rules

- If a new alert arrives, pause enrichment work and run the read-only incident
  branch first.
- If the heap pair appears, run the analyzer first; do not remediate before the
  retainer is named.
- If source-health is `warn`, adjudicate it; do not call it release-green.
- If accepted synthesis canary breaks raw publication, roll back synthesis
  enablement and protect the raw feed first.
- If five-user engagement fails, fix the failing interaction lane before
  widening public beta.
- If LUMA forbidden-claim gates fail, change copy or product surfaces; do not
  weaken the gate.
- If release gates fail, fix the lane or narrow the release envelope; do not
  override the packet.
