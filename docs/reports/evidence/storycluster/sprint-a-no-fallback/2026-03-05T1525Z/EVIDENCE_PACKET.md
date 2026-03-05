# Sprint A Evidence Packet — Production No-Fallback Validation (2026-03-05T1525Z)

- Date (UTC): 2026-03-05
- Branch: `coord/storycluster-sprint-a-prod-no-fallback`
- Head SHA (workspace): `1f4bb22bbc7dae42ccb71e375116d944cd18b46f`
- PR: `TBD` (no PR opened in this validation milestone)
- Milestone type: **Deterministic acceptance validation**

## Scope validated in this milestone

1. Production orchestrator hard-fail behavior (no missing endpoint, no fallback toggle in production mode).
2. Daemon startup hard-fail behavior on StoryCluster health red.
3. Daemon production runtime wiring with explicit no-fallback orchestrator settings.
4. Coverage gate audit against the run contract requirement (100% line/branch/function/statement for changed files).

## Exact validation commands (as executed)

1. `pnpm exec vitest run packages/ai-engine/src/__tests__/newsOrchestrator.production.test.ts packages/ai-engine/src/__tests__/newsOrchestrator.test.ts packages/ai-engine/src/newsRuntime.test.ts`
2. `pnpm --filter @vh/news-aggregator exec vitest run src/daemon.production.test.ts src/daemon.test.ts src/cluster.test.ts src/orchestrator.test.ts`
3. `pnpm --filter @vh/ai-engine typecheck && pnpm --filter @vh/news-aggregator typecheck`
4. `node tools/scripts/check-diff-coverage.mjs`
5. `pnpm exec vitest run packages/ai-engine/src/newsRuntime.test.ts packages/ai-engine/src/__tests__/newsOrchestrator.test.ts packages/ai-engine/src/__tests__/newsOrchestrator.production.test.ts --coverage --coverage.reporter=json-summary --coverage.reporter=text-summary --coverage.reportsDirectory=.coverage-sprint-a-ai --coverage.thresholds.lines=0 --coverage.thresholds.branches=0 --coverage.thresholds.functions=0 --coverage.thresholds.statements=0 --coverage.include=packages/ai-engine/src/newsOrchestrator.ts --coverage.include=packages/ai-engine/src/newsRuntime.ts`
6. `pnpm --dir services/news-aggregator exec vitest run src/daemon.production.test.ts src/daemon.test.ts src/cluster.test.ts src/orchestrator.test.ts --coverage --coverage.reporter=json-summary --coverage.reporter=text-summary --coverage.reportsDirectory=.coverage-sprint-a-prod --coverage.thresholds.lines=0 --coverage.thresholds.branches=0 --coverage.thresholds.functions=0 --coverage.thresholds.statements=0 --coverage.include=src/daemon.ts --coverage.include=src/daemonUtils.ts`
7. `pnpm --dir services/news-aggregator exec vitest run src/daemon.production.test.ts src/daemon.test.ts src/cluster.test.ts src/orchestrator.test.ts --coverage --coverage.reporter=text --coverage.reporter=text-summary --coverage.reportsDirectory=.coverage-sprint-a-prod --coverage.thresholds.lines=0 --coverage.thresholds.branches=0 --coverage.thresholds.functions=0 --coverage.thresholds.statements=0 --coverage.include=src/daemon.ts --coverage.include=src/daemonUtils.ts`
8. `pnpm --dir services/news-aggregator exec vitest run src/daemon.production.test.ts src/daemon.test.ts src/cluster.test.ts src/orchestrator.test.ts --coverage --coverage.reporter=lcovonly --coverage.reportsDirectory=.coverage-sprint-a-prod --coverage.thresholds.lines=0 --coverage.thresholds.branches=0 --coverage.thresholds.functions=0 --coverage.thresholds.statements=0 --coverage.include=src/daemon.ts --coverage.include=src/daemonUtils.ts`
9. `node - <<'NODE' ... (lcov parser) ... NODE`

## Deterministic artifact paths

