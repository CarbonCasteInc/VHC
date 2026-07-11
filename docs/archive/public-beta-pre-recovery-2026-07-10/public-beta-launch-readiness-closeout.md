# Archived Public Beta Launch Readiness Closeout - Pre-Recovery Snapshot

> Document Role: Historical launch-readiness snapshot (non-authoritative)
> Archived: 2026-07-11
> Superseded By: `docs/ops/public-beta-launch-readiness-closeout.md`
> Do not use this file as current launch authority.

> Status: Engineering Closeout Audit
> Owner: VHC Launch Ops
> Last Reviewed: 2026-07-10
> Depends On: docs/plans/VENN_NEWS_MVP_ROADMAP_2026-04-20.md, docs/ops/public-beta-compliance-minimums.md, docs/ops/BETA_SESSION_RUNSHEET.md, docs/ops/public-beta-launch-control-2026-07-09.md, docs/ops/public-beta-distribution-packet-2026-07-09.md, docs/ops/a6-s1b-relay-timeout-recovery-packet-2026-07-10.md, docs/plans/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md

Version: 0.11
Document path: `docs/ops/public-beta-launch-readiness-closeout.md`
Audit baseline: current public-beta closeout baseline plus the LUMA public-beta MVP readiness slice and consolidated MVP closeout packet.
Scope: Web PWA public beta launch-readiness evidence, deterministic gate inventory, and remaining-work classification.

2026-06-24 Scope A update: Phase 5 raw public-news Scope A is live under the
controlled profile recorded in
`docs/archive/public-beta-pre-recovery-2026-07-10/reports/phase5-scope-a-launch-closeout-2026-06-24.md`. That launch proves
raw-fresh, signed, product-visible latest-index cards with pending lifecycle
state and relay REST quorum. It does not satisfy the broader public-beta gates
below for accepted synthesis, full app readiness, mesh `release_ready`, LUMA
production assurance, or legal/commercial launch claims.

2026-06-28 Scope A stability update: the StoryCluster rerank truncation track is
closed for the launched raw path after #687. The stability bake in
`docs/archive/public-beta-pre-recovery-2026-07-10/reports/phase5-scope-a-stability-bake-2026-06-28.md` recorded 42 clean
post-overlap ticks, 336/336 raw writes, zero new truncation artifacts, zero
rerank degeneracy warnings, and a passing hourly archive. This strengthens the
controlled raw Scope A claim but still does not satisfy the broader gates below.

2026-07-02 Scope A recovery update: outage #2 began at
`2026-06-29T15:50:53Z` when correlated relay trips broke critical 2-of-3 quorum
and the publisher fail-closed as designed. The feed recovered after roughly 67
hours and is fresh again with #691 graph diagnostics, #692 early heap capture,
#693 fresh-bundle priority, and #694 staggered relay watchdog ceilings deployed.
The recovery is recorded in
`docs/archive/public-beta-pre-recovery-2026-07-10/reports/phase5-scope-a-recovery-current-state-2026-07-02.md`. This closes
the outage, not the sustained-operation proof.

2026-07-03 Scope A driver update: the read-only verdict in
`docs/archive/public-beta-pre-recovery-2026-07-10/reports/phase5-scope-a-driver-verdict-2026-07-02.md` classifies the
current heap growth as `heap_driver_off_graph_likely`. Graph live bytes are too
small to explain heap/RSS growth, tombstones remain absent, and total graph soul
count is not large enough to make link-only structure the primary driver. The
missing early-capture artifact is threshold-not-reached evidence, not another
trip-time capture failure: the sampled heap stayed near `300 MiB`, below the
configured `~800 MiB` trigger. The next Scope A PR is early-capture threshold
retuning and secret-safe retainer identification; the intended public-beta
diagnostic defaults are staggered per relay (`relay-a=500/700 MiB`,
`relay-b=520/720 MiB`, `relay-c=540/740 MiB`) so realistic relay uptimes can
produce evidence without synchronized heap serialization. Retention, publisher
clear, eviction, and relay compaction are not release-readiness work unless a
future retainer summary names them.

2026-07-06 Scope A alert/recovery update: Slice 0 interim email alerting is now
live on A6, and the first real alert after enablement correctly reported a
stale-feed condition rather than setup noise. PR #723 fixed the StoryCluster
production-timeout path that blocked raw writes, A6 is on `main@47ba218d`, and
the normal post-fix tick completed at `2026-07-06T22:44:08.567Z` with 8/8 raw
writes and public/relay/snapshot/alert readbacks passing. The current record is
`docs/archive/public-beta-pre-recovery-2026-07-10/reports/phase5-scope-a-post-slice0-current-state-2026-07-06.md`. This
moves Scope A into evidence accrual: do not restart services, enable Codex live
execution, deploy the custom pager, or choose a memory fix while the feed stays
fresh. The next triggers are a new alert or the first post-recovery 500 MB ->
700 MB heap-summary pair.

## 1. Closeout Verdict

Engineering closeout status: Web PWA public beta candidate, constrained to the implemented beta scope, with public feed composition/freshness, fresh RSS propagation, lifecycle accountability, analysis/frame-table reliability, pagination/refresh, and stance aggregate behavior now explicit release gates.

No public-beta launch claim may proceed unless the release owner produces a passing evidence packet on the release commit, including the public latest-index/story-body/synthesis/frame-table reliability gate, the public feed mixed-composition/freshness gate with all configured public relay peer readbacks, the fresh RSS-to-product-feed propagation gate, and the raw-story/product-feed lifecycle accountability gate. The implemented beta scope includes the core news loop, accepted synthesis detail, point stance persistence, deterministic story threads, correction/moderation/report remediation paths, operator trust gate, public policy routes, public support issue intake, private escalation protocol, curated fallback launch content, and LUMA public-beta MVP readiness for the beta-local identity/signed-write layer.

`pnpm check:mvp-closeout` is the consolidated release-truth reader for this scope. It reads the MVP release-gates packet, source-health packet, LUMA MVP readiness packet, Mesh readiness packet, and production app canary packet, then writes `.tmp/mvp-closeout/latest/mvp-closeout-report.json` with bounded allowed/forbidden claims. It does not override any upstream gate. For a release-commit packet, run `pnpm check:mvp-release-evidence`; it regenerates those upstream inputs, records boundary Mesh/canary exits without treating them as launch claims, runs closeout, and writes `.tmp/release-evidence-pipeline/latest/release-evidence-pipeline-report.json` without storing command stdout or stderr.

Public feed organic-composition gate update, 2026-06-08: The relay latest-index response now reports organic selected-window composition separately from emergency mixed-feed backfill: `organic_selected_count`, `organic_singleton_visible`, `organic_multi_source_visible`, `scan_window_selected_count`, `scan_window_singleton_visible`, `scan_window_multi_source_visible`, `backfill_used`, `backfill_story_ids`, and `composition_backfill_records`. `pnpm check:public-feed:composition-freshness` and `pnpm check:mvp-release-gates` treat `public-relay-feed-composition-backfill-only-multi-source` as a hard failure; a corroborated row appended after a singleton-only top window no longer proves mixed latest-feed composition. The same gate now defaults to a 24-hour MVP current-news freshness SLA through `VH_PUBLIC_FEED_MVP_FRESHNESS_WINDOW_MS`, while still recording the observed `freshness_age_ms`. This is release-gate hardening only until rerun on the deployed public commit with current public peer evidence.

Fresh propagation gate update, 2026-06-08: `pnpm check:public-feed:fresh-propagation` now writes `.tmp/release-evidence/public-feed-fresh-propagation/latest/public-feed-fresh-propagation-summary.json` and validates a current live RSS producer run separately from fixture evidence. It requires daemon ingest, normalization, StoryCluster request/response, raw story snapshot, latest/hot product indexes, readable story bodies, and Web PWA consumer render/open evidence; inside `pnpm check:mvp-release-gates` it also requires the current public browser-smoke artifact so relay readback, refresh, and cursor pagination stay tied to the same release packet. Empty or stale propagation may classify as `setup_scarcity` only when source-health/publisher evidence shows no usable live input; fixture-only, stale latest activity with source supply, missing stage logs, missing browser smoke, and failed relay refresh evidence are hard failures.

Source slate correction, 2026-06-08: The current live source-health runs held release evidence because `democracydocket-alerts` sampled one durable article 404 and fell below the MVP `keepMinReadableSampleRate: 1` rule (`readableSampleRate: 0.75`, `watchSourceIds: ["democracydocket-alerts"]`), and then `scotusblog-main` became feed-unavailable through the FeedBurner URL (`feed_links_unavailable`, `feed_fetch_error`, zero contribution; direct `curl` timed out after 15 seconds). This branch prunes both sources from the admitted starter/live source surface rather than weakening the threshold or classifying the issue as scarcity. The remaining admitted slate still has 25 keep sources with contributing and corroborating source evidence; a release claim still requires a fresh passing source-health packet on the final commit.

