# Local Live Stack Runbook (Canonical)

> Status: Operational Runbook (Canonical)
> Owner: VHC Ops
> Last Reviewed: 2026-03-03
> Depends On: docs/foundational/STATUS.md, docs/CANON_MAP.md


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

1. Before merge/release, run `pnpm test:storycluster:gates` from repo root and require a clean pass.
2. Feed loads with headlines visible.
3. Scrolling loads older headlines (infinite list behavior).
4. Pull-to-refresh / refresh button updates list.
5. Opening a previously analyzed story shows existing analysis.
6. Per-cell vote states are strictly tri-state per user: `+`, `-`, `none`.
7. Switching `+` to `-` removes prior state and applies new state.
8. Analysis persists across tabs/browsers.
9. Vote aggregates update and persist across users.
10. Opening storyline focus from the feed writes `?storyline=<id>` into route state and survives reload.
11. Route-driven storyline focus shows a clear action only.
12. Feed-opened storyline focus shows explicit `Back` and `Clear storyline` actions, and `Back` returns to the prior route state.

## Release Gate Wiring

Current release-gate split for StoryCluster and feed correctness:

1. Blocking pre-merge / pre-release gate:
   - `pnpm test:storycluster:gates`
2. The blocking gate is sequential and fixture-backed:
   - `pnpm --filter @vh/e2e test:live:daemon-feed:integrity-gate`
   - `pnpm --filter @vh/e2e test:live:daemon-feed:semantic-gate`
3. These gates still exercise the production stack shape:
   - daemon
   - relay
   - StoryCluster
   - web app
4. Public semantic validation remains non-blocking smoke:
   - `pnpm test:storycluster:smoke`
5. Public smoke failures caused by insufficient auditable live bundles do not block merge/release by themselves; they must still be reviewed as evidence artifacts.
6. If CI does not run the live daemon-first gates in a fully provisioned environment, the merge/release owner must run the blocking gate manually and retain the artifacts.

### StoryCluster Replay Evidence Interpretation

When reviewing StoryCluster release evidence:

1. Read `replay_continuity.continuous` as the uninterrupted identity signal.
2. Read `replay_continuity.reappearance` as the gap-return identity signal.
3. Read `replay_topology_pressure` separately:
   - it reports replay scenarios that exercised merge/split lineage
   - it is the topology-repair pressure signal, not a substitute for semantic precision
4. Do not treat low aggregate `persistence_rate` as a failure by itself if the affected scenarios are gap-return reappearance scenarios and `reappearance_rate` remains within threshold.
5. The active deterministic replay corpus now includes explicit topology-pressure scenarios:
   - zero `replay_topology_pressure.total_split_pair_activation_count` is a regression in replay coverage
   - zero `replay_topology_pressure.reactivated_scenario_count` means repeated split-pair pressure was not exercised and should be treated as a release-evidence failure

## Notes

- Logs:
  - web: `/tmp/vh-local-web.log`
  - relay: `/tmp/vh-local-relay.log`
- The launcher script is:
  - `tools/scripts/live-local-stack.sh`
- Public semantic soak remains non-blocking smoke:
  - `pnpm test:storycluster:smoke`
  - inspect the soak trend/report artifacts for the explicit promotion assessment before arguing that public-feed evidence is ready to move beyond smoke-only
- If you need a different profile:
  - `ENV_FILE=/path/to/.env pnpm live:stack:up`
