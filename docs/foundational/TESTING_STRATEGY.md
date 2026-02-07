# Testing Strategy: Multi-User & Multi-Device

## Overview

VENN-HERMES is a decentralized, multi-user application with E2E encrypted messaging. Testing requires multiple strategies to cover:

1. **Correctness**: Do features work as specified?
2. **Isolation**: Do users have proper data separation?
3. **Sync**: Does data propagate correctly across the mesh?
4. **Security**: Is encryption actually protecting data?

## Typecheck Workflow Snapshot (Current)

- Repo-wide entry point: `pnpm typecheck` (Issue #11 complete).
- Coverage extension work completed in recent sprints:
  - Issue #15: extended typecheck coverage across remaining packages.
  - Issue #18: resolved web-pwa typecheck error backlog.
  - Issue #24: added `apps/web-pwa/tsconfig.test.json` for test-file typechecking (`pnpm --filter @vh/web-pwa typecheck:test`).
- ~~Issue #27~~ resolved: fresh-checkout `pnpm typecheck` works without prior build artifacts (PR #30, merged 2026-02-06).

---

## Test Layers

### Layer 1: Unit Tests (Vitest)
**Scope**: Pure functions, schemas, helpers  
**Execution**: Every commit, <1 second  

| Component | Tests |
|-----------|-------|
| `deriveChannelId` | Deterministic output, browser-safe |
| `computeThreadScore` | Decay math, edge cases |
| Zod schemas | Valid/invalid payloads |
| `encryptMessagePayload` | Round-trip with mock keys |

### Layer 2: Store Integration Tests (Vitest)
**Scope**: Zustand stores with mocked Gun adapters  
**Execution**: Every commit, <5 seconds  

| Store | Tests |
|-------|-------|
| `useChatStore` | sendMessage encrypts, writes 3 paths, deduplication |
| `useForumStore` | Trust gating, vote idempotency, score computation |
| `useXpLedger` | Caps enforced, monotonicity, persistence |

### Layer 3: Gun Adapter Integration Tests (Vitest)
**Scope**: Real Gun adapters against in-memory Gun instance  
**Execution**: Every commit, <10 seconds  

```typescript
// Example: Test that message paths are correct
// Note: Inbox uses devicePub (SEA pub key), not nullifier
test('getHermesInboxChain writes to correct path', async () => {
  const gun = Gun({ file: false, radix: false });
  const client = createClient({ gun });
  
  // devicePub is the recipient's SEA public key (ECDSA)
  const aliceDevicePub = 'iMbH2gPcDcxR...'; // truncated for example
  const chain = getHermesInboxChain(client, aliceDevicePub);
  await chain.get('msg-1').put({ __encrypted: true, content: '...' });
  
  // Verify path: vh/hermes/inbox/<devicePub>/<msgId>
  const data = await new Promise(resolve => {
    gun.get('vh').get('hermes').get('inbox').get(aliceDevicePub).get('msg-1').once(resolve);
  });
  expect(data.__encrypted).toBe(true);
});
```

### Layer 4: Single-User E2E (Playwright)
**Scope**: Full app, one user, mocked network  
**Execution**: Every commit, <30 seconds  
**Current**: ✅ Passing (tracer-bullet, full-flow)

### Layer 5: Multi-User E2E (Playwright + Isolated Contexts)
**Scope**: Two users, separate browser contexts, shared mock mesh  
**Execution**: PR/Merge, <5 seconds  
**Current**: ✅ Infrastructure complete, core tests passing

#### Key Insight: Why Isolated Contexts Matter

```
WRONG: context.newPage()
┌─────────────────────────────────────────┐
│           Shared Browser Context        │
│  ┌──────────┐       ┌──────────┐       │
│  │  Page A  │       │  Page B  │       │
│  │  (Alice) │       │  (Bob)   │       │
│  └────┬─────┘       └────┬─────┘       │
│       └───────┬──────────┘             │
│           Shared localStorage          │  ← NOT real multi-user!
└─────────────────────────────────────────┘

RIGHT: Separate browser contexts
┌──────────────────┐    ┌──────────────────┐
│  Context A       │    │  Context B       │
│  ┌──────────┐   │    │   ┌──────────┐   │
│  │  Page A  │   │    │   │  Page B  │   │
│  │  (Alice) │   │    │   │  (Bob)   │   │
│  └──────────┘   │    │   └──────────┘   │
│  localStorage A │    │   localStorage B │
└────────┬────────┘    └────────┬─────────┘
         │                      │
         └──────────┬───────────┘
                    │
              ┌─────┴─────┐
              │ Gun Relay │  ← Real sync point
              └───────────┘
```

### Layer 6: Cross-Device E2E (BrowserStack/Sauce Labs)
**Scope**: Real devices, real network conditions  
**Execution**: Nightly/Release, <10 minutes  
**Current**: 📋 Planned for Season 1

---

## Infrastructure Required

### For Multi-User E2E

1. **Test Gun Relay** (Docker)
   ```yaml
   # docker-compose.test.yml
   services:
     gun-relay:
       image: gundb/gun
       ports:
         - "9780:8765"
       command: ["--port", "8765"]
   ```

2. **Playwright Config Update**
   ```typescript
   // playwright.config.ts
   export default defineConfig({
     webServer: [
       {
         command: 'pnpm --filter @vh/web-pwa preview',
         port: 4173,
         reuseExistingServer: true,
       },
       {
         command: 'docker-compose -f docker-compose.test.yml up',
         port: 9780,
         reuseExistingServer: true,
       },
     ],
   });
   ```

3. **Environment Variables**
   ```bash
   # E2E with real relay (multi-user tests)
   VITE_E2E_MODE=false
   VITE_GUN_PEERS=["http://localhost:9780/gun"]
   
   # E2E with mock (single-user tests)  
   VITE_E2E_MODE=true
   ```

### Shared Mock Mesh (Implemented ✅)

The mock client uses Playwright's `exposeFunction` to share an in-memory mesh across isolated browser contexts:

```typescript
// packages/e2e/src/fixtures/multi-user.ts
const sharedMesh = new Map<string, Map<string, any>>();

// Exposed to each browser context:
await page.exposeFunction('__VH_MOCK_MESH_GET__', (scope: string) => sharedMesh.get(scope));
await page.exposeFunction('__VH_MOCK_MESH_PUT__', (scope, key, value) => sharedMesh.get(scope)?.set(key, value));

// apps/web-pwa/src/store/index.ts (mock client)
// Uses exposed functions when available, falls back to local Map for Vitest
```

**Benefits:**
- No external dependencies (Docker, Gun relay)
- True multi-user isolation (separate localStorage per context)
- Cross-context data sync via shared mesh
- Fast (<5 seconds for multi-user E2E suite)

---

## CI/CD Pipeline

```yaml
name: CI (excerpt)

on: [push, pull_request]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm build
      - run: pnpm typecheck

  test:
    runs-on: ubuntu-latest
    needs: quality
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:quick

  e2e:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @vh/e2e exec playwright install --with-deps
      - run: pnpm test:e2e
```

---

## What Needs Wiring for Multi-User Tests

### Completed (Sprint 3)

1. **[x] Wire mock message sync between contexts:**
   - ✅ Option A implemented: Shared mock mesh via Playwright `exposeFunction`
   - `packages/e2e/src/fixtures/multi-user.ts` provides `alice` and `bob` fixtures

2. **[x] Basic multi-user tests passing:**
   - ✅ Isolated contexts with separate identities
   - ✅ Shared mesh sync verification
   - ✅ Both users can access HERMES routes

3. **[x] Unique E2E identities:**
   - Each mock identity gets unique nullifier (`mock-nullifier-${randomToken()}`)

### Completed (Sprint 3)

1. **[x] Add `data-testid` attributes to HERMES UI components:**
   - `contact-qr`, `identity-key`, `contact-key-input`
   - `start-chat-btn`, `message-composer`, `send-message-btn`
   - `thread-title`, `thread-content`, `create-thread-btn`, `new-thread-btn`
   - `submit-thread-btn`, `comment-composer`, `vote-up-{id}`, `vote-down-{id}`

2. **[x] Implement HERMES-specific E2E test flows:**
   - Forum: create thread, trust gate verification
   - Messaging: Alice/Bob chat via shared mesh

### Season 1 (Post-Sprint 3)

1. **[ ] Docker compose for test infrastructure** (Option B: real Gun relay)
2. **[ ] BrowserStack integration for real device testing**
3. **[ ] Performance benchmarks (message latency, sync time)**
4. **[ ] Chaos testing (network partitions, relay failures)**

---

## Test Data IDs Checklist

| Component | Required `data-testid` |
|-----------|------------------------|
| ContactQR | `contact-qr` |
| Identity display | `identity-key` |
| ScanContact input | `contact-key-input` |
| Start chat button | `start-chat-btn` |
| Composer input | `message-composer` |
| Send button | `send-message-btn` |
| Message bubble | `message-{id}` |
| NewThreadForm title | `thread-title` |
| NewThreadForm content | `thread-content` |
| Create thread button | `create-thread-btn` |
| Thread card | `thread-{id}` |
| Comment composer | `comment-composer` |
| Vote buttons | `vote-up-{id}`, `vote-down-{id}` |

---

## Summary

| Test Type | Status | Blocks |
|-----------|--------|--------|
| Unit | ✅ Passing | None |
| Store Integration | ✅ Passing | None |
| Single-User E2E | ✅ 2 Passing | None |
| Multi-User E2E | ✅ 7 Passing | None |
| Cross-Device | 📋 Planned | BrowserStack setup |

**Sprint 3 Complete (Dec 3, 2025):**
- **9 E2E tests passing** (single + multi-user)
- Shared mock mesh infrastructure complete
- Multi-user isolation verified
- All HERMES components have `data-testid` attributes
- Forum and Messaging E2E flows implemented

**Next step**: Proceed to Sprint 4 (Agentic Foundation) or add BrowserStack for real cross-device testing.

