# TRINITY Implementation Status

> Status: Implementation Truth Ledger
> Owner: VHC Core Engineering
> Last Reviewed: 2026-04-16
> Depends On: docs/foundational/System_Architecture.md, docs/CANON_MAP.md


**Last Updated:** 2026-04-16
**Version:** 0.8.4 (compact one-feed UI shell, first-use orientation, and side-media headline cards)
**Assessment:** Controlled beta candidate. The integrated VENN/HERMES/AGORA app is distributable in constrained beta, but the public product shell now treats the unified feed as the primary home surface rather than asking users to choose VENN/HERMES/AGORA modes. Live corroborated-headlines remain beta-gated by production-readiness evidence. Wave 4 is closed; StoryCluster correctness, source-health enforcement, unified production-readiness, background source scouting, stable retained identity anchoring, and AP HTML-hub onboarding are landed. The primary remaining blocker is no longer generic identity churn; it is headline-soak trend recovery and hours-scale later attachment across repeated executions.

> ⚠️ **This document reflects actual implementation status, not target architecture.**
> For the full vision, see `System_Architecture.md` and whitepapers in `docs/`.
> Scope rule: this file is the current-state/delta ledger for active engineering decisions; canonical behavior contracts remain in `docs/specs/*.md`.

---

## Quick Summary

| Layer | Status | Production-Ready |
|-------|--------|------------------|
| **LUMA (Identity)** | 🟡 Hardened (trust constants, session lifecycle, constituency proof — flag-gated) | ❌ No |
| **GWC (Economics)** | 🟡 Contracts ready, Sepolia deployed | ⚠️ Partial |
| **VENN (Analysis)** | 🟡 Pipeline end-to-end; live profile defaults to relay-backed analysis, local-first remains target-state default | ❌ No |
| **HERMES Messaging** | 🟢 Implemented | ⚠️ Partial |
| **HERMES Forum** | 🟢 Implemented + 240-char reply cap + article CTA | ⚠️ Partial |
| **HERMES Docs** | 🟢 Foundation + CollabEditor wired into ArticleEditor (flag-gated) | ❌ No |
| **HERMES Bridge (Civic Action Kit)** | 🟡 Full UI (5 components), trust/XP/budget enforcement, local receipt capture, and feed-card rendering support; unified feed publication remains partial | ❌ No |
| **News Aggregator** | 🟡 Implemented with daemon-first StoryCluster production path, source-admission/health evidence, scout-backed source growth, and unified production-readiness; live public headline-soak density and broader overlap-ready source breadth remain active | ⚠️ Partial |
| **Discovery Feed** | 🟢 Implemented with compact one-feed chrome, first-use orientation, fixture-backed integrity/semantic release gates, storyline-aware ranking/presentation, and deep-link focus state; public semantic soak remains smoke-only | ⚠️ Partial |
| **Delegation Runtime** | 🟢 Store + hooks + control panel + 8/8 budget keys (all wired or deferred-with-rationale) | ⚠️ Partial |
| **Linked-Social** | 🟡 Substrate + notification ingestion + feed cards | ⚠️ Partial |

---

## Active Program — Production Hardening

Current policy state:
- Production rollout remains blocked until hard reliability gates pass.
- Transitional proof shims are dev/staging only and must be removed before ship.
- Point-identity migration requires dual-write/backfill plus explicit sunset criteria.
- Canary rollout requires quantitative SLO gates and validated rollback drills.
- StoryCluster correctness is now gated primarily by the deterministic corpus/replay path plus the daemon-first semantic gate; the active blocker has moved to live public headline-soak recovery and overlap-ready source breadth.
- Blocking feed-release evidence now comes from fixture-backed daemon-first gates:
  - `pnpm test:storycluster:correctness`
  - `pnpm test:storycluster:gates`
  - `pnpm --filter @vh/e2e test:live:daemon-feed:integrity-gate`
  - `pnpm --filter @vh/e2e test:live:daemon-feed:semantic-gate`
- Primary StoryCluster correctness proof is now explicit and deterministic:
  - `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/benchmarkCorpusKnownEventOngoingFixtures.ts`
  - `/Users/bldt/Desktop/VHC/VHC/services/storycluster-engine/src/benchmarkCorpusReplayKnownEventOngoingScenarios.ts`
  - `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemon-first-feed-semantic-audit.live.spec.ts`
- Release/readiness reviewers should treat that deterministic corpus plus the daemon-first semantic gate as the authoritative correctness gate.
- Unified production-readiness now requires one explicit combined rule:
  - StoryCluster correctness must pass via `pnpm check:storycluster:correctness`;
  - source-health release evidence must remain fresh and pass via `pnpm check:news-sources:health`;
  - headline-soak trend evidence must remain fresh and pass via `pnpm report:storycluster:production-readiness`.
- The combined production-readiness decision surface is:
  - command: `pnpm check:storycluster:production-readiness`
  - artifact: `/Users/bldt/Desktop/VHC/VHC/.tmp/storycluster-production-readiness/latest/production-readiness-report.json`
  - release-ready status: `release_ready`
  - non-ready statuses: `review_required`, `blocked`
  - refresh headline-soak input with `pnpm collect:storycluster:headline-soak` before a production claim when the latest soak trend is missing or stale.
- Evidence-bearing StoryCluster/feed checks must now be labeled as one of:
  - `CI-enforced`: automated merge gates that run only when scoped change detection says the lane is relevant;
  - `manual release discipline`: commands that must be run by the release owner before a production claim;
  - `telemetry / review only`: evidence that informs release posture but does not block merge by itself.
