# Gate 8b Canary Rerun — Evidence Bundle (2026-02-21)

Status: **Executed, PASS (no auto-abort)**

## Scope
Runtime rerun after upstreaming managed analysis backend process on `:3001` and health contract.

- Main SHA under test: `f7b190c9266e29aae693e0d03d6516c768a70471`
- Target runtime: `https://ccibootstrap.tail6cc9b5.ts.net`
- Harness: `tools/scripts/canary/run-gate8b-canary.cjs`

## Commands executed

```bash
# canary harness run
node tools/scripts/canary/run-gate8b-canary.cjs

# stability sampling window (20 samples)
python3 ... -> docs/reports/evidence/2026-02-21-canary-rerun/analysis-stability-window.json
```

## Artifact inventory
- `canary-run.log`
- `canary-summary.json`
- `breach-sim-evidence.json`
- `vote-reliability-report.json`
- `analysis-stability-window.json`

## Quantitative result (from `canary-summary.json`)

### Healthy phases (5/25/50/100)
- Effective admissions: **200**
- Denials: **0**
- Mesh writes: **200/200 success** (**100.0%**)
- P95 vote→mesh latency: **2031 ms**
- `hasClientBeforePhase`: **true** for all healthy phases

### Breach-sim
- Admissions: **40**
- Mesh writes: **0/40 success**
- Distinguishable from healthy: **true**

### SLO evaluation
- Denial rate `< 2%`: **PASS** (0.0%)
- Mesh-write success `> 98%`: **PASS** (100.0%)
- P95 latency `< 3s`: **PASS** (2031ms)
- Auto-abort condition: **NOT triggered**

## Vote reliability validation (from `vote-reliability-report.json`)
- Total rows: **240**
- Admitted rows: **240**
- Terminal outcome rows: **240**
- Silent drops: **0**
- Healthy-path successes: covered by canary summary (**200/200**)
- Breach-path failures: accounted as terminal failures (not silent)

## Analysis backend stability check (from `analysis-stability-window.json`)
20/20 successful checks on each endpoint:
- `http://127.0.0.1:3001/api/analysis/health?pipeline=true`
- `http://127.0.0.1:2048/api/analysis/health?pipeline=true`
- `https://ccibootstrap.tail6cc9b5.ts.net/api/analysis/health?pipeline=true`

## Acceptance gate assessment
- **A) Analysis backend stable:** PASS (sample window clean; no ECONNREFUSED/5xx)
- **B) Admitted votes → terminal outcomes:** PASS (0 silent drops)
- **C) Canary healthy non-zero mesh + breach distinct:** PASS
- **D) Worktree discipline:** PASS at execution time (clean/synced checks performed before run)

## Verdict
Gate 8b rerun evidence satisfies quantitative runtime criteria for this execution window.
