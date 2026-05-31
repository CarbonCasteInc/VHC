# Public Beta Launch Readiness Closeout

> Status: Engineering Closeout Audit
> Owner: VHC Launch Ops
> Last Reviewed: 2026-04-28
> Depends On: docs/plans/VENN_NEWS_MVP_ROADMAP_2026-04-20.md, docs/ops/public-beta-compliance-minimums.md, docs/ops/BETA_SESSION_RUNSHEET.md

Version: 0.5
Document path: `docs/ops/public-beta-launch-readiness-closeout.md`
Audit baseline: current public-beta closeout baseline plus the LUMA public-beta MVP readiness slice and consolidated MVP closeout packet.
Scope: Web PWA public beta launch-readiness evidence, deterministic gate inventory, and remaining-work classification.

## 1. Closeout Verdict

Engineering closeout status: Web PWA public beta candidate, constrained to the implemented beta scope, with public feed composition/freshness, lifecycle accountability, analysis/frame-table reliability, pagination/refresh, and stance aggregate behavior now explicit release gates.

No public-beta launch claim may proceed unless the release owner produces a passing evidence packet on the release commit, including the public latest-index/story-body/synthesis/frame-table reliability gate, the public feed mixed-composition/freshness gate, and the raw-story/product-feed lifecycle accountability gate. The implemented beta scope includes the core news loop, accepted synthesis detail, point stance persistence, deterministic story threads, correction/moderation/report remediation paths, operator trust gate, public policy routes, public support issue intake, private escalation protocol, curated fallback launch content, and LUMA public-beta MVP readiness for the beta-local identity/signed-write layer.

`pnpm check:mvp-closeout` is the consolidated release-truth reader for this scope. It reads the MVP release-gates packet, source-health packet, LUMA MVP readiness packet, Mesh readiness packet, and production app canary packet, then writes `.tmp/mvp-closeout/latest/mvp-closeout-report.json` with bounded allowed/forbidden claims. It does not override any upstream gate.

The release-owner decision handoff is recorded in `docs/reports/mvp-public-beta-launch-control-2026-05-13.md`. That packet converts the engineering release-candidate evidence into an explicit go/hold control surface with approvals, bounded launch copy, support/escalation ownership, rollback ownership, and final launch status. The launch-control packet must not fake signoff; if any required approval or owner field is pending, its final status remains `hold_external_approval_pending`.

The full-product five-user engagement lane supplements the deterministic report packet with a production-shaped local-stack run: five beta-local users open singleton and bundled stories, read accepted synthesis/frame tables, register point-level stances, confirm mesh aggregate readback, and hold threaded story discussions across reloads. This lane is release-like manual QA; it does not replace the named deterministic command/report gates below.

This closeout does not claim legal approval, production-grade live headline freshness, production-attestation/Silver, verified-human identity, one-human-one-vote, Sybil resistance, public WSS mesh `release_ready`, full production app readiness, full RBAC/admin membership management, a private support desk, native App Store/TestFlight readiness, automated escalation/SLA handling, or a complete trust-and-safety operations console.

## 2. Required Release Evidence Packet

Run these commands on the final public-beta release commit and preserve their output paths in the release note:

