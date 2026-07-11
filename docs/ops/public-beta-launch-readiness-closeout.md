# Public Beta Launch Readiness Closeout

> Status: Engineering Closeout Audit
> Owner: VHC Launch Ops
> Last Reviewed: 2026-07-11
> Depends On: docs/ops/public-beta-operational-state.md, docs/ops/public-beta-compliance-minimums.md, docs/ops/BETA_SESSION_RUNSHEET.md, docs/ops/public-beta-launch-control-2026-07-09.md, docs/ops/public-beta-distribution-packet-2026-07-09.md, docs/sprints/PUBLIC_BETA_MVP_COMPLETION_SPRINT_2026-07-11.md, docs/plans/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md

## Current Verdict

Engineering target: a controlled Venn News Web PWA public beta, constrained to
the implemented beta scope.

Current launch decision: **NO-GO**.

The repository contains the core news/detail/stance/thread loop, correction and
moderation paths, trusted beta operator gates, compliance/support surfaces,
beta-local LUMA identity, and deterministic release checks. That capability does
not substitute for current live evidence.

The immediate operational blocker is S1. The exact S1 revision and original
tuple were reviewed, but supervised load attempt 001 stopped at read-only
prestate because its staging base was shared. No live mutation occurred. The
next eligible work is a fresh private-staging load/supervision envelope,
independent review, and new exact binding. See
`docs/ops/public-beta-operational-state.md`.

No public-beta launch claim may proceed until S1A/S1B pass immediate, T0+24h,
and T0+48h evidence; S2-S10 then pass; the distribution packet is complete; and
Lou records the final go/no-go decision.

Durable S1 boundaries:

- `FINAL_MAIN_REVISION_BINDS_RELAY_IMAGE_AND_PUBLISHER_CHECKOUT`
- `IMMEDIATE_RECOVERY_IS_NOT_S1_GREEN`
- `T0_PLUS_24H_IS_INTERMEDIATE_ONLY`
- `T0_PLUS_48H_REQUIRED_TO_UNBLOCK_S2`

Historical launch/outage/recovery chronology is preserved under
`docs/archive/public-beta-pre-recovery-2026-07-10/`. It is evidence history, not
current clearance.

## Required Release Evidence Packet

Every product/live result must be generated on the intended product release
commit R. Fixture-only, stale, partial, or differently stamped artifacts do not
satisfy a live gate. A later control-record-only commit C may bind Lou's final
decision to R; transition-aware guards must already exist on R, and C cannot
contain guard/runtime/product changes or substitute for evidence generated on R.

| Evidence | Command | Required result or artifact |
| --- | --- | --- |
| S1 recovery control plane | `pnpm check:public-beta-s1-recovery-control-plane` | Pass on the recovery/release line; does not itself prove live recovery. |
| Launch closeout self-check | `pnpm check:public-beta-launch-closeout` | Pass; validates this gate inventory and its control-document wiring. |
| Public-beta launch control | `pnpm check:public-beta-launch-control` | Current packet remains honest `NO-GO` until every live field is complete. |
| Distribution packet | `pnpm check:public-beta-distribution-packet` | Current packet remains blocked; a future go packet has no TBD or blocker rows. |
| Operator packets | `pnpm check:release-readiness-operator-packets` | StoryCluster repair, accepted-synthesis canary, and auth/provider packets preserve preconditions and secret boundaries. |
| Beta session runsheet guard | `pnpm check:beta-session-runsheet` | Pass; manual rehearsal still must be executed separately. |
| Next-phase sequence | `pnpm check:public-beta-next-phase-sprint` | Pass; current G4 through S12 ordering and authority remain pinned. |
| MVP release gates | `pnpm check:mvp-release-gates` | `.tmp/mvp-release-gates/latest/mvp-release-gates-report.json` with required gates passing. |
| Consolidated MVP closeout | `pnpm check:mvp-closeout` | `.tmp/mvp-closeout/latest/mvp-closeout-report.json` with bounded allowed/forbidden claims. |
| Curated fallback QA | `pnpm check:launch-content-snapshot` | `.tmp/launch-content-snapshot/latest/launch-content-snapshot-report.json` passes; this is not live-ingestion proof. |
| Public-beta compliance | `pnpm check:public-beta-compliance` | Policy/support/private-handoff surfaces pass. |
| Incident-response/pager repo gate | `pnpm check:vhc-incident-response` | Pager contract and dead-man implementation pass; separate live deployment, subscription, test-fire, acknowledgement, heartbeat, and external dead-man evidence remain mandatory. |
| Documentation governance | `pnpm docs:check` | Pass with current links and authority boundaries. |
| Full release regeneration | `pnpm check:mvp-release-evidence` | Fresh release-evidence pipeline stamped to the intended release commit. |

