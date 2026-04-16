# Documentation Canon Map

This file defines canonical ownership for cross-domain behavior and contract decisions.

Precedence is defined in `docs/README.md`.

## Canon Table

| Domain | Authoritative Doc | Owner | Fallback / Context Docs | Last Review Date |
|---|---|---|---|---|
| Product intent (Season 0) | `docs/foundational/trinity_project_brief.md` | VHC Product + Architecture | `docs/foundational/TRINITY_Season0_SoT.md` | 2026-04-16 |
| Season scope and rollout framing | `docs/foundational/TRINITY_Season0_SoT.md` | VHC Product + Architecture | `docs/foundational/STATUS.md` | 2026-04-16 |
| Architecture contracts and defaults | `docs/foundational/System_Architecture.md` | VHC Core Architecture | `docs/foundational/ARCHITECTURE_LOCK.md` | 2026-04-16 |
| Implementation reality and drift | `docs/foundational/STATUS.md` | VHC Core Engineering | `docs/foundational/System_Architecture.md`, `docs/ops/NEWS_UI_SOAK_LANE_SEPARATION.md`, `docs/ops/STORY_BUNDLER_PRODUCTION_READINESS_CHECKLIST.md` | 2026-04-16 |
| StoryCluster execution program | `docs/plans/STORYCLUSTER_INTEGRATION_EXECUTION_PLAN.md` | VHC Core Engineering | `docs/plans/STORYCLUSTER_IMPLEMENTATION_TICKET_STACK.md`, `docs/foundational/STATUS.md` | 2026-03-16 |
| StoryCluster implementation backlog | `docs/plans/STORYCLUSTER_IMPLEMENTATION_TICKET_STACK.md` | VHC Core Engineering | `docs/plans/STORYCLUSTER_INTEGRATION_EXECUTION_PLAN.md`, `docs/foundational/STATUS.md` | 2026-03-16 |
| News source admission, background scouting, source-health policy, and readable-source ops | `docs/ops/NEWS_SOURCE_ADMISSION_RUNBOOK.md` | VHC Ops + Core Engineering | `docs/specs/spec-news-aggregator-v0.md`, `docs/foundational/STATUS.md`, `docs/ops/LOCAL_LIVE_STACK_RUNBOOK.md` | 2026-03-20 |
| UI / UX lane separation, soak measurement boundaries, and retained-feed integration sequencing | `docs/ops/NEWS_UI_SOAK_LANE_SEPARATION.md` | VHC Core Engineering | `docs/foundational/STATUS.md`, `docs/ops/LOCAL_LIVE_STACK_RUNBOOK.md`, `docs/specs/spec-news-aggregator-v0.md` | 2026-03-23 |
| Story bundler production-readiness scorecard and gate thresholds | `docs/ops/STORY_BUNDLER_PRODUCTION_READINESS_CHECKLIST.md` | VHC Core Engineering | `docs/specs/spec-news-aggregator-v0.md`, `docs/foundational/STATUS.md`, `docs/ops/LOCAL_LIVE_STACK_RUNBOOK.md`, `docs/ops/NEWS_UI_SOAK_LANE_SEPARATION.md` | 2026-03-25 |
| Analysis and synthesis object contract | `docs/specs/topic-synthesis-v2.md` | VHC Spec Owners | `docs/foundational/AI_ENGINE_CONTRACT.md`, `docs/specs/canonical-analysis-v2.md`, `docs/specs/canonical-analysis-v1.md` | 2026-03-03 |
| Identity, trust, and constituency semantics | `docs/specs/spec-identity-trust-constituency.md` | VHC Spec Owners | `docs/foundational/LUMA_BriefWhitePaper.md`, `docs/foundational/System_Architecture.md` | 2026-03-03 |
| Civic sentiment and voting contract | `docs/specs/spec-civic-sentiment.md` | VHC Spec Owners | `docs/foundational/System_Architecture.md` | 2026-03-13 |
| News bundling, publication, and production-readiness contract | `docs/specs/spec-news-aggregator-v0.md` | VHC Spec Owners | `docs/specs/spec-topic-discovery-ranking-v0.md`, `docs/foundational/System_Architecture.md`, `docs/foundational/STATUS.md` | 2026-04-16 |
| Topic/news discovery and ranking | `docs/specs/spec-topic-discovery-ranking-v0.md` | VHC Spec Owners | `docs/specs/spec-news-aggregator-v0.md`, `docs/specs/spec-hermes-forum-v0.md`, `docs/specs/topic-synthesis-v2.md` | 2026-04-16 |
| HERMES Messaging | `docs/specs/spec-hermes-messaging-v0.md` | VHC Spec Owners | `docs/foundational/System_Architecture.md` | 2026-03-03 |
| HERMES Forum | `docs/specs/spec-hermes-forum-v0.md` | VHC Spec Owners | `docs/foundational/System_Architecture.md` | 2026-04-16 |
| HERMES Docs | `docs/specs/spec-hermes-docs-v0.md` | VHC Spec Owners | `docs/foundational/System_Architecture.md` | 2026-03-03 |
| Civic Action Kit | `docs/specs/spec-civic-action-kit-v0.md` | VHC Spec Owners | `docs/foundational/System_Architecture.md` | 2026-03-03 |
| Local manual + strict runtime ops | `docs/ops/LOCAL_LIVE_STACK_RUNBOOK.md` | VHC Ops | `docs/ops/AUTOMATION_STACK_RUNBOOK.md`, `docs/ops/NEWS_UI_SOAK_LANE_SEPARATION.md`, `docs/ops/STORY_BUNDLER_PRODUCTION_READINESS_CHECKLIST.md`, `docs/ops/NEWS_SOURCE_ADMISSION_RUNBOOK.md`, `docs/ops/BETA_SESSION_RUNSHEET.md`, `docs/ops/analysis-backend-3001.md` | 2026-04-16 |
| Persistent automation stack and validated feed snapshot through-line | `docs/ops/AUTOMATION_STACK_RUNBOOK.md` | VHC Ops + Core Engineering | `docs/ops/LOCAL_LIVE_STACK_RUNBOOK.md`, `docs/ops/NEWS_UI_SOAK_LANE_SEPARATION.md`, `docs/ops/STORY_BUNDLER_PRODUCTION_READINESS_CHECKLIST.md`, `docs/specs/spec-news-aggregator-v0.md` | 2026-04-16 |
| Beta-session operator procedure and pre-session feed readiness review | `docs/ops/BETA_SESSION_RUNSHEET.md` | VHC Ops | `docs/ops/LOCAL_LIVE_STACK_RUNBOOK.md`, `docs/foundational/STATUS.md` | 2026-03-20 |

## Update Rule

Any PR that changes foundational/spec/ops semantics must:

1. Update the authoritative owner doc.
2. Update this canon table if ownership or fallback routing changed.
3. Update `Last Review Date` for touched owner rows.
