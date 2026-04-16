# Main Feed Editorial Redesign Notes

Status: Implemented
Owner: Codex
Last Updated: 2026-04-16

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

- no primary VENN/HERMES/AGORA mode switcher in the app chrome; VENN is the
  home feed, forum cards are reached through the Topics feed filter, and
  governance/settings entry points live behind the User surface
- a first-use-only `For You` orientation card stored in local safe storage so
  returning sessions land directly in the feed
- minimized sticky controls for filter and sort
- one card stream with shared spacing, elevation, and rounded geometry
- cards sized for fast scan first, with expansion carrying the detail load

The visual direction intentionally blends:

- X/Twitter scan speed and single-column focus
- Apple News polish, whitespace, and editorial typography

## Card Anatomy

### News Cards

Collapsed news cards now emphasize:

- compact headline
- one selected source image to the side of the headline when the bundle carries
  usable media
- overlapping circular source badges
- singleton vs cluster count at a glance
- one-line synthesis preview
- compact engagement counts

Expanded news cards expose:

- one synthesized facts summary rather than outlet-by-outlet summary bullets
- additional source images when multiple distinct source images exist
- related coverage / related links rail
- frame / reframe table
- discussion section with linked forum thread or thread creation affordance

Feed media now survives the bundled remote-clustering path as well:

- source image URLs are extracted during ingest
- one usable image is promoted to the headline card
- additional distinct source images remain available in the expanded view
- chunked StoryCluster remote processing returns a full topic snapshot so hero
  images are not dropped on later chunk passes

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

- `pnpm exec vitest run apps/web-pwa/src/components/feed/FeedShell.test.tsx apps/web-pwa/src/components/feed/NewsCard.test.tsx apps/web-pwa/src/components/feed/NewsCard.storyline.test.tsx apps/web-pwa/src/components/feed/FeedEngagement.test.tsx apps/web-pwa/src/components/feed/FilterChips.test.tsx apps/web-pwa/src/components/feed/SortControls.test.tsx --config vitest.config.ts`
- `pnpm --filter @vh/web-pwa typecheck`
- Playwright smoke against the fixture-backed local stack at `http://127.0.0.1:2048/`: 11 feed items, primary mode links removed, first-use orientation persists once, side-image layout detected, and three compact cards visible after reload in a 1365x768 viewport
- `git diff --check`

## Follow-on Constraint

Explicit topic/category preference controls are intentionally not introduced in
this pass, but the feed shell keeps a clear controls rail so those selectors can
be added without another layout rewrite.
