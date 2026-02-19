# Docs & Alignment Audit — FPD Production Wiring

Date: 2026-02-19
Scope: `docs/**`, active agent contracts (`/srv/trinity/agentdirs/*/agent/AGENTS.md`), and worktree freshness.

---

## Executive result

Audit status: **PASS WITH OPEN FOLLOW-UPS**

- Core active-run artifacts are now aligned and discoverable.
- Context-building ladder is now explicit and role-accessible.
- Specs now include missing production-wiring clarifications.
- Agent contracts are synchronized to the active FPD program overlay.
- Worktrees were refreshed (`fetch --prune` for all); fast-forward normalization applied where safe.

Open follow-up remains: broad historical wave-era docs are preserved as history and still contain legacy wording by design.

---

## What was checked

1. **Active docs discoverability and authority chain**
2. **Foundational alignment with current run-state**
3. **Spec freshness + requirement clarity for current job**
4. **Context-building ladder availability for all roles**
5. **AGENTS.md alignment for coordinator/chiefs/impl/qa/docs/specialists**
6. **Markdown link integrity in docs tree**
7. **Worktree remote freshness and safe fast-forward opportunities**

---

## Findings (before remediation)

### F1 — Active-run ambiguity
- `WAVE_RUNTIME_CONSTANTS.json` still described post-wave-4 idle posture and pointed to Wave 4 kickoff/delta docs.
- `docs/README.md` did not expose an active execution packet for current FPD work.

### F2 — Missing context ladder artifact
- No single deterministic context-loading ladder for `main/coordinator/chiefs/impls` in current FPD scope.

### F3 — Requirements clarity gaps in active specs
- Sentiment spec lacked explicit migration/dual-write/telemetry requirements for current point-ID root transition.
- Identity/trust spec lacked explicit production fail-closed language for mock/transitional proof paths.

### F4 — AGENTS contracts stale against current program
- Agent contracts still pointed to Wave 4 delta/kickoff and `integration/wave-4` target.
- This created direct conflict with current FPD main-targeted execution posture.

### F5 — Worktree freshness variance
- 61 worktrees scanned; many had stale upstream offsets and/or local dirt.
- Needed explicit refresh and report for safe planning.

### F6 — Docs link hygiene
- 4 broken internal links in Sprint 3.5 docs.

---

## Remediation applied (completed)

### A) Active control docs created/updated
- **Created:** `docs/foundational/CONTEXT_BUILDING_LADDER.md`
- **Created:** `docs/foundational/FPD_PROD_WIRING_DELTA_CONTRACT.md`
- **Created:** `docs/plans/FPD_OUTLINE_AND_DISPATCH_2026-02-19.md` (outline + dispatch preserved together)
- **Updated:** `docs/foundational/WAVE_RUNTIME_CONSTANTS.json`
  - `ACTIVE_WAVE_LABEL=fpd-prod-wiring`
  - `ACTIVE_INTEGRATION_BRANCH=main`
  - active contract/kickoff/context ladder pointers switched to FPD artifacts
- **Updated:** `docs/README.md` active execution pack section
- **Updated:** `docs/foundational/STATUS.md` header + active program section
- **Updated:** `docs/foundational/V2_Sprint_Staffing_Roles.md` with active execution override
- **Updated:** `docs/foundational/CE_DUAL_REVIEW_CONTRACTS.md` status/update date language

### B) Spec clarity updates
- **Updated:** `docs/specs/spec-civic-sentiment.md`
  - Added FPD production-wiring clarifications:
    - unified vote admission policy
    - canonical identity migration constraints
    - legacy sunset requirements
    - aggregate-read requirement
    - telemetry requirements
- **Updated:** `docs/specs/spec-identity-trust-constituency.md`
  - Added explicit production fail-closed requirements for proof-provider path

### C) AGENTS alignment
- Updated **39/39** agent contract files under `/srv/trinity/agentdirs/*/agent/AGENTS.md`:
  - Inserted `Active Mission Overlay (FPD Production Wiring — 2026-02-19)`
  - Repointed delta/kickoff references to FPD artifacts
  - Switched active integration branch constants from `integration/wave-4` to `main`
  - Added overlay precedence rule for historical sections
- Coordinator AGENTS additionally normalized in-place:
  - Prime directive/run-state updated for FPD
  - hard rules/binding policy section updated to FPD gate set
  - checkpoint template updated (`main HEAD`)

### D) Worktree update pass
- **Generated:** `docs/audit/WORKTREE_SYNC_AUDIT_2026-02-19.md`
- `git fetch origin --prune` run across all 61 worktrees.
- Safe fast-forward normalization applied where clean and strictly behind.
- Result appended to worktree audit doc.

### E) Link integrity
- Fixed 4 broken internal links in sprint docs:
  - `docs/sprints/03.5-sprint-3.5-ui-refinement.md`
  - `docs/sprints/archive/03.5-implementation-details.md`
- Post-fix link check result: **0 missing links** across docs markdown.

---

## Verification snapshot

- Docs markdown files scanned: **84**
- Missing internal links after remediation: **0**
- AGENTS files with active mission overlay: **39/39**
- Residual `integration/wave-4`/`WAVE4_*` runtime refs in AGENTS: **0**
- Worktrees scanned: **61**
- Fetch/prune failures: **0**

---

## Remaining follow-ups (explicit)

1. **Historical wave docs archive policy:**
   - Large portions of `V2_Sprint_Staffing_Plan.md` and historical wave contracts remain intentionally historical.
   - Recommended: add a standardized "Historical / superseded by runtime constants" banner to all non-active wave docs.

2. **Coverage-policy implementation follow-through:**
   - Audit identified critical-path exclusions risk previously; implementation PRs must enforce coverage/e2e updates in Phase S7.

3. **Dispatch execution gate:**
   - Implementation dispatch should begin only after Director approval of this audit + dispatch packet.

---

## Conclusion

The docs and contract surface is now materially aligned to the FPD production-wiring mission, with explicit context ladder, clarified spec requirements, synchronized AGENTS overlays, and refreshed worktree visibility.

This audit enables safe iterative execution under hard gates without relying on stale wave-era assumptions.