Current PR #632 blocker audit, 2026-06-09: Branch
`coord/mvp-public-news-feed-organic-composition-v1` has current release-gate
evidence on commit `04e8c2e20ee897b2e53137b690ad4c40bb6af606`; the branch
remains not release-ready. Source-health evidence generated at
`2026-06-09T02:12:40.887Z` is `ready`/`pass` with 25 admitted sources, 831
ingested items, 767 normalized items, 391 heuristic bundles, 338 singleton
bundles, 53 corroborated bundles, 25 contributing sources, and 23
corroborating sources, so the deployed public feed failures are not
`setup_scarcity`. The public composition artifact at
`.tmp/release-evidence/public-feed-composition-freshness/latest/public-feed-composition-freshness-summary.json`
and lifecycle artifact at
`.tmp/release-evidence/public-feed-lifecycle-accountability/latest/public-feed-lifecycle-accountability-summary.json`
record peer-by-peer early-failure readback evidence generated around
`2026-06-09T02:25Z`: `https://venn.carboncaste.io`,
`https://gun-a.carboncaste.io`, `https://gun-b.carboncaste.io`, and
`https://gun-c.carboncaste.io` all returned Cloudflare `530` / Error `1033` for
the public latest-index surface. Because latest-index is unreadable across the
configured public HTTP relay origins, the public latest feed, story-body
readback, refresh, pagination, lifecycle, and stance gates cannot be claimed
from current deployed evidence. The canonical mesh aggregate regenerated on the
same runtime commit at
`.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json`
has run id `mesh-production-readiness-20260609T012910Z-4aca67f6`, status
`review_required`, all 12 implemented source reports passing, a full 30-minute
soak pass, evidence scrub pass, and one remaining release blocker:
`public-wss-deployment-proof`. A direct continuation run of
`pnpm test:mesh:deployed-wss-peer-config:public` remained blocked before network
validation because the required public proof inputs were not configured:
`VH_MESH_PUBLIC_PEER_CONFIG_URL`, `VH_MESH_PUBLIC_PEER_CONFIG_PUBLIC_KEY`,
`VH_MESH_PUBLIC_CONFIG_ID`, `VH_MESH_PUBLIC_APP_URL`,
`VH_MESH_PUBLIC_WSS_PEERS`, `VH_MESH_PUBLIC_CSP_CONNECT_SRC`,
`VH_MESH_PUBLIC_MINIMUM_PEER_COUNT`, and `VH_MESH_PUBLIC_QUORUM_REQUIRED`.
Standalone public WSS proof artifacts are now isolated under
`.tmp/mesh-production-readiness/latest-public-wss-proof/` so a blocked proof
cannot overwrite the aggregate mesh readiness packet consumed by closeout and
production-app canary readers. The LUMA-gated mesh coverage packet
`mesh-luma-gated-write-coverage-20260609T012900Z-bd94915a` passed with
`schema_epoch: post_luma_m0b` and `luma_profile: e2e`, and
`.tmp/luma-mvp-production-readiness/latest/luma-mvp-production-readiness-report.json`
is `pass` for the public-beta LUMA surface. Those LUMA/mesh results do not
clear public distribution readiness. Fresh propagation is also still blocked:
the publisher canary starts the daemon, ingests 15 RSS items, normalizes 13,
and sends 13 items to StoryCluster, then fails closed in
`language_translation` on OpenAI HTTP 401 `invalid_api_key` with the key
redacted. This is neither `setup_scarcity` nor a pass; it is a live
credential/deployment blocker and no release note may claim production feed
freshness, public WSS release readiness, or deployed MVP distribution readiness
from this packet.

Public release-gate env correction, 2026-06-08: `pnpm check:mvp-release-gates`
now invokes all public-feed release gates against the deployed public app and
configured public peer set instead of inheriting local defaults:
`https://venn.carboncaste.io`, `https://gun-a.carboncaste.io`,
`https://gun-b.carboncaste.io`, `https://gun-c.carboncaste.io`, and WSS peers
`wss://gun-a.carboncaste.io/gun`, `wss://gun-b.carboncaste.io/gun`,
`wss://gun-c.carboncaste.io/gun`. The composition and lifecycle gates now
write failure summaries with configured public peer-origin readback tables even
when the first public latest-index readback fails. The 2026-06-09 local
umbrella rerun at
`.tmp/mvp-release-gates/latest/mvp-release-gates-report.json` recorded
`overallStatus: fail` with 15 passing gates and 6 failing gates. Public feed
analysis/frame reliability and stance/aggregate browser smoke both failed on
`gun-latest-index-readback-timeout`; composition and lifecycle failed on
Cloudflare 530 from the deployed latest-index route; fresh propagation failed
after live RSS ingest/normalize when StoryCluster reached the redacted invalid
OpenAI key; pagination reused the same public browser-smoke failure. The LUMA
row passed on the clean runtime evidence head. These are launch blockers, not
`setup_scarcity`, because source-health evidence still reports 25 admitted
sources and 54 corroborated bundles.

The release-owner decision handoff is now recorded in
`docs/ops/public-beta-launch-control-2026-07-09.md`. That packet converts the
engineering release-candidate evidence into an explicit go/no-go control
surface with approvals, bounded launch copy, support/escalation ownership,
rollback ownership, and final launch status. The launch-control packet must not
fake signoff: while any required approval, owner, release commit, auth host,
provider decision, A6 readback, release evidence, or rehearsal field is pending,
its status remains `no_go_pending_operator_decisions_and_live_evidence`. A
future `go_for_public_beta_ramp` status is valid only after the packet's
authority/contact fields and evidence rows are filled. `pnpm
check:public-beta-launch-control` statically enforces that no-go packets retain
explicit blockers and go packets do not retain TBDs, release-blocker rows, stale
blocked-evidence text, or "No tester wave" language.

The first-wave distribution packet is recorded in
`docs/ops/public-beta-distribution-packet-2026-07-09.md`. It is intentionally
blocked until release evidence, provider rehearsal, A6/origin readbacks,
operator owners, rollback ownership, alert ownership, private support,
external approval disposition, and manual rehearsal fields are filled. `pnpm
check:public-beta-distribution-packet` pins that blocked state, the required
evidence rows, claim-safe tester invite copy, stop rules, and rollback
boundaries so launch closeout cannot drift away from the actual distribution
control surface.

The remaining operator packets are guarded by
`pnpm check:release-readiness-operator-packets`: StoryCluster headline-soak
credential repair, A6 accepted-synthesis canary, and auth-callback/provider
deployment. The check keeps those packets pending or draft until their
preconditions are met, and pins their secret-safe evidence, non-goals, stop
rules, rollback boundaries, and no-live-authority claims.

The manual tester-session procedure is guarded by
`pnpm check:beta-session-runsheet`. That check pins the canonical
`docs/ops/BETA_SESSION_RUNSHEET.md` contract for daily feed/source review,
account sign-in/provider readiness, 3-browser persistence, cross-client
convergence, privacy-leak inspection, account-to-LUMA binding, flip-switch
criteria, monitoring thresholds, rollback, and session evidence capture. It
does not execute the manual rehearsal; it prevents the release closeout from
forgetting which manual evidence has to be collected before distribution.

The next-phase execution checklist is recorded in
`docs/plans/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md` and guarded
by `pnpm check:public-beta-next-phase-sprint`. It turns the launch-control
decisions into ordered slices for Cloudflare/auth, Apple/Google provider
registration, A6 release update, accepted-synthesis canary, release evidence,
manual rehearsal, first public-beta tranche, and post-launch monitoring/ramp.

2026-07-10 failure-mailbox monitor update: the Codex App mailbox monitor writes
moving secret-safe state at `.tmp/vhc-failure-mailbox-monitor/latest.json`; a
monitor `status: pass` means execution health, not release clearance. The first
run's `newCriticalCount: 85` is a dated historical snapshot, not the current
count. Subsequent artifacts remain incident-blocking, and S1A read-only
evidence classified
`relay_rest_story_timeout_total_0_of_3_exit_78`. S1B repo remediation does not
prove deployment or recovery. Preserve the email/readback evidence and do not
start StoryCluster repair, auth deployment, provider registration, origin
redeploy, A6 update, accepted-synthesis canary, release-evidence regeneration,
manual rehearsal, distribution, or tranche expansion until the reviewed S1B
recovery packet is merged, Lou authorizes its live boundary, and S1A/S1B exit
green.

The full-product five-user engagement lane supplements the deterministic report packet with a production-shaped local-stack run: five beta-local users open singleton and bundled stories, read accepted synthesis/frame tables, register point-level stances, confirm mesh aggregate readback, and hold threaded story discussions across reloads. This lane is release-like manual QA; it does not replace the named deterministic command/report gates below.

Superseding public app/feed recovery update, 2026-05-31: PR #631 head
`ab570f70b517ec4e3979354fe861bb170bc77d8e` is deployed on the public relay
image `vhc-public-beta-relay:20260531-pr631-feed-mvp-vab570f70-aggregate-self-fanin-amd64`;
the public origin continues serving the current Web PWA bundle from
`vhc-public-beta-origin:20260531-pr631-feed-mvp-v56913189-public-aggregate-wss-readclient-peerconfig-amd64`.
The strict deployed browser gate
`pnpm check:public-feed:stance-aggregate-decay` passed against
`https://venn.carboncaste.io` with artifact
`packages/e2e/packages/e2e/.tmp/release-evidence/public-feed-browser-smoke/1780272232-ab570f70-aggregate-self-fanin-rerun/public-feed-browser-smoke-summary.json`.
Observed live relay composition was 80 visible stories: 59 singleton, 21
multi-source/corroborated, 77 synthesis-pending, 3 accepted-synthesis
available, 3 frame-table-ready, average source count 1.413, max source count 6,
and 9/9 frame/reframe point ids present. The Web PWA opened to 15 current cards
without manual refresh, refresh preserved 15, load-more/cursor pagination grew
the visible set to 30 cards from mesh/relay data, an accepted story opened with
frame/reframe content, a `+` stance write read back as aggregate count 1, reload
preserved the detail state, and a second browser observed the public aggregate
count from the DOM. This supersedes earlier same-day entries that reported
accepted synthesis, identity creation, or second-browser stance convergence as
unproven. It remains a focused public-feed/stance gate pass, not a blanket MVP
release-ready claim: fresh RSS ingest-to-feed propagation, all configured public
WSS peer convergence, the full umbrella `pnpm check:mvp-release-gates` packet,
and release-owner signoff still require separate current evidence.

