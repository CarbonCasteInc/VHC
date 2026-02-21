# ACTIVE TASK PACKET

Last updated: 2026-02-21
Status: Mesh persistence remediation ready for PR publication + CE dual-review
Owner: Lou + main/coord

## Task ID
FPD-CE-MESH-PERSISTENCE-REMEDIATION-CLOSEOUT

## Objective
Close AC1-AC5 mesh-persistence remediation with auditable PR artifacts and CE dual-review convergence, while KPI burn-in continues in background for separate Phase 2 model-switch gating.

## Source of truth
- `docs/foundational/FPD_PROD_WIRING_DELTA_CONTRACT.md`
- `docs/specs/spec-civic-sentiment.md`
- `docs/reports/evidence/2026-02-21-ce-mesh-persistence/EVIDENCE_BUNDLE.md`

## Reporting contract
Use: `state now / done / next / blockers / artifacts`

## Execution packet

### state now
- Branch: `coord/ce-mesh-persistence-remediation`.
- Remediation code + tests are local and validation is green.
- Evidence bundle exists under `docs/reports/evidence/2026-02-21-ce-mesh-persistence/`.
- PR is not yet opened for this branch.
- KPI telemetry burn-in remains active in background (`/home/humble/openclaw/memory/cluster-kpi/`).

### done
1. Implemented mesh/sentiment/analysis persistence fixes across web-pwa + gun-client + ai-engine.
2. Added analysis telemetry utility + tests.
3. Removed known full-suite flake by making the news-aggregator server default-options test use ephemeral port binding.
4. Produced remediation evidence bundle with validation logs.

### next
1. Finalize docs parity updates in foundational/spec/task packet.
2. Commit + push `coord/ce-mesh-persistence-remediation`.
3. Open PR to `main` with evidence references.
4. Run CE-Codex + CE-Opus dual review on PR head and record verdict convergence.
5. Keep KPI burn-in running; do not conflate burn-in hold with remediation PR publication.

### blockers
- No technical red blockers for remediation PR publication.
- Governance blocker for Phase 2 model-switch remains separate (telemetry burn-in + dual CE convergence).

### artifacts
- `docs/reports/evidence/2026-02-21-ce-mesh-persistence/EVIDENCE_BUNDLE.md`
- `docs/reports/evidence/2026-02-21-ce-mesh-persistence/pnpm-test.log`
- `docs/reports/evidence/2026-02-21-ce-mesh-persistence/typecheck.log`
- `docs/reports/evidence/2026-02-21-ce-mesh-persistence/lint.log`
- `docs/reports/evidence/2026-02-21-ce-mesh-persistence/vitest-slices.log`
