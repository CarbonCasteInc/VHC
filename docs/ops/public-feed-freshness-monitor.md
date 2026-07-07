# Public Feed Freshness Monitor

> Status: Operational Monitor
> Owner: VHC Launch Ops
> Last Reviewed: 2026-07-06
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
until a human reads the host. Slice 0 on 2026-07-06 closed the immediate silence
gap by configuring the interim email channel on A6, test-firing it to an
operator device, and enabling both the public-feed alert watch and watch-closure
timers. Before any new host, channel change, or unattended long watch, repeat
the same receipt proof outside the A6 host.

## Host-Local Alert Watch

`tools/scripts/public-feed-alert-watch.mjs` is the repo-side host alert path for
the outage #2 silence gap. It composes the public freshness monitor with a
read-only publisher unit check, relay health readbacks, relay snapshot
freshness, and the Scope A watch-closure verdict. It sends a state-change-only
alert when either:

- the public latest-index freshness monitor fails the 6-hour SLO or public
  health checks;
- `vh-news-aggregator.service` is not `active/running`;
- the publisher unit is in the #706 transport-total restart path with
  `ExecMainStatus=69`;
- the publisher unit is parked with `ExecMainStatus=78`.
- required relay-liveness, relay-snapshot, or watch-closure latest files are
  missing or stale;
- relay liveness or relay snapshot freshness reports fail;
- the Scope A watch-closure verdict reports `status: "fail"` after an elapsed
  threshold.

Publisher exit classification is intentionally split:

- `exit_69_transport_unavailable` is warning-severity. It means the daemon saw a
  branded all-relay transport-total REST failure and exited with `69`, which is
  restartable by the managed systemd unit (`Restart=on-failure`;
  `RestartPreventExitStatus=78`) and systemd is still in the bounded
  auto-restart window. The alert exists so the operator can confirm
  self-recovery instead of discovering a stale feed later.
- `exit_69_start_limit_parked` is critical-severity. It means the same
  transport-total class repeated until systemd exhausted `StartLimitBurst`, so
  the publisher is no longer self-recovering and needs operator action after the
  host/network path is healthy again.
- `exit_75_wrapper_refusal` is critical-severity. It means the production
  wrapper refused to start before the daemon owned the process, such as a
  sibling-service or approval/preflight refusal, and requires operator
  inspection.
- `exit_78_fail_closed` is critical-severity. It remains the non-restarting
  write-safety park and requires operator inspection before publisher writes
  resume.

The alert output is secret-safe. It records statuses, blockers, counts, ages,
and origin hashes only; it does not include tokens, raw feed payloads, story
bodies, URLs, pins, keys, or heap snapshot contents.

The script supports two delivery channels configured by environment only:

| Variable | Notes |
| --- | --- |
| `VH_PUBLIC_FEED_ALERT_WEBHOOK_URL` | HTTPS webhook target. Keep the value in the host env file, not the repo. |
| `VH_PUBLIC_FEED_ALERT_WEBHOOK_HMAC_SECRET` | Optional shared secret for pager-bound webhook signatures. Set when `VH_PUBLIC_FEED_ALERT_WEBHOOK_URL` points at the VHC pager. |
| `VH_PUBLIC_FEED_ALERT_EMAIL_TO` | Recipient for host-MTA delivery via `sendmail -t`. |
| `VH_PUBLIC_FEED_ALERT_EMAIL_FROM` | Optional sender, default `vhc-public-feed-alert@localhost`. |
| `VH_PUBLIC_FEED_ALERT_SENDMAIL` | Optional sendmail path, default `/usr/sbin/sendmail`. |
| `VH_PUBLIC_FEED_ALERT_HEARTBEAT_MS` | Optional resend interval for unchanged state. Default `0`, meaning no heartbeat. |
| `VH_PUBLIC_FEED_ALERT_TEST_FIRE` | Set to `1` for a one-shot delivery test without changing the observed pass/fail result. |
| `VH_PUBLIC_FEED_ALERT_STATE_DIR` | Default `~/.local/state/vhc/public-feed-alert`. |
| `VH_PUBLIC_FEED_ALERT_REQUIRE_RELAY_LIVENESS` | Set by the shipped unit. Requires a fresh relay-liveness latest file. |
| `VH_PUBLIC_FEED_ALERT_RELAY_LIVENESS_FILE` | Default `~/.local/state/vhc/relay-liveness/latest.json`. |
| `VH_PUBLIC_FEED_ALERT_RELAY_LIVENESS_MAX_AGE_MS` | Default `900000` in the shipped unit. |
| `VH_PUBLIC_FEED_ALERT_REQUIRE_RELAY_SNAPSHOT` | Set by the shipped unit. Requires a fresh relay snapshot watch latest file. |
| `VH_PUBLIC_FEED_ALERT_RELAY_SNAPSHOT_FILE` | Default `~/.local/state/vhc/relay-snapshot-watch/latest.json`. |
| `VH_PUBLIC_FEED_ALERT_RELAY_SNAPSHOT_MAX_AGE_MS` | Default `2700000` in the shipped unit. |
| `VH_PUBLIC_FEED_ALERT_REQUIRE_WATCH_CLOSURE` | Set by the shipped unit. Requires a fresh Scope A watch-closure verdict. |
| `VH_PUBLIC_FEED_ALERT_WATCH_CLOSURE_VERDICT_FILE` | Default `~/.local/state/vhc/phase5-scope-a-watch-closure/verdict.json`. |
| `VH_PUBLIC_FEED_ALERT_WATCH_CLOSURE_MAX_AGE_MS` | Default `5400000` in the shipped unit. |