Operational recovery note, 2026-05-31: PR #631 restored the deployed public REST feed path from StoryCluster-derived product rows, deployed bounded relay repair/fanout, and fixed the Web PWA underfilled first-page refresh path for `venn.carboncaste.io`. Current recovery evidence from `.tmp/release-evidence/public-feed-composition-freshness/1780228000865/public-feed-composition-freshness-summary.json` shows the public latest-index returns 80 product-visible stories with live story-body readback for every sampled row: 59 singleton and 21 multi-source/corroborated rows, with `acceptedSynthesisStoryCount: 0`. Lifecycle accountability now passes in `.tmp/release-evidence/public-feed-lifecycle-accountability/1780229577328/public-feed-lifecycle-accountability-summary.json`: 80/80 sampled raw stories are product-visible, 59 singleton and 21 multi-source rows are visible, hot-index product metadata is complete for 80/80 rows, and no eligible multi-source story is hidden because synthesis is pending. Browser-level recovery evidence includes `.tmp/release-evidence/public-feed-browser-smoke/1780226628317/public-feed-browser-smoke-summary.json`, which proved app open populated 15 current stories without a manual refresh, refresh preserved the mixed feed, and scroll/load-more issued `refreshLatest({ limit: 15, before: 1780190425000 })`, grew the store from 15 to 30 stories, and rendered non-overlapping older relay-cursor rows. A post-fix browser-only check on 2026-05-31 again observed 15 visible stories on app open and 30 after mobile scroll. This recovery packet is still not release-ready evidence. The latest strict browser smoke fails at `.tmp/release-evidence/public-feed-browser-smoke/1780230262620/public-feed-browser-smoke-summary.json` with `gun-latest-index-readback-timeout` after direct Gun latest-index and story-body rows fail public system-writer validation (`signature-invalid`, `unknown-signer-id`, and legacy missing signature fields). Current live public feed synthesis remains pending-only (`accepted_available: 0`, `frame_table_ready: 0`), so accepted synthesis/frame-table visibility and stance/aggregate/decay public-mesh convergence are unproven. Fresh RSS ingest-to-feed propagation, synthesis worker catch-up/current accepted synthesis, frame/reframe point-id readiness, stance/aggregate/decay public-mesh convergence, and direct Gun signature cleanup remain blocking or unproven. Relay-backed recovery is allowed only as explicit operational repair evidence and must not be described as release readiness unless all configured public peers, fresh ingest, synthesis, browser, lifecycle, direct Gun/WSS, and stance/aggregate gates pass.

Operational recovery update, 2026-05-31: PR #631 follow-up rotated the public news system-writer pin to retired `vh-public-beta-news-system-writer-v1` plus active `vh-public-beta-news-system-writer-v2`, deployed `vhc-public-beta-origin:20260531-pr631-feed-mvp-v40-writer-v2-amd64`, and repaired the top public latest/story/lifecycle window on `gun-a` and `gun-b` with v2-signed records. To keep the public app stable after the v2 repair writes, relay A/B were recreated with `VH_RELAY_PEERS=[]`, per-request snapshot story-body/state refresh disabled, and the origin REST news fanout constrained to the repaired A/B relays; `gun-c` remains in the signed peer config but is no longer treated as a passing origin REST source because its latest-index rows are stale v1. The user-facing deployed app check in `.tmp/release-evidence/public-feed-browser-lite/1780234500/app-open-scroll.png` observed 15 stories on initial app open and 30 after scroll/load-more, with visible singleton and multi-source badges. Limited live composition evidence passed at `.tmp/release-evidence/public-feed-composition-freshness/1780234609210/public-feed-composition-freshness-summary.json` for the top 5 rows: 3 singleton, 2 multi-source, 5/5 story readback, all pending synthesis. This is recovery evidence only. The full release gates remain blocked: broad 80-row composition/lifecycle reads still overload the public relay process when live Gun readback is enabled, `gun-c` rejects the v2 repair token and still serves v1 latest-index rows (`.tmp/release-evidence/public-news-system-writer-repair/1780233900-gun-c-offset-0/public-news-system-writer-repair-summary.json`), direct hot-index validation is stale/mixed for visible stories, and the limited lifecycle gate fails at `.tmp/release-evidence/public-feed-lifecycle-accountability/latest/public-feed-lifecycle-accountability-summary.json` with `product_feed_hot_index_missing_for_visible_story`. No release note may claim public-feed release readiness from the v40 recovery packet.

Relay snapshot durability update, 2026-05-31: PR #631 now includes relay-side latest-index snapshot write-through after readback-confirmed `/vh/news/story`, `/vh/news/latest-index`, and `/vh/news/synthesis-lifecycle` writes. This closes the code path that allowed a graph repair/write to update Gun while leaving the persisted REST snapshot stale until a later latest-index read. The behavior is covered by `pnpm --filter @vh/e2e exec vitest run src/live/relay-server.vitest.mjs --config ./vitest.config.ts`, including a regression that starts a second relay from the snapshot file before any latest-index read. This is implementation and local relay evidence only until the image is deployed on all public relays and live peer gates pass.

Limited gate rerun, 2026-05-31: PR #631 now also hard-exits the public feed composition/freshness and lifecycle accountability CLI gates after artifacts are written, matching the browser smoke runner and preventing lingering Gun/browser helper sockets from turning a completed evidence run into a hung command. The composition gate still has limited recovery evidence at `.tmp/release-evidence/public-feed-composition-freshness/1780237217539/public-feed-composition-freshness-summary.json`: 10 readable latest rows, 7 singleton, 3 multi-source, 10 pending synthesis, and all configured public relay origins passed the one-story readback sample. The lifecycle accountability gate has since been tightened to require a direct synthesis lifecycle ledger row for every product-visible story/source-set revision. Under that stricter gate, live public evidence fails at `.tmp/release-evidence/public-feed-lifecycle-accountability/1780237820651/public-feed-lifecycle-accountability-summary.json`: 10/10 sampled rows remain product-visible, but only 1/10 has a complete direct lifecycle ledger row, 8 are missing lifecycle rows, 1 is missing the source-set revision, and 7 visible rows are absent from the direct hot index despite relay fallback rows. An attempted direct Gun v2 repair wrote 9/10 sampled stories but did not converge the direct ledger; artifact `.tmp/release-evidence/public-news-system-writer-repair/1780237598652-top10-inline-gun/public-news-system-writer-inline-repair-summary.json` records 9 repaired and 1 `JSON error!`. This is not release-ready evidence.

Public feed cold-start/durability follow-up, 2026-05-31: PR #631 now also hardens the Web PWA public news cold-start path and the production public-news writer durability contract. The Web PWA can read the same-origin public relay latest/story routes with the bundled system-writer pin before the full Gun mesh client finishes session hydration, and `FeedShell` triggers that relay bootstrap only for true cold starts with no public news rows loaded. Local coverage: `pnpm --filter @vh/web-pwa exec vitest run src/store/news/index.test.ts src/components/feed/FeedShell.lazyLoading.test.tsx`, `pnpm --filter @vh/web-pwa typecheck`, and `pnpm --filter @vh/web-pwa build`; the production build passed with existing non-blocking chunk/browser-data warnings. The Gun client now requires readback after acknowledged production news writes by default for story bodies, latest/hot product indexes, and synthesis lifecycle rows; tests can opt out with `requireNewsWriteReadback: false`. Local coverage: `pnpm --filter @vh/gun-client exec vitest run src/durableWrite.test.ts src/newsAdapters.test.ts --config ./vitest.config.ts`. The repair script now resolves workspace ESM packages and writes phase-specific repair failures. Readback-required live direct-Gun repair still fails, not passes: `.tmp/release-evidence/public-news-system-writer-repair/1780238974-require-readback-top10/public-news-system-writer-repair-summary.json` repaired 0/10, and `.tmp/release-evidence/public-news-system-writer-repair/1780239022-require-readback-top1-step/public-news-system-writer-repair-summary.json` classifies the first failure at `gun_story_body` with `JSON error!`. A clean deployed-browser spot check observed 15 public stories on open, including 3 multi-source rows, and 30 after scroll/load-more, but this is diagnostic evidence only; it does not clear direct Gun/WSS lifecycle, accepted synthesis, frame-table, stance, aggregate, or release gates.