- Production-grade feed claims now depend more on source-readability discipline than on additional StoryCluster corpus growth:
  - only onboarded readable, accessible, extraction-safe sources count toward the feed promise;
  - see `/Users/bldt/Desktop/VHC/VHC/docs/ops/NEWS_SOURCE_ADMISSION_RUNBOOK.md`.
- Source-readiness evidence is now a concrete runtime/ops surface on `main`:
  - `pnpm report:news-sources:admission`
  - `pnpm report:news-sources:health`
  - `pnpm scout:news-sources:candidates`
  - stable latest artifact path: `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json`
  - stable latest scout path: `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-scout/latest/source-candidate-scout-report.json`
  - daemon starter-surface resolution is the authoritative keep/watch/remove enforcement path;
  - web/server surfaces can autoload the latest health artifact for diagnostics and optional browser-runtime bootstrap flows.
- `main` currently carries a 24-source keep surface and the latest source-health runtime policy is green:
  - latest artifact: `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json`
  - `readinessStatus: ready`
  - `releaseEvidence.status: pass`
  - `enabledSourceCount: 24`
  - `contributingSourceCount: 24`
  - `corroboratingSourceCount: 24`
- UI / UX product work and periodic soak measurement are now explicitly separated:
  - UI lanes build against the current published feed contract;
  - soak lanes validate the production pipeline behind that contract on merged `main`;
  - see `/Users/bldt/Desktop/VHC/VHC/docs/ops/NEWS_UI_SOAK_LANE_SEPARATION.md`.
- UI lane current state:
  - the app shell no longer requires a primary `VENN` / `HERMES` / `AGORA` mode switcher for feed use;
  - the unified feed is the home surface;
  - HERMES Forum cards are discovered through the `Topics` filter and card discussion affordances, while direct forum routes remain available for deep links/internal flows;
  - governance/elevation controls are expected through card/user flows rather than a separate primary feed tab;
  - `For You` is first-use orientation only;
  - collapsed news cards are compact and place available story media beside the headline/title, with extra source images kept for expanded detail.
- Story bundler release claims now have an explicit operational scorecard:
  - see `/Users/bldt/Desktop/VHC/VHC/docs/ops/STORY_BUNDLER_PRODUCTION_READINESS_CHECKLIST.md` for the snapshot-ready vs retained-feed-ready gates, thresholds, and artifact paths.
- The latest full combined readiness check on `main` is fresh again and currently blocks only on:
  - `headline_soak_release_evidence_failed`
  - latest artifact: `/Users/bldt/Desktop/VHC/VHC/.tmp/storycluster-production-readiness/latest/production-readiness-report.json`
- The latest complete post-fix public soak now provides usable telemetry again, but the density is still thin:
  - artifact: `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/1774695043848/semantic-soak-summary.json`
  - visible stories: `4`
  - auditable stories: `1`
  - sampled stories: `1`
  - audited pairs: `1`
- The latest headline-soak trend execution is still not promotable:
  - artifact: `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/1774707755214/semantic-soak-summary.json`
  - `readinessStatus: not_ready`
  - classification: `artifact_missing`
- Background source scouting is now part of the operating model:
  - the checked-in scout command ranks overlap-heavy candidates;
  - the active Codex automation keeps that admission lane moving without auto-merging source changes.
- Canonical feed publication is singleton-first and source-growth friendly:
  - a single readable article may publish as a valid feed story;
  - later same-incident / same-developing-episode coverage should attach under stable story identity as sources grow.
- The retained-mesh identity prerequisite is now materially improved on `main`:
  - adjacent-run continuity moved from near-zero retention to high repeated-evidence retention after stable identity anchoring;
  - the active unresolved question is now timing/attachment over hours, not sequence-driven identity churn across adjacent runs.
- Feed/discovery/storyline changes are not considered distribution-ready on unit coverage alone:
  - every such lane must run at least one relevant Playwright/browser validation command and record the exact command and result in its evidence note.
- Public-feed daemon semantic runs remain smoke/soak only:
  - `pnpm test:storycluster:smoke`
  - these runs are evidence-bearing secondary distribution telemetry, but live public-feed bundle scarcity is not currently stable enough to be the primary clustering proof or sole semantic blocker.
  - soak artifacts now include a machine-readable promotion assessment plus explicit references to the authoritative correctness-gate inputs, so release evidence can distinguish blocking correctness proof from non-blocking public-supply telemetry.
  - the scheduled headline-soak trend is still telemetry/review evidence, but the unified production-readiness rule now requires its latest trend artifact to remain fresh and pass over the recent run window.
- Beta distribution posture is now explicit:
  - the integrated VENN/HERMES/AGORA application may be distributed in constrained beta on current `main`;
  - live corroborated headlines remain beta-gated by `/Users/bldt/Desktop/VHC/VHC/.tmp/storycluster-production-readiness/latest/production-readiness-report.json`;
  - do not market the live headlines lane as production-grade until combined readiness resolves to `release_ready`.
- Live analysis default remains relay-backed remote analysis; local-first remains the target default once local-agent capability thresholds are met.

## StoryCluster Program Snapshot (2026-03-16)

Current truth for the news bundler and feed hardening lane:

- StoryCluster is no longer treated as a generic topic clusterer; the active program is `EventCluster`-first and precision-biased.
- Canonical bundle membership is limited to same-incident / same-developing-episode coverage.
- Canonical source projection is publisher-normalized:
  - `primary_sources` = one canonical source per publisher
  - `secondary_assets` = same-publisher derivatives such as video clips
- `created_at` is immutable by `story_id`; `cluster_window_end` is the latest-activity source of truth.
- `Latest` is activity-based and `Hot` remains deterministic/config-versioned.
- The fixture-backed daemon-first release gates are green on `main` after the latest semantic-fixture expansion:
  - `pnpm --filter @vh/e2e test:live:daemon-feed:integrity-gate`
  - `pnpm --filter @vh/e2e test:live:daemon-feed:semantic-gate`
