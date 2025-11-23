# Architecture Lock

This document summarizes the non-negotiable guardrails for the TRINITY Bio-Economic OS.

## 1. Core Principles
- **Zero-Trust**: Authenticate every request. Secrets never leave the device. Services are hostile by default.
- **Local-First**: Data is authored/stored locally. Cloud is a relay. Offline operation is mandatory.
- **350 LOC Limit**: Hard cap per source file (tests/types exempt). Enforce via CI. Split modules aggressively.

## 2. CI/CD & Tooling Guardrails

### 2.1 Dependency & Type Hygiene
- **Single Source of Truth**: `package.json` defines `packageManager`. CI uses `pnpm/action-setup` (no version arg).
- **Type Isolation**:
    - **Pinning**: Root `package.json` must use `pnpm.overrides` to force a single version of `@types/node` and other conflicting globals.
    - **Leaf Isolation**: Pure data/logic packages (`types`, `crdt`) must strictly limit global types in `tsconfig.json` (e.g., `"types": []` or `"types": ["node"]`) to prevent pollution from test runners.
- **Lockstep Updates**: Adding or changing workspace packages requires regenerating `pnpm-lock.yaml` with `pnpm install`; choose published versions only. CI uses `--frozen-lockfile` and will fail otherwise.

### 2.2 Testing Discipline
- **Source-Based Testing**: Unit tests (`test:quick`) run against `src/`, not `dist/`.
    - *Impl*: `vitest.config.ts` aliases `@vh/*` -> `./packages/*/src`.
- **Segmentation**: Unit (Vitest) and E2E (Playwright) never overlap.
    - *Impl*: Vitest excludes `packages/e2e`. Playwright runs separately against a built preview.
- **True Offline Mode (The Short-Circuit)**:
    - **Rule**: E2E tests must not just "configure" network down; they must **bypass initialization** of heavy I/O subsystems entirely.
    - *Impl*: App State must detect `VITE_E2E_MODE` and inject **Full Mocks** (not just empty configs) for Gun, WebLLM, and Auth. No WebSocket or WASM initialization allowed in Playwright.
- **Runtime Compatibility**:
    - **Rule**: Legacy libs accessing `process` or `global` must be stubbed at the Bundler level, not the Code level.
    - *Impl*: `vite.config.ts` uses `define: { 'process.env': {}, global: 'window' }` to satisfy strict browser environments without polyfilling Node core.

### 2.3 Build Hygiene
- **Strict Exclusion**: Production builds (`tsc`) must exclude test files.
    - *Impl*: `tsconfig.json` excludes `src/**/*.test.ts`.
- **Browser-Safe Dependencies**: Packages consumed by the web app must avoid Node core modules (e.g., `crypto`, `node:` imports) and expose browser-safe entrypoints. Use pure JS implementations for hashing/utility functions or ship explicit browser bundles to prevent bundler externalization errors.
- **Bundle Budget**:
    - **Initial Load**: Critical-path bundles must be < **1 MiB gzip**.
    - **Lazy AI/WASM Assets**: Allowed up to **10 MiB gzip** if **lazy-loaded** and **cached by the Service Worker** to avoid re-downloads. Initial route render must not block on these assets.
