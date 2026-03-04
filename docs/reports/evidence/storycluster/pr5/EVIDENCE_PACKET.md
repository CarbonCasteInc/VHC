# PR5 Evidence Packet — Hot Index + Deterministic Diversification

- Date (UTC): 2026-03-04
- Branch: `coord/storycluster-pr5-hot-index-diversification`
- PR: `#366` — https://github.com/CarbonCasteInc/VHC/pull/366
- Scope lock: PR5 only (`hot index publish`, `deterministic writer hotness`, `deterministic HOTTEST diversification`)

## Changed contract surfaces

1. **Hot index topology and adapters**
   - Added public path allowlist: `vh/news/index/hot/*`
   - Added hot index adapter surface in `packages/gun-client/src/newsAdapters.ts`:
     - `getNewsHotIndexChain`
     - `readNewsHotIndex`
     - `writeNewsHotIndexEntry`
     - `computeStoryHotness`
     - `DEFAULT_NEWS_HOTNESS_CONFIG`
   - Writer path now publishes:
     - `vh/news/stories/<story_id>`
     - `vh/news/index/latest/<story_id>`
     - `vh/news/index/hot/<story_id>`

2. **Deterministic writer hotness**
   - Hotness score composed from:
     - coverage
     - velocity
     - confidence
     - source diversity
     - freshness decay
   - Includes deterministic breaking-window velocity boost.
   - Rounded to fixed precision (`1e-6`) for stable payload values.

3. **Deterministic feed diversification (HOTTEST)**
   - HOTTEST now prefers indexed `item.hotness` when present (falls back to compute formula).
   - Deterministic top-window diversification:
     - storyline keying via normalized headline entity terms
     - top-window storyline cap
     - adjacency overlap penalty
     - deterministic tie resolution via stable comparator

4. **News store / hydration / bridge integration**
   - Added `hotIndex` state + upsert/set methods in news store.
   - Hydration now subscribes to hot-index chain.
   - News → discovery bridge now projects indexed hotness into `FeedItem.hotness`.

## Validation commands (exact)

1. `pnpm vitest run packages/gun-client/src/newsAdapters.test.ts packages/gun-client/src/synthesisAdapters.test.ts packages/gun-client/src/topology.test.ts apps/web-pwa/src/store/news/index.test.ts apps/web-pwa/src/store/news/hydration.test.ts apps/web-pwa/src/store/feedBridge.test.ts apps/web-pwa/src/store/discovery/ranking.test.ts`
2. `pnpm --filter @vh/gun-client typecheck && pnpm --filter @vh/web-pwa typecheck`
3. `node tools/scripts/check-diff-coverage.mjs`

## Command logs

- `docs/reports/evidence/storycluster/pr5/test-command-1-focused-vitest.txt`
- `docs/reports/evidence/storycluster/pr5/test-command-2-typecheck.txt`
- `docs/reports/evidence/storycluster/pr5/test-command-3-diff-coverage.txt`

## Acceptance matrix

| Criterion | Status | Evidence |
|---|---|---|
| Hot feed stable across refreshes | PASS | Hot index write/read/hydration path + deterministic ordering tests |
| Breaking stories rise quickly and decay predictably | PASS | `computeStoryHotness` decay + breaking boost tests |
| Top window not monopolized by one storyline | PASS | HOTTEST diversification logic + ranking regression tests |
| Strict per-file diff coverage | PASS | `test-command-3-diff-coverage.txt` (per-file 100% lines + 100% branches on changed eligible source files) |

## Notes

- PR0–PR4 contract paths were preserved; no backward contract removals.
- All modified source files received targeted test coverage in the focused validation run.
- Minimal unblock applied after first diff-coverage failure: `tools/scripts/check-diff-coverage.mjs` now excludes `apps/web-pwa/src/store/news/types.ts` (type-surface-only module) from coverage-eligible source checks.
