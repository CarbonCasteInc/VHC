# Completion Report: B-1 — Service Scaffold + StoryBundle Schemas

## Issue/PR
- **Slice**: B-1 (Team B, Wave 1)
- **Branch**: `team-b/B-1-storybundle-schemas`
- **Target**: `integration/wave-1`

## Merged
- **Merge commit SHA**: `27c1902a17ae2edeb71d89584c2054dc8bb91dde`
- **Feature commit SHA**: `cad856ed0ab7a892af38fbeb715875bb49e41b3e`
- **Merged to**: `integration/wave-1`

## Changes
1. **`packages/data-model/src/schemas/hermes/storyBundle.ts`** — Replaced Wave 0 passthrough stubs with spec-compliant Zod schemas:
   - `FeedSourceSchema` (id, name, rssUrl, trustTier?, enabled)
   - `RawFeedItemSchema` (sourceId, url, title, publishedAt?, summary?, author?)
   - `StoryBundleSourceSchema` (source_id, publisher, url, url_hash, published_at?, title)
   - `ClusterFeaturesSchema` (entity_keys, time_bucket, semantic_signature)
   - `StoryBundleSchema` (schemaVersion, story_id, topic_id, headline, summary_hint?, cluster_window_start/end, sources, cluster_features, provenance_hash, created_at)
   - `STORY_BUNDLE_VERSION` constant (`'story-bundle-v0'`)

2. **`services/news-aggregator/`** — New workspace scaffold:
   - `package.json` with typecheck, test, lint scripts
   - `tsconfig.json` extending base config
   - `vitest.config.ts` with 100% coverage thresholds
   - `src/index.ts` re-exporting schemas from `@vh/data-model`
   - `README.md` documenting service purpose, schemas, and roadmap

3. **`packages/data-model/src/schemas/hermes/storyBundle.test.ts`** — 39 unit tests

## Gate Results
| Gate | Result |
|------|--------|
| `pnpm typecheck` | ✅ PASS |
| `pnpm lint` | ✅ PASS |
| `pnpm test:quick` | ✅ 849/849 tests pass (84 files) |
| storyBundle.ts coverage | ✅ 100% statements, branches, functions, lines |
| LOC cap (350) | ✅ 78 LOC (storyBundle.ts), 26 LOC (index.ts) |
| Fresh checkout QA | ✅ SHA verified, all gates pass |
| Maint review | ✅ 0 Must, 0 Should, 1 Nit |

## Coverage
- `storyBundle.ts`: 100% across all metrics
- Global threshold: FAIL (pre-existing — `newsAdapters.ts` 20%, `synthesisAdapters.ts` 9.8% — untouched Wave 0 stubs)

## Risks/Unknowns
1. **Ownership Scope CI blocker (pre-existing)**: `check-ownership-scope.mjs` has a glob regex bug where `**` patterns don't match nested paths. The `globToRegExp` function applies `escapeRegex` before sentinel replacement, then the single-star `*` replacement in step 4 corrupts the `.*` inserted in step 3. Affects all teams. **Needs Coordinator fix.**
2. **Global coverage threshold (pre-existing)**: `newsAdapters.ts` and `synthesisAdapters.ts` in `packages/gun-client/src/` are uncovered Wave 0 stubs that fail the 100% threshold. Not introduced by this PR.
3. **Schema is breaking vs Wave 0 stub**: The old `.passthrough()` stubs are replaced with strict schemas. No downstream consumers exist yet (verified via grep).

## Spec Drift
- No spec drift. All schemas match `docs/specs/spec-news-aggregator-v0.md` §2-§3 exactly.

## Follow-up Issues
- [ ] **Coordinator**: Fix `check-ownership-scope.mjs` glob regex bug (swap replacement order or use two-pass sentinel)
- [ ] **Coordinator**: Add `pnpm-lock.yaml` and `*.test.ts` adjacent to owned files as allowed in ownership map (or make script handle them)
- [ ] **Team B (B-2)**: RSS ingest + normalization pipeline in `services/news-aggregator/`
- [ ] **Team B (B-3)**: Clustering + provenance logic
- [ ] **Team B (B-4)**: Gun adapters and mesh store

## Next Ready Slice
**B-2**: RSS ingest + normalization pipeline — can proceed immediately as the schema contract is now landed.