Direct Gun readback follow-up, 2026-05-31: PR #631 now treats Gun ack errors as recoverable only when the caller explicitly requires readback and the configured readback predicate confirms persistence; ordinary ack errors still reject. The readback attempt count is configurable with `VH_GUN_DURABLE_WRITE_READBACK_ATTEMPTS` / `VITE_VH_GUN_DURABLE_WRITE_READBACK_ATTEMPTS`, and the direct repair utility can require per-peer WSS repair/readback with `VH_PUBLIC_NEWS_REPAIR_REQUIRE_EACH_GUN_PEER=true`. Local coverage: `pnpm --filter @vh/gun-client exec vitest run src/chain.test.ts src/durableWrite.test.ts src/newsAdapters.test.ts --config ./vitest.config.ts`, `pnpm --filter @vh/gun-client typecheck`, `pnpm --filter @vh/gun-client build`, `node --check tools/scripts/repair-public-news-system-writer.mjs`, and `git diff --check`. Live evidence improved but remains blocking: `.tmp/release-evidence/public-news-system-writer-repair/1780240356-top1-ack-error-readback-default-retry/public-news-system-writer-repair-summary.json` repaired the top story through direct Gun with all three peers configured after story/latest/lifecycle ack errors were confirmed by readback; per-peer single-story reruns passed individually for `gun-a`, `gun-b`, and `gun-c` at `.tmp/release-evidence/public-news-system-writer-repair/1780240449-gun-a-single-peer-after-ack-fix/`, `.tmp/release-evidence/public-news-system-writer-repair/1780240451-gun-b-single-peer-after-ack-fix/`, and `.tmp/release-evidence/public-news-system-writer-repair/1780240454-gun-c-single-peer-after-ack-fix/`. Wider evidence is still not release-ready: `.tmp/release-evidence/public-news-system-writer-repair/1780240368-top10-ack-error-readback/public-news-system-writer-repair-summary.json` repaired 5/10 with the multi-peer client, and strict per-peer repair with an extended readback window failed at `.tmp/release-evidence/public-news-system-writer-repair/1780240750-top3-per-peer-extended-readback/public-news-system-writer-repair-summary.json` with 1/3 repaired and explicit hot-index/lifecycle readback failures on named peers. This proves the direct WSS path is partially recoverable and now auditable per peer, but public peer convergence is still a blocker.

Public feed mixed-feed recovery update, 2026-05-31: PR #631 now isolates local Gun files for repair/gate clients, retries repair phases with explicit attempt metadata, and makes strict per-peer repair count only after a fresh reader validates story body, latest index, hot index metadata, and synthesis lifecycle on that peer. Live repair artifacts show the current window required this stronger check: `.tmp/release-evidence/public-news-system-writer-repair/1780242236-top10-per-peer-independent-readback/public-news-system-writer-repair-summary.json` repaired 9/10 and exposed one remaining `gun-b` hot-index miss, then `.tmp/release-evidence/public-news-system-writer-repair/1780242472-offset5-top1-per-peer-independent-readback-retry5/public-news-system-writer-repair-summary.json` repaired that row, and `.tmp/release-evidence/public-news-system-writer-repair/1780242617-offset5-top1-per-peer-independent-readback-settle10s/public-news-system-writer-repair-summary.json` reran it with a 10-second remote-settle window. The lifecycle gate now configures all `VH_PUBLIC_FEED_PUBLIC_RELAY_ORIGINS` as signed Gun/REST read paths rather than treating a single peer as the full public mesh; `.tmp/release-evidence/public-feed-lifecycle-accountability/1780242922382/public-feed-lifecycle-accountability-summary.json` passes for the deployed public sample with 10/10 product-visible stories, 7 singleton, 3 multi-source/corroborated, 10 pending lifecycle rows, and 10/10 complete hot-index product metadata. Composition/freshness passes at `.tmp/release-evidence/public-feed-composition-freshness/1780243026644/public-feed-composition-freshness-summary.json` with 102 visible stories, 75 singleton, 27 multi-source/corroborated, average source count 1.441, max source count 6, and freshness age 48,006,438 ms. This is stronger live public feed recovery evidence, but not a release-ready claim: accepted synthesis remains 0, frame-table readiness remains 0, the latest strict browser smoke has not been rerun to pass, and stance/aggregate/decay public-mesh convergence remains unproven.

Synthesis catch-up implementation update, 2026-05-31: PR #631 now also has a daemon catch-up path for product-visible stories whose current source-set lifecycle is `pending`, `retryable_failure`, or stale `in_progress`. After acquiring leadership, the daemon scans the product latest window, verifies the story body and current lifecycle row, and re-enqueues only current story/source-set revisions into the real bundle synthesis worker; stale `in_progress` recovery is age-gated by `VH_BUNDLE_SYNTHESIS_IN_PROGRESS_STALE_MS` with a 10-minute default and does not downgrade the public lifecycle row to `pending`. This does not create heuristic accepted synthesis and does not make product feed visibility depend on accepted synthesis; it closes the gap where repaired, reconciled, or interrupted feed rows could remain permanently pending/in-progress because they were not part of the original runtime publication tick or a worker died mid-flight. Local coverage: `pnpm --filter @vh/news-aggregator exec vitest run src/pendingSynthesisCatchup.test.ts src/daemon.test.ts --config ./vitest.config.ts`, `pnpm --filter @vh/news-aggregator typecheck`, and the full `pnpm --filter @vh/news-aggregator test` package run. Live release evidence is still required after deployment with bundle synthesis enabled and valid model credentials; the current deployed public artifacts still show `accepted_available: 0` and `frame_table_ready: 0`.

Synthesis configuration hardening update, 2026-05-31: PR #631 now auto-enables the bundle-synthesis enrichment worker when `VH_BUNDLE_SYNTHESIS_API_KEY`, `ANALYSIS_RELAY_API_KEY`, or `OPENAI_API_KEY` is configured, while preserving `VH_BUNDLE_SYNTHESIS_ENABLED=false` as an explicit kill switch. This removes the production footgun where an otherwise configured public daemon could publish and repair product-visible pending lifecycle rows without ever creating the synthesis worker. Release evidence still must show accepted-current synthesis and frame-table readiness on the deployed public feed; credential-based auto-enable is implementation hardening, not proof that the live worker completed.

Scope B master-gate update, 2026-06-28: after the raw Scope A launch, production daemon startup now also requires the explicit master gate `VH_NEWS_SCOPE_B_ENRICHMENT_ENABLED=1` before accepted/topic synthesis enrichment, synthesis catch-up, accepted replay, or storyline overlay adapters are wired. The lower-level bundle-synthesis worker config still recognizes credentials for replay/catch-up tooling once Scope B is intentionally opened, but credentials alone no longer activate enrichment in the live publisher. This is default-off wiring control, not Scope B readiness: accepted synthesis and accepted replay still share the fatal `news_synthesis_lifecycle` write class until the lifecycle lane split lands, and accepted publication also writes product-visible latest/hot indexes that need explicit safety tests before production enablement.

Relay-backed synthesis write hardening update, 2026-05-31: PR #631 now includes an explicit relay-REST bundle synthesis writer mode for public daemon deployments that have relay daemon tokens but no local news system-writer private key. When `VH_BUNDLE_SYNTHESIS_WRITE_RELAY_REST=true` or `VH_BUNDLE_SYNTHESIS_RELAY_WRITE_ORIGINS` is configured, the bundle worker fails closed without `VH_RELAY_DAEMON_TOKEN`, preserves latest-synthesis ownership guards before writing, and posts accepted `TopicSynthesisV2` plus synthesis lifecycle rows through authenticated public relay write routes with readback-validated relay responses. The public origin now also proxies `GET /vh/news/synthesis-lifecycle` to relay JSON instead of falling through to the SPA document, so browser/detail lifecycle reads can observe pending, accepted, terminal, and frame-table states from the same-origin public route. `pnpm catchup:public-synthesis` runs the same production bundle synthesis worker once against pending public latest rows and writes `.tmp/release-evidence/public-synthesis-catchup/.../public-synthesis-catchup-summary.json`; it is an operations catch-up path, not a fixture or heuristic synthesis path. The runner now fails loudly unless a public system-writer pin is configured through `VH_SYSTEM_WRITER_PIN_JSON`, `VH_NEWS_SYSTEM_WRITER_PIN_JSON`, `VH_SYSTEM_WRITER_PUBLIC_KEY_SPKI_BASE64URL`, or `VH_NEWS_SYSTEM_WRITER_PUBLIC_KEY_SPKI_BASE64URL`, because unsigned lifecycle readback cannot safely classify public pending rows. Local coverage: `pnpm --filter @vh/news-aggregator exec vitest run src/relayRestSynthesisWriters.test.ts src/bundleSynthesisDaemonConfig.test.ts src/publicSynthesisCatchup.test.ts --config ./vitest.config.ts`, `pnpm --filter @vh/news-aggregator typecheck`, `pnpm --filter @vh/news-aggregator test`, `pnpm --filter @vh/e2e exec vitest run src/live/public-beta-origin-server.vitest.mjs --config ./vitest.config.ts`, `node --check tools/scripts/public-beta-origin-server.mjs`, and `git diff --check`. This is deployment-path hardening only until a live daemon/catch-up run produces accepted synthesis/frame rows and public peer convergence evidence.

