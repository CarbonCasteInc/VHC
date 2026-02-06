# Monorepo Structure — Target Architecture Specification

**Status:** Target architecture (aspirational; not a 1:1 snapshot of today’s repository tree)

**Source of Truth:** `docs/foundational/System_Architecture.md` Section 4 & 5

This document defines the desired end-state directory structure, dependency rules, infrastructure seams, and code organization standards for the VENN/HERMES monorepo.

## Current vs Target (as of 2026-02-06)

Use this section to avoid spec drift confusion:

| Area | Current (implemented now) | Target (this specification) |
|------|----------------------------|-----------------------------|
| Apps | `apps/web-pwa` is the only active app workspace | Add `apps/mobile` (Capacitor) and `apps/desktop` (Tauri) shells alongside web |
| Packages | Core packages exist (`types`, `crypto`, `crdt`, `data-model`, `gun-client`, `ai-engine`, `contracts`, `e2e`, `ui`) plus `identity-vault` and `zk-circuits` | Preserve strict package boundaries while expanding toward full architecture |
| Services | Limited service set (`attestation-verifier`, `bridge-stub`) | Full relay/turn/object-store/aggregation/certificate service mesh |
| Infra & tooling | `infra/docker`, `infra/relay`, and `tools/*` are present; some CLI/infrastructure pieces remain partial | Full `infra` + CLI orchestration model described below |

When this file and the current repo tree differ, treat this document as the **target plan**. For present-state truth, rely on `docs/foundational/STATUS.md` and the checked-in filesystem.

## 1. Workspace Layout

The repository is managed via `pnpm workspaces`.

```text
/
├── apps/                   # End-user applications (Entry points)
│   ├── web-pwa/            # Main React Application (Vite)
│   ├── mobile/             # Capacitor Shell (iOS/Android)
│   └── desktop/            # Tauri Shell (macOS/Windows/Linux)
│
├── packages/               # Shared libraries (Strictly scoped)
│   ├── types/              # Zod schemas & TS Interfaces (NO dependencies)
│   ├── crypto/             # E2EE primitives (Deps: types)
│   ├── crdt/               # Lamport, LWW, Vector Clocks (Deps: types)
│   ├── gun-client/         # The ONLY package allowed to touch 'gun'
│   ├── data-model/         # High-level Entities (Msg, Post) (Deps: crdt)
│   ├── ui/                 # Atomic Design Components (Deps: types)
│   ├── ai-engine/          # WebLLM Integration (The Nervous System)
│   ├── contracts/          # Hardhat/Foundry workspace (Deps: types)
│   └── e2e/                # Playwright Specs
│
├── services/               # Dockerized Microservices (Untrusted)
│   ├── bootstrap-relay/    # Initial peer discovery
│   ├── turn/               # CoTURN config
│   ├── object-store/       # MinIO config
│   ├── attestation-verifier/ # Hardware Attestation Verifier (Rust/WASM)
│   ├── gun-peer/           # Super-peer relay (no plaintext access)
│   ├── aggregator-headlines/ # Deterministic feed aggregation
│   ├── analysis-relay/     # Privacy-preserving analytics
│   └── ca/                 # Internal certificate authority bootstrap
│
├── infra/                  # Infrastructure as Code
│   ├── docker/             # Docker Compose stacks
│   ├── k8s/                # Kubernetes manifests
│   └── terraform/          # Cloud provisioning
│
├── config/                 # Shared runtime configuration
│   └── tsconfig.base.json  # Base TypeScript config
│
└── tools/                  # Developer Experience
    ├── scripts/            # Build/Deploy scripts
    └── vh/                 # The 'vh' CLI entry point
```

**Action Items**
- [ ] Root `pnpm-workspace.yaml` includes every workspace path shown above.
- [ ] `README` explains how `vh bootstrap up` wires `infra/docker` and `services/*`.
- [ ] LOC caps and module rules (Section 3) referenced from `CONTRIBUTING.md`.

## 2. Bootstrapping & Toolchain

