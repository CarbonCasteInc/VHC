# Newsfeed Production Wiring Hardening Plan

## Scope

This plan hardens the Season 0 newsfeed wiring against the exact regressions observed in local multi-browser testing:

1. Default analysis model drift (`gpt-5-nano` expected, `gpt-5.2`/`gpt-4o-mini` observed)
2. Analysis reuse races causing per-tab divergent frame sets
3. Vote convergence asymmetry across tabs/browsers
4. Feed instability (card closes, scroll jumps, headline churn)
5. Runtime noise and reliability failures (`waitForRemote`/ack timeout storms, CORS/probe fallback errors)

All fixes must preserve existing wins in local mesh operation (no Tailscale dependency), fail-fast preflights, and strict-run diagnostics.

## Contract Sources

Non-negotiable behavior is derived from:

- `docs/foundational/trinity_project_brief.md`
- `docs/foundational/TRINITY_Season0_SoT.md`
- `docs/foundational/System_Architecture.md`
- `docs/foundational/STATUS.md`
- `docs/specs/spec-civic-sentiment.md`
- `docs/foundational/FPD_PROD_WIRING_DELTA_CONTRACT.md`

### Required behavioral contract

1. Per-user per-cell tri-state is strict: `+1`, `0`, `-1`
2. Toggle semantics are deterministic:
   - `+` on neutral -> `+1`
   - `+` on `+1` -> `0`
   - `-` on neutral -> `-1`
   - `-` on `-1` -> `0`
   - `+` then `-` -> `-1` (switch)
   - `-` then `+` -> `+1` (switch)
3. Vote counters must converge from shared mesh state across tabs/browsers
4. Story analysis for a given synthesis identity must be reusable across tabs (no duplicate divergent analyses for same identity)
5. Feed UX must be stable: open card state and scroll position are not invalidated by background updates

## Root Cause Analysis

### RC1: Pipeline vote context is not bound to canonical analysis identity

- In pipeline mode, `BiasTable` often falls back to `analysisId = "${story_id}:${provenance_hash}"` as `synthesis_id`
- This fallback is not the canonical mesh artifact identity (`analysisKey`)
- Distinct analysis outputs can alias into one vote context, or one story can produce divergent point maps per tab

### RC2: Aggregate reads are not truly live

- `usePointAggregate` performs bounded read/retry and zero-snapshot polling
- Once non-zero data is read, hook can remain stale for later writes from other tabs
- UI combines aggregate with local event counts in a way that can retain stale/inflated values

### RC3: Feed cards remount due unstable keying and timestamp churn

- Feed row key currently includes `created_at`
- `StoryBundle.created_at` is updated repeatedly by runtime writes for same `story_id`
- This remounts cards, collapses open analysis, and causes scroll jumps

### RC4: Multi-ingester contention in auto mode

- Multiple browsers can run runtime ingestion in `auto` role
- Concurrent writes amplify ack timeouts and update churn
- Churn increases race probability for both feed updates and analysis generation

### RC5: Browser runtime reliability fallback hits cross-origin fetch paths

- Reliability probe falls back from `/rss/:id` to direct remote feed URLs
- Browser CORS/CSP blocks create inconsistent source health and noise

### RC6: Model default drift

- Core default in `packages/ai-engine/src/modelConfig.ts` is not aligned with project expectation (`gpt-5-nano`)
- Dev override picker options/labels reinforce drift

## Implementation Plan

## Phase 1: Identity and vote correctness (highest risk)

1. Bind pipeline vote context to canonical mesh analysis key
   - Extend analysis synthesis payload to include `analysisKey` and `modelScope`
   - In pipeline mode, pass `analysisKey` to `BiasTable` as the authoritative `synthesis_id`
   - Keep legacy fallback only as temporary compatibility path and log when used

2. Harden analysis reuse path
   - First-writer-wins behavior for same `analysisKey`
   - Re-read canonical mesh artifact after write and normalize local state to canonical artifact
   - Preserve pending-claim race protections already landed

3. Fix vote display semantics
   - Remove event-history counting as authoritative aggregate source
   - Render counts from mesh aggregate; local vote state only provides optimistic floor for current user
   - Ensure counts can decrease on toggle-off/switch events

## Phase 2: Cross-tab convergence and ingestion stability

4. Add live aggregate convergence channel
   - Subscribe to aggregate snapshot updates (`on`) for point context
   - Add slow reconciliation poll for recovery from dropped subscription events
   - Keep alias/fallback point migration behavior intact

5. Reduce writer contention in `auto` runtime role
   - Add mesh-backed lease for runtime ingester selection
   - Only lease holder runs ingestion; other tabs run as consumers
   - Heartbeat/expiry semantics prevent dead lock on tab close/crash

6. Remove cross-origin reliability fallback in browser runtime
   - Reliability checks must use same-origin proxy routes only (`/rss/*`, `/article-text`)
   - If proxy unavailable/inconclusive, degrade gracefully without direct remote fetch

## Phase 3: Feed UX stability and model alignment

7. Stabilize feed item keying and remount behavior
   - Remove volatile timestamp from feed row key
   - Use stable semantic key to keep card instance across background updates

8. Prevent timestamp churn from forcing top-of-feed reorder for unchanged stories
   - Preserve first-seen ordering metadata for existing `story_id` updates in live upsert path

9. Align model defaults to expected baseline
   - Set default analysis model to `gpt-5-nano`
   - Update dev picker options to include `gpt-5-nano` and keep explicit override behavior

10. Relax overly aggressive mesh remote wait threshold
   - Increase `waitForRemote` timeout budget from 500ms to realistic local-network threshold
   - Keep suppression logic to avoid log floods

## Validation Plan (headless, production wiring)

Validation is run against real app flows (Playwright live, relay, dev server, runtime, analysis relay):

1. Vote semantics e2e contract
   - single-user deterministic toggle matrix (`0/+/-` transitions)
   - assert per-click state and aggregate deltas

2. Multi-context convergence (3 browsers)
   - A/B/C open same story, reuse same mesh analysis artifact
   - votes from each context converge bidirectionally
   - reload each context; analysis + votes persist

3. Feed stability e2e
   - open card, allow background runtime ticks, verify card remains open
   - scroll deep, verify no jump remount loop
   - pull-to-refresh loads new headlines without collapsing active card

4. Strict live matrix pass
   - run one strict pass from head with local relay
   - verify no regression in preflight diagnostics and harness classification

5. Unit/regression tests
   - touched modules: analysis identity, aggregate subscriptions, sentiment display, feed keying, runtime lease

## Rollout / Safety

1. All new behavior behind conservative defaults where possible
2. Keep compatibility read paths for legacy vote contexts during migration window
3. Add telemetry tags for:
   - lease acquisition/loss
   - vote-context source (`analysisKey` vs fallback)
   - aggregate subscription freshness

## Definition of Done

1. Default model resolves to `gpt-5-nano` unless explicitly overridden
2. Same story in separate browsers reuses mesh analysis identity (no duplicate divergent analysis under same identity)
3. Vote toggles strictly satisfy tri-state contract and can both increment and decrement reliably
4. Votes written in browser A converge into browser B and vice versa without refresh hacks
5. Open news card is not closed by background feed updates
6. No browser-side CORS fallback errors from direct RSS probing in runtime logs
7. Headless validation passes for vote semantics, multi-context convergence, and feed stability on production wiring