- `docs/reports/evidence/storycluster/sprint-a-no-fallback/2026-03-05T1525Z/EVIDENCE_PACKET.md`
- `docs/reports/evidence/storycluster/sprint-a-no-fallback/2026-03-05T1525Z/test-command-1-ai-engine-production-vitest.txt`
- `docs/reports/evidence/storycluster/sprint-a-no-fallback/2026-03-05T1525Z/test-command-2-news-aggregator-production-vitest.txt`
- `docs/reports/evidence/storycluster/sprint-a-no-fallback/2026-03-05T1525Z/test-command-3-typecheck.txt`
- `docs/reports/evidence/storycluster/sprint-a-no-fallback/2026-03-05T1525Z/test-command-4-diff-coverage.txt`
- `docs/reports/evidence/storycluster/sprint-a-no-fallback/2026-03-05T1525Z/test-command-5-ai-engine-fullfile-coverage.txt`
- `docs/reports/evidence/storycluster/sprint-a-no-fallback/2026-03-05T1525Z/test-command-6-news-aggregator-fullfile-coverage.txt`
- `docs/reports/evidence/storycluster/sprint-a-no-fallback/2026-03-05T1525Z/test-command-7-news-aggregator-coverage-gap-map.txt`
- `docs/reports/evidence/storycluster/sprint-a-no-fallback/2026-03-05T1525Z/test-command-8-news-aggregator-uncovered-lines.txt`
- `docs/reports/evidence/storycluster/sprint-a-no-fallback/2026-03-05T1525Z/coverage-summary-ai-engine.json`
- `docs/reports/evidence/storycluster/sprint-a-no-fallback/2026-03-05T1525Z/coverage-summary-news-aggregator.json`

## Acceptance matrix (this milestone)

| Criterion | Status | Evidence |
|---|---|---|
| Production mode rejects missing StoryCluster endpoint | PASS | `newsOrchestrator.production.test.ts` (`requires remote endpoint in production mode`) |
| Production mode rejects heuristic fallback toggle | PASS | `newsOrchestrator.production.test.ts` (`rejects production mode fallback toggles`) |
| Production mode fails closed on remote clustering outage | PASS | `newsOrchestrator.production.test.ts` (`fails closed when remote clustering is unavailable`) |
| Daemon startup fails closed when StoryCluster health check is red | PASS | `daemon.production.test.ts` (`fails closed before daemon startup when StoryCluster health is red`) |
| Daemon startup wires no-fallback orchestrator settings | PASS | `daemon.production.test.ts` (`wires production no-fallback orchestrator settings on daemon startup`) |
| Typecheck (ai-engine + news-aggregator) | PASS | `test-command-3-typecheck.txt` |
| Diff-coverage gate | PASS | `test-command-4-diff-coverage.txt` (no eligible committed source diff vs merge-base) |
| Full-file 100% coverage for changed ai-engine files (`newsOrchestrator.ts`, `newsRuntime.ts`) | PASS | `coverage-summary-ai-engine.json` (100% lines/branches/functions/statements) |
| Full-file 100% coverage for changed news-aggregator files (`daemon.ts`, `daemonUtils.ts`) | **FAIL** | `coverage-summary-news-aggregator.json` + uncovered map (`test-command-8-news-aggregator-uncovered-lines.txt`) |

## Blocking gap (direct unblock evidence)

The run contract's full-file coverage requirement is currently blocked by these measured deficits:

- `src/daemon.ts`: lines/statements **82.82%**, functions **84.21%**, branches **81.25%**.
- `src/daemonUtils.ts`: lines/statements **85.40%**, functions **100%**, branches **76.40%**.

Exact uncovered line and branch-line sets are captured in:

- `docs/reports/evidence/storycluster/sprint-a-no-fallback/2026-03-05T1525Z/test-command-8-news-aggregator-uncovered-lines.txt`

This milestone therefore advanced deterministic validation, confirmed no-fallback behavior, and produced a precise branch/line gap map for the next unblock milestone.
