# Automation Stack Runbook

> Status: Operational Runbook
> Owner: VHC Core Engineering
> Last Reviewed: 2026-04-16
> Depends On: docs/ops/LOCAL_LIVE_STACK_RUNBOOK.md, docs/ops/NEWS_UI_SOAK_LANE_SEPARATION.md

## Purpose

The automation stack is a persistent local infrastructure layer managed by `launchd`. It provides shared services that scheduled automation runs (Publisher Canary, Consumer Smoke, Retained Uplift) consume as clients instead of bootstrapping their own listeners.

The stack also provides the validated-snapshot through-line for UI testing:
Publisher Canary writes a passing `published-store-snapshot.json`, the snapshot
server serves the latest passing snapshot, and the web client periodically
refreshes that snapshot into the discovery feed.

This reduces `listen EPERM` failures by making scheduled lanes consume a shared stack and by launching detached stack children from the automation state directory instead of the Desktop-rooted repo cwd.

## Port Assignments

| Service              | Automation Stack | Manual Dev Stack |
|----------------------|-----------------|-----------------|
| Web preview / dev    | `127.0.0.1:2099` | `127.0.0.1:2048` |
| Gun relay            | `127.0.0.1:7777` | `127.0.0.1:7777` |
| StoryCluster         | `127.0.0.1:4310` | `127.0.0.1:4310` |
| Snapshot server      | `127.0.0.1:8790` | `127.0.0.1:8790` |

Ports `7777` and `8790` are shared. The automation stack and manual dev stack are mutually exclusive. Stop one before starting the other.

## Quick Reference

```bash
# Ensure the stack is running (idempotent)
pnpm automation:ensure-stack

# Check health
pnpm automation:stack:health

# Force rebuild and restart
pnpm automation:stack:restart

# Stop all services
pnpm automation:stack:stop

# Install launchd agent (persists across reboots)
pnpm automation:stack:install-launchd

# Uninstall launchd agent
pnpm automation:stack:uninstall
```

## launchd Installation

Install the user-scoped launch agent:

```bash
pnpm automation:stack:install-launchd
```

This installs `com.vhc.automation-stack` as a user agent under `~/Library/LaunchAgents/`. The agent runs `automation-stack.sh ensure` at login and then every 5 minutes.

**Important:** launchd agents may not work from repos in TCC-protected paths like `~/Desktop/`. macOS background execution contexts lack permission to read/execute scripts under those paths. If `launchctl print` shows `last exit code = 126` and the stderr log shows `Operation not permitted`, the launchd path is not viable for your checkout location.

**The required supervision model is per-run preflight, not launchd.** Every scheduled automation run must start with `pnpm automation:ensure-stack` followed by `pnpm automation:stack:health`. This ensures the stack is healthy exactly when it matters — at the start of each automation run. launchd installation is optional and only useful for repos outside TCC-protected paths.

Verify:

```bash
launchctl print gui/$(id -u)/com.vhc.automation-stack
```

Uninstall:

```bash
pnpm automation:stack:uninstall
```

## State File

The stack writes state to `.tmp/automation-stack/state.json`.

Schema:

| Field                | Type    | Description |
|----------------------|---------|-------------|
| `schemaVersion`      | number  | Always `1` |
| `repoRoot`           | string  | Absolute path to repo |
| `gitHead`            | string  | Git SHA at last rebuild |
| `startedAt`          | string  | ISO 8601 first start |
| `updatedAt`          | string  | ISO 8601 last health check |
| `services`           | object  | Per-service `{ port, pid, healthy }` |
| `ports`              | object  | `{ snapshot, relay, web }` |
| `pids`               | object  | `{ snapshot, relay, web }` |
| `snapshotPath`       | string  | Path to snapshot data (if available) |
| `snapshotSummary`    | object  | Current validated-snapshot summary from `/meta.json` |
| `webBaseUrl`         | string  | `http://127.0.0.1:2099` |
| `storyclusterClusterUrl` | string | `http://127.0.0.1:4310/cluster` |
| `storyclusterReadyUrl` | string | `http://127.0.0.1:4310/ready` |
| `storyclusterAuthToken` | string | Local auth token for automation clients |
| `relayUrl`           | string  | `http://127.0.0.1:7777/gun` |
| `healthStatus`       | string  | `healthy` or `degraded` |

## Rebuild Policy

`pnpm automation:ensure-stack` compares the current `git rev-parse HEAD` against `state.json.gitHead`. If they diverge, the stack rebuilds `web-pwa` and restarts all services. This ensures automation always runs against the latest merged code.

The comparison uses the canonical repo root HEAD, not a worktree HEAD, to avoid spurious rebuilds during worktree-based automation runs.

Snapshot freshness does not require a rebuild. The snapshot server re-resolves
the latest passing publisher-canary artifact on `VH_VALIDATED_SNAPSHOT_REFRESH_MS`
(default `10000`), and the web preview refreshes
`VITE_NEWS_BOOTSTRAP_SNAPSHOT_URL` on
`VITE_NEWS_BOOTSTRAP_SNAPSHOT_REFRESH_MS` / `VH_NEWS_BOOTSTRAP_SNAPSHOT_REFRESH_MS`
(default `60000`). Set either interval to `0` only when intentionally freezing a
debug snapshot.

Artifact root selection is explicit and worktree-safe. Set
`VH_VALIDATED_SNAPSHOT_ARTIFACT_ROOT` or
`VH_DAEMON_FEED_PUBLISHER_CANARY_ARTIFACT_ROOT` to point at the canary artifact
root. When unset, the scripts prefer the current checkout artifact root if it
contains snapshots, otherwise the `main` worktree artifact root when available.

## Troubleshooting

### Lock contention

`automation:ensure-stack` now waits briefly for an in-flight stack operation to finish and returns early if the other run already restored a healthy stack.

If it still fails with a lock error after the wait budget:

```bash
cat .tmp/automation-stack/lock    # shows holding PID
ps -p $(cat .tmp/automation-stack/lock)  # check if alive
rm .tmp/automation-stack/lock     # only if holder is dead; stale locks are auto-reclaimed
```

### launchd "Operation not permitted" on Desktop-rooted repos

macOS TCC restrictions prevent launchd agents from executing scripts in protected paths like `~/Desktop/`. This is a platform constraint that cannot be worked around with plist changes.

If `launchctl print gui/$(id -u)/com.vhc.automation-stack` shows `last exit code = 126` and the stderr log shows `Operation not permitted`, uninstall the agent and rely on the per-run preflight model instead:

```bash
pnpm automation:stack:uninstall
```

The per-run preflight (`pnpm automation:ensure-stack` at the start of each automation) is the required supervision model regardless of launchd availability.

### Port conflicts with manual dev stack

Stop the manual stack first:

```bash
pnpm live:stack:down
pnpm automation:ensure-stack
```

### Logs

| Log | Path |
|-----|------|
| Web preview | `.tmp/automation-stack/logs/web.log` |
| Relay | `.tmp/automation-stack/logs/relay.log` |
| Snapshot server | `.tmp/automation-stack/logs/snapshot.log` |
| Web build | `.tmp/automation-stack/logs/web-build.log` |
| launchd stdout | `.tmp/automation-stack/logs/launchd-stdout.log` |
| launchd stderr | `.tmp/automation-stack/logs/launchd-stderr.log` |
