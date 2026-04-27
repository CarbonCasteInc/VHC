# Documentation Index

## Precedence Contract

When documents disagree, use this precedence order:

1. Product intent and season scope: `docs/foundational/trinity_project_brief.md`, `docs/foundational/TRINITY_Season0_SoT.md`
2. Normative behavior/data specs: `docs/specs/*.md`
3. Architecture contract: `docs/foundational/System_Architecture.md`
4. Implementation reality and drift: `docs/foundational/STATUS.md`
5. Operational runbooks: `docs/ops/*.md`
6. Plans and sprints (non-authoritative execution artifacts): `docs/plans/*.md`, `docs/sprints/**/*.md`

Clarification:
- For behavior/data contract conflicts, `docs/specs/*.md` wins over architecture prose.
- `STATUS.md` records current implementation state and drift; it does not redefine canonical behavior contracts.

Domain ownership for canonical docs is maintained in `docs/CANON_MAP.md`.

## Normative Language Policy

- Authoritative docs (`docs/foundational`, `docs/specs`, `docs/ops`) may define normative contract language.
- Non-authoritative docs (`docs/plans`, `docs/sprints`) must not declare themselves as a source of truth.
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
- `docs/plans` — implementation plans and temporary analysis artifacts.
- `docs/sprints` — active and historical sprint execution records.

## Core Entry Points

1. `docs/foundational/trinity_project_brief.md`
2. `docs/foundational/TRINITY_Season0_SoT.md`
3. `docs/foundational/System_Architecture.md`
4. `docs/foundational/STATUS.md`
5. `docs/CANON_MAP.md`
6. `docs/specs/topic-synthesis-v2.md`
7. `docs/specs/spec-civic-sentiment.md`

## Local Development and Operations

- `docs/ops/LOCAL_LIVE_STACK_RUNBOOK.md`
- `docs/ops/analysis-backend-3001.md`
- `docs/ops/public-beta-compliance-minimums.md`
- `docs/feature-flags.md`
