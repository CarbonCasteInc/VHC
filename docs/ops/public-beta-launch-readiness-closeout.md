# Public Beta Launch Readiness Closeout

> Status: Engineering Closeout Audit
> Owner: VHC Launch Ops
> Last Reviewed: 2026-04-28
> Depends On: docs/plans/VENN_NEWS_MVP_ROADMAP_2026-04-20.md, docs/ops/public-beta-compliance-minimums.md, docs/ops/BETA_SESSION_RUNSHEET.md

Version: 0.2
Document path: `docs/ops/public-beta-launch-readiness-closeout.md`
Audit baseline: `main` at `cf961e731b15aba675305f62d72a6cc16c1567d2` after the public-beta launch closeout merge, plus the full-product multi-user engagement slice carried by PR #551 for local service-backed QA.
Scope: Web PWA public beta launch-readiness evidence, deterministic gate inventory, and remaining-work classification.

## 1. Closeout Verdict

Engineering closeout status: Web PWA public beta candidate, constrained to the implemented beta scope.

No repository feature gap is currently classified as a Web PWA public-beta ship blocker when the release owner produces a passing evidence packet on the release commit. The implemented beta scope includes the core news loop, accepted synthesis detail, point stance persistence, deterministic story threads, correction/moderation/report remediation paths, operator trust gate, public policy routes, public support issue intake, private escalation protocol, and curated fallback launch content.

The full-product five-user engagement lane supplements the deterministic report packet with a production-shaped local-stack run: five beta-local users open singleton and bundled stories, read accepted synthesis/frame tables, register point-level stances, confirm mesh aggregate readback, and hold threaded story discussions across reloads. This lane is release-like manual QA; it does not replace the named deterministic command/report gates below.

This closeout does not claim legal approval, production-grade live headline freshness, full RBAC/admin membership management, a private support desk, native App Store/TestFlight readiness, automated escalation/SLA handling, or a complete trust-and-safety operations console.

## 2. Required Release Evidence Packet

Run these commands on the final public-beta release commit and preserve their output paths in the release note:

| Evidence | Command | Deterministic report or artifact | Required result |
| --- | --- | --- | --- |
| Launch closeout audit | `pnpm check:public-beta-launch-closeout` | This document plus the static checker in `tools/scripts/check-public-beta-launch-closeout.mjs` | `pass` |
| MVP release gates | `pnpm check:mvp-release-gates` | `.tmp/mvp-release-gates/latest/mvp-release-gates-report.json` | `overallStatus: pass` |
| Curated launch-content fallback | `pnpm check:launch-content-snapshot` | `.tmp/launch-content-snapshot/latest/launch-content-snapshot-report.json` | `overallStatus: pass` |
| Public-beta compliance minimums | `pnpm check:public-beta-compliance` | `tools/scripts/check-public-beta-compliance.mjs` and `docs/ops/public-beta-compliance-minimums.md` | `pass` |
| Documentation governance | `pnpm docs:check` | `tools/scripts/check-docs-governance.mjs` | `pass` |
| Standard repo health | `pnpm lint`, `pnpm deps:check`, touched package typechecks | CI and local command output | `pass` |

Supplemental release-like product validation:

| Evidence | Command | Artifact | Required result |
| --- | --- | --- | --- |
| Full-product five-user engagement | `pnpm live:stack:up:analysis-stub` followed by `pnpm test:live:five-user-engagement` | Playwright attachment `five-user-news-engagement-summary` plus local command output | `pass` before claiming the full multi-user feed/detail/stance/thread loop was exercised against the production-shaped local stack |

## 3. MVP Gate Coverage

`pnpm check:mvp-release-gates` is the umbrella Web PWA MVP proof packet. It must include these gate ids in `.tmp/mvp-release-gates/latest/mvp-release-gates-report.json`:

| Gate id | Launch claim proven | Report status required |
| --- | --- | --- |
| `source_health` | Source-health artifact exists and is fresh enough for the release runner. | `pass` |
| `story_correctness` | StoryCluster correctness gate passes. | `pass` |
| `feed_render` | Fixture-backed feed renders and preferences affect ranking/filtering. | `pass` |
| `story_detail` | Headline detail opens from accepted `TopicSynthesisV2`. | `pass` |
| `synthesis_correction` | Corrected/suppressed accepted synthesis does not render stale summary/frame rows. | `pass` |
| `point_stance` | Frame/reframe point stance writes and restores against accepted synthesis point ids. | `pass` |
| `story_thread` | Deterministic `news-story:*` thread replies remain attached to the same story across reload. | `pass` |
| `story_thread_moderation` | Audited hide/restore moderation hides abusive reply content without losing thread provenance. | `pass` |
| `launch_content_snapshot` | Curated fallback content snapshot validates representative launch stories and states. | `pass` |
| `report_intake_admin_action` | Synthesis and story-thread reports appear in the operator queue and route to audited actions. | `pass` |
| `operator_trust_gate` | Remediation writes fail closed unless the current operator holds required trusted beta capabilities. | `pass` |
| `public_beta_compliance` | Public beta policy/support/compliance surfaces match implemented scope. | `pass` |
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
| `release_commit_gate_packet_missing_or_failing` | ship_blocker | A public-beta release commit must have passing `pnpm check:public-beta-launch-closeout`, `pnpm check:mvp-release-gates`, `pnpm check:launch-content-snapshot`, `pnpm check:public-beta-compliance`, `pnpm docs:check`, lint/dependency checks, and touched package typechecks. |
| `external_release_approval_not_recorded` | ship_blocker | This repo does not create legal/commercial approval. If the organization requires legal/operator approval before public distribution, that signoff must be recorded outside the code gates before public launch claims are made. |
| `production_live_headline_claim_without_release_ready` | ship_blocker | Do not market live public headlines as production-grade unless `pnpm check:storycluster:production-readiness` resolves to `release_ready`. The Web PWA beta may still use the constrained beta and validated-snapshot scope. |
| `full_product_engagement_claim_without_live_lane` | ship_blocker | Do not claim the full multi-user product loop was exercised against release-like service wiring unless `pnpm live:stack:up:analysis-stub` and `pnpm test:live:five-user-engagement` pass on the release candidate or the claim is removed. |
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

Disallowed without additional evidence:

- legal approval complete;
- production-grade live headline freshness;
- verified-human, one-human-one-vote, or Sybil-resistant civic proof;
- private support inbox or SLA-backed support desk;
- full trust-and-safety operations console;
- full RBAC/admin membership system;
- native App Store or TestFlight readiness.
