# TEMP Docs Audit Reference (2026-03-03)

Status: temporary working reference for consolidation planning.
Branch: `coord/docs-vhc-prune-agent-cluster`
Intent: track observations and clarification needs without making canonical decisions yet.

## 1) Audit Scope and Method

Scope audited: entire `docs/` tree after agent-cluster/process purge.

Inventory audited:
- Total files: 54
- Folders: `foundational/`, `specs/`, `ops/`, `plans/`, `sprints/`, `sprints/archive/`

Method used:
1. Full file inventory and per-file metadata extraction (line counts, top headings).
2. Cross-reference scan for internal `docs/...` links.
3. Authority-marker scan (`canonical`, `deprecated`, `archived`, `historical`, `source of truth`, `authoritative`).
4. Open-work marker scan (`[ ]`, `deferred`, `pending`, `backlog`).
5. Targeted deep reads of core entry docs and operational docs.

No canonical ownership changes were made in this pass.

## 2) File Ledger (Complete)

| File | Lines | Category | Working Role (Observed) | Notes |
|---|---:|---|---|---|
| `docs/README.md` | 31 | top-level | index/config reference | - |
| `docs/feature-flags.md` | 50 | top-level | index/config reference | - |
| `docs/foundational/AI_ENGINE_CONTRACT.md` | 148 | foundational | architecture/contract/status | - |
| `docs/foundational/ARCHITECTURE_LOCK.md` | 61 | foundational | architecture/contract/status | - |
| `docs/foundational/CSP_HEADER_MIGRATION.md` | 159 | foundational | architecture/contract/status | - |
| `docs/foundational/FPD_PROD_WIRING_DELTA_CONTRACT.md` | 130 | foundational | architecture/contract/status | - |
| `docs/foundational/GWC_BriefWhitePaper.md` | 152 | foundational | architecture/contract/status | missing top-level H1 |
| `docs/foundational/Hero_Paths.md` | 469 | foundational | architecture/contract/status | - |
| `docs/foundational/LUMA_BriefWhitePaper.md` | 114 | foundational | architecture/contract/status | - |
| `docs/foundational/STATUS.md` | 463 | foundational | architecture/contract/status | - |
| `docs/foundational/System_Architecture.md` | 503 | foundational | architecture/contract/status | - |
| `docs/foundational/TESTING_STRATEGY.md` | 330 | foundational | architecture/contract/status | - |
| `docs/foundational/TRINITY_Season0_SoT.md` | 166 | foundational | architecture/contract/status | - |
| `docs/foundational/audit-report.md` | 13 | foundational | architecture/contract/status | - |
| `docs/foundational/dev-color-panel.md` | 131 | foundational | architecture/contract/status | - |
| `docs/foundational/notes/Manual Testing.md` | 148 | foundational | architecture/contract/status | missing top-level H1 |
| `docs/foundational/notes/Notes.md` | 10 | foundational | architecture/contract/status | missing top-level H1 |
| `docs/foundational/notes/bootstrapServerREADME.md` | 278 | foundational | architecture/contract/status | - |
| `docs/foundational/requirements-test-matrix.md` | 34 | foundational | architecture/contract/status | - |
| `docs/foundational/risks.md` | 10 | foundational | architecture/contract/status | marked historical/deprecated |
| `docs/foundational/trinity_project_brief.md` | 269 | foundational | architecture/contract/status | - |
| `docs/ops/BETA_SESSION_RUNSHEET.md` | 131 | ops | runbook/session operations | - |
| `docs/ops/LOCAL_LIVE_STACK_RUNBOOK.md` | 71 | ops | runbook/session operations | - |
| `docs/ops/analysis-backend-3001.md` | 60 | ops | runbook/session operations | - |
| `docs/plans/BETA_WIRING_IMPLEMENTATION_PLAN.md` | 178 | plan | implementation plan | - |
| `docs/plans/CANARY_ROLLBACK_PLAN.md` | 69 | plan | implementation plan | - |
| `docs/plans/NEWSFEED_PROD_WIRING_HARDENING_PLAN.md` | 169 | plan | implementation plan | - |
| `docs/specs/00-monorepo-structure.md` | 192 | spec | normative domain spec | - |
| `docs/specs/canonical-analysis-v1.md` | 48 | spec | normative domain spec | marked historical/deprecated |
| `docs/specs/canonical-analysis-v2.md` | 18 | spec | normative domain spec | - |
| `docs/specs/secure-storage-policy.md` | 61 | spec | normative domain spec | - |
| `docs/specs/spec-attestor-bridge-v0.md` | 46 | spec | normative domain spec | - |
| `docs/specs/spec-civic-action-kit-v0.md` | 594 | spec | normative domain spec | - |
| `docs/specs/spec-civic-sentiment.md` | 180 | spec | normative domain spec | - |
| `docs/specs/spec-data-topology-privacy-v0.md` | 90 | spec | normative domain spec | - |
| `docs/specs/spec-hermes-docs-v0.md` | 681 | spec | normative domain spec | - |
| `docs/specs/spec-hermes-forum-v0.md` | 503 | spec | normative domain spec | - |
| `docs/specs/spec-hermes-messaging-v0.md` | 392 | spec | normative domain spec | - |
| `docs/specs/spec-identity-trust-constituency.md` | 400 | spec | normative domain spec | - |
| `docs/specs/spec-linked-socials-v0.md` | 103 | spec | normative domain spec | - |
| `docs/specs/spec-news-aggregator-v0.md` | 103 | spec | normative domain spec | - |
| `docs/specs/spec-rvu-economics-v0.md` | 70 | spec | normative domain spec | - |
| `docs/specs/spec-topic-discovery-ranking-v0.md` | 140 | spec | normative domain spec | - |
| `docs/specs/spec-xp-ledger-v0.md` | 106 | spec | normative domain spec | - |
| `docs/specs/topic-synthesis-v2.md` | 178 | spec | normative domain spec | - |
| `docs/sprints/02-sprint-2-advanced-features.md` | 351 | sprint | implementation checklist | - |
| `docs/sprints/03-sprint-3-the-agora.md` | 1683 | sprint | implementation checklist | - |
| `docs/sprints/03.5-sprint-3.5-ui-refinement.md` | 106 | sprint | implementation checklist | - |
| `docs/sprints/04-sprint-agentic-foundation.md` | 55 | sprint | implementation checklist | - |
| `docs/sprints/05-sprint-the-bridge.md` | 620 | sprint | implementation checklist | - |
| `docs/sprints/MANUAL_TEST_CHECKLIST_SPRINT3.md` | 461 | sprint | implementation checklist | - |
| `docs/sprints/archive/00-sprint-0-foundation.md` | 174 | sprint-archive | historical implementation checklist | - |
| `docs/sprints/archive/01-sprint-1-core-bedrock.md` | 123 | sprint-archive | historical implementation checklist | - |
| `docs/sprints/archive/03.5-implementation-details.md` | 813 | sprint-archive | historical implementation checklist | marked historical/deprecated |