### 2.1 Language & Runtime
- **TypeScript 5.x** with `strict`, `noImplicitAny`, and `noUncheckedIndexedAccess`.
- **Node.js 20 LTS** enforced via `.nvmrc` and CI containers.
- **pnpm** as the only package manager committed to lockfiles; running `npm`/`yarn` in CI fails the job.

### 2.2 Frontend Stack
- **Vite 5.x** bundler for every app.
- **React 18** + TanStack Router entry points per platform (`apps/web-pwa`, `apps/mobile`, `apps/desktop`).
- **State**: Zustand for transient UI state, TanStack Query for async flows, and `useVennStore` hooks that wrap `@venn-hermes/gun-client`.
- **Styling**: Tailwind (or CSS Modules) scoped per component to stay within 350 LOC / file.

### 2.3 Data + Crypto Foundations
- **CRDT Engine**: Implemented inside `packages/crdt` (Lamport clock utilities, LWW registers, CRDT Sets, HRW sentiment aggregation).
- **Crypto**: `packages/crypto` exposes X3DH, Double Ratchet, XChaCha20-Poly1305/AES-GCM primitives, using WebCrypto in browsers and `node:crypto` in tests.
- **Storage**: `packages/gun-client` provides encrypted IndexedDB adapters, hydration barriers, graph pruning, and the offline outbox.

### 2.4 Tooling & CLI
- **vh CLI** orchestrates secrets, Docker stack, dev servers, and CI wrappers:
    - `vh bootstrap init|up|check|join`
    - `vh dev`, `vh test:quick`
- **Scripts**: `pnpm test:quick`, `pnpm test:workflow`, and `pnpm test:e2e` are wired to the commands above.

## 3. Package Boundaries & Rules

### 3.1 Dependency Graph
Dependencies must flow **downwards**. Circular dependencies are strictly forbidden and will fail the build.

- **`packages/types`**: The leaf node. Must NOT import from any other workspace package.
- **`packages/crdt`**: Depends only on `types`.
- **`packages/crypto`**: Depends only on `types`.
- **`packages/data-model`**: Depends on `crdt` and `types`.
- **`packages/gun-client`**: Depends on `types`, `crypto`, `crdt`, and `data-model`.
- **`packages/ui`**: Pure UI components; cannot import `gun-client`, `data-model`, or Node APIs.
- **`packages/ai-engine`**: May depend on `types`, `data-model`, and `crypto` abstractions; never `gun`.
- **`packages/contracts`**: Hardhat/Foundry workspace that emits TypeChain bindings consumed by apps (`deps`: `types`).
- **`packages/e2e`**: Depends on built apps + CLI outputs, never on `src` modules directly.
- **`apps/*`**: Compose any `packages/*` respecting browser discipline.
- **`services/*`**: Consume packages via published build output; they never export runtime secrets back to packages.

### 3.2 The "250/350" Rule
- **Soft Cap**: 250 LOC (Warning)
- **Hard Cap**: 350 LOC (Error/Build Fail)
- **Exemptions**: `*.test.ts(x)`, `*.stories.tsx`, and pure type definition files.
- **Enforcement**: Custom ESLint rule or pre-commit hook; CI fails on violation (System Architecture §5.1).

### 3.3 Browser Discipline
- **`apps/*`** and **`packages/ui`** must be "Pure Web".
- **Forbidden**: Node.js built-ins (`fs`, `path`, `process`, `Buffer`).
- **Required**: Web Standards (`Blob`, `crypto.subtle`, `IndexedDB`).
- **Tooling**: ESLint rule + bundler alias throwing compilation errors if Node modules leak into browser bundles.

## 4. Security & Data Constraints

### 4.1 Zero-Trust Architecture
- Servers (relays, TURN, aggregators) are untrusted transport; they never hold decryption keys.
- `@venn-hermes/crypto` enforces forward secrecy (Double Ratchet) and signature verification.
- All services communicate over mutually-authenticated TLS (Traefik/ACME fronting Docker stack).

