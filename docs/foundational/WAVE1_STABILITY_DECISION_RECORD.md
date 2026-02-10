# Wave 1 Stability Decision Record (Draft v1)

Date: 2026-02-10
Status: Draft for Human Coordinator review
Owners: Human Coordinator + AI Coordinator
Scope: Wave 1 process/CI/agent workflow hardening before Slice 3 dispatch

---

## 1. Purpose

Capture binding decisions from Slice 1 and Slice 2 retrospective analysis to improve:
- merge throughput,
- CI reliability,
- agent execution stability,
- and reporting accuracy.

This record is policy input for operational changes. No code/config changes are approved until this record is accepted.

---

## 2. Inputs and Evidence

Primary inputs:
- `docs/reports/FIRST_SLICE_STABILITY_REVIEW.md`
- `docs/reports/SECOND_SLICE_STABILITY_REVIEW.md`

Verification notes applied:
- Root cause for ownership glob failure was custom `globToRegExp` replacement ordering, not `minimatch` options.
- Run `21836529129` failure was Hardhat compiler download timeout (`HH501`), not generic transient build state.
- CI failure accounting must include all cited failures consistently (including run `21836424746`).
- First-slice 10-minute timeout/re-dispatch pattern must be explicitly recorded.

---

## 3. Decisions (Priority Order)

### D1. Correct report facts and add evidence appendix (Immediate)
Decision:
- Correct factual errors in both stability reports before they are used as policy references.
- Add per-incident evidence appendix entries with:
  - run id + URL,
  - failing job,
  - first failing log line,
  - fix PR/SHA.

Rationale:
- Process decisions must be based on correct incident attribution.

Acceptance:
- Both reports updated and internally consistent.

---

### D2. Enable merge queue on `integration/wave-1` (Highest throughput)
Decision:
- Keep strict up-to-date branch protection.
- Add merge queue to eliminate serial rebase cascades.

Rationale:
- Best single change to reduce O(n) rebase cycles and CI reruns.

Acceptance:
- Merge queue enabled and used for active team PRs.

---

### D3. Add explicit CI timeouts and no-manual-cancel policy
Decision:
- Add `timeout-minutes` per CI job.
- Policy: no manual job cancellation unless timeout threshold is exceeded or failure is proven deterministic.

Rationale:
- Prevents operator-induced reruns from misclassified "stuck" jobs.

Acceptance:
- Timeouts present in workflow.
- Coordinator runbook updated.

---

### D4. Fix local ownership check baseline behavior
Decision:
- Pre-push ownership checks must compare against merge-base to avoid false positives after branch updates.
- Base-ref inference policy:
  - if `GITHUB_BASE_REF` exists, use it;
  - else team branches default to `integration/wave-1`;
  - else default to `main`.

Rationale:
- Eliminates unnecessary `--no-verify` from normal flow.

Acceptance:
- Hook/checker behavior validated for team and coord branch paths.

---

### D5. Add path-based CI gating matrix
Decision:
- Make expensive checks conditional by changed paths.
- Lighthouse remains required for PWA-affecting changes, non-blocking/skip for unrelated changes.
- E2E and Bundle Size also path-aware where feasible.

Rationale:
- Preserve signal while reducing unnecessary CI load.

Acceptance:
- Workflow has documented path matrix and tested behavior.

---

### D6. Enforce coverage in CI with diff-aware scope
Decision:
- Add coverage enforcement tied to touched files/modules, not blanket full-suite coverage on every PR.
- Maintain 100% touched-file threshold policy.

Rationale:
- Enforces quality contract without avoidable queue expansion.

Acceptance:
- CI fails when touched-file coverage drops below threshold.

---

### D7. Increase agent runtime budget with mandatory mid-task checkpoint
Decision:
- Increase session budget to 15-20 minutes for full ritual tasks.
- Add required checkpoint after local gates and before PR creation.

Rationale:
- Addresses repeated 10-minute timeout/re-dispatch pattern while preserving visibility.

Acceptance:
- Timeout-related re-dispatch rate decreases measurably.

---

### D8. Automate stability report generation + schema
Decision:
- Generate stability packets from GitHub API/job data (not manual counting).
- Use fixed schema with:
  - required vs observed vs optional checks,
  - as-of SHA/timestamp,
  - failure taxonomy (`code`, `infra`, `operator`),
  - evidence appendix.

Rationale:
- Eliminates counting drift and attribution inconsistencies.

Acceptance:
- Next stability report produced via automation and schema-validated.

---

## 4. Additional Clarifications

- Lighthouse policy is path-conditional, not globally demoted.
- Strict update requirement remains; merge queue is the throughput lever.
- Session budget increase is coupled with a checkpoint protocol, not standalone.

---

## 5. Implementation Sequence

Phase A (same day):
1. D1 report corrections + evidence appendix.
2. D2 merge queue enablement.
3. D3 CI timeout policy and config.

Phase B (next 24h):
4. D4 hook/checker baseline fix.
5. D5 path-based CI matrix.
6. D6 diff-aware coverage enforcement.

Phase C (next 48h):
7. D7 agent runtime/checkpoint updates.
8. D8 report automation + schema.

---

## 6. Success Metrics

Target metrics before Slice 3 scale-up:
- CI runs per merged PR: from ~4.2 toward <=2.0.
- Rebase-induced reruns: materially reduced after merge queue.
- Ownership-scope bypasses (`--no-verify`, `SKIP_OWNERSHIP_SCOPE=1`): zero without explicit logged approval.
- Report data discrepancies: zero.
- Timeout/re-dispatch events: reduced from first-slice baseline.

---

## 7. Hold Condition

No Slice 3 dispatch until:
- D1 and D2 are complete,
- and D3 is applied or explicitly deferred by Human Coordinator with written rationale.

Current operational status:
`STATUS: HOLDING_FOR_REVIEW`

