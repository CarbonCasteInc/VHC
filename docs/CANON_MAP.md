# Documentation Canon Map

This file defines canonical ownership for cross-domain behavior and contract decisions.

Precedence is defined in `docs/README.md`.

## Canon Table

| Domain | Authoritative Doc | Owner | Fallback / Context Docs | Last Review Date |
|---|---|---|---|---|
| Product intent (Season 0) | `docs/foundational/trinity_project_brief.md` | VHC Product + Architecture | `docs/foundational/TRINITY_Season0_SoT.md` | 2026-04-16 |
| Season scope and rollout framing | `docs/foundational/TRINITY_Season0_SoT.md` | VHC Product + Architecture | `docs/foundational/STATUS.md` | 2026-07-03 |
| Architecture contracts and defaults | `docs/foundational/System_Architecture.md` | VHC Core Architecture | `docs/foundational/ARCHITECTURE_LOCK.md` | 2026-04-16 |
| Implementation reality and drift | `docs/foundational/STATUS.md` | VHC Core Engineering | `docs/foundational/System_Architecture.md`, `docs/ops/NEWS_UI_SOAK_LANE_SEPARATION.md`, `docs/ops/STORY_BUNDLER_PRODUCTION_READINESS_CHECKLIST.md`, `docs/ops/public-beta-compliance-minimums.md` | 2026-07-08 |
| Phase 5 Scope A live publisher and StoryCluster operations | `docs/ops/news-aggregator-production-service.md` | VHC Ops | `docs/ops/storycluster-production-service.md`, `docs/ops/storycluster-headline-soak-credential-repair-2026-07-09.md`, `docs/ops/a6-accepted-synthesis-canary-packet-2026-07-09.md`, `docs/ops/public-feed-freshness-monitor.md`, `docs/ops/public-beta-image-deploy.md`, `docs/reports/phase5-scope-a-launch-closeout-2026-06-24.md`, `docs/reports/phase5-scope-a-stability-bake-2026-06-28.md`, `docs/reports/phase5-scope-a-recovery-current-state-2026-07-02.md`, `docs/reports/phase5-scope-a-driver-verdict-2026-07-02.md`, `docs/reports/phase5-scope-a-post-slice0-current-state-2026-07-06.md`, `docs/reports/mvp-readiness-state-of-play-2026-07-03.md`, `docs/specs/spec-news-aggregator-v0.md`, `docs/specs/spec-vhc-incident-response.md`, `docs/foundational/STATUS.md` | 2026-07-09 |
| StoryCluster execution program | `docs/plans/STORYCLUSTER_INTEGRATION_EXECUTION_PLAN.md` | VHC Core Engineering | `docs/plans/STORYCLUSTER_IMPLEMENTATION_TICKET_STACK.md`, `docs/foundational/STATUS.md` | 2026-03-16 |
| StoryCluster implementation backlog | `docs/plans/STORYCLUSTER_IMPLEMENTATION_TICKET_STACK.md` | VHC Core Engineering | `docs/plans/STORYCLUSTER_INTEGRATION_EXECUTION_PLAN.md`, `docs/foundational/STATUS.md` | 2026-03-16 |
| News source admission, background scouting, source-health policy, and readable-source ops | `docs/ops/NEWS_SOURCE_ADMISSION_RUNBOOK.md` | VHC Ops + Core Engineering | `docs/specs/spec-news-aggregator-v0.md`, `docs/foundational/STATUS.md`, `docs/ops/LOCAL_LIVE_STACK_RUNBOOK.md` | 2026-03-20 |
| UI / UX lane separation, soak measurement boundaries, and retained-feed integration sequencing | `docs/ops/NEWS_UI_SOAK_LANE_SEPARATION.md` | VHC Core Engineering | `docs/foundational/STATUS.md`, `docs/ops/LOCAL_LIVE_STACK_RUNBOOK.md`, `docs/specs/spec-news-aggregator-v0.md` | 2026-03-23 |
| Story bundler production-readiness scorecard and gate thresholds | `docs/ops/STORY_BUNDLER_PRODUCTION_READINESS_CHECKLIST.md` | VHC Core Engineering | `docs/specs/spec-news-aggregator-v0.md`, `docs/foundational/STATUS.md`, `docs/ops/LOCAL_LIVE_STACK_RUNBOOK.md`, `docs/ops/NEWS_UI_SOAK_LANE_SEPARATION.md` | 2026-03-25 |
| Public beta policy, support/contact, private escalation protocol, telemetry consent, UGC/moderation, deletion, and copyright boundaries | `docs/ops/public-beta-compliance-minimums.md` | VHC Launch Ops | `docs/plans/VENN_NEWS_MVP_ROADMAP_2026-04-20.md`, `docs/specs/spec-data-topology-privacy-v0.md`, `docs/specs/spec-hermes-forum-v0.md`, `docs/ops/BETA_SESSION_RUNSHEET.md`, `.github/ISSUE_TEMPLATE/public-beta-support.yml` | 2026-04-26 |
| Public beta launch closeout and claim boundary | `docs/ops/public-beta-launch-readiness-closeout.md` | VHC Launch Ops | `docs/ops/public-beta-launch-control-2026-07-09.md`, `docs/ops/auth-callback-provider-deployment-packet-2026-07-09.md`, `docs/ops/public-news-mvp-release-decisions.md`, `docs/launch/public-beta-copy.md`, `docs/foundational/STATUS.md`, `docs/reports/phase5-scope-a-stability-bake-2026-06-28.md`, `docs/reports/phase5-scope-a-recovery-current-state-2026-07-02.md`, `docs/reports/phase5-scope-a-driver-verdict-2026-07-02.md`, `docs/reports/phase5-scope-a-post-slice0-current-state-2026-07-06.md` | 2026-07-09 |
| Analysis and synthesis object contract | `docs/specs/topic-synthesis-v2.md` | VHC Spec Owners | `docs/foundational/AI_ENGINE_CONTRACT.md`, `docs/specs/canonical-analysis-v2.md`, `docs/specs/canonical-analysis-v1.md` | 2026-03-03 |
| Data topology and privacy boundaries | `docs/specs/spec-data-topology-privacy-v0.md` | VHC Spec Owners | `docs/foundational/System_Architecture.md`, `docs/ops/public-beta-compliance-minimums.md`, `docs/specs/spec-hermes-forum-v0.md`, `docs/specs/spec-luma-service-v0.md`, `docs/specs/spec-mesh-production-readiness.md` | 2026-05-04 |
| Identity, trust, and constituency semantics | `docs/specs/spec-identity-trust-constituency.md` | VHC Spec Owners | `docs/foundational/LUMA_BriefWhitePaper.md`, `docs/foundational/System_Architecture.md` | 2026-05-02 |
| LUMA service boundary, SDK contract, and operational hooks | `docs/specs/spec-luma-service-v0.md` | VHC Spec Owners | `docs/specs/spec-identity-trust-constituency.md`, `docs/specs/spec-data-topology-privacy-v0.md`, `docs/specs/spec-mesh-production-readiness.md`, `docs/specs/spec-signed-pin-custody-v0.md`, `docs/specs/secure-storage-policy.md`, `docs/ops/luma-verifier-current-state.md`, `docs/plans/LUMA_SERVICE_V0_ROADMAP_2026-05-02.md`, `docs/foundational/LUMA_BriefWhitePaper.md` | 2026-07-08 |
| Mesh production readiness, drill harness, transport readiness gate, and downstream production-app canary | `docs/specs/spec-mesh-production-readiness.md` | VHC Core Engineering | `docs/specs/spec-luma-service-v0.md`, `docs/specs/spec-data-topology-privacy-v0.md`, `docs/specs/spec-civic-sentiment.md`, `docs/specs/spec-signed-pin-custody-v0.md`, `docs/reports/MESH_HARDENING_PR2_2026-05-02.md` | 2026-05-04 |
| Signed-pin custody manifest, key scope, blast radius, and rotation/compromise procedures across mesh peer-config, LUMA verifier manifest, LUMA safety bulletin, mesh drill signer, and system writer | `docs/specs/spec-signed-pin-custody-v0.md` | VHC Spec Owners | `docs/specs/spec-luma-service-v0.md`, `docs/specs/spec-mesh-production-readiness.md`, `docs/specs/spec-data-topology-privacy-v0.md` | 2026-05-04 |
| Civic sentiment and voting contract | `docs/specs/spec-civic-sentiment.md` | VHC Spec Owners | `docs/foundational/System_Architecture.md` | 2026-04-16 |
| News bundling, publication, and production-readiness contract | `docs/specs/spec-news-aggregator-v0.md` | VHC Spec Owners | `docs/specs/spec-topic-discovery-ranking-v0.md`, `docs/foundational/System_Architecture.md`, `docs/foundational/STATUS.md`, `docs/ops/news-aggregator-production-service.md` | 2026-07-03 |
| Topic/news discovery and ranking | `docs/specs/spec-topic-discovery-ranking-v0.md` | VHC Spec Owners | `docs/specs/spec-news-aggregator-v0.md`, `docs/specs/spec-hermes-forum-v0.md`, `docs/specs/topic-synthesis-v2.md` | 2026-04-16 |
| HERMES Messaging | `docs/specs/spec-hermes-messaging-v0.md` | VHC Spec Owners | `docs/foundational/System_Architecture.md`, `docs/specs/spec-luma-service-v0.md` | 2026-05-07 |
| HERMES Forum | `docs/specs/spec-hermes-forum-v0.md` | VHC Spec Owners | `docs/foundational/System_Architecture.md`, `docs/ops/public-beta-compliance-minimums.md` | 2026-04-26 |
| HERMES Docs | `docs/specs/spec-hermes-docs-v0.md` | VHC Spec Owners | `docs/foundational/System_Architecture.md` | 2026-03-03 |
| Civic Action Kit | `docs/specs/spec-civic-action-kit-v0.md` | VHC Spec Owners | `docs/foundational/System_Architecture.md` | 2026-03-03 |
| Local manual + strict runtime ops | `docs/ops/LOCAL_LIVE_STACK_RUNBOOK.md` | VHC Ops | `docs/ops/AUTOMATION_STACK_RUNBOOK.md`, `docs/ops/NEWS_UI_SOAK_LANE_SEPARATION.md`, `docs/ops/STORY_BUNDLER_PRODUCTION_READINESS_CHECKLIST.md`, `docs/ops/NEWS_SOURCE_ADMISSION_RUNBOOK.md`, `docs/ops/BETA_SESSION_RUNSHEET.md`, `docs/ops/analysis-backend-3001.md`, `docs/ops/news-aggregator-production-service.md`, `docs/ops/public-beta-image-deploy.md` | 2026-06-14 |
| Persistent automation stack and validated feed snapshot through-line | `docs/ops/AUTOMATION_STACK_RUNBOOK.md` | VHC Ops + Core Engineering | `docs/ops/LOCAL_LIVE_STACK_RUNBOOK.md`, `docs/ops/NEWS_UI_SOAK_LANE_SEPARATION.md`, `docs/ops/STORY_BUNDLER_PRODUCTION_READINESS_CHECKLIST.md`, `docs/specs/spec-news-aggregator-v0.md` | 2026-04-16 |
| Beta-session operator procedure and pre-session feed readiness review | `docs/ops/BETA_SESSION_RUNSHEET.md` | VHC Ops | `docs/ops/LOCAL_LIVE_STACK_RUNBOOK.md`, `docs/foundational/STATUS.md`, `docs/ops/public-beta-compliance-minimums.md` | 2026-04-26 |

## Update Rule

Any PR that changes foundational/spec/ops semantics must:

1. Update the authoritative owner doc.
2. Update this canon table if ownership or fallback routing changed.
3. Update `Last Review Date` for touched owner rows.
