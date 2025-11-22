# Architecture Lock

This document summarizes the non-negotiable guardrails for the TRINITY Bio-Economic OS.

## 1. Core Principles
- **Zero-Trust**: Authenticate every request. Secrets never leave the device. Services are hostile by default.
- **Local-First**: Data is authored/stored locally. Cloud is a relay. Offline operation is mandatory.
- **350 LOC Limit**: Hard cap per source file (tests/types exempt). Enforce via CI. Split modules aggressively.

## 2. CI/CD & Tooling Guardrails

### 2.1 Dependency Management
- **Single Source of Truth**: `package.json` defines `packageManager`. CI uses `pnpm/action-setup` (no version arg).

### 2.2 Testing Discipline
- **Source-Based Testing**: Unit tests (`test:quick`) run against `src/`, not `dist/`.
    - *Impl*: `vitest.config.ts` aliases `@vh/*` -> `./packages/*/src`.
    - *Impl*: Internal packages export `src/index.ts` for dev tools.
- **Segmentation**: Unit (Vitest) and E2E (Playwright) never overlap.
    - *Impl*: Vitest excludes `packages/e2e`. Playwright runs separately.
- **E2E Lazy Loading**: Heavy dependencies (e.g., WebLLM) must be lazy-loaded and mocked in E2E.
    - *Impl*: Check `VITE_E2E_MODE` to swap real workers for lightweight mocks.

### 2.3 Build Hygiene
- **Strict Exclusion**: Production builds (`tsc`) must exclude test files.
    - *Impl*: `tsconfig.json` excludes `src/**/*.test.ts`.