Required control documents:

- `docs/ops/public-beta-launch-readiness-closeout.md`
- `docs/ops/public-beta-launch-control-2026-07-09.md`
- `docs/ops/public-beta-distribution-packet-2026-07-09.md`
- `docs/sprints/PUBLIC_BETA_MVP_COMPLETION_SPRINT_2026-07-11.md`
- `docs/plans/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md`
- `docs/ops/a6-s1b-relay-timeout-recovery-packet-2026-07-10.md`
- `docs/ops/storycluster-headline-soak-credential-repair-2026-07-09.md`
- `docs/ops/a6-accepted-synthesis-canary-packet-2026-07-09.md`
- `docs/ops/auth-callback-provider-deployment-packet-2026-07-09.md`

## MVP Gate Coverage

`pnpm check:mvp-release-gates` must retain these gate IDs:

| Gate ID | Launch claim |
| --- | --- |
| `source_health` | Admitted source evidence is current and passing. |
| `story_correctness` | StoryCluster deterministic corpus/replay correctness passes. |
| `feed_render` | Feed renders and preferences affect ranking/filtering. |
| `story_detail` | Accepted-current story detail renders honestly. |
| `public_feed_analysis_frame_reliability` | Visible stories have readable bodies and current accepted/terminal synthesis state, frame rows, and point IDs where claimed. |
| `public_feed_composition_freshness` | Current singleton and corroborated stories, metadata, freshness, and every configured public relay readback pass. |
| `public_feed_lifecycle_accountability` | Raw stories, product indexes, lifecycle, and accepted synthesis agree without hiding pending stories. |
| `public_feed_fresh_propagation` | A current live RSS item progresses through ingest, StoryCluster, publication, relay readback, and PWA render. |
| `story_identity_growth` | Stable story identity survives same-event source growth. |
| `public_feed_pagination_refresh` | App-open refresh and relay-backed older-page pagination pass. |
| `stance_aggregate_decay_public_mesh` | Point stance persistence, aggregate/voter readback, second-browser convergence, and cap/decay math pass. |
| `synthesis_correction` | Corrected or suppressed synthesis does not render stale output. |
| `point_stance` | Frame/reframe point stance writes and restores against accepted IDs. |
| `story_thread` | Deterministic story discussion persists across reload. |
| `story_thread_moderation` | Audited hide/restore preserves provenance. |
| `launch_content_snapshot` | Curated QA/demo fixture coverage passes. |
| `report_intake_admin_action` | Reports route to audited trusted-operator actions. |
| `operator_trust_gate` | Remediation writes fail closed without trusted beta capability. |
| `public_beta_compliance` | Policy/support/compliance surfaces match implemented scope. |
| `luma_forbidden_claims` | Tester copy and product surfaces reject unproved identity/trust claims. |
| `luma_production_profile` | Public-beta identity/profile behavior stays inside the implemented production-profile boundary. |
| `luma_telemetry_redaction` | Identity/proof/session telemetry remains secret-safe. |
| `luma_mvp_production_readiness` | The composed beta-local LUMA readiness gate passes on the release commit. |
| `public_beta_launch_closeout` | This evidence and claim-boundary map remains complete. |

Passing one gate never overrides another. In particular, relay `/readyz`, a
nonblank cached feed, or one clean publisher tick does not prove freshness,
lifecycle integrity, accepted synthesis, stance convergence, or sustained
operation.

## Launch-Content Snapshot Coverage

The committed snapshot must cover:

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

This snapshot is internal QA/demo fallback. It does not prove live ingestion,
source breadth, public relay convergence, production headline freshness, or a
supported snapshot-only public launch mode.

## Remaining Work Classification

`ship_blocker` means the public-beta claim must not proceed while the condition
is true. `post_beta_follow_up` means useful work outside the minimum beta claim.