- The deterministic fixture corpus now covers multilingual same-incident, recap-vs-incident, and commentary contamination pressure in addition to the earlier same-event / false-merge traps.
- StoryCluster release evidence now exposes two distinct replay identity signals:
  - `replay_continuity`
    - `continuous`: scenarios that never drop out of emitted bundles and must preserve `persistence_rate`
    - `reappearance`: scenarios that intentionally disappear and return and must preserve `reappearance_rate`
  - `replay_topology_pressure`
    - counts replay scenarios where merge/split lineage is observed
    - tracks total merge lineage, split lineage, and repeated correction-cycle scenarios separately from continuity
- The active deterministic replay corpus now includes explicit topology-pressure scenarios, so:
  - zero `replay_topology_pressure.total_split_pair_activation_count` is now a replay-coverage regression
  - repeated-cycle scenarios are expected to appear in release evidence, not just isolated lifecycle tests
- Release reviewers should not collapse these into one number:
  - low overall `persistence_rate` is expected in gap-return scenarios and must be read together with `reappearance_rate`
  - correction-cycle counts measure topology repair pressure, not semantic bundle precision by themselves
- `StorylineGroup` is now a first-class published runtime contract and read model:
  - StoryCluster publishes `storylines` alongside canonical bundles;
  - the daemon and Gun client hydrate storyline artifacts separately from canonical event bundles;
  - the web store consumes `storyline_id` for ranking/diversification, related-coverage presentation, and focused storyline state;
  - canonical source basis and bias-table basis remain event-bundle-only.
- `main` now includes:
  - storyline publication and store hydration;
  - storyline-aware ranking/diversification;
  - minimal related-coverage presentation separated from canonical sources;
  - route/search-param deep-link hydration for focused storyline state;
  - explicit shell `Back` / `Clear storyline` semantics;
  - archive-parent diversification and archive-child deep-link state.
- `main` now also includes richer public semantic-soak evidence:
  - machine-readable density/trend summaries;
  - explicit promotion-readiness assessment with blocking reasons;
  - denser diagnostic artifacts for insufficient-bundle public runs.
- The correctness-gate sufficiency lane is complete and in force on `main`.
- The current active work is live public headline-soak recovery, source-surface density growth, and release-evidence accumulation:
  - treat the deterministic known-event fixture corpus plus replay corpus as the primary StoryCluster correctness proof;
  - require the daemon-first semantic gate as the served-stack confirmation of that proof;
  - keep public semantic runs smoke-only unless they independently earn promotion beyond telemetry;
  - make source breadth growth, scout-ranked candidate promotion, and public overlap density explicit release-readiness work.
- `main` now also includes source-program operationalization:
  - machine-readable source-admission evidence;
  - machine-readable source-health decisions with keep/watch/remove runtime policy;
  - machine-readable source-candidate scouting with promotable/blocked/rejected outcomes;
  - stable latest source-health artifact publication;
  - stable latest source-scout artifact publication;
  - web/server autoload of the latest source-health artifact for diagnostics/bootstrap surfaces;
  - runtime summaries that surface the applied report source plus removed/watchlisted sources.
- Storyline/discovery work is now expected to carry browser-driven verification, not only unit coverage:
  - local feed opens create history entries;
  - focused storyline panels distinguish `Back` from `Clear storyline`;
  - route-driven storyline focus keeps only the clear action;
  - archive-parent and archive-child navigation restore focused storyline state across route transitions.
- Vote convergence and analysis persistence are validated on the fixture-backed daemon-first integrity gate; public-feed smoke remains supplementary evidence only.

### StoryCluster Next Steps (Active)

1. Keep the deterministic corpus/replay gate and daemon-first semantic gate explicit in release/readiness artifacts:
   - primary correctness proof must name the authoritative corpus, replay, and served semantic-gate inputs;
   - public semantic soak must remain labeled as secondary distribution telemetry.
2. Treat source-program maturity as the main distribution-readiness blocker:
   - production-grade feed claims apply only to onboarded readable, accessible, extraction-safe sources;
   - source onboarding/removal, paywall/truncation rejection, source-health review, and runtime-policy enforcement must follow `/Users/bldt/Desktop/VHC/VHC/docs/ops/NEWS_SOURCE_ADMISSION_RUNBOOK.md`.
3. Keep singleton-first publication and later bundle growth explicit in release evidence:
   - single-source stories remain valid feed entries;
   - later same-incident / same-developing-episode coverage must attach without identity churn as source coverage grows.
4. Production-readiness next steps:
   - keep the unified production-readiness report fresh and treat `headline_soak_release_evidence_failed` as the current live blocker until the trend actually recovers;
   - keep scheduled headline-soak collection running on the fresh, contribution-ranked public smoke surface so new density evidence replaces the older red trend window;
   - expand admitted readable source breadth only through the scout/admission/health pipeline, not generic feed growth;
   - use scout-ranked overlap-heavy candidates as the primary source-growth queue;
   - keep source-health and scout artifacts attached to release/session evidence so source-surface changes remain reviewable.
5. Keep Playwright/browser validation a standard release discipline for feed/discovery/storyline/vote changes:
   - record exact browser commands run;
   - treat fixture-backed daemon-first Playwright gates as the blocking semantic/integrity proof;
   - treat public semantic smoke as non-blocking evidence.
6. Continue improving public semantic-soak density and trend interpretation until public-feed evidence is strong enough to promote beyond smoke-only status, without treating public scarcity as a substitute for source-health review.

---

## Post-Merge Stability Gate Hardening (PR #345, merged 2026-02-24)