### 4.2 Local-First / Offline-First
- Client IndexedDB + CRDT data is the primary source of truth.
- Writes are queued in the outbox and replayed once online; conflicts are resolved using Lamport timestamps + LWW + CRDT sets.
- HRW (Highest Random Weight) actors perform sentiment aggregation deterministically, even if aggregators are unavailable.

## 5. Module Standards

### 5.1 Barrel Files (`index.ts`)
- `index.ts` files must ONLY contain exports. Implementation belongs in sibling modules.
- Barrels should re-export stable APIs (`types`, `hooks`, `components`) to keep import paths short and agent-friendly.

### 5.2 Hydration Barrier & Storage Rules
- `packages/gun-client` is the ONLY workspace allowed to import `gun`.
- Gun interactions must pass through a hydration barrier (read before write) and implement graph pruning to prevent memory bloat.
- Encrypted storage adapters live here; other modules must call the exported APIs rather than reaching into storage.

### 5.3 Service & App Boundaries
- Services interact with the monorepo via generated artifacts: Docker images, CLI bundles, or published packages.
- Apps never import from `services/*` or `infra/*`; they consume typed APIs exposed via packages.

## 6. Testing & Quality Gates

### 6.1 "200% Coverage" Strategy
- **Unit/Integration**: Vitest co-located with sources; every requirement receives positive + negative coverage.
- **E2E**: Playwright specs in `packages/e2e` include tracer-bullet flows (attestation → identity → Gun relay → WebLLM).
- **Security Tests**: Negative tests for crypto envelopes and attestation verification are mandatory.

### 6.2 CI/CD Enforcement
- GitHub Actions workflow (`.github/workflows/main.yml`) runs `pnpm test:quick`, lint, LOC enforcement, circular dependency checks (`madge`/`dpdm`), Lighthouse budgets, and bundle-size gating (PWA ≤ 1 MiB gz).
- `pnpm test:workflow` mirrors full CI locally via `act`.
- `vh test:quick` is the developer-friendly wrapper; CI still executes raw pnpm commands for transparency.

## 7. Infrastructure & Services

### 7.1 Home Server Stack (System Architecture §6.1)
Defined in `infra/docker/docker-compose.yml`:
- **Reverse Proxy + ACME** fronting every service.
- **bootstrap-relay** for initial peer discovery.
- **gun-peer** (inside `services/bootstrap-relay` or `services/gun-peer`) acting as the super-peer without decrypting payloads.
- **aggregator-headlines** and **analysis-relay** performing deterministic feed + analytics without plaintext access.
- **coturn** providing TURN services (rate limited).
- **minio** object store for encrypted attachments.
- **ca** issuing internal certificates.

### 7.2 vh CLI Integration
- `vh bootstrap init` generates secrets for MinIO, TURN, JWT, and TLS CA.
- `vh bootstrap up` orchestrates Docker Compose services (reverse proxy, relays, TURN, MinIO, aggregators).
- `vh bootstrap check` validates HTTPS, WebSocket, TURN, and MinIO health.
- `vh dev` runs the Docker stack plus the PWA for local development.

### 7.3 Configuration & Secrets
- Shared TypeScript configs live in `/config/` and are symlinked or referenced by each package.
- Environment-specific values stay inside `config/*.env.example` and are consumed exclusively through the CLI.
- Secrets are never committed; `vh bootstrap init` writes them to `.env.local` files ignored by git.

## 8. Milestone Alignment
- **Milestone A (Home Server Bring-Up):** Satisfied when `vh bootstrap check` passes and Docker stack mirrors §7.1.
- **Milestone B (Communication Vertical):** Requires `packages/gun-client`, `packages/crypto`, and `apps/web-pwa` scaffolds to exchange encrypted DMs online/offline.
- **Milestone C (Headlines/Sentiment):** Builds upon `services/aggregator-headlines` and HRW logic in `packages/crdt`.
- **Milestone F (Hardening):** Enforced by CI gates, LOC caps, Lighthouse budgets, and documented risk mitigations (Lamport overflow, TURN costs, AI drift).