| Item | Classification | Decision |
| --- | --- | --- |
| `s1_recovery_not_closed_t0_plus_48h` | ship_blocker | Complete reviewed private staging, image load, A/review/B/review/C/review, separate publisher recovery, and passing T0+48h closure. |
| `release_commit_gate_packet_missing_or_failing` | ship_blocker | All required release commands and live evidence must pass on the intended release commit. |
| `external_release_approval_not_recorded` | ship_blocker | Record any required external legal/commercial disposition; the repo cannot create it. |
| `production_live_headline_claim_without_release_ready` | ship_blocker | `check:storycluster:production-readiness` must resolve `release_ready` for production-grade live headline copy. |
| `scope_a_sustained_stability_claim_without_retainer_evidence` | ship_blocker | Do not claim host-failure tolerance or memory boundedness from recovery alone. |
| `public_feed_alert_delivery_channel_missing` | ship_blocker | Controlled distribution requires the canonical signed-alert, durable pager, active subscription/heartbeat, push/email fallback, acknowledgement, and external dead-man path. |
| `full_product_engagement_claim_without_live_lane` | ship_blocker | Run the production-shaped local five-user lane plus deployed three-browser rehearsal, or remove the full-loop claim. |
| `offline_mesh_unreachable_behavior_unproven` | ship_blocker | Prove visibly pending local intent, no false aggregate success, reconnect replay, and bounded honest failure. |
| `minimum_accessibility_unproven` | ship_blocker | Prove keyboard/focus, stance labels and pressed state, screen-reader distinction, and reduced-motion-safe behavior. |
| `public_feed_analysis_frame_reliability_missing_or_failing` | ship_blocker | No launch with unreadable stories, stale/current-lifecycle mismatch, missing current accepted/terminal state, frame rows, or point IDs. |
| `public_feed_composition_or_lifecycle_missing_or_failing` | ship_blocker | No launch with stale/singleton-only or metadata-incomplete feed, hidden eligible stories, or missing peer parity. |
| `public_feed_fresh_propagation_missing_or_failing` | ship_blocker | Current RSS must progress through ingest, StoryCluster, publication, relay readback, and PWA render. |
| `luma_mvp_readiness_gate_missing_or_blocked` | ship_blocker | LUMA beta-local readiness must pass on the release commit. |
| `luma_silver_or_production_attestation_claim` | ship_blocker | Separate production verifier/attestation evidence is required. |
| `mesh_release_ready_or_app_ready_claim_without_downstream_gates` | ship_blocker | Mesh and full production-app readiness remain separate downstream gates. |
| `full_rbac_admin_membership` | post_beta_follow_up | Minimum trusted beta operator authorization exists; full RBAC remains future hardening. |
| `notifications_escalation_appeals` | post_beta_follow_up | Rich notifications, escalation, appeals, and user-block UX remain broader trust-and-safety work. |
| `private_support_desk_or_sla` | post_beta_follow_up | Public support plus private handoff exists; a private desk/SLA does not. |
| `broader_admin_workflow_ux` | post_beta_follow_up | Assignment, dashboards, and multi-operator workflow remain follow-up. |
| `remote_model_cost_operations_visibility` | post_beta_follow_up | Spend dashboards and cost alerts remain separate operations work. |
| `live_ingestion_source_breadth` | post_beta_follow_up | Breadth is operations maturity unless release copy claims production-grade coverage. |
| `native_app_store_testflight` | post_beta_follow_up | Web PWA is the beta surface; no native readiness claim. |
| `story_engagement_summary_rollup` | post_beta_follow_up | Point-level stance is the MVP; generic story sentiment remains deferred. |

## Release Copy Boundaries

Allowed only after the corresponding evidence passes:

- Web PWA public beta for the implemented MVP scope.
- Deterministic gate coverage and curated QA fallback.
- Beta-local LUMA identity and signed-write behavior.
- Current source-health evidence.

Disallowed without additional proof:

- legal approval complete;
- 48-hour stability before a passing current closure packet;
- production-grade live headline freshness;
- disallowed verified-human, one-human-one-vote, Sybil-resistant, residency, or LUMA Silver claims;
- public WSS mesh `release_ready`;
- full production-app readiness;
- independent host-failure tolerance from three co-located relay votes;
- private support inbox or SLA;
- full trust-and-safety console or RBAC;
- native App Store or TestFlight readiness;
- pager-backed 24/7 operations.

The launch owner must narrow or remove any unsupported claim; narrower copy does
not waive a gate that remains required for the selected live-feed public-beta
envelope.
