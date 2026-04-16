# Main Feed Editorial Redesign Notes

Status: Implemented
Owner: Codex
Last Updated: 2026-04-15

This note records the UI implementation decisions for the main-feed redesign on
`coord/ui-worktree-20260409`. It is an implementation note, not a canonical
behavior contract.

## Goal

Make the main feed read like a cross between X/Twitter and Apple News:

- one primary personalized home surface
- news-first ranking with high-engagement forum topics able to rise into the
  same stream
- inline expansion that stays anchored in the feed while feeling like a real
  detail view
- a shared anatomy for news stories and forum topics: summary, frame/reframe,
  stance and engagement cues, then threaded discussion

## UI Shape

The redesigned feed uses a single editorial shell:

- a masthead that frames the surface as the main home feed
- sticky pill controls for filter and sort
- one card stream with shared spacing, elevation, and rounded geometry
- cards sized for fast scan first, with expansion carrying the detail load

The visual direction intentionally blends:

- X/Twitter scan speed and single-column focus
- Apple News polish, whitespace, and editorial typography

## Card Anatomy

### News Cards

Collapsed news cards now emphasize:

- large headline
- overlapping circular source badges
- singleton vs cluster count at a glance
- short synthesis preview
- engagement summary

Expanded news cards expose:

- synthesis summary
- related coverage / related links rail
- frame / reframe table
- discussion section with linked forum thread or thread creation affordance

### Topic Cards

Collapsed topic cards now emphasize:

- headline thread identity
- engagement-driven promotion into the main feed
- summary preview when synthesis exists, with thread content fallback

Expanded topic cards expose:

- synthesis summary
- thread-head or conversation-state side panel
- frame / reframe table
- forum replies below the table

## State and Restoration

The shell preserves and restores feed context through URL search state:

- expanded detail card
- active feed filter
- active sort mode
- selected storyline
- selected storyline child story

This keeps context stable across refresh, reload, and shareable deep links.

## Validation

Validated with:

- `pnpm exec vitest run apps/web-pwa/src/components/feed/FeedShell.test.tsx apps/web-pwa/src/components/feed/NewsCard.test.tsx apps/web-pwa/src/components/feed/NewsCardBack.storyline.test.tsx apps/web-pwa/src/components/feed/NewsCard.sharedTopicIsolation.test.tsx apps/web-pwa/src/components/feed/TopicCard.test.tsx apps/web-pwa/src/components/feed/SourceBadge.test.tsx apps/web-pwa/src/components/feed/SourceBadgeRow.test.tsx apps/web-pwa/src/components/feed/FilterChips.test.tsx apps/web-pwa/src/components/feed/SortControls.test.tsx apps/web-pwa/src/components/feed/FeedEngagement.test.tsx`
- `pnpm exec tsc -p apps/web-pwa/tsconfig.json --noEmit`
- `git diff --check`
- browser screenshot/manual review against the local stack at `http://127.0.0.1:2048/`

## Follow-on Constraint

Explicit topic/category preference controls are intentionally not introduced in
this pass, but the feed shell keeps a clear controls rail so those selectors can
be added without another layout rewrite.
