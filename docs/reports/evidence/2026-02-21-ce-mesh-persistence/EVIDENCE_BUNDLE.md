# CE Mesh Persistence Remediation — Evidence Bundle

Date: 2026-02-21
Branch: `coord/ce-mesh-persistence-remediation`
Worktree: `/srv/trinity/worktrees/coordinator`

## Objective
Close remaining test blockers, preserve remediation quality gates, and produce auditable proof for merge-readiness.

## Implemented closure fixes in this pass

1. **secure-storage audit path resolution hardening**
   - File: `apps/web-pwa/src/secure-storage-audit.test.ts`
   - Change: replaced `process.cwd()` root derivation with stable file-based root derivation:
     - `dirname(fileURLToPath(import.meta.url))`
     - `resolve(TEST_FILE_DIR, '../../..')`
   - Result: audit test now resolves monorepo paths correctly regardless of runner cwd (including `packages/identity-vault` context).

2. **Workspace test script alignment for CRDT package**
   - File: `packages/crdt/package.json`
   - Change: `test` script switched from `vitest run` to
     `vitest run --config ../../vitest.config.ts --dir ../../`
   - Result: avoids package-local include mismatch when running recursive workspace tests.

3. **news-aggregator test flake removal under active :3001 runtime**
   - File: `services/news-aggregator/src/__tests__/server.test.ts`
   - Change: default-host/service test now binds with `port: 0` and asserts host + allocated port, rather than hard-binding default `3001`.
   - Result: eliminates `EADDRINUSE 127.0.0.1:3001` failure when analysis service is active.

## Validation results

### A) Targeted monorepo vitest slice (identity-vault runner context)
- Command: `pnpm test` (from `packages/identity-vault`)
- Result: **PASS**
  - `Test Files 234 passed (234)`
  - `Tests 3393 passed (3393)`
- Evidence: `vitest-slices.log`

### B) Full workspace test
- Command: `pnpm test` (repo root)
- Result: **PASS** (exit code 0)
- Evidence: `pnpm-test.log`

### C) Typecheck
- Command: `pnpm typecheck`
- Result: **PASS**
- Evidence: `typecheck.log`

### D) Lint
- Command: `pnpm lint`
- Result: **PASS**
- Evidence: `lint.log`

## Artifact index
- `docs/reports/evidence/2026-02-21-ce-mesh-persistence/vitest-slices.log`
- `docs/reports/evidence/2026-02-21-ce-mesh-persistence/pnpm-test.log`
- `docs/reports/evidence/2026-02-21-ce-mesh-persistence/typecheck.log`
- `docs/reports/evidence/2026-02-21-ce-mesh-persistence/lint.log`
- `docs/reports/evidence/2026-02-21-ce-mesh-persistence/EVIDENCE_BUNDLE.md` (this file)

## Gate status
- `pnpm test`: ✅
- `pnpm typecheck`: ✅
- `pnpm lint`: ✅
- Evidence bundle complete: ✅
