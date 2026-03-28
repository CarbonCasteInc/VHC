# @vh/news-aggregator

RSS/HTML-hub ingest, normalization, clustering, source-health, and `StoryBundle` publication service for the TRINITY integrated news/forum app.

## Overview

This service converts onboarded publisher source surfaces into unified `StoryBundle` objects for consumption by the V2 synthesis pipeline and discovery feed.

Current responsibilities:

1. **Feed ingest** — fetch and parse configured publisher feeds and approved HTML hub surfaces
2. **Normalization & dedupe** — canonicalize URLs, strip tracking params, deduplicate
3. **Story clustering** — group same-incident / same-developing-episode coverage into canonical `StoryBundle`s
4. **Mesh publish** — emit bundles, storylines, and latest indexes to Gun
5. **Source operations** — run source admission, source health, and scout workflows that govern the starter surface

The browser app is a consumer of this daemon-owned publication path. In production wiring, ingest and publication happen here; the web client only boots feed bridges.

## Schemas

Canonical schemas live in `@vh/data-model` and are re-exported here for convenience:

- `FeedSourceSchema` — configured RSS/feed source
- `RawFeedItemSchema` — single raw ingested item
- `StoryBundleSchema` — clustered story bundle (cross-module contract)
- `StoryBundleSourceSchema` — provenance entry within a bundle
- `ClusterFeaturesSchema` — cluster feature vector

## Scripts

```bash
pnpm build                # Compile the service
pnpm typecheck   # TypeScript type checking
pnpm test        # Run unit tests
pnpm daemon      # Run the canonical news daemon
pnpm report:source-admission
pnpm report:source-health
pnpm report:source-scout
pnpm check:source-health
```

## Mesh paths

- `vh/news/stories/<storyId>` — published story bundles
- `vh/news/index/latest/<storyId>` — latest story index
- `vh/news/storylines/<storylineId>` — related-coverage groups
- `vh/news/source/<sourceId>/<itemId>` — debug snapshots (optional)

## Status

- [x] B-1: Service scaffold + StoryBundle/FeedSource schemas
- [x] B-2: Feed ingest + normalization pipeline
- [x] B-3: Clustering + provenance
- [x] B-4: Gun publication, daemon path, and source-health/scout ops
- [ ] Distribution-grade live headline readiness

## Current Posture

- The integrated app may move forward in constrained beta on current `main`.
- Live corroborated headlines remain beta-gated by `/Users/bldt/Desktop/VHC/VHC/.tmp/storycluster-production-readiness/latest/production-readiness-report.json`.
- Current starter surface is governed by `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json`.
- Source onboarding/promotion is governed by `/Users/bldt/Desktop/VHC/VHC/docs/ops/NEWS_SOURCE_ADMISSION_RUNBOOK.md`.
