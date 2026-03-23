# News UI / Soak Lane Separation (Canonical)

> Status: Operational Boundary (Canonical)
> Owner: VHC Core Engineering
> Last Reviewed: 2026-03-23
> Depends On: /Users/bldt/Desktop/VHC/VHC/docs/foundational/STATUS.md, /Users/bldt/Desktop/VHC/VHC/docs/ops/LOCAL_LIVE_STACK_RUNBOOK.md, /Users/bldt/Desktop/VHC/VHC/docs/specs/spec-news-aggregator-v0.md

This document defines the strict separation between:
- the UI / UX product lane
- the periodic headline-soak / retained-mesh measurement lane

The goal is simple:
- UI work must keep moving
- soak evidence must keep accumulating
- neither lane should invalidate the other

## Current Boundary

### UI / UX Lane

The UI lane builds against the published feed contract that already exists on `main`.

It may change:
- feed presentation
- card layout
- navigation
- source-view behavior
- storyline presentation
- loading, empty, and error states
- affordances around the existing feed/store contract

It must treat the current publication contract as authoritative:
- `story_id`
- `topic_id`
- `StoryBundle`
- canonical source metadata
- secondary asset metadata

It must not block on soak recovery before building user-facing surfaces.

### Soak / Measurement Lane

The soak lane measures whether the production pipeline behind that contract is good enough for release.

It owns:
- periodic `pnpm collect:storycluster:headline-soak`
- retained-source-evidence capture
- ghost retained-mesh trend analysis
- headline-soak release evidence
- production-readiness inputs derived from those artifacts

It must run against merged `main`, not a UI feature branch.

## Strict Separation Rules

1. UI work must happen on a feature branch, not on `main`.
2. Periodic soak collection must run against merged `main`.
3. UI sessions should run only the web app unless the developer is explicitly debugging the runtime lane.
4. UI-only sessions should disable local runtime ingestion:
   - `VITE_NEWS_RUNTIME_ENABLED=false`
   - or `VITE_NEWS_RUNTIME_ROLE=consumer`
5. UI contributors must not manually run live soak commands unless they are intentionally working the soak lane:
   - `pnpm collect:storycluster:headline-soak`
   - `pnpm --filter @vh/e2e test:live:daemon-feed:semantic-soak`
   - `pnpm --filter @vh/e2e test:live:daemon-feed:semantic-gate`
6. Soak contributors must not bundle unrelated UI changes into soak/reliability branches.
7. In-progress or partial soak artifact directories are not authoritative:
   - readiness and trend consumers must use the latest complete artifact set only.

## Safe UI Workflow

Recommended UI development path:

1. branch from `main`
2. run only `/Users/bldt/Desktop/VHC/VHC/apps/web-pwa`
3. default to runtime-disabled or consumer-only mode
4. use stable latest artifacts for inspection, not in-progress soak directories

Recommended commands:

```bash
cd /Users/bldt/Desktop/VHC/VHC
git checkout -b coord/ui-<lane>
```

```bash
cd /Users/bldt/Desktop/VHC/VHC/apps/web-pwa
VITE_NEWS_RUNTIME_ENABLED=false \
VITE_NEWS_BRIDGE_ENABLED=false \
VITE_SYNTHESIS_BRIDGE_ENABLED=false \
VITE_VH_ANALYSIS_PIPELINE=false \
pnpm dev
```

Consumer-only variant:

```bash
cd /Users/bldt/Desktop/VHC/VHC/apps/web-pwa
VITE_NEWS_RUNTIME_ENABLED=true \
VITE_NEWS_RUNTIME_ROLE=consumer \
pnpm dev
```

## Stable Contract The UI May Assume Today

The UI may assume the following contract is stable for current work:

1. feed items publish as `StoryBundle`-shaped records
2. `story_id` is the current feed identity
3. `topic_id` is present and stable enough for current routing/presentation work
4. canonical sources and secondary assets are already separated
5. singleton-first publication is valid
6. later same-incident / same-developing-episode growth should attach without identity churn

This is sufficient for:
- card rendering
- route state
- source presentation
- storyline presentation
- persistence of open/focus state keyed to current feed identity

## What UI Must Not Hardcode

Until the retained-feed experiment is closed, UI contributors must avoid hardcoding assumptions that would block a later publication-model upgrade.

Avoid baking in assumptions that:
- a story row is permanently immutable after first publish
- disappearance always means terminal deletion
- a future retained topic cannot evolve while preserving user context
- feed identity can never gain a continuity layer above current `story_id`

This does not block current UI work.
It means new UX code should prefer adapters/selectors over scattering lifecycle assumptions across components.

## Eventual Integration Plan

If the retained-mesh experiment proves that hours-separated executions create meaningful later attachment and singleton-to-auditable growth, integrate in phases.

### Phase 0: Current Separation

Current state:
- UI builds against today’s publication contract
- soak validates the live pipeline behind it

### Phase 1: Measurement Proof

Required proof before any publication-model change:
- stable retained identity across executions
- non-trivial `laterAttachmentCount`
- non-trivial `singletonToAuditableCount`
- retained trend improves without semantic contamination regression

### Phase 2: Contract RFC

Before changing runtime publication:
- write the retained-feed contract explicitly
- define identity semantics
- define decay/staleness policy
- define what updates in place vs what republish/replaces

No UI code should be changed to a speculative retained model before this RFC exists.

### Phase 3: Backend Publish Change

Implement retained publication in a dedicated backend/runtime lane only.

That lane must prove:
- current feed correctness does not regress
- retained identity is stable
- decay works
- replay/continuity evidence improves materially

### Phase 4: UI Adaptation

Only after the retained publication contract is explicit and passing should the UI lane adapt:
- row lifecycle behavior
- ordering behavior on topic evolution
- read/open state persistence across retained updates
- any continuity-specific UX affordances

### Phase 5: Joint Acceptance

Merge the two lanes only when both are true:
- soak evidence says the retained model is an improvement
- UI behavior remains stable and legible under that model

## Contributor Rule Of Thumb

If the task is:
- presentation, navigation, affordance, layout, loading, empty/error state
  - stay in the UI lane
- bundle supply, source overlap, retained evidence, trend interpretation, production readiness
  - stay in the soak lane
- publication semantics or identity lifecycle
  - open a dedicated integration lane; do not smuggle it through UI polish or soak-only work
