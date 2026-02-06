# Phase 4 Security Audit (Sprint 1)

## Zero-Trust / Secrets
- Client bundle contains no private keys or mnemonic strings; wallet logic relies on runtime-injected providers/addresses (`useWallet`), and E2E mode uses deterministic mocks only.
- Identity creation enforces attestation integrity and rejects low-trust sessions (`useIdentity`: throws when `trustScore < 0.5`).

## Local-First Mesh
- E2E/client mesh writes are confined to local storage or the in-memory mock Gun chain (`createMockClient.mesh`), avoiding unencrypted writes to remote peers in tests.
- Production Gun client still requires sessions and writes via authenticated namespaces (`createClient` with `requireSession: true`).

## Build Hygiene
- Browser-only dependency rule enforced (`ARCHITECTURE_LOCK`): hashing uses browser-safe utilities; no `node:` imports in web bundles.
- Bundle inputs validated via `pnpm build` and coverage gates; tests run against `src/` code paths only.
