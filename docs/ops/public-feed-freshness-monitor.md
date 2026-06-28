# Public Feed Freshness Monitor

> Status: Operational Monitor
> Owner: VHC Launch Ops
> Last Reviewed: 2026-06-28
> Depends On: docs/ops/public-beta-launch-readiness-closeout.md, docs/reports/mesh-readiness-state-of-play-2026-06-12.md

## Purpose

The MVP release gates are point-in-time evidence. This monitor is the continuous
backstop for the deployed public feed after launch: it fails if the newest
product-visible row returned through the public latest-index is older than the
configured freshness budget, or if the deployed origin/relay health surfaces
stop responding.

Phase 5 Scope A deliberately serves raw public-news cards whose synthesis state
is `synthesis_pending` / `frame_table_pending`. This monitor therefore measures
latest-index recency and public read-surface health, not accepted synthesis
availability. Accepted synthesis freshness is a separate post-launch enrichment
gate.

## Scheduled Alert Path

GitHub Actions runs **Public Feed Freshness Monitor** hourly from
`.github/workflows/public-feed-freshness-monitor.yml`. A red scheduled run is the
minimum launch alert channel. The failing run uploads
`.tmp/public-feed-freshness/**`, including
`.tmp/public-feed-freshness/latest/public-feed-freshness-summary.json`, so the
operator can inspect the exact stale origin, HTTP failure, or OpenAI preflight
failure.

Operators should keep GitHub scheduled-workflow failure notifications enabled
for the release owner account. If this monitor is promoted into PagerDuty or a
host-local launchd check later, the GitHub Action remains the canonical public
artifact producer unless this document is updated.

Host-local relay snapshot freshness is covered separately by
`docs/ops/news-aggregator-production-service.md`. That watch reads
`news-latest-index-snapshot.json` files directly and does not perform public
latest-index HTTP probes.

During the Phase 5 Scope A 24-72 hour watch, the host-local soak archive timer
wraps this monitor and preserves hourly public freshness summaries under
`~/.local/state/vhc/phase5-scope-a-soak/YYYYMMDDTHHMMSSZ/`. The archive is the
preferred evidence packet for bake-window review because it captures this public
freshness result together with publisher liveness, relay liveness, and relay
snapshot freshness.

## Command

```bash
pnpm check:public-feed:freshness-monitor
```

Default origins:

- `https://venn.carboncaste.io/`
- `https://gun-a.carboncaste.io/`
- `https://gun-b.carboncaste.io/`
- `https://gun-c.carboncaste.io/`

Default freshness SLO: newest latest-index row age <= 6 hours.

## Latest-Index Snapshot Safety

Freshness monitor latest-index reads are nonmutating. The monitor and browser
smoke helper add `persist=false` to `/vh/news/latest-index` requests as an
explicit diagnostic marker, and the relay's default GET path must not refresh
`news-latest-index-snapshot.json` when it falls through to live Gun records.

Persisted latest-index snapshot refresh is reserved for intentional
write-through and maintenance code paths, including relay news story,
latest-index, and synthesis-lifecycle writes. Routine read traffic must not
poison a served snapshot with an under-scanned window, and must not heal a stale
served snapshot as a side effect of monitoring.

The stale publisher/feed incident remains separate from this monitor. A passing
freshness monitor proves the public latest-index read surface is current enough
at the sampled origins; it does not prove accepted synthesis, source ingest
health, publisher liveness by itself, or broader release readiness.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `VH_PUBLIC_FEED_FRESHNESS_ORIGINS` | deployed `venn` + `gun-a/b/c` | Comma, whitespace, or JSON array override for staging/manual runs. |
| `VH_PUBLIC_FEED_FRESHNESS_MAX_AGE_MS` | `21600000` | Set to `0` for a forced-stale failure test. |
| `VH_PUBLIC_FEED_FRESHNESS_TIMEOUT_MS` | `15000` | Per-request HTTP timeout. |
| `VH_PUBLIC_FEED_FRESHNESS_INDEX_LIMIT` | `80` | Latest-index page size read from every origin. |
| `VH_PUBLIC_FEED_FRESHNESS_SCAN_LIMIT` | `120` | Relay scan limit for latest-index reads. |
| `VH_PUBLIC_FEED_FRESHNESS_CHECK_OPENAI_PREFLIGHT` | `false` | When `true`, the monitor builds StoryCluster and fails on auth/quota/model preflight errors. |
| `VH_PUBLIC_FEED_FRESHNESS_ARTIFACT_DIR` | `.tmp/public-feed-freshness/<timestamp>` | Override for deterministic local tests. |

## Failure Classes

- `health_unhealthy`: `/healthz` failed, or a relay `/readyz` failed.
- `latest_index_not_fresh`: latest-index fetch failed, was empty, had no usable
  timestamp, or the newest row was stale.
- `openai_preflight_failed`: optional StoryCluster OpenAI preflight did not pass.

Do not convert these failures into warnings for release evidence. A stale feed
means users are seeing old news, even if the last one-shot MVP gate packet was
green.