## 3) High-Confidence Discrepancies (Needs Clarification)

### P0 (blocks consolidation quality)

1. Broken internal references exist (9 paths)
- Missing link targets observed:
  - `docs/plans/FPD_OUTLINE_AND_DISPATCH_2026-02-19.md`
  - `docs/reports/FPD_CANARY_EVIDENCE_BUNDLE_2026-02-20.md`
  - `docs/reports/evidence/2026-02-21-canary-rerun/EVIDENCE_BUNDLE.md`
  - `docs/reports/evidence/2026-02-21-ce-mesh-persistence/EVIDENCE_BUNDLE.md`
  - `docs/TESTING_STRATEGY.md` (actual file is `docs/foundational/TESTING_STRATEGY.md`)
  - `docs/dev-color-panel.md` (actual file is `docs/foundational/dev-color-panel.md`)
  - `docs/risks.md` (actual file is `docs/foundational/risks.md`)
  - `docs/specs/docs/specs/spec-civic-sentiment.md` (malformed nested path)
  - `docs/specs/docs/specs/spec-data-topology-privacy-v0.md` (malformed nested path)

2. `docs/foundational/FPD_PROD_WIRING_DELTA_CONTRACT.md` still anchors to removed process/report artifacts
- References to deleted dispatch/report evidence files are present.
- This doc currently mixes policy intent with deleted process-era evidence links.

