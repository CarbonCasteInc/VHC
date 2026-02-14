# W3-Budget Boundary Assessment

**Date:** 2026-02-14
**Author:** Coordinator
**CE Review:** AGREED (ce-codex + ce-opus, Pass 2)
**Status:** CLOSED — deferred-until-surface-exists

## Summary

W3-Budget (key 8/8: `moderation/day`) was assessed for wiring readiness. Both CE agents independently concluded this is a boundary-clarification task, not an implementation task.

## Budget Key Status (all 8 keys)

| # | Key | Status | Wired At |
|---|-----|--------|----------|
| 1 | `moderation/day` | **Deferred** | No moderation surface exists yet |
| 2 | `civic_actions/day` | ✅ Wired | `ActionComposer` (PR #236, Phase 3) |
| 3-8 | (other keys) | ✅ Wired | Various Wave 1-2 PRs |

## Assessment Detail

### `moderation/day` — VoteControl.tsx

The TODO at `VoteControl.tsx` references "when this surface adds explicit hide/remove moderation actions." Current VoteControl only provides up/down voting — no moderation primitives (hide, remove, flag-for-review) exist in the component.

**Budget primitives exist and are tested:**
- `checkModerationBudget()` in `store/xpLedgerBudget.ts`
- `consumeModerationBudget()` in `store/xpLedgerBudget.ts`
- Already enforced in `FamiliarControlPanel` for grant-level moderation

**Decision:** No synthetic wiring. Budget enforcement will be added when the moderation surface materializes. TODO updated with assessment reference.

### `civic_actions/day` — CommunityReactionSummary.tsx

The TODO references "when civic actions execute real delivery flows." This surface currently shows `ComingSoonModal` — no actual delivery occurs.

The civic actions budget IS wired at the real delivery boundary: `ActionComposer.tsx` (Phase 3, PR #236) calls `checkCivicActionsBudget()` before send and `consumeCivicActionsBudget()` at finalize.

**Decision:** Budget correctly wired at real boundary. CommunityReactionSummary TODO updated with assessment reference. Will wire here when this surface executes real delivery.

## Conclusion

All 8 budget keys are either wired at real enforcement boundaries or explicitly deferred-until-surface-exists with documented rationale. W3-Budget workstream is complete.
