# Public Beta Recovery Blocked Sprint - 2026-07-25

> Status: Non-authoritative execution queue
> Owner: VHC Launch Ops + VHC Core Engineering
> Current-state owner: `docs/ops/public-beta-operational-state.md`

## Objective

Preserve the completed repository safety work and resume the governed recovery
only after a valid custody path exists. This sprint does not authorize
restoration, reconstruction, installation, live recovery, or launch.

## Completed

- [x] Merge #772 after exact-head independent GO and hosted-green checks.
- [x] Correct secret process scope, independently re-review, and merge #773.
- [x] Correct pager body/output fail-closed seams, independently re-review, and
      merge #771.
- [x] Revalidate that required active-authority originals remain absent.
- [x] Establish one current operational owner and route dated documents to it.
- [x] Add a documentation freshness guard to the normal docs check.

## Blocked Queue

- [ ] Lou selects `RESTORE_EXACT` or `AUTHORIZE_FRESH_SUCCESSOR`.
- [ ] A distinct reviewer proves the selected custody path from primary
      evidence.
- [ ] Resume Gate P only from that exact reviewed authority.
- [ ] Complete Gate R, then obtain a new exact Gate I install confirmation.
- [ ] After independent install readback, generate a separate fresh Gate L
      live-recovery packet and confirmation.
- [ ] Recover relays A/B/C serially, then the publisher, stopping on any drift,
      exit 78, rollback, or uncertain mutation.
- [ ] Preserve immediate, 24-hour, and 48-hour S1A/S1B evidence.
- [ ] Record `S2=UNBLOCKED` only after both S1 lanes are green.
- [ ] Begin Gate M only after S2 is explicitly unblocked.

## Stop Condition

Until the first two blocked items are complete, the terminal state is
`BLOCKED_EXTERNAL`. Do not substitute disaster copies, fixtures, newer prose,
or repository success for missing active authority.