Public origin redeploy update, 2026-05-31: A6 first served PR #631 origin image `vhc-public-beta-origin:20260531-pr631-feed-mvp-v49d662c0-origin-peerconfig-v2-amd64` at `https://venn.carboncaste.io`, replacing the older `vhc-public-beta-origin:20260531-pr631-feed-mvp-v40-writer-v2-amd64` app asset that lacked the branch's public-relay cold-start path. A later origin redeploy now serves `vhc-public-beta-origin:20260531-pr631-feed-mvp-v76adf8ce-origin-lifecycle-amd64`, still with the PR #631 Web PWA asset `/assets/index-xWZ9OOwO.js`, and adds same-origin JSON lifecycle proxy behavior: `GET https://venn.carboncaste.io/vh/news/synthesis-lifecycle?story_id=story-b6355234a9f6` returns a JSON `news-synthesis-lifecycle-not-found` response when no row exists instead of falling through to the SPA HTML document. Public `/healthz` reports the origin healthy with `peer_config_present: true` and `relay_proxy_target_count: 2`. Diagnostic deployed-browser evidence passed against the peer-config image at `.tmp/release-evidence/public-feed-browser-smoke/1780247585511/public-feed-browser-smoke-summary.json` with accepted-synthesis requirements explicitly disabled for recovery verification: public relay readback saw 80 latest rows, 59 singleton rows, 21 multi-source/corroborated rows, 80 pending synthesis rows, 0 accepted synthesis rows, and 0 frame-table-ready rows; browser app open rendered 15 current cards without manual refresh, refresh preserved 15 cards, and scroll/load-more grew to 30 stories through a real relay cursor request `{ limit: 15, before: 1780190425000 }`. This closes the deployed blank/refresh/lazy-loading symptom for the origin asset and fixes the expired peer-config artifact, but it is not release-ready evidence because live accepted synthesis, frame/reframe point IDs, stance persistence, aggregate convergence, and full public peer convergence remain unproven or blocked.

Public synthesis catch-up live attempt, 2026-05-31: commit `2b71fa56` was exercised on A6 with `pnpm catchup:public-synthesis` against `wss://gun-a.carboncaste.io/gun` and `wss://gun-c.carboncaste.io/gun`, relay REST write origins `https://gun-a.carboncaste.io,https://gun-c.carboncaste.io`, same-origin model relay `https://venn.carboncaste.io/api/analyze`, and relay-all write convergence required. The first artifact, `.tmp/release-evidence/public-synthesis-catchup/1780248791540/public-synthesis-catchup-summary.json`, reported `no_candidates` after scanning 3 rows because the public system-writer pin was not loaded in the catch-up process; this is now converted into a hard configuration error by the runner. The pin-corrected run wrote `.tmp/release-evidence/public-synthesis-catchup/1780248859233/public-synthesis-catchup-summary.json` with status `fail`, `scanned: 3`, `enqueued: 3`, and three `latest_write_failed` worker rejections: two singleton stories and one multi-source story (`story-d4197fa60cbf`, `source_count: 4`, `canonical_source_count: 3`). The worker failed closed before producing accepted synthesis because `gun-a` accepted the lifecycle REST write but `gun-c` returned HTTP 401 for `/vh/news/synthesis-lifecycle`; a separate health probe also observed `gun-b` returning Cloudflare 502. This is useful blocker evidence, not release evidence: live accepted synthesis remains 0, frame-table readiness remains 0, stance/aggregate/decay cannot be proven, and configured public-peer convergence must be repaired before the public MVP feed can be called release-ready.

Public feed lifecycle/readiness recovery update, 2026-05-31: PR #631 head `e751f67e0c0368d1a3bfbc9d8d01062f2f28064c` deployed relay A/B image `vhc-public-beta-relay:20260531-pr631-feed-mvp-v013645bc-lifecycle-fields-amd64` and enabled snapshot story-state refresh on the public A/B relays. The relay latest-index now exposes lifecycle source-set revision and updated-at fields from durable lifecycle rows while keeping product visibility independent from accepted synthesis. A one-time A/B lifecycle backfill wrote honest `pending` lifecycle rows for 22 older product-visible stories; no accepted synthesis was fabricated. Live lifecycle accountability now passes at `.tmp/release-evidence/public-feed-lifecycle-accountability/1780259355639/public-feed-lifecycle-accountability-summary.json`: 120 sampled ids, 102 readable/product-visible stories, 75 singleton visible, 27 multi-source/corroborated visible, 99 pending synthesis, 3 accepted/frame-ready, 102/102 lifecycle ledgers complete, 24 sampled hot-index rows with complete product metadata, and 18 blocked raw ids due signed-writer validation/readability rather than silent product hiding. A direct 120-row latest-index probe after deployment observed 102 story states and 102 lifecycle field sets. This is live recovery evidence for the user-visible blank/singleton-only/stale-lifecycle failure, not full release readiness: `gun-c` still rejects the A/B daemon token for lifecycle repair writes, strict browser and stance/aggregate/decay public-mesh gates still need passing reruns after the accepted-synthesis detail flake, and `pnpm check:mvp-release-gates` has not passed end to end on the final commit.

Public app-open/load-more recovery update, 2026-05-31: PR #631 head `55223b3f61ebf86b81ab29bb2dfd14931d4baf03` deployed origin image `vhc-public-beta-origin:20260531-pr631-feed-mvp-v33359f98-same-origin-news-amd64` and relay A/B image `vhc-public-beta-relay:20260531-pr631-feed-mvp-v55223b3f-state-refresh-cache-amd64`. The Web PWA now keeps public news reads on the same-origin relay route after mesh hydration, and the relay no longer repeatedly refreshes already-current snapshot story states. Recovery browser evidence at `packages/e2e/.tmp/release-evidence/public-feed-browser-smoke/1780260800-final-recovery-pass/public-feed-browser-smoke-summary.json` records relay readback for 80 latest rows with 59 singleton, 21 multi-source/corroborated, 77 pending synthesis, 3 accepted synthesis, 3 frame-table-ready, 80/80 story-body readback, and 9/9 frame/reframe point ids present. Browser logs in the same artifact show initial app open rendered 15 current cards without manual refresh, refresh preserved 15 cards, and scroll/load-more grew the store and DOM to 30 cards via a real relay cursor call `refreshLatest({ limit: 15, before: 1780190425000 })`. The command status is still `fail` because the later identity/vote setup timed out with `identity-create-ready-timeout`; therefore this is feed population, refresh, and pagination recovery evidence only, not a passing browser smoke or MVP release packet. Public peer convergence also remains blocked by `gun-c` rejecting the A/B daemon token for repair writes.

Public peer-config bootstrap and accepted-detail smoke update, 2026-05-31: PR #631 head `d390884a60531fce8fdbe34a77077409cb1fcd49` deploys origin image `vhc-public-beta-origin:20260531-pr631-feed-mvp-vd390884a-peer-config-default-amd64`, serving Web PWA asset `/assets/index-BEOI045y.js`. The production app now defaults strict peer resolution to the signed same-origin `/mesh-peer-config.json` when no compile-time peer-config URL is embedded, so `venn.carboncaste.io/dashboard` resolves the three public peers and enables identity creation instead of staying at `Peers: 0` / `Connecting`. Local coverage passed: `pnpm exec vitest run apps/web-pwa/src/store/peerConfig.test.ts apps/web-pwa/src/store/store.test.ts`, `pnpm --filter @vh/web-pwa typecheck`, `pnpm --filter @vh/web-pwa build`, `git diff --check`, and a local production-browser probe showing `Peers: 3` and `Join` enabled. Live recovery evidence at `packages/e2e/.tmp/release-evidence/public-feed-browser-smoke/1780262800-d390884a-peerconfig-live/public-feed-browser-smoke-summary.json` is the first post-deploy browser smoke in this sequence with accepted synthesis required and status `pass`: relay readback saw 80 latest rows, 59 singleton, 21 multi-source/corroborated, 77 pending synthesis, 3 accepted synthesis, 3 frame-table-ready, 80/80 story-body readback, and 9/9 frame/reframe point ids; app open rendered 15 cards without manual refresh; scroll/load-more grew 15 to 30 through `refreshLatest({ limit: 15, before: 1780190425000 })`; identity creation succeeded; story `story-b6355234a9f6` opened with accepted synthesis; and a frame point `+` stance write read back with `afterAgree: 1`. A stricter rerun with `VH_PUBLIC_FEED_SMOKE_REQUIRE_SECOND_BROWSER_VOTE=true` is still failing at `packages/e2e/.tmp/release-evidence/public-feed-browser-smoke/1780263050-d390884a-second-browser-vote/public-feed-browser-smoke-summary.json`: it reproduces feed, identity, accepted detail, and first-browser vote readback, then times out on post-vote accepted-synthesis re-detection for `story-6a8e161f6012` before reaching second-browser convergence. Therefore app population, mixed feed, accepted-detail display, and first-browser stance persistence are live recovery evidence; full stance/aggregate/decay public-mesh convergence and MVP release readiness remain unclaimed.