| Evidence | Command | Deterministic report or artifact | Required result |
| --- | --- | --- | --- |
| Release-owner launch control | committed launch-control packet | `docs/reports/mvp-public-beta-launch-control-2026-05-13.md` and optional JSON mirror | `go_for_public_beta_launch` only when deterministic evidence passes and required approvals/owners are recorded; otherwise `hold_external_approval_pending` |
| Launch closeout audit | `pnpm check:public-beta-launch-closeout` | This document plus the static checker in `tools/scripts/check-public-beta-launch-closeout.mjs` | `pass` |
| MVP release gates | `pnpm check:mvp-release-gates` | `.tmp/mvp-release-gates/latest/mvp-release-gates-report.json` | `overallStatus: pass` |
| Public feed analysis/frame reliability | `VH_PUBLIC_FEED_APP_URL=https://venn.carboncaste.io VH_PUBLIC_FEED_GUN_PEER_URL=wss://gun-a.carboncaste.io/gun VH_PUBLIC_FEED_PUBLIC_WSS_PEERS='["wss://gun-a.carboncaste.io/gun","wss://gun-b.carboncaste.io/gun","wss://gun-c.carboncaste.io/gun"]' pnpm test:public-feed:browser-smoke` | `.tmp/release-evidence/public-feed-browser-smoke/latest/public-feed-browser-smoke-summary.json` plus `.tmp/analysis-frame-pipeline/<timestamp>/` consistency probes | `pass`; public top-N latest-index body 404 count is zero or inside an explicitly recorded repair/tombstone window; app-open feed population succeeds without a manual refresh click; visible readable text stories have accepted synthesis with frame/reframe rows and point ids only when relay lifecycle matches the current story/source-set revision, or durable pending/terminal unavailable state |
| Public feed composition/freshness | `VH_PUBLIC_FEED_APP_URL=https://venn.carboncaste.io pnpm check:public-feed:composition-freshness` | `.tmp/release-evidence/public-feed-composition-freshness/latest/public-feed-composition-freshness-summary.json` | `pass`; public latest feed includes both singleton and multi-source/corroborated stories, reports composition/per-story public-state counts, verifies latest-index product metadata, verifies relay cursor pagination for older latest-index rows, and fails instead of `setup_scarcity` when source-health evidence proves corroborated supply exists but the deployed feed remains singleton-only |
| Raw/product lifecycle accountability | `VH_PUBLIC_FEED_APP_URL=https://venn.carboncaste.io VH_PUBLIC_FEED_GUN_PEER_URL=wss://gun-a.carboncaste.io/gun pnpm check:public-feed:lifecycle-accountability` | `.tmp/release-evidence/public-feed-lifecycle-accountability/latest/public-feed-lifecycle-accountability-summary.json` | `pass`; eligible raw stories are product-visible unless they have an explicit allowed reason, multi-source stories are not hidden merely because synthesis is pending, and daemon repair evidence includes the bounded recurring raw-story scan window plus singleton/multi-source promotion counts |
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
| `public_feed_analysis_frame_reliability` | Public top-N latest-index rows have readable story bodies or explicit repair/tombstone evidence; app-open feed population triggers the public latest refresh once the mesh client is ready and succeeds without a manual refresh click, even when launch/snapshot news is already composed; visible readable text stories have accepted synthesis/frame rows/point ids only when lifecycle matches the current story/source-set revision, or durable pending/terminal unavailable state; browser smoke records singleton visibility and CSP/network errors. | `pass` |
| `public_feed_composition_freshness` | Public latest feed includes eligible singleton and multi-source/corroborated stories, exposes pending/accepted/terminal composition counts and per-story public states, verifies latest-index product metadata, verifies a relay `before` cursor returns a non-overlapping older page when older product rows are expected, and enforces freshness. Singleton-only or stale supply may classify as `setup_scarcity` only when source-health evidence does not show current corroborated bundle supply. | `pass` |
| `public_feed_lifecycle_accountability` | Raw `vh/news/stories`, product latest/hot indexes, relay latest-index, synthesis lifecycle, and accepted synthesis paths agree; eligible raw stories are not hidden because synthesis is pending; daemon repair scans the bounded raw-story window after leadership acquisition and on its recurring repair interval with root-map and Gun map evidence and reports singleton versus multi-source promotions; hot index rows exist for product-visible stories and carry current source-set product metadata; stale topic latest synthesis from an older source-set revision is not counted as accepted/current. | `pass` |
| `story_identity_growth` | StoryCluster keeps singleton stories visible and preserves `story_id` while same-event source coverage grows; related-topic-only articles do not widen canonical sources. | `pass` |
| `public_feed_pagination_refresh` | Public app opens current stories, refreshes latest stories, load-more/scroll performs an older-window mesh refresh with an exclusive cursor, and relay pagination evidence proves `before` can return a non-overlapping older latest-index page; revealing rows from a larger initial DOM or in-memory window does not satisfy this gate. | `pass` |
| `stance_aggregate_decay_public_mesh` | Point-level +/− stance persistence, one final stance per scoped point, public aggregate readback, and cap/decay math (`cap=1.95`, `alpha=0.3`) are enforced. | `pass` |
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
| `release_commit_gate_packet_missing_or_failing` | ship_blocker | A public-beta release commit must have passing `pnpm check:public-beta-launch-closeout`, `pnpm check:mvp-release-gates`, `pnpm check:mvp-closeout`, `pnpm check:launch-content-snapshot`, `pnpm check:public-beta-compliance`, `pnpm docs:check`, lint/dependency checks, and touched package typechecks. |
| `external_release_approval_not_recorded` | ship_blocker | This repo does not create legal/commercial approval. If the organization requires legal/operator approval before public distribution, that signoff must be recorded outside the code gates before public launch claims are made. |
| `production_live_headline_claim_without_release_ready` | ship_blocker | Do not market live public headlines as production-grade unless `pnpm check:storycluster:production-readiness` resolves to `release_ready`. The Web PWA beta may still use the constrained beta and validated-snapshot scope. |
| `full_product_engagement_claim_without_live_lane` | ship_blocker | Do not claim the full multi-user product loop was exercised against release-like service wiring unless `pnpm live:stack:up:analysis-stub` and `pnpm test:live:five-user-engagement` pass on the release candidate or the claim is removed. |
| `public_feed_analysis_frame_reliability_missing_or_failing` | ship_blocker | Do not launch the public MVP feed if the public browser smoke or consistency probe shows latest-index rows whose story body route 404s outside a bounded repair/tombstone window, app-open public latest refresh is skipped because stale launch/snapshot news was already composed, visible readable text stories without accepted-current synthesis or terminal unavailable reason, accepted synthesis counted without matching story/source-set lifecycle, missing accepted frame rows, missing point ids for votable rows, or CSP/network errors affecting peer health, synthesis, story reads, or app function. |
| `public_feed_composition_or_lifecycle_missing_or_failing` | ship_blocker | Do not launch the public MVP feed if the latest feed is singleton-only, lacks visible eligible singleton stories, lacks visible multi-source/corroborated stories without an explicit `setup_scarcity` classification, omits the relay composition/story-state/product-metadata surface, has missing or metadata-stale hot index rows for product-visible stories, is outside the freshness window, or hides eligible raw stories because synthesis is pending. |
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
- production-grade live headline freshness;
- no verified-human, one-human-one-vote, or Sybil-resistant civic proof claim;
- no production-attestation/Silver, cryptographic residency, or verified-human assurance claim;
- public WSS mesh `release_ready` unless the mesh report proves it;
- full production app readiness unless the production app canary passes after mesh release readiness;
- private support inbox or SLA-backed support desk;
- full trust-and-safety operations console;
- full RBAC/admin membership system;
- native App Store or TestFlight readiness.
