# TRINITY / VENN-HERMES Monorepo

This monorepo contains the Guardian Node stack, client applications, shared packages, and infrastructure for the TRINITY Bio-Economic OS. See `System_Architecture.md` (root) for the single source of truth.

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
- One-shot helper: `./tools/scripts/manual-dev.sh up` (starts stack via `pnpm vh bootstrap up`, then PWA dev on 0.0.0.0:2048, logs at `/tmp/vh-pwa-dev.log`). Stop with `./tools/scripts/manual-dev.sh down` (stack left running).
- Remote tunnel example (from your laptop): `ssh -L 2048:localhost:2048 <user>@<server-ip>` then open `http://localhost:2048`.
- If you prefer direct IP, trust a cert and use HTTPS (self-signed or via Traefik); otherwise stay on localhost via tunnel to avoid secure-context issues.
- Clear stale SW/cache in your browser if the UI looks blank after switching hosts.

## Documentation
- System architecture: `System_Architecture.md`
- Sprint 0 checklist: `docs/00-sprint-0-foundation.md`
- Architecture lock: `docs/ARCHITECTURE_LOCK.md`

## Contributing
See `CONTRIBUTING.md` for guardrails (200% coverage, 350 LOC cap) and workflow expectations.