Public feed/stance relay recovery update, 2026-06-01: PR #631 follow-up replaced the blocked `nypost-politics` starter feed with `washingtonexaminer-politics`, then pruned `channelnewsasia-latest` after live source-health sampled an RSS item returning HTTP 404. A candidate scout rerun found no promotable replacement (`cnn-politics` was singleton-only, and the other candidates were rejected or inconclusive), so the active source surface now keeps only the 27 verified readable sources. Source-health artifact `services/news-aggregator/.tmp/news-source-admission/1780289875717/source-health-report.json` reports `ready` with 27/27 sources kept, 27 contributing sources, 26 corroborating sources, no watch/remove sources, and `releaseEvidence.status: pass`. The deployed relays were operationally repaired by moving aside corrupted legacy RADISK field files while preserving `news-latest-index-snapshot.json`, `news-synthesis-lifecycle-snapshot.json`, and `topic-synthesis-latest-snapshot.json`; relay A/B/C were then recreated with aggregate self-peer readback disabled and the origin was recreated with three relay fanout targets (`gun-a`, `gun-b`, `gun-c`). This avoided the prior aggregate REST hang/OOM loop and restored bounded public aggregate reads. Current code hardens the relay so optional aggregate self-peer readback is bounded even if re-enabled; local coverage is `pnpm --filter @vh/e2e exec vitest run src/live/relay-server.vitest.mjs --config ./vitest.config.ts` (`31 passed`) plus `node --check infra/relay/server.js`. A later lifecycle gate rerun exposed 77 stale pending rows, so the public repair utility was hardened to derive the lifecycle row from public state before signing: current accepted syntheses with complete frame/reframe point IDs are preserved as `accepted_available` and `frame_table_ready`, while incomplete rows receive a fresh pending/retryable heartbeat instead of being hidden or downgraded. The lifecycle-preserving signed repair passed for 80/80 rows on `gun-a`/`gun-c` at `.tmp/release-evidence/public-news-system-writer-repair/20260601T051408Z-lifecycle-preserve-top80-gun-a-c/public-news-system-writer-repair-summary.json` and for 80/80 rows on `gun-b` at `.tmp/release-evidence/public-news-system-writer-repair/20260601T052025Z-lifecycle-preserve-top80-gun-b/public-news-system-writer-repair-summary.json`. Current live public artifacts are: composition/freshness at `.tmp/release-evidence/public-feed-composition-freshness/1780290109877/public-feed-composition-freshness-summary.json`, which observed 80 latest rows, 59 singleton, 21 multi-source/corroborated, 3 accepted synthesis stories, and 80/80 story-body readback; lifecycle accountability at `.tmp/release-evidence/public-feed-lifecycle-accountability/1780291589018/public-feed-lifecycle-accountability-summary.json`, which observed 80/80 product-visible stories, 77 fresh pending lifecycle rows, 3 accepted/frame-ready rows, and no stale pending rows; and strict stance/aggregate/decay at `.tmp/release-evidence/public-feed-browser-smoke/1780290283606/public-feed-browser-smoke-summary.json`, which passed with app-open 15 cards, load-more 30 cards through a real `before` cursor, accepted detail for `story-b6355234a9f6`, public aggregate readback via same-origin relay fanout (`agree: 12`, `participants: 12`), and second-browser vote visibility. This remains public feed and relay-fanout recovery evidence, not a blanket distributed mesh release claim: server-to-server relay peering is still disabled (`relay_peer_count: 0`) because the current public Gun peer hydration path OOMs under the recovered data load, direct Gun latest-index reads are not the authoritative accepted-synthesis path after the snapshot-preserving RADISK cleanup, and mesh production readiness remains `review_required` until the separate public WSS deployment proof blocker is cleared.

This closeout does not claim legal approval, 48-hour Scope A stability, production-grade live headline freshness, production-attestation/Silver, verified-human identity, one-human-one-vote, Sybil resistance, full LUMA `§21.4` recorded product replay, `<TrustClaim>` readiness, public WSS mesh `release_ready`, full production app readiness, full RBAC/admin membership management, a private support desk, native App Store/TestFlight readiness, automated escalation/SLA handling, or a complete trust-and-safety operations console.

## 2. Required Release Evidence Packet

Run these commands on the final public-beta release commit and preserve their output paths in the release note:

| Evidence | Command | Deterministic report or artifact | Required result |
| --- | --- | --- | --- |
| S1 recovery control plane | `pnpm check:public-beta-s1-recovery-control-plane` | Exact serialized publisher authority/control, liveness, relay-liveness, alert, watch-closure, and A/B/C packet suites plus `docs/ops/a6-s1b-relay-timeout-recovery-packet-2026-07-10.md` | `pass`; `FINAL_MAIN_REVISION_BINDS_RELAY_IMAGE_AND_PUBLISHER_CHECKOUT`, `IMMEDIATE_RECOVERY_IS_NOT_S1_GREEN`, `T0_PLUS_24H_IS_INTERMEDIATE_ONLY`, and `T0_PLUS_48H_REQUIRED_TO_UNBLOCK_S2` remain fail-closed |
| Release-owner launch control | `pnpm check:public-beta-launch-control` | `docs/ops/public-beta-launch-control-2026-07-09.md` plus `tools/scripts/check-public-beta-launch-control.mjs` | Current no-go packet must retain explicit unresolved evidence blanks and live-evidence blockers; a future `go_for_public_beta_ramp` packet must have authority/contact fields and evidence rows filled and must not retain stale no-go/blocker language |
| First-wave distribution packet | `pnpm check:public-beta-distribution-packet` | `docs/ops/public-beta-distribution-packet-2026-07-09.md` plus `tools/scripts/public-beta-distribution-packet.test.mjs` | Current packet must remain blocked until every release evidence, A6/origin readback, provider rehearsal, manual rehearsal, owner, alert, support, rollback, and external-approval field is filled; tester copy remains claim-safe and rollback remains claim-first |
| Operator packet boundary guard | `pnpm check:release-readiness-operator-packets` | `docs/ops/storycluster-headline-soak-credential-repair-2026-07-09.md`, `docs/ops/a6-accepted-synthesis-canary-packet-2026-07-09.md`, `docs/ops/auth-callback-provider-deployment-packet-2026-07-09.md`, plus `tools/scripts/release-readiness-operator-packets.test.mjs` | Pending/draft operator packets retain secret-safe handling, exact live authority boundaries, non-goals, stop rules, and rollback constraints before any live execution |
| Beta session runsheet guard | `pnpm check:beta-session-runsheet` | `docs/ops/BETA_SESSION_RUNSHEET.md` plus `tools/scripts/beta-session-runsheet.test.mjs` | `pass`; daily gate, provider readiness, 3-browser convergence, privacy, account-to-LUMA binding, flip-switch, monitoring, rollback, and evidence-capture requirements remain pinned before manual rehearsal |
| Next-phase sprint checklist guard | `pnpm check:public-beta-next-phase-sprint` | `docs/plans/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md` plus `tools/scripts/public-beta-next-phase-sprint.test.mjs` | `pass`; ordered slices, Lou/Codex authority model, Apple/Google first provider set, `auth.venn.carboncaste.io`, A6/update/canary permissions, secret boundaries, first-tranche cap, and post-launch ramp rules remain pinned |
| Launch closeout audit | `pnpm check:public-beta-launch-closeout` | This document plus the static checker in `tools/scripts/check-public-beta-launch-closeout.mjs` | `pass`; includes the launch-control, distribution-packet, operator-packet, and beta-session runsheet checks above |
| MVP release gates | `pnpm check:mvp-release-gates` | `.tmp/mvp-release-gates/latest/mvp-release-gates-report.json` | `overallStatus: pass` |
| Public feed analysis/frame reliability | `VH_PUBLIC_FEED_APP_URL=https://venn.carboncaste.io VH_PUBLIC_FEED_GUN_PEER_URL=wss://gun-a.carboncaste.io/gun VH_PUBLIC_FEED_PUBLIC_RELAY_ORIGINS='["https://venn.carboncaste.io","https://gun-a.carboncaste.io","https://gun-b.carboncaste.io","https://gun-c.carboncaste.io"]' VH_PUBLIC_FEED_PUBLIC_WSS_PEERS='["wss://gun-a.carboncaste.io/gun","wss://gun-b.carboncaste.io/gun","wss://gun-c.carboncaste.io/gun"]' pnpm test:public-feed:browser-smoke` | `.tmp/release-evidence/public-feed-browser-smoke/latest/public-feed-browser-smoke-summary.json` plus `.tmp/analysis-frame-pipeline/<timestamp>/` consistency probes | `pass`; public top-N latest-index body 404 count is zero or inside an explicitly recorded repair/tombstone window; app-open feed population succeeds without a manual refresh click; at least one current accepted synthesis is visible by default with frame/reframe rows and point ids when relay lifecycle matches the current story/source-set revision; pending/terminal stories still render honest non-votable states |
| Public feed composition/freshness | `VH_PUBLIC_FEED_APP_URL=https://venn.carboncaste.io VH_PUBLIC_FEED_GUN_PEER_URL=wss://gun-a.carboncaste.io/gun VH_PUBLIC_FEED_PUBLIC_RELAY_ORIGINS='["https://venn.carboncaste.io","https://gun-a.carboncaste.io","https://gun-b.carboncaste.io","https://gun-c.carboncaste.io"]' VH_PUBLIC_FEED_PUBLIC_WSS_PEERS='["wss://gun-a.carboncaste.io/gun","wss://gun-b.carboncaste.io/gun","wss://gun-c.carboncaste.io/gun"]' pnpm check:public-feed:composition-freshness` | `.tmp/release-evidence/public-feed-composition-freshness/latest/public-feed-composition-freshness-summary.json` | `pass`; public latest feed includes both singleton and multi-source/corroborated stories, reports composition/per-story public-state counts, verifies latest-index product metadata, verifies relay cursor pagination for older latest-index rows, independently verifies latest-index and sampled story-body readback on every configured public relay peer, and fails instead of `setup_scarcity` when source-health evidence proves corroborated supply exists but the deployed feed remains singleton-only |
| Fresh RSS propagation | `VH_PUBLIC_FEED_APP_URL=https://venn.carboncaste.io VH_PUBLIC_FEED_GUN_PEER_URL=wss://gun-a.carboncaste.io/gun VH_PUBLIC_FEED_PUBLIC_RELAY_ORIGINS='["https://venn.carboncaste.io","https://gun-a.carboncaste.io","https://gun-b.carboncaste.io","https://gun-c.carboncaste.io"]' VH_PUBLIC_FEED_PUBLIC_WSS_PEERS='["wss://gun-a.carboncaste.io/gun","wss://gun-b.carboncaste.io/gun","wss://gun-c.carboncaste.io/gun"]' VH_PUBLIC_FEED_FRESH_PROPAGATION_REQUIRE_PUBLIC_BROWSER_SMOKE=true pnpm check:public-feed:fresh-propagation` | `.tmp/release-evidence/public-feed-fresh-propagation/latest/public-feed-fresh-propagation-summary.json` plus the current public browser-smoke artifact | `pass`; proves at least one current live RSS item progressed through daemon ingest, normalization, StoryCluster, raw story publication, latest/hot product indexes, public relay/browser refresh evidence, and Web PWA consumer render/open; fixture-only evidence and stale latest activity with source supply are hard failures |
| Raw/product lifecycle accountability | `VH_PUBLIC_FEED_APP_URL=https://venn.carboncaste.io VH_PUBLIC_FEED_GUN_PEER_URL=wss://gun-a.carboncaste.io/gun VH_PUBLIC_FEED_PUBLIC_RELAY_ORIGINS='["https://venn.carboncaste.io","https://gun-a.carboncaste.io","https://gun-b.carboncaste.io","https://gun-c.carboncaste.io"]' VH_PUBLIC_FEED_PUBLIC_WSS_PEERS='["wss://gun-a.carboncaste.io/gun","wss://gun-b.carboncaste.io/gun","wss://gun-c.carboncaste.io/gun"]' pnpm check:public-feed:lifecycle-accountability` | `.tmp/release-evidence/public-feed-lifecycle-accountability/latest/public-feed-lifecycle-accountability-summary.json` | `pass`; eligible raw stories are product-visible unless they have an explicit allowed reason, multi-source stories are not hidden merely because synthesis is pending, pending/in-progress/retryable synthesis lifecycle rows are not older than `VH_PUBLIC_FEED_SYNTHESIS_PENDING_STALE_MS`, and daemon repair evidence includes the bounded recurring raw-story scan window plus singleton/multi-source promotion counts |
| Point stance/aggregate/decay public mesh | `VH_PUBLIC_FEED_APP_URL=https://venn.carboncaste.io VH_PUBLIC_FEED_GUN_PEER_URL=wss://gun-a.carboncaste.io/gun VH_PUBLIC_FEED_PUBLIC_RELAY_ORIGINS='["https://venn.carboncaste.io","https://gun-a.carboncaste.io","https://gun-b.carboncaste.io","https://gun-c.carboncaste.io"]' VH_PUBLIC_FEED_PUBLIC_WSS_PEERS='["wss://gun-a.carboncaste.io/gun","wss://gun-b.carboncaste.io/gun","wss://gun-c.carboncaste.io/gun"]' pnpm check:public-feed:stance-aggregate-decay` | `.tmp/release-evidence/public-feed-browser-smoke/latest/public-feed-browser-smoke-summary.json` plus stance/aggregate unit-test stdout | `pass`; requires a current accepted synthesis with persisted point ids, writes a point stance, proves public aggregate or voter-row readback, proves second-browser vote convergence, and keeps cap/decay math at `cap=1.95`, `alpha=0.3` |
| MVP consolidated closeout | `pnpm check:mvp-closeout` | `.tmp/mvp-closeout/latest/mvp-closeout-report.json` | `status: pass`; bounded MVP claims only; Mesh/app/Silver claims remain forbidden unless separately proven |
| Curated launch-content fallback | `pnpm check:launch-content-snapshot` | `.tmp/launch-content-snapshot/latest/launch-content-snapshot-report.json` | `overallStatus: pass` |
| Public-beta compliance minimums | `pnpm check:public-beta-compliance` | `tools/scripts/check-public-beta-compliance.mjs` and `docs/ops/public-beta-compliance-minimums.md` | `pass` |
| LUMA public-beta MVP readiness | `pnpm check:luma:mvp-production-readiness` | `.tmp/luma-mvp-production-readiness/latest/luma-mvp-production-readiness-report.json` | `status: pass` |
| LUMA mesh reader-path coverage | `pnpm test:mesh:luma-gated-write-coverage -- --mode local-e2e` | `.tmp/mesh-luma-gated-write-coverage/latest/mesh-luma-gated-write-coverage-report.json` | `status: pass`, current commit, clean repo, `schema_epoch: post_luma_m0b`, `luma_profile` not `none` |
| Mesh aggregate boundary check | `VH_MESH_SOAK_DURATION_MS=1800000 VH_MESH_LUMA_GATED_WRITE_COVERAGE_REPORT=.tmp/mesh-luma-gated-write-coverage/latest/mesh-luma-gated-write-coverage-report.json pnpm check:mesh:production-readiness` | `.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json` | current commit; may remain `review_required` until public WSS/soak/app-canary gates clear |
| Documentation governance | `pnpm docs:check` | `tools/scripts/check-docs-governance.mjs` | `pass` |
| Standard repo health | `pnpm lint`, `pnpm deps:check`, touched package typechecks | CI and local command output | `pass` |

