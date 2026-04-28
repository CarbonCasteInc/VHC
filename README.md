# TRINITY / VENN-HERMES Monorepo

This monorepo contains the Guardian Node stack, client applications, shared packages, and infrastructure for the TRINITY Bio-Economic OS. See `docs/foundational/System_Architecture.md` for the single source of truth.

Smoke: agent loop verified 2026-02-05
Smoke v2: agent loop verified 2026-02-05

## Quickstart (Guardian Node)

```bash
# 1) Install pnpm & Node 20 (via corepack)
# 2) Clone repo and cd into it

# Generate secrets
pnpm vh bootstrap init --force

# Start stack (Traefik, MinIO, relay, TURN, Anvil, attestation verifier)
pnpm vh bootstrap up

# Run the PWA in dev mode (stack should be up)
pnpm vh dev
```

Services exposed (default localhost):
- Traefik: http://localhost:8080 (dashboard: 8081)
- MinIO: http://localhost:9001
- TURN: 3478/udp,tcp
- Anvil: http://localhost:8545

## Remote manual testing (PWA)
- WebCrypto requires a secure context; using a raw IP over HTTP can blank the app. For remote browsers, tunnel to localhost or use HTTPS.
- Canonical bundled-headlines helper: `pnpm live:stack:up` (fixture-backed StoryCluster + relay + daemon + web on `http://127.0.0.1:2048/`). Stop with `pnpm live:stack:down`.
- Public/admitted-source variant: `pnpm live:stack:up:public`.
- Deterministic analysis/full-product engagement variant: `pnpm live:stack:up:analysis-stub`, then `pnpm test:live:five-user-engagement`.
- Compatibility wrapper: `./tools/scripts/manual-dev.sh up` now delegates to the same canonical local stack path.
- Remote tunnel example (from your laptop): `ssh -L 2048:localhost:2048 <user>@<server-ip>` then open `http://localhost:2048`.
- If you prefer direct IP, trust a cert and use HTTPS (self-signed or via Traefik); otherwise stay on localhost via tunnel to avoid secure-context issues.
- Clear stale SW/cache in your browser if the UI looks blank after switching hosts.

## Documentation
- Documentation index: `docs/README.md`
- System architecture: `docs/foundational/System_Architecture.md`
- Sprint 0 checklist: `docs/sprints/archive/00-sprint-0-foundation.md`
- Architecture lock: `docs/foundational/ARCHITECTURE_LOCK.md`

## Contributing
See `CONTRIBUTING.md` for guardrails (200% coverage, 350 LOC cap) and workflow expectations.