Merged on `main` via `coord/postmerge-convergence-stability-gate`:
- Tunable live nav timeout (`VH_LIVE_NAV_TIMEOUT_MS`, default 90s) for live matrix navigation calls.
- Two-phase strict gate in `packages/e2e/src/live/bias-vote-convergence.live.spec.ts`:
  - Phase 1 readiness = budget-capped candidate discovery and vote-capability probing.
  - Phase 2 convergence = locked/frozen candidate set only.
- Explicit setup scarcity verdict (`blocked_setup_scarcity`) with preflight reject-reason diagnostics.
- Stability runner (`packages/e2e/src/live/live-matrix-stability-gate.mjs`) now records scarcity separately (`scarcityCount`).
- Phase-2 per-topic feed reload removal (feed nav once/page before loop) to reduce strict-run wall-clock overhead.

Operational interpretation:
- Live strict failures are now classified as either setup-readiness scarcity or functional convergence failure.
- Setup scarcity indicates environment readiness issues (feed/analysis/vote-capable topic availability), not silent harness timeout.

---

## Finishing-Touch Sprint Closeout (2026-02-18)

All three finishing-touch lanes have landed on `main`:

- **#298** `coord/finishing-l2-model-picker` — merged at `2026-02-18T11:23:59Z`
- **#299** `coord/finishing-l1-relay-compat` — merged at `2026-02-18T11:30:23Z` (`a5713e3`)
- **#300** `team-d/l3-dev-invite-vote-persistence` — merged at `2026-02-18T11:49:59Z` (`5dbcc747061ebe2e7c937cab06683d2c830899b1`)

Closeout evidence from lane reports confirms: clean worktree ritual, `<=350 LOC` per touched source file, and full changed-file coverage for the finishing-touch slices.

---

## Wave 2 Landed Capabilities (2026-02-13)

