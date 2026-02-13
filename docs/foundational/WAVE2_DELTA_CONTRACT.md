# Wave 2 Delta Contract (Companion)

Companion to:
- `docs/foundational/V2_Sprint_Staffing_Roles.md`
- `docs/foundational/V2_Sprint_Staffing_Plan.md`

Status: Binding for Wave 2 execution.

Last updated: 2026-02-12

---

## Scope Rule

`V2_Sprint_Staffing_Roles.md` remains canonical baseline.
This delta captures what changed for Wave 2 and why, based on concrete Wave 1 incidents.

---

## Wave Runtime Constants (Source of Truth)

All wave-specific values are defined in `docs/foundational/WAVE_RUNTIME_CONSTANTS.json`. Contracts, runbooks, and scripts should reference that file rather than hardcoding wave strings. For quick reference in human-readable context:

- `ACTIVE_INTEGRATION_BRANCH`: see constants file
- `ACTIVE_WAVE_LABEL`: see constants file
- `EXECUTION_BRANCH_PREFIXES`: see constants file
- Active policy docs, kickoff sheet, CE contracts: see constants file

---

## Binding Policies

1. Parameterize the active integration branch.
Policy: use `ACTIVE_INTEGRATION_BRANCH=integration/wave-2` in kickoff/runbooks; avoid hardcoded `integration/wave-1` strings in new process docs/scripts.
Rationale: Wave 1 required repeated branch-string cleanup across contracts and prompts.

2. Pre-build ownership map coverage.
Policy: ownership map entries for planned Wave 2 touchpoints must use source+test globs up front (for example `foo*.ts`, `Bar*.tsx`), not exact single-file paths.
Rationale: Wave 1 repeatedly failed Ownership Scope due to exact-path patterns missing adjacent tests.

3. Shared-file protocol is explicit and strict.
Policy: if a file is marked `Shared files (coordinated)` for a team in staffing docs, request coordinator-approved ownership-map update before coding that slice; if not listed shared, do not edit it.
Rationale: Wave 1 had both invalid shared edits and valid coordinated shared-file updates; policy must disambiguate.

4. Merge queue is mandatory.
Policy: all execution PRs use auto-merge (`gh pr merge --merge --auto`); no manual rebase loops to chase up-to-date status.
Rationale: Wave 1 rebase cascades inflated CI runs and slowed throughput.

5. Impl/chief-impl stop after PR handoff.
Policy: implementation agents push, open PR, set auto-merge, emit report, then exit; they do not poll CI.
Rationale: Wave 1 saw session budget exhaustion from CI wait loops after coding was complete.
Infrastructure carry-forward: OpenClaw spawn-layer timeout policy (`runTimeoutSeconds=1200` for impl/chief-impl via `/home/humble/openclaw/config/spawn-timeout-policy.json`) remains in effect.

6. CI cancellation remains strict.
Policy: no manual CI cancellation unless deterministic code-level failure is proven; otherwise rely on job `timeout-minutes`.
Rationale: Wave 1 incurred unnecessary reruns from premature cancellation.

7. Keep CI builds package-scoped for frontend gates.
Policy: Bundle/Lighthouse jobs must build `@vh/web-pwa` only, not workspace-wide.
Rationale: Wave 1 saw transient Hardhat compiler-download failures when frontend checks triggered monorepo-wide build paths.

8. Coverage policy is split by context.
Policy: per-PR gate uses diff-aware coverage; integration closeout requires global `pnpm test:coverage` success at current thresholds.
Rationale: Wave 1 demonstrated both are necessary: fast PR feedback and full baseline proof.

9. Protect both active branches.
Policy: protect `main` and `integration/wave-2`; `Ownership Scope` is required on integration branch and non-required on `main` unless checker logic is wave-head aware for `integration/wave-* -> main`.
Rationale: Wave 1 merge-to-main exposed branch-protection and Ownership Scope mismatch.

10. Coordinator phases are isolated by spawn.
Policy: one subagent spawn per phase; no spawn may include instructions for subsequent phases; next phase starts only after prior phase artifact is verified.
Rationale: Wave 1 multi-phase batching hit context limits and produced partial/no-output runs.

