# Season 0 Dev Operating Mode (Local-First, 2-User Phase)

**Status:** Active development posture  
**Audience:** Core builder loop (founder + agent cluster)  
**Scope:** This mode is for local-first bring-up before external beta intake.

---

## 1. Objective in this phase

Ship one reliable end-to-end loop:

1. Feed shows real headlines.
2. Opening a headline triggers analysis.
3. Bias table rows and vote controls render.
4. Votes persist to mesh and are visible from other browsers.

Anything not directly improving this loop is lower priority.

## 2. Operating stance

1. Optimize for deterministic learning velocity, not polish.
2. Prefer explicit, reversible runtime knobs over hidden behavior.
3. Keep one canonical local topology for debugging:
   - app: `http://127.0.0.1:2048`
   - relay: `http://localhost:7777/gun`
4. Treat local strict gate as the source of truth for progress.
5. Instrument first, then patch. Avoid blind timeout inflation without telemetry.

## 3. Temporary allowances (allowed now)

1. Dev-only feature overrides and diagnostics in E2E.
2. Aggressive logging and artifact attachments in live tests.
3. Temporary budget tuning for readiness scans.
4. Best-effort fallback paths that keep the loop observable.

All allowances must be easy to remove or disable by env flag.

## 4. Non-negotiables (still enforced now)

1. V2-first contracts remain canonical.
2. Privacy boundaries remain intact (no secret leakage to public mesh).
3. Changes must be traceable (commit, artifact, explicit reason).
4. Keep production claims off until hard gates pass.

## 5. Exit criteria for this mode

Switch from this mode to external-beta posture only after all are true:

1. Local strict gate passes repeatedly with `TOPIC_LIMIT=3` and no setup scarcity.
2. Manual 3-browser check passes (analysis visibility, vote mutation, reload durability).
3. Failures are predominantly functional regressions, not environment/setup churn.
4. Rollback thresholds and session runbook are validated in practice.

At that point, scale knobs (`TOPIC_LIMIT`, budgets, tester count) can increase without changing the core test flow.