### P1 (high consolidation ambiguity)

3. Multiple docs assert overlapping authority for the same domains
- `trinity_project_brief.md`
- `TRINITY_Season0_SoT.md`
- `System_Architecture.md`
- `STATUS.md`
- Relevant domain specs under `docs/specs/`

Observed issue: authority boundaries are implied, not explicitly normalized into one precedence contract.

4. Non-archive sprint docs include both historical context and active checklists
- `docs/sprints/02-sprint-2-advanced-features.md`
- `docs/sprints/03-sprint-3-the-agora.md`
- `docs/sprints/03.5-sprint-3.5-ui-refinement.md`
- `docs/sprints/04-sprint-agentic-foundation.md`
- `docs/sprints/05-sprint-the-bridge.md`
- `docs/sprints/MANUAL_TEST_CHECKLIST_SPRINT3.md`

Observed issue: they contain many unchecked tasks and stale implementation sequencing while also being referenced by specs as canonical in places.

5. Canonical-analysis transition docs are split across three files
- `docs/specs/canonical-analysis-v1.md` (deprecated)
- `docs/specs/canonical-analysis-v2.md` (compat alias)
- `docs/specs/topic-synthesis-v2.md` (canonical target)

Observed issue: migration intent is clear, but entry-path for developers can still be ambiguous.

### P2 (cleanup/clarity quality)

6. Notes and legacy support docs have uneven structure
- Files missing H1:
  - `docs/foundational/GWC_BriefWhitePaper.md`
  - `docs/foundational/notes/Manual Testing.md`
  - `docs/foundational/notes/Notes.md`
- `docs/foundational/risks.md` is a deprecated stub that points elsewhere (likely okay, but should be explicitly classified in the future map).

## 4) Overlap Map (Observed, Not Decided)

### Domain: Product vision and “what we are building”
- `docs/foundational/trinity_project_brief.md`
- `docs/foundational/TRINITY_Season0_SoT.md`
- `docs/foundational/System_Architecture.md`
- `docs/foundational/STATUS.md`

Potential overlap: mission + product behavior + rollout state are spread across four docs.

### Domain: Analysis/synthesis contracts
- `docs/specs/topic-synthesis-v2.md` (claims canonical)
- `docs/specs/canonical-analysis-v2.md` (compat alias)
- `docs/specs/canonical-analysis-v1.md` (deprecated compatibility)
- `docs/foundational/AI_ENGINE_CONTRACT.md` (provider/prompt/runtime contract)
- `docs/specs/spec-civic-sentiment.md` (persistence clarifications touching analysis ids)

Potential overlap: model/output contract + synthesis object contract + persistence migration constraints.

### Domain: Identity/trust/delegation
- `docs/specs/spec-identity-trust-constituency.md`
- `docs/foundational/LUMA_BriefWhitePaper.md`
- `docs/foundational/System_Architecture.md`
- `docs/foundational/STATUS.md`

Potential overlap: normative thresholds vs architecture narrative vs implementation status.

### Domain: Messaging/forum/docs/bridge
- `docs/specs/spec-hermes-messaging-v0.md`
- `docs/specs/spec-hermes-forum-v0.md`
- `docs/specs/spec-hermes-docs-v0.md`
- `docs/specs/spec-civic-action-kit-v0.md`
- `docs/specs/spec-attestor-bridge-v0.md`
- sprint plans (`docs/sprints/*`) include implementation details and open tasks.

Potential overlap: norms in specs vs execution checklists in sprints.

## 5) Authority Overlap Recommendations (For Decision, Not Yet Applied)

These recommendations are intentionally decision-ready but not self-executing. They are designed to remove overlap by separating `normative`, `descriptive`, and `historical` roles.

