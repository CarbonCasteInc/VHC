# Public Feed Freshness Monitor

> Status: Operational Monitor
> Owner: VHC Launch Ops
> Last Reviewed: 2026-07-02
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

Outage #2 proved that host-local liveness timers and freshness logs are not an
alerting channel by themselves. A fail-closed publisher can leave the feed stale
until a human reads the host. Before any unattended long watch, confirm that at
least one monitor failure path reaches the release owner outside the A6 host.

## Host-Local Alert Watch

`tools/scripts/public-feed-alert-watch.mjs` is the repo-side host alert path for
the outage #2 silence gap. It composes the public freshness monitor with a
read-only publisher unit check and sends a state-change-only alert when either:

- the public latest-index freshness monitor fails the 6-hour SLO or public
  health checks;
- `vh-news-aggregator.service` is not `active/running`;
- the publisher unit is parked with `ExecMainStatus=78`.

The alert output is secret-safe. It records statuses, blockers, counts, ages,
and origin hashes only; it does not include tokens, raw feed payloads, story
bodies, URLs, pins, keys, or heap snapshot contents.

The script supports two delivery channels configured by environment only:

| Variable | Notes |
| --- | --- |
| `VH_PUBLIC_FEED_ALERT_WEBHOOK_URL` | HTTPS webhook target. Keep the value in the host env file, not the repo. |
| `VH_PUBLIC_FEED_ALERT_EMAIL_TO` | Recipient for host-MTA delivery via `sendmail -t`. |
| `VH_PUBLIC_FEED_ALERT_EMAIL_FROM` | Optional sender, default `vhc-public-feed-alert@localhost`. |
| `VH_PUBLIC_FEED_ALERT_SENDMAIL` | Optional sendmail path, default `/usr/sbin/sendmail`. |
| `VH_PUBLIC_FEED_ALERT_HEARTBEAT_MS` | Optional resend interval for unchanged state. Default `0`, meaning no heartbeat. |
| `VH_PUBLIC_FEED_ALERT_TEST_FIRE` | Set to `1` for a one-shot delivery test without changing the observed pass/fail result. |
| `VH_PUBLIC_FEED_ALERT_STATE_DIR` | Default `~/.local/state/vhc/public-feed-alert`. |

State-change-only delivery means a repeated stale feed or repeated exit-78
publisher state does not spam every timer tick. A transition into failure sends,
a transition out of failure sends, and a heartbeat sends only when explicitly
configured. The state fingerprint is based on failure class, publisher state,
origin hashes, counts, and stale/fresh age state rather than the exact
`newestAgeMs`, so an already-stale feed aging by another timer interval does not
create a new alert by itself. A failed delivery is not treated as delivered; the
next timer run retries the same observed failure until at least one configured
channel succeeds.

The repo ships user-systemd units but does not enable them:

- `infra/systemd/user/vh-public-feed-alert-watch.service`
- `infra/systemd/user/vh-public-feed-alert-watch.timer`

The service unit includes `TimeoutStartSec=180`, which bounds a hung
freshness/publisher probe without making normal 15-second HTTP timeouts race the
systemd start deadline.

Operator enablement, after explicit approval:

```bash
mkdir -p ~/.config/vhc
install -m 0600 /dev/null ~/.config/vhc/public-feed-alert.env
$EDITOR ~/.config/vhc/public-feed-alert.env

# Fail closed before enabling: at least one delivery channel must be configured
# and reachable from this host.
grep -Eq '^(VH_PUBLIC_FEED_ALERT_WEBHOOK_URL|VH_PUBLIC_FEED_ALERT_EMAIL_TO)=' ~/.config/vhc/public-feed-alert.env

mkdir -p ~/.config/systemd/user
cp infra/systemd/user/vh-public-feed-alert-watch.service ~/.config/systemd/user/
cp infra/systemd/user/vh-public-feed-alert-watch.timer ~/.config/systemd/user/
systemctl --user daemon-reload

VH_PUBLIC_FEED_ALERT_TEST_FIRE=1 systemctl --user start vh-public-feed-alert-watch.service
cat ~/.local/state/vhc/public-feed-alert/latest.json

systemctl --user enable --now vh-public-feed-alert-watch.timer
systemctl --user status vh-public-feed-alert-watch.timer --no-pager
```

Rollback:

```bash
systemctl --user disable --now vh-public-feed-alert-watch.timer
systemctl --user reset-failed vh-public-feed-alert-watch.service
rm -f ~/.config/systemd/user/vh-public-feed-alert-watch.service
rm -f ~/.config/systemd/user/vh-public-feed-alert-watch.timer
systemctl --user daemon-reload
```

Host-local relay snapshot freshness is covered separately by
`docs/ops/news-aggregator-production-service.md`. That watch reads
`news-latest-index-snapshot.json` files directly and does not perform public
latest-index HTTP probes.

During the current post-#694 Scope A instrumented climb, the host-local soak
archive timer wraps this monitor and preserves hourly public freshness summaries
under `~/.local/state/vhc/phase5-scope-a-soak/YYYYMMDDTHHMMSSZ/`. The archive is
the preferred evidence packet for window review because it captures this public
freshness result together with publisher liveness, relay liveness, relay
snapshot freshness, and relay graph/heap diagnostics when enabled.

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
| `VH_PUBLIC_FEED_ALERT_WEBHOOK_URL` | unset | Host-local alert webhook URL; only read by `public-feed-alert-watch.mjs`. |
| `VH_PUBLIC_FEED_ALERT_EMAIL_TO` | unset | Host-local alert email recipient; only read by `public-feed-alert-watch.mjs`. |
| `VH_PUBLIC_FEED_ALERT_HEARTBEAT_MS` | `0` | Optional unchanged-state heartbeat interval for host-local alerting. |

## Failure Classes

- `health_unhealthy`: `/healthz` failed, or a relay `/readyz` failed.
- `latest_index_not_fresh`: latest-index fetch failed, was empty, had no usable
  timestamp, or the newest row was stale.
- `openai_preflight_failed`: optional StoryCluster OpenAI preflight did not pass.

Do not convert these failures into warnings for release evidence. A stale feed
means users are seeing old news, even if the last one-shot MVP gate packet was
green.
