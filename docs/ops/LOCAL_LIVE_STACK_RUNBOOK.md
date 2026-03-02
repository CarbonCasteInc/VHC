# Local Live Stack Runbook (Canonical)

This runbook locks local manual testing to the same production-like wiring used by live headless gates.

## Purpose

Avoid drift between:
- manual browser validation
- live Playwright strict/smoke runs

All commands below use:
- local relay (`http://localhost:7777/gun`)
- local web app (`http://localhost:2048/`)
- `packages/e2e/.env.dev-small` profile
- analysis relay env (`ANALYSIS_RELAY_UPSTREAM_URL`, `ANALYSIS_RELAY_API_KEY`)

## Prerequisites

1. Export one of:
   - `ANALYSIS_RELAY_API_KEY`
   - `OPENAI_API_KEY` (used as fallback)
2. Node/pnpm installed.

## Canonical Commands

From repo root:

```bash
pnpm live:stack:up
```

Status check:

```bash
pnpm live:stack:status
```

Full regression smoke (vote semantics + 3-user convergence + strict matrix N=1):

```bash
pnpm live:smoke
```

Shutdown:

```bash
pnpm live:stack:down
```

## DoD Validation Checklist

Use this checklist during manual browser validation:

1. Feed loads with headlines visible.
2. Scrolling loads older headlines (infinite list behavior).
3. Pull-to-refresh / refresh button updates list.
4. Opening a previously analyzed story shows existing analysis.
5. Per-cell vote states are strictly tri-state per user: `+`, `-`, `none`.
6. Switching `+` to `-` removes prior state and applies new state.
7. Analysis persists across tabs/browsers.
8. Vote aggregates update and persist across users.

## Notes

- Logs:
  - web: `/tmp/vh-local-web.log`
  - relay: `/tmp/vh-local-relay.log`
- The launcher script is:
  - `tools/scripts/live-local-stack.sh`
- If you need a different profile:
  - `ENV_FILE=/path/to/.env pnpm live:stack:up`