Wave 2 delivered the following features across 3 workstreams and 36 PRs to `integration/wave-2`, merged to `main` via Policy 15 sync PRs (#218, #221).

### W2-Alpha — Comment-Driven Re-synthesis (PRs #192, #197, #199, #202)
- `CommentTracker` module: per-topic verified comment counting with epoch-aware state (`commentTracker.ts`)
- `DigestBuilder`: rolling `TopicDigestInput` construction from comment activity (`digestBuilder.ts` — W2A-2)
- Re-synthesis trigger wiring: comment count threshold → epoch scheduler trigger, forum comment integration (`resynthesisWiring.ts`)
- Full test coverage on all touched modules

### W2-Beta Stage 1 — Reply-to-Article + Docs MVP (PRs #190, #198, #201)
- `ForumPost` and `HermesDocs` Zod schemas + `docsAdapters` for Gun mesh sync
- 240-character reply cap enforcement in `CommentComposer`
- "Convert to Article" CTA when reply exceeds cap
- `hermesDocs` Zustand store with CRUD, flag-gated via `VITE_HERMES_DOCS_ENABLED`
- `ArticleEditor` (draft/edit) and `ArticleViewer` (read) components
- `ArticleFeedCard` integrated into discovery feed under `ARTICLE` feed kind

### W2-Beta Stage 2 — Collaborative Docs Foundation (PRs #214, #217, #219, #220)
- `@vh/crdt` package: Yjs provider, `AwarenessAdapter`, dedup module for CRDT sync
- Document key management: `deriveDocumentKey`, `shareDocumentKey`, `receiveDocumentKey`, `encryptDocContent`, `decryptDocContent` (`docsKeyManagement.ts`)
- `CollabEditor` component: TipTap + Yjs binding, lazy-loaded (229 LOC)
- `PresenceBar` component: collaborator cursor/presence indicators via AwarenessAdapter (66 LOC)
- `ShareModal` component: collaborator add/remove, role selection, trust threshold checks (261 LOC)
- `hermesDocsCollab` store: collab runtime state, auto-save (5s encrypted), offline pending indicator
- `hermesDocsAccess` store: pure access control functions (`getAccessLevel`, `canEdit`, `canView`, `canShare`, `canDelete`)
- Document key localStorage persistence (`vh_docs_keys:<nullifier>`)
- Feature flags: `VITE_HERMES_DOCS_ENABLED` + `VITE_DOCS_COLLAB_ENABLED` gate collab runtime
- E2E bypass: `VITE_E2E_MODE=true` → `MockGunYjsProvider` (no Yjs/Gun init)
- 204 new tests, 100% line+branch coverage on all touched modules

> **Note:** `CollabEditor` is wired into the active `ArticleEditor` path via lazy-load + `useEditorMode` hook (Wave 3). Flag-gated by `VITE_HERMES_DOCS_ENABLED` + `VITE_DOCS_COLLAB_ENABLED`.

### W2-Gamma Phase 1 — Linked-Social Substrate (PR #207)
- Schema convergence: `LinkedSocialAccount` and `SocialNotification` with strict Zod validation
- Vault token substrate: `OAuthTokenRecord` with vault-only storage enforcement
- Notification ingestion pipeline with sanitization

### W2-Gamma Phase 2 — Elevation Artifacts + Budget Gates (PR #209)
- Elevation schema tightening with Zod validation
- Artifact generators: `BriefDoc`, `ProposalScaffold`, `TalkingPoints`
- `civic_actions/day` budget gate enforcement (budget key #7 of 8 now active)
- Trust threshold checks for elevation nominations

### W2-Gamma Phase 3 — Social Feed Wiring (PR #211)
- `SocialNotificationCard` real-data rendering (replaces mock)
- `socialFeedAdapter`: notification → feed item mapping with dismiss/seen state
- Feed integration: social notifications in `Social` surface and `All` feed

### Wave 2 Governance Infrastructure (20 coord/* PRs)
- CE dual-review contracts codified and enforced for all execution dispatches
- Ownership map expanded for all 3 workstreams (glob patterns per Policy 2)
- Wave 2 delta contract: 16 binding policies defined and enforced
- Policy 4 exception documented (serialized merge fallback)
- Policy 14 repo migration parity verified post-transfer
- Policy 15 periodic sync enforced (PRs #218, #221)
- Context rotation guard enforced (Policy 13)

---

## Wave 2 Deferred Items (CEO Decision 2026-02-13)

The following items were explicitly deferred to Wave 3 by CEO decision:

| Item | Reason | Carryover Doc |
|------|--------|---------------|
| W2-Gamma Phase 4 (receipt-in-feed) | DeliveryReceipt schema needed spec work at W2 close; additive to landed foundation | Feed-card rendering support landed; live publication remains partial |
| SoT F: Rep directory + native intents | CAK foundation landed; full delivery pipeline is Wave 3 priority | Tracked in current STATUS backlog |
| CollabEditor runtime wiring | Foundation built and tested; ArticleEditor wiring deferred at W2 close | Completed in Wave 3; see Docs status below |

---

## Feature Flags

| Flag | Purpose | Default | Wave |
|------|---------|---------|------|
| `VITE_FEED_V2_ENABLED` | Retired; discovery feed shell is permanently mounted | n/a | 1 |
| `VITE_TOPIC_SYNTHESIS_V2_ENABLED` | Gates synthesis v2 hooks | `false` | 1 |
| `VITE_NEWS_BRIDGE_ENABLED` | Gates news store → discovery feed bridge bootstrap | `false` | 1 |
| `VITE_SYNTHESIS_BRIDGE_ENABLED` | Gates synthesis store → discovery feed bridge bootstrap | `false` | 1 |
| `VITE_NEWS_RUNTIME_ENABLED` | Gates ai-engine news runtime bootstrap in app init | `false` | 1 |
| `VITE_NEWS_FEED_SOURCES` | JSON override for runtime feed source list | empty (`[]`) | 1 |
| `VITE_NEWS_TOPIC_MAPPING` | JSON override for runtime topic mapping | empty (defaults to `topic-news`) | 1 |
| `VITE_NEWS_POLL_INTERVAL_MS` | Runtime polling cadence override (ms) | empty (defaults to 30m) | 1 |
| `VITE_E2E_MODE` | Deterministic bypass of heavy I/O init (Gun/Yjs) | `false` | 1 |
| `VITE_VH_ANALYSIS_PIPELINE` | Enables relay-backed analysis path (`/api/analyze`) | `true` in live profiles | Post-4 |
| `VITE_REMOTE_ENGINE_URL` | Direct remote engine endpoint (deprecated path) | empty | 1 |
| `VITE_ANALYSIS_MODEL` | Selects remote analysis model id in ai-engine | `gpt-5-nano` | 1 |
| `VITE_REMOTE_API_KEY` | Auth key for remote analysis requests | empty | 1 |
| `VITE_HERMES_DOCS_ENABLED` | Gates HERMES Docs store + article editor | `false` | 2 |
| `VITE_DOCS_COLLAB_ENABLED` | Gates collaborative editing runtime | `false` | 2 |
| `VITE_LINKED_SOCIAL_ENABLED` | Gates linked-social notification pipeline | `false` | 2 |
| `VITE_ELEVATION_ENABLED` | Gates elevation artifact generation | `false` | 2 |
| `VITE_SESSION_LIFECYCLE_ENABLED` | Gates session expiry/near-expiry checks + forum freshness | `false` | 4 |
| `VITE_CONSTITUENCY_PROOF_REAL` | Gates constituency proof verification enforcement | `false` | 4 |

Code-level defaults remain conservative (`false`/empty) unless explicitly noted.
Operational live profiles intentionally override selected flags to enable the full production-like path (analysis relay + runtime feed stack).

---

## Product Direction Deltas (A-G)

| Direction Delta | Target (Ship Snapshot) | Current Implementation |
|---|---|---|
| A. V2-first synthesis | `TopicSynthesisV2` (quorum + epochs + divergence) is canonical | ✅ Types, candidate gatherer, quorum engine, epoch scheduler, store, Gun adapters (Wave 1) + re-synthesis triggers, comment tracking, digest builder (Wave 2 Alpha) |
| B. Unified feed | Feed mixes `News`, `Topics`, `Linked-Social Notifications`, `Articles`, and `Action Receipts` (`All` only) | ✅ Discovery feed shell with all five source surfaces, compact one-feed chrome, source-strip cards, first-use orientation, and real social notification wiring |
| C. Elevation loop | Nomination thresholds produce BriefDoc + ProposalScaffold + TalkingPoints + rep forwarding | 🟡 Elevation schema + artifact generators + budget gates landed (Wave 2 Gamma P2); receipt feed-card rendering support landed, live publication remains partial |
| D. Thread + longform rules | Reddit-like sorting, 240-char replies, overflow to Docs article | ✅ Forum sorting + 240-char reply cap + Convert-to-Article CTA + ArticleFeedCard (Wave 2 Beta S1) |
| E. Collaborative docs | Multi-author encrypted docs, draft-to-publish workflow | 🟢 Full foundation plus flag-gated ArticleEditor runtime wiring: CRDT/Yjs, E2EE key management, collab editor, presence, sharing, access control |
| F. Civic signal → value rails | Eye/Lightbulb capture thought-effort; aggregate civic signal drives future REL/AU | 🟡 Per-user Eye/Lightbulb decay persists locally and projects topic engagement summaries to mesh; budget guards (7/8 keys active), elevation artifacts landed; rep directory + native intents deferred to Wave 3 |
| G. Provider switching + consent | Default API relay today; local-first when local-agent capability thresholds are met; remote providers opt-in with cost/privacy clarity | ✅ Relay default in live profiles; local engine path retained; model/provider override controls in place |

---

## Test & Coverage Truth

**Gate verification snapshot date:** 2026-02-15 (historical baseline)
**Branch snapshot:** `main` at `df0f787` (historical reference; rerun gates on current branch before release)

### Live strict matrix lane (post-merge)

- Canonical single-run strict: `pnpm --filter @vh/e2e test:live:matrix:strict`
- Canonical multi-run strict stability gate: `pnpm --filter @vh/e2e test:live:matrix:strict:stability`
- Strict gate now emits setup-scarcity vs convergence outcomes explicitly via `live-bias-vote-convergence-summary`.

| Gate | Result | Detail |
|------|--------|--------|
| `pnpm typecheck` | ✅ PASS | All workspace projects |
| `pnpm lint` | ✅ PASS | All workspace projects |
| `pnpm test` | ✅ PASS | 2557+ tests (49 new in Wave 4, including coverage gap fixes) |
| `pnpm test:e2e` | ✅ PASS | E2E tests passed (CI run 22024258084) |
| `pnpm bundle:check` | ✅ PASS | Under 1 MiB limit |
| `pnpm deps:check` | ✅ PASS | Zero circular dependencies |
| Feature-flag variants | ✅ PASS | All ON/OFF combinations pass |

**Coverage:** 100% line+branch on all Wave 4 modules (diff-aware gate, 483/483 branches on merge PR #253).

---

## Sprint Completion Status

| Sprint | Status | Key Outcomes |
|--------|--------|-------------|
| **Sprint 0** (Foundation) | ✅ Complete | Monorepo, CLI, CI, core packages |
| **Sprint 1** (Core Bedrock) | ⚠️ 90% | Encrypted vault, identity types, contracts; Sepolia deployed; attestation hardened but not production-grade |
| **Sprint 2** (Civic Nervous System) | ✅ Complete | Full analysis pipeline, relay-backed live default, local engine retained as non-default path |
| **Sprint 3** (Communication) | ✅ Complete | E2EE messaging, forum with stance-threading, XP integration |
| **Sprint 3.5** (UI Refinement) | ✅ Complete | Stance-based threading, design unification |
| **Sprint 4** (Agentic Foundation) | ✅ Complete | Delegation types + store + control panel; participation governors; budget denial UX |
| **Wave 1** (V2 Features) | ✅ Complete | Synthesis pipeline/store, news aggregator/store, discovery feed/cards, delegation runtime, bridge/attestor wiring |
| **Wave 2** (Integration Features) | ✅ Complete | Re-synthesis triggers, collaborative docs foundation, elevation artifacts, linked-social substrate, social feed wiring |
| **Wave 3** (CAK + Collab + LUMA Spec) | ✅ Complete | CAK Phase 3 UI, collab editor wiring, feature flags, budget boundary, synthesis feed, LUMA identity spec v0.2 (13 PRs: #229–#242) |
| **Wave 4** (LUMA Identity Hardening) | ✅ Complete | Trust constants consolidation, session lifecycle, constituency proof verification — all flag-gated (8 PRs: #243–#250) |

---

## Detailed Status by Subsystem

### LUMA (Identity Layer)

**Status:** 🟡 **Hardened (Flag-Gated)** — Trust constants, session lifecycle, constituency proof verification

| Feature | Implementation | Evidence |
|---------|----------------|----------|
| Trust constants | ✅ Centralized | `packages/data-model/src/constants/trust.ts` — TRUST_MINIMUM (0.5), TRUST_ELEVATED (0.7) |
| Session lifecycle | ✅ Feature-flagged | `packages/types/src/session-lifecycle.ts` — expiry, near-expiry, migration (`VITE_SESSION_LIFECYCLE_ENABLED`) |
| Constituency proof verification | ✅ Feature-flagged | `packages/types/src/constituency-verification.ts` — nullifier/district/freshness checks (`VITE_CONSTITUENCY_PROOF_REAL`) |
| Session revocation | ✅ Active (no flag) | `useIdentity.ts` — `revokeSession()` clears identity + proof state |
| Hardware TEE binding | ❌ Not implemented | No Secure Enclave/StrongBox code (Season 0 deferred §9.2) |
| VIO liveness detection | ❌ Not implemented | No sensor fusion code (Season 0 deferred §9.2) |
| Trust score calculation | ⚠️ Hardened stub | `main.rs` — structured validation, rate limiting; no real chain validation |
| Nullifier derivation | ⚠️ Device-bound | SHA256(device_key + salt) |
| Identity storage | ✅ Encrypted vault | `identity-vault` package (IndexedDB) |
| Sybil resistance | ❌ Not implemented | No uniqueness checking (Season 0 deferred §9.2) |

**⚠️ WARNING:** Current identity layer provides hardened stubs with feature-gated enforcement. Both flags default to `false`. Real sybil defense requires TEE + VIO (post-Season 0).

---

### Agentic Familiars (Delegation)

**Status:** 🟡 **Store + Hooks + UI Landed** — Full runtime orchestration pending

| Feature | Implementation | Evidence |
|---------|----------------|----------|
| Delegation store (grants/revocation) | ✅ Landed | `store/delegation/index.ts` |
| Persistence (safeStorage) | ✅ Landed | `store/delegation/persistence.ts` |
| `useFamiliar` hook | ✅ Landed | `store/delegation/useFamiliar.test.ts` |
| FamiliarControlPanel UI | ✅ Landed | `components/hermes/FamiliarControlPanel.tsx` |
| Delegation utility functions | ✅ Landed | `packages/types/src/delegation-utils.ts` |
| Budget enforcement (7/8 keys) | ✅ Wired | posts, comments, governance/sentiment votes, analyses, shares, civic_actions |
| Full familiar orchestration | ❌ Not implemented | No autonomous agent loop |

---

### GWC (Economics Layer)

**Status:** 🟡 **Contracts Implemented, Sepolia Deployed**

| Feature | Contract | Tests | Deployed |
|---------|----------|-------|----------|
| RVU Token (ERC-20) | ✅ `RVU.sol` | ✅ | ⚠️ Localhost + Sepolia |
| UBE Distribution | ✅ `UBE.sol` | ✅ | ❌ Not deployed |
| Quadratic Funding | ✅ `QuadraticFunding.sol` | ✅ | ❌ Not deployed |
| Median Oracle | ✅ `MedianOracle.sol` | ✅ | ⚠️ Localhost + Sepolia |
| Faucet | ✅ `Faucet.sol` | ✅ | ❌ Not deployed |

---

### VENN (Canonical Analysis Layer)

**Status:** 🟡 **Pipeline End-to-End, V2 Synthesis + Re-synthesis Landed**

| Feature | Implementation | Evidence |
|---------|----------------|----------|
| Analysis pipeline (v1) | ✅ End-to-end | `pipeline.ts` |
| `LocalMlEngine` (WebLLM) | ✅ Default in non-E2E | `localMlEngine.ts` |
| `RemoteApiEngine` (opt-in) | ✅ Wired | `remoteApiEngine.ts` |
| Synthesis types (v2) | ✅ Landed | `synthesisTypes.ts` |
| Candidate gatherer | ✅ Landed | `candidateGatherer.ts` |
| Quorum engine | ✅ Landed | `quorum.ts` |
| Epoch scheduler | ✅ Landed | `epochScheduler.ts` |
| Synthesis store | ✅ Landed | `store/synthesis/` |
| Gun synthesis adapters | ✅ Landed | `synthesisAdapters.ts` |
| Comment tracker (W2) | ✅ Landed | `commentTracker.ts` |
| Digest builder (W2) | ✅ Landed | `digestBuilder.ts` |
| Re-synthesis triggers (W2) | ✅ Landed | `resynthesisWiring.ts` |

---

### HERMES (Communication Layer)

#### Messaging — 🟢 Implemented

| Feature | Status |
|---------|--------|
| E2EE encryption (SEA) | ✅ |
| Gun sync | ✅ |
| Topology guard | ✅ |
| XP integration | ✅ |

#### Forum — 🟢 Implemented + Reply Cap + Article CTA

| Feature | Status |
|---------|--------|
| Threaded comments (stance-based) | ✅ |
| 240-char reply cap enforcement | ✅ (Wave 2) |
| Convert-to-Article CTA | ✅ (Wave 2) |
| `topicId`/`sourceUrl`/`urlHash`/`isHeadline` | ✅ |
| Feed↔Forum integration | ✅ |
| Proposal extension on threads | ✅ |

#### Docs — 🟢 Foundation Complete, Runtime Wiring Flag-Gated

| Feature | Status |
|---------|--------|
| hermesDocs store (CRUD) | ✅ (Wave 2 S1) |
| ArticleEditor + ArticleViewer | ✅ (Wave 2 S1) |
| ArticleFeedCard in discovery feed | ✅ (Wave 2 S1) |
| CRDT/Yjs provider + dedup | ✅ (Wave 2 S2) |
| Document key management (E2EE) | ✅ (Wave 2 S2) |
| CollabEditor (TipTap + Yjs) | ✅ Foundation (Wave 2 S2) |
| PresenceBar (awareness) | ✅ Foundation (Wave 2 S2) |
| ShareModal (access control) | ✅ Foundation (Wave 2 S2) |
| hermesDocsCollab store | ✅ Foundation (Wave 2 S2) |
| hermesDocsAccess functions | ✅ Foundation (Wave 2 S2) |
| CollabEditor wired into ArticleEditor | ✅ Wave 3, flag-gated by `VITE_HERMES_DOCS_ENABLED` + `VITE_DOCS_COLLAB_ENABLED` |

#### Bridge (Civic Action Kit) — 🟡 Elevation Landed

| Feature | Status |
|---------|--------|
| Attestation verifier (hardened) | ✅ |
| Elevation artifact generators | ✅ (Wave 2) |
| civic_actions/day budget gate | ✅ (Wave 2) |
| Trust threshold for nominations | ✅ (Wave 2) |
| Receipt-in-feed | 🟡 Feed-card rendering support landed; live publication remains partial |
| Representative directory | ❌ Wave 3 |
| Native intents | ❌ Wave 3 |

#### Linked-Social — 🟡 Substrate + Feed Cards Landed

| Feature | Status |
|---------|--------|
| LinkedSocialAccount schema | ✅ (Wave 2) |
| SocialNotification schema | ✅ (Wave 2) |
| Vault token substrate | ✅ (Wave 2) |
| Notification ingestion | ✅ (Wave 2) |
| SocialNotificationCard (real data) | ✅ (Wave 2) |
| socialFeedAdapter | ✅ (Wave 2) |
| OAuth connection flow | ❌ Not implemented |

---

### News Aggregator

**Status:** 🟡 **Implemented, with active StoryCluster hardening**

| Feature | Implementation |
|---------|----------------|
| RSS/Atom ingest | ✅ `packages/ai-engine/src/newsIngest.ts` |
| HTML normalization and source dedupe | ✅ `packages/ai-engine/src/newsNormalize.ts` |
| Daemon-first StoryCluster production path | ✅ `services/news-aggregator/src/daemon.ts`, `packages/ai-engine/src/clusterEngine.ts` |
| Stable `story_id` + canonical news `topic_id` contract | ✅ `services/storycluster-engine/src/remoteContract.ts`, `packages/gun-client/src/newsAdapters.ts` |
| Publisher-normalized canonical source projection | ✅ `services/storycluster-engine/src/bundleProjection.ts` |
| `StorylineGroup` publication | ✅ `services/news-aggregator/src/daemon.ts`, `packages/gun-client/src/storylineAdapters.ts` |
| Fixture-backed semantic gate | ✅ `packages/e2e/src/live/daemon-first-feed-semantic-audit.live.spec.ts` |
| Public semantic soak | 🟡 Non-blocking smoke only |

---

### Discovery Feed

**Status:** 🟢 **Implemented, with release-gated daemon-first validation**

| Feature | Implementation |
|---------|----------------|
| Feed shell + filter chips | ✅ `FeedShell.tsx` |
| Sort controls | ✅ `SortControls.tsx` |
| Compact feed chrome + first-use orientation | ✅ `components/feed/FeedShellChrome.tsx` |
| Primary mode nav retired from app chrome | ✅ `routes/index.tsx` |
| Latest by activity (`cluster_window_end`) | ✅ `apps/web-pwa/src/store/feedBridge.ts`, `apps/web-pwa/src/store/news/storeHelpers.ts` |
| Deterministic hotness wiring | ✅ `packages/gun-client/src/newsAdapters.ts` |
| TopicCard / NewsCard | ✅ Wave 1 |
| Compact NewsCard side media + source strip + engagement counts | ✅ `components/feed/NewsCardFront.tsx`, `components/feed/SourceBadgeRow.tsx`, `components/feed/FeedEngagement.tsx` |
| Mesh-backed Eye/Lightbulb topic engagement counters | ✅ `hooks/useSentimentState.ts`, `hooks/useFeedEngagementMetrics.ts`, `packages/gun-client/src/topicEngagementAdapters.ts` |
| SocialNotificationCard (real data) | ✅ Wave 2 |
| ArticleFeedCard | ✅ Wave 2 |
| Discovery store + ranking | ✅ `store/discovery/` |
| Storyline focus shell + archive presentation | ✅ `components/feed/FeedShell.tsx`, `components/feed/StorylineFocusPanel.tsx` |
| Fixture-backed integrity gate | ✅ `packages/e2e/src/live/daemon-first-feed-integrity.live.spec.ts` |
| Fixture-backed semantic gate | ✅ `packages/e2e/src/live/daemon-first-feed-semantic-audit.live.spec.ts` |
| Public semantic soak | 🟡 Evidence-bearing smoke only |

---

## Security Considerations

### Current Risks

| Risk | Severity | Status |
|------|----------|--------|
| No sybil defense | 🔴 High | Open |
| Trust scores spoofable | 🔴 High | Open (hardened stubs, not production) |
| First-to-file poisoning (v1) | 🟡 Medium | Open (v2 quorum landed, runtime pending) |

### Mitigations in Place

- ✅ Identity stored in encrypted IndexedDB vault
- ✅ Topology guard prevents unauthorized Gun writes
- ✅ Encryption required for sensitive mesh paths
- ✅ XP ledger is local-only
- ✅ Participation governors enforce rate limits (8/8 budget keys active)
- ✅ TOCTOU hardening on concurrent budget operations
- ✅ Attestation verifier has structured validation and rate limiting
- ✅ AI engine default is truthful (LocalMlEngine in non-E2E)
- ✅ Document keys derived per-document, never stored on mesh (Wave 2)
- ✅ OAuth tokens vault-only, never on public paths (Wave 2)

---

## Deployment Status

| Environment | Status | Artifacts |
|-------------|--------|-----------|
| Localhost (Anvil) | ✅ Working | `deployments/localhost.json` |
| Sepolia Testnet | ✅ Deployed | `deployments/sepolia.json` |
| Base Sepolia | ❌ Not deployed | Script exists |
| Mainnet | ❌ Not planned | — |

---

## Next Work (Post-Wave 4)

Wave 4 merged to main via PR #253 (`31fce88`, 2026-02-15T01:44:54Z). All integration branches (`integration/wave-3`, `integration/wave-4`) are ancestors of `main`.

### Feed Parity Slices (Post-Wave 4)
- **FE-1** (provider model): merged
- **FE-2** (bias table): merged
- **FE-3** (cell voting): Per-cell sentiment voting on BiasTable v2 is now always-on in production wiring
- **FE-4** (removal polish): merged

Remaining backlog:
1. **Feature-flag retirement** — promote Wave 1–4 flags to permanent-on after stability verification
2. ~~**Remaining budget key**~~ — `moderation/day` enforcement landed (PR #259, all 8/8 active)
3. **Runtime wiring** — synthesis pipeline → discovery feed UI (v2 end-to-end)

Post-Season 0 (deferred per spec §9.2):
- TEE/VIO hardware binding
- Real sybil resistance
- BioKey, DBA, ZK-SNARK proofs
- Gold/Platinum trust tiers

---

## References

### Architecture & Specs
- `System_Architecture.md` — Target architecture
- `docs/foundational/ARCHITECTURE_LOCK.md` — Non-negotiable engineering guardrails
- `docs/specs/spec-hermes-docs-v0.md` — HERMES Docs spec (Canonical for Season 0)
- `docs/specs/spec-hermes-forum-v0.md` — Forum spec
- `docs/specs/spec-linked-socials-v0.md` — Linked-social spec
- `docs/specs/spec-civic-action-kit-v0.md` — Civic Action Kit spec
- `docs/specs/topic-synthesis-v2.md` — Synthesis V2 spec
