# @vh/news-aggregator

RSS ingest, normalization, clustering, and StoryBundle publication service for the TRINITY Bio-Economic OS.

## Overview

This service converts many RSS/feed source URLs into unified `StoryBundle` objects for consumption by the V2 synthesis pipeline (Team A) and discovery feed (Team C).

Pipeline stages (slices B-2 through B-4):

1. **RSS ingest** — fetch and parse configured feed sources
2. **Normalization & dedupe** — canonicalize URLs, strip tracking params, deduplicate
3. **Story clustering** — group related articles by entity, time, and semantic similarity
4. **StoryBundle publish** — emit bundles with full provenance to Gun mesh

## Schemas

Canonical schemas live in `@vh/data-model` and are re-exported here for convenience:

- `FeedSourceSchema` — configured RSS/feed source
- `RawFeedItemSchema` — single raw ingested item
- `StoryBundleSchema` — clustered story bundle (cross-module contract)
- `StoryBundleSourceSchema` — provenance entry within a bundle
- `ClusterFeaturesSchema` — cluster feature vector

## Scripts

```bash
pnpm typecheck   # TypeScript type checking
pnpm test        # Run unit tests
pnpm lint        # Lint check
```

## Mesh paths

- `vh/news/stories/<storyId>` — published story bundles
- `vh/news/index/latest/<storyId>` — latest story index
- `vh/news/source/<sourceId>/<itemId>` — debug snapshots (optional)

## Status

- [x] B-1: Service scaffold + StoryBundle/FeedSource schemas
- [ ] B-2: RSS ingest + normalization pipeline
- [ ] B-3: Clustering + provenance
- [ ] B-4: Gun adapters and mesh store