State-change-only delivery means a repeated stale feed, repeated exit-69
restart state, or repeated exit-78 publisher state does not spam every timer
tick. A transition into failure sends, a transition out of failure sends, and a
heartbeat sends only when explicitly configured. The state fingerprint is based
on failure class, publisher state, origin hashes, counts, and stale/fresh age
state rather than the exact `newestAgeMs`, so an already-stale feed aging by
another timer interval does not create a new alert by itself. A failed delivery
is not treated as delivered; the next timer run retries the same observed
failure until at least one configured channel succeeds.

The repo ships user-systemd units but does not enable them:

- `infra/systemd/user/vh-public-feed-alert-watch.service`
- `infra/systemd/user/vh-public-feed-alert-watch.timer`

The service unit includes `TimeoutStartSec=180`, which bounds a hung
freshness/publisher probe without making normal 15-second HTTP timeouts race the
systemd start deadline.

Current A6 state as of 2026-07-06:

- `~/.config/vhc/public-feed-alert.env` is configured with a host-private email
  channel;
- `vh-public-feed-alert-watch.timer` is enabled and active;
- `vh-phase5-scope-a-watch-closure.timer` is enabled and active;
- the first real stale-feed alert after enablement was delivered;
- the recovery/pass transition after #723 was also delivered;
- the active live alert path is still interim email, not the custom
  pager/PWA.

While freshness, relay liveness, relay snapshot freshness, and watch closure
remain green, do not rerun test-fire, restart services, or change the alert
channel. Treat the next delivered failure email as an incident.

Operator enablement or channel reconfiguration, after explicit approval.

Block A: configure, install, test-fire, and stop on any failed or stale
readback. Set `TEST_FIRE_STARTED_AT` immediately before the test-fire so the
readback can prove the output was produced by this block.

```bash
TEST_FIRE_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

mkdir -p ~/.config/vhc
install -m 0600 /dev/null ~/.config/vhc/public-feed-alert.env
$EDITOR ~/.config/vhc/public-feed-alert.env

# Fail closed before enabling: at least one delivery channel must be configured
# and reachable from this host.
grep -Eq '^(VH_PUBLIC_FEED_ALERT_WEBHOOK_URL|VH_PUBLIC_FEED_ALERT_EMAIL_TO)=' ~/.config/vhc/public-feed-alert.env

# Fail closed before enabling: alert dependencies must already be producing
# fresh latest files. If any command below fails, enable/fix that producer first.
test -s ~/.local/state/vhc/relay-liveness/latest.json
test -s ~/.local/state/vhc/relay-snapshot-watch/latest.json
test -s ~/.local/state/vhc/phase5-scope-a-watch-closure/verdict.json

mkdir -p ~/.config/systemd/user
cp infra/systemd/user/vh-public-feed-alert-watch.service ~/.config/systemd/user/
cp infra/systemd/user/vh-public-feed-alert-watch.timer ~/.config/systemd/user/
systemctl --user daemon-reload

systemctl --user set-environment VH_PUBLIC_FEED_ALERT_TEST_FIRE=1
systemctl --user start vh-public-feed-alert-watch.service || true
systemctl --user unset-environment VH_PUBLIC_FEED_ALERT_TEST_FIRE
! systemctl --user show-environment | grep -q '^VH_PUBLIC_FEED_ALERT_TEST_FIRE='

node - <<'NODE'
const fs = require('node:fs');
const path = `${process.env.HOME}/.local/state/vhc/public-feed-alert/latest.json`;
const summary = JSON.parse(fs.readFileSync(path, 'utf8'));
const startedAt = Date.parse(process.env.TEST_FIRE_STARTED_AT || '');
console.log(JSON.stringify({
  status: summary.status,
  observedStatus: summary.observedStatus,
  severity: summary.severity,
  generatedAt: summary.generatedAt,
  blockers: summary.blockers,
  delivery: summary.delivery && {
    status: summary.delivery.status,
    reason: summary.delivery.reason,
    channels: summary.delivery.channels?.map((channel) => channel.channel),
    error: summary.delivery.error,
  },
  publisher: summary.publisher && {
    status: summary.publisher.status,
    failureClass: summary.publisher.failureClass,
    activeState: summary.publisher.activeState,
    subState: summary.publisher.subState,
    execMainStatus: summary.publisher.execMainStatus,
  },
  freshnessStatus: summary.freshness?.status,
  relayLiveness: summary.relayLiveness && {
    status: summary.relayLiveness.status,
    ageMs: summary.relayLiveness.ageMs,
    blockers: summary.relayLiveness.blockers,
  },
  relaySnapshot: summary.relaySnapshot && {
    status: summary.relaySnapshot.status,
    ageMs: summary.relaySnapshot.ageMs,
    blockers: summary.relaySnapshot.blockers,
  },
  watchClosure: summary.watchClosure && {
    status: summary.watchClosure.status,
    verdictStatus: summary.watchClosure.verdictStatus,
    ageMs: summary.watchClosure.ageMs,
    blockers: summary.watchClosure.blockers,
  },
}, null, 2));
if (summary.delivery?.status !== 'sent') {
  process.exitCode = 1;
} else if (!Number.isFinite(startedAt) || Date.parse(summary.generatedAt || '') < startedAt) {
  process.exitCode = 1;
}
NODE

systemctl --user reset-failed vh-public-feed-alert-watch.service
```

