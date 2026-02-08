# News Aggregator Spec (v0)

Version: 0.1
Status: Canonical for Season 0
Context: RSS ingest, normalization, clustering, and story bundle publication.

## 1. Scope

Convert many source URLs into one story object for feed consumption and V2 synthesis inputs.

Pipeline:

1. RSS ingest
2. normalization and dedupe
3. story clustering
4. `StoryBundle` publish with provenance

## 2. Inputs and ingest

```ts
interface FeedSource {
  id: string;
  name: string;
  rssUrl: string;
  trustTier?: 'primary' | 'secondary';
  enabled: boolean;
}

interface RawFeedItem {
  sourceId: string;
  url: string;
  title: string;
  publishedAt?: number;
  summary?: string;
  author?: string;
}
```

Normalization requirements:

- canonicalize URLs and hash to `url_hash`
- strip tracking params
- dedupe exact URL and near-duplicate title+time windows

## 3. Story clustering contract

```ts
interface StoryBundle {
  schemaVersion: 'story-bundle-v0';
  story_id: string;
  topic_id: string;
  headline: string;
  summary_hint?: string;
  cluster_window_start: number;
  cluster_window_end: number;
  sources: Array<{
    source_id: string;
    publisher: string;
    url: string;
    url_hash: string;
    published_at?: number;
    title: string;
  }>;
  cluster_features: {
    entity_keys: string[];
    time_bucket: string;
    semantic_signature: string;
  };
  provenance_hash: string;
  created_at: number;
}
```

`story_id` and `topic_id` must be stable for the same cluster window and feature set.

## 4. Provenance requirements

Every story must preserve source-level provenance:

- publisher and source ID
- canonical URL and URL hash
- publication time when available
- deterministic provenance hash over sorted source list

No source URLs should be dropped from provenance if used in clustering/synthesis.

## 5. Mesh/storage paths

- `vh/news/stories/<storyId>`
- `vh/news/index/latest/<storyId>`
- optional: `vh/news/source/<sourceId>/<itemId>` for debug snapshots

## 6. Privacy and safety

- News artifacts are public and must not include identity fields.
- OAuth/social tokens are out-of-scope and forbidden in this subsystem.

## 7. Tests

1. URL normalization and dedupe behavior.
2. Stable story ID generation for equivalent clusters.
3. Provenance hash determinism.
4. Multi-source cluster generation from overlapping feed items.