Supplemental release-like product validation:

| Evidence | Command | Artifact | Required result |
| --- | --- | --- | --- |
| Full-product five-user engagement | `pnpm live:stack:up:analysis-stub` followed by `pnpm test:live:five-user-engagement` | Playwright attachment `five-user-news-engagement-summary` plus local command output | `pass` before claiming the full multi-user feed/detail/stance/thread loop was exercised against the production-shaped local stack |
| Full-product two-user engagement smoke | `pnpm live:stack:up:analysis-stub` followed by `pnpm test:live:two-user-engagement` | Same Playwright attachment with two isolated identities, one singleton, and one bundled analysis-ready story | `pass` for fast test-group validation; does not replace the five-user release-like lane when release copy claims the broader multi-user loop |

## 3. MVP Gate Coverage

`pnpm check:mvp-release-gates` is the umbrella Web PWA MVP proof packet. It must include these gate ids in `.tmp/mvp-release-gates/latest/mvp-release-gates-report.json`:

| Gate id | Launch claim proven | Report status required |
| --- | --- | --- |
| `source_health` | Source-health artifact exists and is fresh enough for the release runner. | `pass` |
| `story_correctness` | StoryCluster correctness gate passes. | `pass` |
| `feed_render` | Fixture-backed feed renders and preferences affect ranking/filtering. | `pass` |
| `story_detail` | Headline detail opens from accepted `TopicSynthesisV2`. | `pass` |
| `public_feed_analysis_frame_reliability` | Public top-N latest-index rows have readable story bodies or explicit repair/tombstone evidence; app-open feed population triggers the public latest refresh once the mesh client is ready and succeeds without a manual refresh click, even when launch/snapshot news is already composed; at least one current accepted synthesis/frame row set with point ids is visible by default when lifecycle matches the current story/source-set revision, and pending/terminal stories render honest non-votable states; browser smoke records singleton visibility and CSP/network errors. Recovery diagnostics may opt out with `VH_PUBLIC_FEED_SMOKE_REQUIRE_ACCEPTED_SYNTHESIS=false`, but release gates may not. | `pass` |
| `public_feed_composition_freshness` | Public latest feed includes eligible singleton and multi-source/corroborated stories, exposes pending/accepted/terminal composition counts and per-story public states, verifies latest-index product metadata, verifies a relay `before` cursor returns a non-overlapping older page when older product rows are expected, independently verifies every configured public WSS peer's relay origin for latest-index surface parity and sampled story-body readback, and enforces freshness. Singleton-only or stale supply may classify as `setup_scarcity` only when source-health evidence does not show current corroborated bundle supply. | `pass` |
| `public_feed_lifecycle_accountability` | Raw `vh/news/stories`, product latest/hot indexes, relay latest-index, synthesis lifecycle, and accepted synthesis paths agree; eligible raw stories are not hidden because synthesis is pending; daemon repair scans the bounded raw-story window after leadership acquisition and on its recurring repair interval with root-map and Gun map evidence and reports singleton versus multi-source promotions; pending/retryable current source-set rows are re-enqueued into real bundle synthesis catch-up without fake accepted synthesis and must not remain stale beyond `VH_PUBLIC_FEED_SYNTHESIS_PENDING_STALE_MS`; sampled hot index rows carry stable story identities and current source-set product metadata without forking singleton versus bundle cards; stale topic latest synthesis from an older source-set revision is not counted as accepted/current. | `pass` |
| `public_feed_fresh_propagation` | Live RSS producer evidence shows daemon ingest, normalization, StoryCluster request/response, raw story bodies, latest/hot indexes, and Web PWA consumer render/open for the same publisher snapshot; the MVP gate also requires the current public browser-smoke artifact for relay readback, refresh, and cursor pagination. Fixture-only proof, stale latest activity with source supply, or missing public browser smoke is not release-ready evidence. | `pass` |
| `story_identity_growth` | StoryCluster keeps singleton stories visible and preserves `story_id` while same-event source coverage grows; related-topic-only articles do not widen canonical sources. | `pass` |
| `public_feed_pagination_refresh` | Public app opens current stories, refreshes latest stories, load-more/scroll performs an older-window mesh refresh with an exclusive cursor, and relay pagination evidence proves `before` can return a non-overlapping older latest-index page; revealing rows from a larger initial DOM or in-memory window does not satisfy this gate. | `pass` |
| `stance_aggregate_decay_public_mesh` | Point-level +/− stance persistence, one final stance per scoped point, public aggregate or voter-row readback, second-browser convergence, and cap/decay math (`cap=1.95`, `alpha=0.3`) are enforced by `pnpm check:public-feed:stance-aggregate-decay`. | `pass` |
| `synthesis_correction` | Corrected/suppressed accepted synthesis does not render stale summary/frame rows. | `pass` |
| `point_stance` | Frame/reframe point stance writes and restores against accepted synthesis point ids. | `pass` |
| `story_thread` | Deterministic `news-story:*` thread replies remain attached to the same story across reload. | `pass` |
| `story_thread_moderation` | Audited hide/restore moderation hides abusive reply content without losing thread provenance. | `pass` |
| `launch_content_snapshot` | Curated fallback content snapshot validates representative launch stories and states. | `pass` |
| `report_intake_admin_action` | Synthesis and story-thread reports appear in the operator queue and route to audited actions. | `pass` |
| `operator_trust_gate` | Remediation writes fail closed unless the current operator holds required trusted beta capabilities. | `pass` |
| `public_beta_compliance` | Public beta policy/support/compliance surfaces match implemented scope. | `pass` |
| `luma_mvp_production_readiness` | Public-beta LUMA is fail-closed, beta-local, signed-write/envelope-backed, namespace-leak guarded, and supported by current LUMA mesh reader-path coverage. | `pass` |
| `public_beta_launch_closeout` | This closeout artifact maps launch gates to deterministic command/report evidence and classifies remaining work. | `pass` |

