# Architecture Lock

This document summarizes the non-negotiable guardrails for the TRINITY Bio-Economic OS.

## 1. Core Principles
- **Zero-Trust**: Authenticate every request. Secrets never leave the device. Services are hostile by default.
- **Local-First**: Data is authored/stored locally. Cloud is a relay. Offline operation is mandatory.
- **350 LOC Limit**: Hard cap per source file (tests/types exempt). Enforce via CI. Split modules aggressively.

## 1.1 Agentic Guardrails (Confusable Deputies by Default)
- **Prompt Injection is First-Class**: Any agent that reads untrusted content is a confusable deputy; treat content as hostile by default.
- **Deny-by-Default Tools**: No shell/file write/network/signing unless explicitly scoped by a `DelegationGrant`.
- **Sandbox “Skills”**: Treat third-party skills as untrusted code; marketplaces are supply-chain risk.
- **Short-Lived Tokens**: Use scoped, expiring grants; never pass raw tokens to upstream tools.
- **Human-in-the-Loop for High Impact**: Votes, funding, civic actions require explicit human approval (OWASP “Excessive Agency”).

## 2. CI/CD & Tooling Guardrails

### 2.1 Dependency & Type Hygiene
- **Single Source of Truth**: `package.json` defines `packageManager`. CI uses `pnpm/action-setup` (no version arg).
- **Type Isolation**:
    - **Pinning**: Root `package.json` must use `pnpm.overrides` to force a single version of `@types/node` and other conflicting globals.
    - **Leaf Isolation**: Pure data/logic packages (`types`, `crdt`) must strictly limit global types in `tsconfig.json` (e.g., `"types": []` or `"types": ["node"]`) to prevent pollution from test runners.
- **Lockstep Updates**: Adding or changing workspace packages requires regenerating `pnpm-lock.yaml` with `pnpm install`; choose published versions only. CI uses `--frozen-lockfile` and will fail otherwise.
- **Typecheck Entry Point**: Repo-wide typechecking runs via root `pnpm typecheck` (workspace orchestrated).

### 2.2 Testing Discipline - 100% Line/Branch coverage required
- **Source-Based Testing**: Unit tests (`test:quick`) run against `src/`, not `dist/`.
    - *Impl*: `vitest.config.ts` aliases `@vh/*` -> `./packages/*/src`.
- **Segmentation**: Unit (Vitest) and E2E (Playwright) never overlap.
    - *Impl*: Vitest excludes `packages/e2e`. Playwright runs separately against a built preview.
- **True Offline Mode (The Short-Circuit)**:
    - **Rule**: E2E tests must not just "configure" network down; they must **bypass initialization** of heavy I/O subsystems entirely.
    - *Impl*: App State must detect `VITE_E2E_MODE` and inject **Full Mocks** (not just empty configs) for Gun, WebLLM, Auth, and Familiar orchestration. No WebSocket or WASM initialization allowed in Playwright.
- **Runtime Compatibility**:
    - **Rule**: Legacy libs accessing `process` or `global` must be stubbed at the Bundler level, not the Code level.
    - *Impl*: `vite.config.ts` uses `define: { 'process.env': {}, global: 'window' }` to satisfy strict browser environments without polyfilling Node core.

### 2.3 Build Hygiene
- **Strict Exclusion**: Production builds (`tsc`) must exclude test files, while test files have their own explicit typecheck path.
    - *Impl*: `apps/web-pwa/tsconfig.json` excludes `src/**/*.test.ts(x)` and `apps/web-pwa/tsconfig.test.json` handles test-file typechecking (`vitest/globals`).
- **Browser-Safe Dependencies**: Packages consumed by the web app must avoid Node core modules (e.g., `crypto`, `node:` imports) and expose browser-safe entrypoints. Use pure JS implementations for hashing/utility functions or ship explicit browser bundles to prevent bundler externalization errors.
- **Bundle Budget**:
    - **Initial Load**: Critical-path bundles must be < **1 MiB gzip**.
    - **Lazy AI/WASM Assets**: Allowed up to **10 MiB gzip** if **lazy-loaded** and **cached by the Service Worker** to avoid re-downloads. Initial route render must not block on these assets.

### 2.4 Content Security Policy (CSP)
- **Enforcement Required**: All HTML entry points must include a Content-Security-Policy. Currently delivered via `<meta>` tag; will migrate to HTTP header when server/CDN control is available.
- **No Inline Scripts**: `script-src` must never include `'unsafe-inline'` or `'unsafe-eval'`. All scripts must be first-party (`'self'`).
- **Object Embedding Blocked**: `object-src 'none'` is mandatory.
- **Style Exception**: `'unsafe-inline'` is permitted for `style-src` only because Tailwind utility-class injection and framework-generated inline styles require it. When build tooling supports style hashes or nonces, remove this exception.
- **Meta-Tag Limitations Accepted**: The current meta-tag CSP cannot enforce `frame-ancestors`, `report-to`, or `sandbox`. These limitations are documented in `docs/foundational/CSP_HEADER_MIGRATION.md` and accepted until HTTP header delivery is available.
- **Migration Path**: See `docs/foundational/CSP_HEADER_MIGRATION.md` for the phased migration plan.

## 3. Local Dev Networking Guardrails
- **Gun peers must be reachable without SSH gymnastics**:
  - Default `VITE_GUN_PEERS` points to the Tailscale-accessible relay (`http://100.75.18.26:7777/gun`) with a localhost fallback.
  - Avoid relying on ad-hoc SSH tunnels for routine dev; configure peers via env instead.
- **Verifier fallbacks must be fast**:
  - `VITE_ATTESTATION_TIMEOUT_MS` defaults to a short timeout (2s) in dev; on timeout, the mock verifier is used.
  - Long “Creating…” spinners are not acceptable; timeouts must be configurable and short in non-prod.