Block B: run only after the node readback in Block A shows
`delivery.status="sent"` from this test-fire and the operator confirms receipt
on a device outside the A6 host.

```bash
node - <<'NODE'
const fs = require('node:fs');
const path = `${process.env.HOME}/.local/state/vhc/public-feed-alert/latest.json`;
const summary = JSON.parse(fs.readFileSync(path, 'utf8'));
if (summary.delivery?.status !== 'sent') {
  throw new Error(`alert delivery is not sent: ${summary.delivery?.status || 'missing'}`);
}
if (summary.delivery?.reason !== 'test_fire') {
  throw new Error(`latest alert output is not a test-fire: ${summary.delivery?.reason || 'missing'}`);
}
if (!summary.generatedAt || Date.now() - Date.parse(summary.generatedAt) > 10 * 60 * 1000) {
  throw new Error(`latest alert output is stale: ${summary.generatedAt || 'missing'}`);
}
NODE

systemctl --user enable --now vh-public-feed-alert-watch.timer
systemctl --user status vh-public-feed-alert-watch.timer --no-pager
```

If the test-fire readback reports `delivery.status="missing_channel"` with
`alert_delivery_missing_channel`, the watch is correctly failing closed: leave
the timer disabled, add a real `VH_PUBLIC_FEED_ALERT_WEBHOOK_URL` or
`VH_PUBLIC_FEED_ALERT_EMAIL_TO` to the host env file, and repeat the test-fire.
If delivery is `failed`, treat it as a channel outage and do not enable the
timer until the channel returns a sent receipt and the operator receives it.

Rollback:

```bash
systemctl --user unset-environment VH_PUBLIC_FEED_ALERT_TEST_FIRE || true
systemctl --user disable --now vh-public-feed-alert-watch.timer
systemctl --user reset-failed vh-public-feed-alert-watch.service
rm -f ~/.config/systemd/user/vh-public-feed-alert-watch.service
rm -f ~/.config/systemd/user/vh-public-feed-alert-watch.timer
systemctl --user daemon-reload
! systemctl --user show-environment | grep -q '^VH_PUBLIC_FEED_ALERT_TEST_FIRE='
```

Host-local relay snapshot freshness is covered separately by
`docs/ops/news-aggregator-production-service.md`. That watch reads
`news-latest-index-snapshot.json` files directly and does not perform public
latest-index HTTP probes.

During the current post-#723 Scope A diagnostic window, the host-local soak
archive timer wraps this monitor and preserves hourly public freshness summaries
under `~/.local/state/vhc/phase5-scope-a-soak/YYYYMMDDTHHMMSSZ/`. The archive is
the preferred evidence packet for window review because it captures this public
freshness result together with publisher liveness, relay liveness, relay
snapshot freshness, and relay graph/heap diagnostics when enabled. The
2026-07-03 driver verdict used that archive to classify heap growth as
off-graph-likely. The current Scope A diagnostic step is waiting for the first
post-recovery 500 MB -> 700 MB early heap-capture summary pair, not a
monitor-path change.

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