1. Publish a one-page precedence contract in `docs/README.md`
- Proposed order: product intent (`trinity_project_brief` / Season SoT) -> architecture contract (`System_Architecture.md`) -> normative behavior (`docs/specs/*`) -> implementation truth (`STATUS.md`) -> runbooks (`docs/ops/*`) -> plans/sprints (historical/planning).
- Add required doc-header metadata (`Status`, `Owner`, `Last Reviewed`, `Depends On`) for every foundational/spec/ops doc.

2. Split each overlapping domain into explicit owner docs
- Product vision: one `intent` owner; one implementation-progress owner.
- Analysis/synthesis: one schema/behavior owner in specs; provider/runtime detail remains in `AI_ENGINE_CONTRACT.md`; migration notes point back to owners.
- Identity/trust: one thresholds/semantics owner in specs; architecture references it without duplicating values.
- Messaging/forum/docs/bridge: specs remain normative; sprint docs marked explicitly as non-authoritative execution logs.

3. Add a hard “normative language” rule
- Only canonical owners use `must`, `required`, `contract`, `source of truth`.
- Supporting docs must use `informative`, `example`, or `historical` language and link upstream for authoritative statements.

4. Mark historical vs active docs in-place
- Add a top-of-file banner for each sprint/archive file: `Historical Execution Record` or `Active Plan`.
- Remove silent ambiguity where archived docs are still phrased as active contracts.

5. Introduce a docs-consistency CI check
- Check internal link validity for `/docs/**`.
- Check banned authority phrases in non-authoritative docs.
- Check presence of required metadata header in authoritative docs.

6. Establish a single “canon map” artifact with ownership
- Maintain one lightweight table with: `Domain`, `Authoritative Doc`, `Owner`, `Fallback Doc`, `Last Review Date`.
- Update this map as part of any PR that changes foundational/spec semantics.

## 6) Candidate Canon Map (For Review, Not Final)

This is a working map for discussion only.

1. Entry and navigation
- Candidate: `docs/README.md`

2. Product north-star
- Candidates: `docs/foundational/trinity_project_brief.md`, `docs/foundational/TRINITY_Season0_SoT.md`

3. Architecture contract
- Candidate: `docs/foundational/System_Architecture.md`
- Supporting guardrails: `docs/foundational/ARCHITECTURE_LOCK.md`

4. Implementation truth / drift
- Candidate: `docs/foundational/STATUS.md`

5. Normative behavior specs
- Candidates: `docs/specs/*.md` (domain-specific)

6. Ops and runbooks
- Candidates: `docs/ops/LOCAL_LIVE_STACK_RUNBOOK.md`, `docs/ops/analysis-backend-3001.md`
- Session-specific ops: `docs/ops/BETA_SESSION_RUNSHEET.md` (clarify if retained)

7. Implementation planning and historical context
- Current plans: `docs/plans/*.md`
- Historical execution detail: `docs/sprints/*`, `docs/sprints/archive/*` (clarify authoritative status)

## 7) Clarification Questions for Collaborative Refinement

1. Should `FPD_PROD_WIRING_DELTA_CONTRACT.md` remain in canonical foundational docs, be migrated to historical/plans, or be removed?
2. Should sprint docs in `docs/sprints/` be treated as active implementation contracts or historical records (with explicit disclaimers)?
3. For day-to-day engineering, should `STATUS.md` remain a broad historical ledger, or be reduced to current-state-only with links to archival records?
4. Do we want one explicit precedence rule in `docs/README.md` (e.g., Specs > System Architecture > Status > Sprint docs) to eliminate authority ambiguity?
5. Should `BETA_SESSION_RUNSHEET.md` remain canonical ops guidance, or be folded into `LOCAL_LIVE_STACK_RUNBOOK.md`?

## 8) Suggested Next Consolidation Sequence (After Your Decisions)

1. Fix broken links and malformed paths.
2. Confirm authoritative precedence order in one place.
3. Reclassify sprint docs (active vs historical) and mark accordingly.
4. Reconcile overlapping foundational docs into clear role boundaries.
5. Produce final concise “docs canon map” with ownership and update rules.