## 4. Launch-Content Snapshot Coverage

`pnpm check:launch-content-snapshot` must validate the committed `packages/e2e/fixtures/launch-content/validated-snapshot.json` and cover these fixture categories:

- `singleton_story`
- `bundled_story`
- `preference_ranking_filtering`
- `accepted_synthesis`
- `frame_reframe_stance_targets`
- `analyzed_sources_and_related_links`
- `deterministic_story_thread`
- `persisted_reply`
- `synthesis_correction`
- `comment_moderation_hidden`
- `comment_moderation_restored`

This snapshot is the deterministic QA/demo fallback. It does not prove live ingestion freshness, source breadth, or production headline density.

## 5. Remaining Work Classification

Every known remaining item is classified below. `ship_blocker` means public-beta release must not proceed if the condition is true for the intended launch claim. `post_beta_follow_up` means the item is valuable but outside the minimum Web PWA public-beta scope documented here.

| Item | Classification | Closeout decision |
| --- | --- | --- |
| `release_commit_gate_packet_missing_or_failing` | ship_blocker | A public-beta release commit must have passing `pnpm check:public-beta-s1-recovery-control-plane`, `pnpm check:public-beta-launch-closeout`, `pnpm check:beta-session-runsheet`, `pnpm check:mvp-release-gates`, `pnpm check:mvp-closeout`, `pnpm check:launch-content-snapshot`, `pnpm check:public-beta-compliance`, `pnpm docs:check`, lint/dependency checks, and touched package typechecks. |
| `external_release_approval_not_recorded` | ship_blocker | This repo does not create legal/commercial approval. If the organization requires legal/operator approval before public distribution, that signoff must be recorded outside the code gates before public launch claims are made. |
| `production_live_headline_claim_without_release_ready` | ship_blocker | Do not market live public headlines as production-grade unless `pnpm check:storycluster:production-readiness` resolves to `release_ready`. The Web PWA beta may still use the constrained beta and validated-snapshot scope. |
| `scope_a_sustained_stability_claim_without_retainer_evidence` | ship_blocker | Do not claim 48-hour Scope A stability or host-failure tolerance from outage recovery alone. The current verdict is `heap_driver_off_graph_likely`; sustained live-headline claims require early-capture retainer evidence or a later clean plateau/window that supersedes the verdict. |
| `public_feed_alert_delivery_channel_missing` | ship_blocker | Do not run an unattended public-feed watch if no webhook/email delivery channel reaches the release owner. Host-local logs and timers already failed as the only alert path during outage #2. |
| `full_product_engagement_claim_without_live_lane` | ship_blocker | Do not claim the full multi-user product loop was exercised against release-like service wiring unless `pnpm live:stack:up:analysis-stub` and `pnpm test:live:five-user-engagement` pass on the release candidate or the claim is removed. |
| `public_feed_analysis_frame_reliability_missing_or_failing` | ship_blocker | Do not launch the public MVP feed if the public browser smoke or consistency probe shows latest-index rows whose story body route 404s outside a bounded repair/tombstone window, app-open public latest refresh is skipped because stale launch/snapshot news was already composed, visible readable text stories without accepted-current synthesis or terminal unavailable reason, accepted synthesis counted without matching story/source-set lifecycle, missing accepted frame rows, missing point ids for votable rows, or CSP/network errors affecting peer health, synthesis, story reads, or app function. |
| `public_feed_composition_or_lifecycle_missing_or_failing` | ship_blocker | Do not launch the public MVP feed if the latest feed is singleton-only, lacks visible eligible singleton stories, lacks visible multi-source/corroborated stories without an explicit `setup_scarcity` classification, omits the relay composition/story-state/product-metadata surface, fails to verify all configured public relay peers, has an empty/unavailable hot index or sampled hot rows with metadata-stale/forked story identities, is outside the freshness window, or hides eligible raw stories because synthesis is pending. |
| `public_feed_fresh_propagation_missing_or_failing` | ship_blocker | Do not launch the public MVP feed if live RSS producer evidence is missing, fixture-only, stale despite source supply, lacks ingest/normalize/StoryCluster/publish stage evidence, lacks latest/hot product index parity, or is not tied to current public relay/PWA refresh evidence in the MVP release packet. |
| `luma_mvp_readiness_gate_missing_or_blocked` | ship_blocker | Do not claim LUMA public-beta MVP readiness unless `pnpm check:luma:mvp-production-readiness` writes `status: pass` on the release commit. |
| `luma_silver_or_production_attestation_claim` | ship_blocker | Public-beta LUMA is beta-local only. Production-attestation/Silver requires a separate verifier, nonce, manifest, signature, profile, and adversarial-harness gate. |
| `mesh_release_ready_or_app_ready_claim_without_downstream_gates` | ship_blocker | LUMA readiness does not clear public WSS mesh `release_ready` or full production app readiness. Keep `pnpm check:production-app-canary -- --mesh-report <mesh-report>` as a separate downstream gate. |
| `full_rbac_admin_membership` | post_beta_follow_up | Minimum trusted beta operator authorization exists; full RBAC, admin membership management, and cryptographic server-side enforcement remain future hardening. |
| `notifications_escalation_appeals` | post_beta_follow_up | Report intake, private handoff protocol, and audited remediation records exist; automated notifications, escalation workflow, appeals, and user-block UX remain broader trust-and-safety work. |
| `private_support_desk_or_sla` | post_beta_follow_up | Public GitHub support issues plus private handoff rules are implemented; a private support desk, account system, SLA handling, and case-management UI are not part of the minimum beta. |
| `broader_admin_workflow_ux` | post_beta_follow_up | The operator queue can route current report actions; richer filtering, assignment, status dashboards, and multi-operator workflow polish remain follow-on work. |
| `remote_model_cost_operations_visibility` | post_beta_follow_up | Current reports expose model/source evidence enough for beta closeout; spend dashboards, cost alerts, and broader ops telemetry remain separate operations work. |
| `live_ingestion_source_breadth` | post_beta_follow_up | Source health and StoryCluster correctness are gated; live public-feed breadth remains an operations maturity item unless the release copy claims production-grade live coverage. |
| `native_app_store_testflight` | post_beta_follow_up | Web PWA is the launch surface. Native shell, signing, device testing, TestFlight, and App Store submission are outside this beta closeout. |
| `story_engagement_summary_rollup` | post_beta_follow_up | Public story-level aggregate sentiment remains intentionally deferred; point-level stance/aggregate behavior is the MVP surface. |

## 6. Release Copy Boundaries

Allowed public-beta claim:

- "Web PWA public beta candidate with deterministic MVP gate coverage, curated fallback launch content, public policy/support surfaces, audited correction/moderation/report remediation paths, and trusted beta operator gates for current remediation writes."
- "MVP public-beta release gates passed for the implemented MVP scope."
- "LUMA public-beta is MVP-production-ready as a fail-closed beta-local identity and signed-write layer."
- "Source health passed the complete release evidence window."
- "Mesh is tracked separately and is currently `review_required` unless its own report says `release_ready`."

Disallowed without additional evidence:

- legal approval complete;
- 48-hour Scope A stability after outage #2;
- production-grade live headline freshness;
- no verified-human, one-human-one-vote, or Sybil-resistant civic proof claim;
- no production-attestation/Silver, cryptographic residency, or verified-human assurance claim;
- public WSS mesh `release_ready` unless the mesh report proves it;
- full production app readiness unless the production app canary passes after mesh release readiness;
- private support inbox or SLA-backed support desk;
- full trust-and-safety operations console;
- full RBAC/admin membership system;
- native App Store or TestFlight readiness.
