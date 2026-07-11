# Documentation Index

## Precedence Contract

When documents disagree, use this precedence order:

1. Product intent and season scope: `docs/foundational/trinity_project_brief.md`, `docs/foundational/TRINITY_Season0_SoT.md`
2. Normative behavior/data specs: `docs/specs/*.md`
3. Architecture contract: `docs/foundational/System_Architecture.md`
4. Implementation reality and drift: `docs/foundational/STATUS.md`
5. Operational runbooks: `docs/ops/*.md`
6. Reports, plans, and sprints (non-authoritative evidence/execution artifacts): `docs/reports/*.md`, `docs/plans/*.md`, `docs/sprints/**/*.md`

Clarification:
- For behavior/data contract conflicts, `docs/specs/*.md` wins over architecture prose.
- `STATUS.md` records current implementation state and drift; it does not redefine canonical behavior contracts.

Domain ownership for canonical docs is maintained in `docs/CANON_MAP.md`.

## Normative Language Policy

- Authoritative docs (`docs/foundational`, `docs/specs`, `docs/ops`) may define normative contract language.
- Non-authoritative docs (`docs/reports`, `docs/plans`, `docs/sprints`) must not declare themselves as a source of truth.
- Plans and sprint docs may reference canonical docs, but canonical behavior must be specified in owners from `docs/CANON_MAP.md`.

## Required Metadata (Authoritative Docs)

Every markdown file in `docs/foundational`, `docs/specs`, and `docs/ops` must include:

- `Status`
- `Owner`
- `Last Reviewed`
- `Depends On`

CI enforces this via docs governance checks.

## Directory Map

- `docs/foundational` — product intent, architecture, status, foundational contracts.
- `docs/specs` — normative protocol/data/behavior specs.
- `docs/ops` — local and operational runbooks.
- `docs/reports` — date/revision-bounded evidence; never present-tense authority.
- `docs/plans` — implementation plans and temporary analysis artifacts.
- `docs/sprints` — active and historical sprint execution records.
- `docs/archive` — explicitly historical snapshots retained for audit; never
  current implementation or execution authority.

## Core Entry Points

1. `docs/foundational/trinity_project_brief.md`
2. `docs/foundational/TRINITY_Season0_SoT.md`
3. `docs/foundational/System_Architecture.md`
4. `docs/foundational/STATUS.md`
5. `docs/CANON_MAP.md`
6. `docs/specs/topic-synthesis-v2.md`
7. `docs/specs/spec-news-aggregator-v0.md`
8. `docs/specs/spec-civic-sentiment.md`

## Start Here Now — Public Beta

For current public-beta work, read only this chain before following deeper
links:

1. `docs/foundational/STATUS.md` — current implementation and drift.
2. `docs/ops/public-beta-operational-state.md` — current live decision and next
   eligible gate.
3. `docs/ops/news-aggregator-production-service.md` — authoritative publisher
   procedure and abort/rollback rules.
4. `docs/ops/public-beta-launch-readiness-closeout.md` — stable release-evidence
   and claim boundary.
5. `docs/plans/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md` — active
   non-authoritative execution sequence.

Historical pre-attempt status, closeout, handoff, and checklist snapshots are
indexed at `docs/archive/public-beta-pre-recovery-2026-07-10/README.md`. They are
not current operational truth.

## Local Development and Operations

- `docs/ops/LOCAL_LIVE_STACK_RUNBOOK.md`
- `docs/ops/ANALYSIS_EVAL_ARTIFACTS.md`
- `docs/ops/analysis-backend-3001.md`
- `docs/ops/storycluster-production-service.md`
- `docs/ops/news-aggregator-production-service.md`
- `docs/ops/public-feed-freshness-monitor.md`
- `docs/ops/public-beta-image-deploy.md`
- `docs/ops/public-beta-compliance-minimums.md`
- `docs/feature-flags.md`

## Current Scope A Status Pointer

For the live public-news Scope A state, read:

- `docs/foundational/STATUS.md`
- `docs/ops/public-beta-operational-state.md`
- `docs/ops/news-aggregator-production-service.md`
- `docs/ops/public-feed-freshness-monitor.md`
- `docs/ops/public-beta-launch-readiness-closeout.md`

Dated reports remain valid only for their stated evidence windows. Do not infer
current service state from a historical launch, recovery, or stability report.