11. CE dual-review is mandatory for Coordinator-bound execution prompts.
Policy: all execution prompts must pass through `ce-codex` and `ce-opus` review using the fixed-schema CE Review Pass protocol before Coordinator dispatches to team agents; direct dispatch without CE review is allowed only for break/fix emergencies with explicit logged rationale.
Rationale: Wave 1 manual relay of dual-review was effective but added latency and risked dropped context; formalizing it as an agent loop removes relay friction.

12. Wave-end documentation audit is required before next-wave dispatch.
Policy: before declaring wave closeout or dispatching the next wave, run a formal doc audit (`ce-opus` for contract/policy coherence, `ce-codex` for execution fidelity) producing `docs/reports/WAVE<n>_DOC_AUDIT.md` with findings, drift matrix, fix list, and pass/fail status; no dispatch until `DOC_AUDIT_PASS`.
Rationale: Wave 1 closeout revealed stale STATUS entries, missing doc artifacts on main, and branch-protection drift. A formal audit gate prevents recurrence.

13. Session-context rotation guard is mandatory for standing agents.
Policy: enforce context thresholds as hard guardrails:
- Coordinator and CE agents: warning at >=70% context, mandatory rotation at >=80% before any new execution dispatch, freeze new work at >=90% (handoff-only until respawn).
- Standing impl/chief agents: same thresholds apply, but monitoring and enforcement are owned by the team Chief.
- Per-PR agents (maint, per-issue QA/sidecars): exempt by design.
Rationale: Wave 1 had multiple high-context failures and timeout/no-output runs that were operational, not technical, defects.
Enforcement split: CE gate enforces thresholds for Coordinator/CE agents only. Chiefs are responsible for monitoring their standing impl agents' context usage and rotating before the 80% threshold.

14. Repo migration parity is a dispatch gate.
Policy: before any wave dispatch following a repo transfer/migration, verify:
  a. All agent worktrees have `origin` remote pointing to the canonical org/repo path.
  b. `gh repo view` and `gh api` resolve correctly from agent worktrees.
  c. Branch protection on `ACTIVE_INTEGRATION_BRANCH` is confirmed via API on the new repo.
  d. CI triggers are confirmed post-transfer (evidence: at least one green push/PR run).
  e. No hardcoded old-org/repo strings remain in active scripts or CI workflows.
  f. Historical references in archived docs/reports are exempt (annotated, not rewritten).
Rationale: The HumblePiCCI → CarbonCasteInc transfer exposed stale remote URLs and hardcoded repo paths that could cause push failures, CI misrouting, or gh CLI errors.
Gate status: `HOLDING_FOR_REPO_MIGRATION` until all sub-checks pass.

15. Periodic integration-to-main sync is mandatory.
Policy: after each workstream milestone (e.g., W2-Alpha complete, W2-Beta Stage 1 complete, W2-Gamma complete), open a sync PR from `ACTIVE_INTEGRATION_BRANCH` to `main`. If file/LOC drift exceeds 100 files or 10,000 net lines before a milestone boundary, open a sync PR immediately regardless of milestone status.
Rationale: Wave 1 closeout was trivial (no drift). Wave 2 accumulated 55+ file divergence before first sync was discussed. Large wave-end merges are risky and reviewable. Periodic sync keeps them small.
Required evidence per sync: PR number, merge SHA, file count, line delta, CI green confirmation.

16. Ownership preflight simulation is a dispatch gate.
Policy: before dispatching any workstream slice, run `tools/scripts/check-ownership-preflight.mjs` with the planned touched paths for that slice's team. If any path is unmapped, dispatch is blocked until the ownership map is updated.
Rationale: Wave 1 and Wave 2 both had repeated ownership-scope CI failures from unmapped paths, requiring extra coord PRs mid-execution.
Gate status: `HOLDING_FOR_OWNERSHIP_PREFLIGHT` until simulation passes.

---

## Exception Handling

Any exception requires explicit Coordinator approval recorded in PR description with:
- rationale,
- blast radius,
- rollback plan,
- and follow-up owner.

All exceptions must be recorded in `docs/foundational/WAVE_EXCEPTION_LEDGER.md` with full lifecycle fields (opened, closed, evidence).
