# PR #343 Post-Merge Strict RCA Packet (2026-02-22 21:10 UTC)

## Incident
After merging PR #343, a **single strict post-merge A→B live matrix pass** failed at **7/8 convergence**.

- PR #343 merged: `209ecb661a940b7302c40ec0a5ac212405d561c8`
- Strict pass artifact: `/tmp/vhc_live_ab_matrix_postmerge_strict.log`
- PR comment packet: https://github.com/CarbonCasteInc/VHC/pull/343#issuecomment-3941691531

## Failing row (strict pass)
- headline: `New details revealed about seconds before trans gunman opened fire at Rhode Island hockey game`
- point id (display): `9165efd05758d897738ecd679f58b0b3e77c0bf9aa81e8c13e5480d861bb953c`
- A observed: `+9 / -1`
- B observed immediate: `+0 / -0`
- B observed after reload: `+0 / -0`
- reason: `b-aggregate-remained-zero`

## Telemetry counts in that strict pass
- `[vh:aggregate:voter-write]`: 15
- `[vh:vote:voter-node-readback]`: 0
- `[vh:aggregate:point-snapshot-write]`: 13
- `[vh:aggregate:read]`: 65
- `[vh:vote:intent-replay]`: 8

## Relevant code paths
- `apps/web-pwa/src/hooks/useSentimentState.ts`
  - `projectSignalToMesh(...)` emits write + readback telemetry.
  - readback telemetry currently fires only after successful `writeVoterNode(...)` return.
- `packages/gun-client/src/aggregateAdapters.ts`
  - `writeVoterNode(...)` throws on ack timeout (`aggregate-put-ack-timeout`) after warning telemetry.
  - `writePointAggregateSnapshot(...)` similarly strict on ack timeout.
- `apps/web-pwa/src/hooks/voteIntentMaterializer.ts`
  - replay pipeline retries failed projections every 3s.
  - materialization may lag strict observation windows.
- `apps/web-pwa/src/components/feed/BiasTable.tsx`, `CellVoteControls.tsx`
  - synthesis/analysis fallback context + canonical/legacy point mapping path.

## Known behavior to preserve
- No silent success semantics for aggregate writes.
- Keep strict telemetry and explicit failure signaling.
- Maintain compatibility with legacy/display point IDs while preferring canonical synthesis point IDs.

## Investigation goals
1. **Root cause** of strict pass flake (7/8) with evidence from logs + code path.
2. Determine whether failure is:
   - write durability/timeout + replay lag,
   - synthesis-id partition mismatch (A/B reading different aggregate namespace),
   - canonical vs legacy point-id mapping race/mismatch,
   - or combination.
3. Produce a **production-ready** solution (not a test-only workaround).

## Required solution shape
- Deterministic convergence behavior for cross-account A→B under strict conditions.
- Explicit observability for previously silent/ambiguous paths.
- Minimal blast radius and clear backward compatibility behavior.
- Test coverage that guards against regression in:
  - id partition mismatch,
  - legacy/canonical read divergence,
  - replay lag under ack timeout.

## Deliverables expected from CE
1. RCA write-up with ranked hypotheses and evidence.
2. Concrete patch plan (file-by-file).
3. Production-ready implementation recommendation (or implementation + validation commands if performed).
4. Risk assessment + rollout/monitoring checks.
5. Clear merge/no-merge recommendation for a follow-up hotfix PR.
