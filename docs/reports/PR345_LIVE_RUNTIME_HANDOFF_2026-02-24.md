# PR345 Live Runtime Handoff (2026-02-24)

## Scope
This note captures live runtime changes made outside git plus strict-gate diagnostics run from this branch so other agents can reproduce quickly.

- Branch: `claude/review-pr-345-status-KXEzt`
- Repo head used: `e78ec4d`

## Live Runtime Changes Applied (ccibootstrap)
These were applied on the live host and are not tracked in this repository.

1. Added systemd drop-in:
- Path: `/home/humble/.config/systemd/user/openclaw-gateway.service.d/vhc-analysis-override.conf`
- Values:
  - `ANALYSIS_RELAY_MODEL=gpt-5-nano`
  - `ANALYSIS_RELAY_BUDGET_ANALYSES=120`
  - `ANALYSIS_RELAY_BUDGET_ANALYSES_PER_TOPIC=20`

2. Restarted user unit:
- `systemctl --user daemon-reload`
- `systemctl --user restart openclaw-gateway.service`

3. Restarted web-pwa supervisor process from:
- `/tmp/vhc-web-pwa-supervisor.sh`
- Effective env on running Vite process includes:
  - `VITE_ANALYSIS_MODEL=gpt-5-nano`
  - `ANALYSIS_RELAY_MODEL=gpt-5-nano`
  - `ANALYSIS_RELAY_BUDGET_ANALYSES=120`
  - `ANALYSIS_RELAY_BUDGET_ANALYSES_PER_TOPIC=20`

4. Live verification:
- `GET https://ccibootstrap.tail6cc9b5.ts.net/api/analyze/config` returned:
  - `model: gpt-5-nano`
  - `analyses_limit: 120`
  - `analyses_per_topic_limit: 20`

## Strict Diagnostics Executed
Forced `N=3` diagnostics were run to get deterministic failure signatures without waiting for long buffered runs.

- Artifact directory: `/tmp/vhc_live_forced_n3_20260224T024033Z`
- Summary: `/tmp/vhc_live_forced_n3_20260224T024033Z/summary.json`

Results:
- Run 1: `exit=124`, forced timeout at 120s
- Run 2: `exit=1`, completed in ~79s
- Run 3: `exit=124`, forced timeout at 120s
- Aggregate: `strictStabilityAchieved=false`, `passCount=0`, `failCount=3`

Decoded failure from run 2 attachment (`live-bias-vote-convergence-summary`):
- `tested=1`, `converged=0`, `failed=1`, `harnessFailed=0`
- Setup row reason:
  - `page.goto: Timeout 60000ms exceeded`
  - navigating to `https://ccibootstrap.tail6cc9b5.ts.net/` waiting for `domcontentloaded`

Additional single-run check with `VH_LIVE_NAV_TIMEOUT_MS=90000` was also attempted and still exceeded an external 220s guardrail, indicating timeout bump alone is insufficient in this environment.

## Live Log Signal
`/tmp/vhc-web-pwa-supervisor.log` showed repeated proxy/socket instability during runs:
- `[vite] ws proxy socket error`
- `ECONNRESET`
- `EPIPE`

## Practical Interpretation
Current blocker in strict execution is still setup/nav instability (including `page.goto` timeouts), not only candidate cardinality.
