# A6 S1B Relay-Timeout Recovery Packet - 2026-07-10

> Status: `blocked_pending_relay_restart_boundary_correction`
> Owner: VHC Ops + VHC Core Engineering
> Last Reviewed: 2026-07-10
> Depends On: `docs/ops/public-beta-image-deploy.md`,
> `docs/ops/news-aggregator-production-service.md`,
> `docs/plans/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md`,
> `docs/plans/PUBLIC_BETA_STATE_OF_PLAY_HANDOFF_2026-07-10.md`
> Decision: `WAITING_FOR_LOU`
> Human incident, restart, and rollback authority: Lou
> Repo preparation owner: VHC Core Engineering
> Live actions performed by this document/branch: none
> Incident class: `relay_rest_story_timeout_total_0_of_3_exit_78`

## Decision Summary

The repo-side S1B remediation adds bounded exact readback for
`/vh/news/story`, `/vh/news/latest-index`, `/vh/news/hot-index`, and
`/vh/news/synthesis-lifecycle`. Those routes execute in
`infra/relay/server.js`.

The A6 relay runtime is image-bound:

- `infra/relay/Dockerfile` uses `COPY server.js /app/server.js` and starts that
  copy with `CMD ["node", "server.js"]`;
- `infra/docker/docker-compose.public-beta.yml` supplies an immutable relay
  image and bind-mounts only `/data` for each relay;
- no source-code bind mount can make a checkout update change the running HTTP
  route surface.

Therefore the reviewed relay route change cannot become live without replacing
the relay image and recreating the relay containers. The current S1B recovery
checklist simultaneously says not to restart relays. That is a real authority
contradiction. This packet does not resolve it by assumption.

No relay, origin, publisher, service, timer, Gmail/provider, pager, alert
channel, or production state was changed. No live packet was generated or run.
S1A/S1B are not recovered or green.

## Boundary Correction Lou Must Decide

Lou may either:

1. approve replacing the contradictory no-relay-restart line with a one-time,
   exact-revision, attended A/B/C rolling relay-image replacement under this
   packet; or
2. decline/defer it, leaving S1B blocked and every S2+ launch slice `NO-GO`.

An approval must name the exact merged commit and relay image tag/digest, permit
only `vhc-relay-a`, then `vhc-relay-b`, then `vhc-relay-c`, and preserve Lou's
stop/rollback authority. It does not authorize origin or publisher mutation,
relay data changes, quorum/timeout changes, provider work, pager cutover,
monitor enablement, or a live-green claim.

## Repo-Only Preparation That Is Complete

The existing image tooling now has explicit inert relay-only modes:

- `tools/scripts/export-public-beta-image-artifacts.sh --relay-only` validates
  the local relay image revision and `linux/amd64`, exports only that image, and
  emits load commands that contain no origin artifact or origin load;
- `tools/scripts/emit-a6-public-beta-deploy-packet.sh --relay-only` requires
  exactly the three canonical relay names and an expected relay revision,
  excludes origin from the inspect/deploy scope, and emits no recreate commands
  unless `--include-recreate-commands` is also explicitly supplied;
- `tools/scripts/vhc-packet-executor.mjs` is unchanged. Its live action surface
  has not been widened to execute this rolling recovery.

The generator is not a packet approval. The default output says
`WAITING_FOR_LOU` and contains only read-only checks plus secret-safe env/snapshot
capture instructions.

## Preparation Inputs

Do not collect live inputs until the repo remediation is merged, independent
packet review is `GO`, and Lou authorizes the read-only capture session.

Required inputs are:

- exact merged remediation commit;
- immutable relay image tag or digest whose OCI
  `org.opencontainers.image.revision` equals that commit;
- local image platform `linux/amd64`;
- secret-safe `docker inspect` JSON for exactly `vhc-relay-a`,
  `vhc-relay-b`, and `vhc-relay-c`;
- confirmation that the publisher remains parked and no unrelated maintenance
  is active;
- captured relay data bind mounts, ports, networks, restart policies, users,
  memory limits, and environment values held only in a private `0600` file.

Never paste env values, tokens, raw story bodies, heap snapshots, provider
responses, or private host paths into chat, PR text, issues, or release docs.

## Inert Local Build And Export

After merge, build the relay image locally from the exact merged checkout:

```bash
tools/scripts/build-public-beta-images.sh \
  --relay \
  --platform linux/amd64 \
  --tag <reviewed-tag>
```

For direct-file delivery, export only the relay image:

```bash
tools/scripts/export-public-beta-image-artifacts.sh \
  --relay-only \
  --relay-image vhc-public-beta-relay:<reviewed-tag> \
  --source-revision <exact-merged-commit> \
  --output-dir .tmp/public-beta-image-artifacts/<reviewed-tag>
```

This produces a private relay tar, one-entry checksum file, one-image manifest,
and approval-only load packet. It does not contact A6.

## Inert Packet Generation

Generate the non-destructive review artifact first:

```bash
tools/scripts/emit-a6-public-beta-deploy-packet.sh \
  --relay-only \
  --inspect-json ./relay-containers.json \
  --new-relay-image vhc-public-beta-relay:<reviewed-tag-or-digest> \
  --expected-relay-revision <exact-merged-commit> \
  --output .tmp/a6-s1b-relay-only-packet.blocked.md
```

The generator fails closed if the three canonical relay names are not selected,
the relay image or expected revision is absent, any relay/data bind/host probe
mapping is absent, or an origin image is supplied in relay-only mode.

Do not add `--include-recreate-commands` before all authority and review gates
below pass. Do not generate or execute a live packet from this branch.

## Required Independent Packet Review

The reviewer must inspect the exact merged commit, generated packet hash, and
captured input hash, then return `GO` only if all of these are true:

- scope is exactly relay A, B, C in that order;
- no origin or publisher recreate/start command exists;
- the publisher is required to remain parked;
- the new image is `linux/amd64` and its OCI revision equals the merged commit;
- each relay preserves the exact prestate env set without printing values;
- bind mount, network, ports, restart policy, user, and memory limits are
  preserved from inspect evidence;
- snapshot checks cover latest-index, synthesis-lifecycle, and topic-synthesis;
- readiness, health, Docker OOM state, and watchdog metrics are checked before
  proceeding;
- all four endpoint-local exact missing-key contracts are closed 404s with the
  expected error and story id;
- any failure rolls back only the current relay to its captured immutable image
  id, verifies basic recovery, and exits `78` before touching the next relay;
- raw secrets and heap artifacts are absent;
- the generic packet executor remains unchanged.

Any correction requires a subsequent review by the same packet reviewer on the
new exact head and packet hash.

## Lou Approval Gate

After reviewer `GO`, stop at `WAITING_FOR_LOU`. Lou's approval must explicitly
answer all of the following:

- Is the no-relay-restart boundary replaced for this exact incident packet?
- Is the exact merged commit and relay image tag/digest approved?
- Is attended A/B/C rolling replacement approved with publisher parked?
- Is automatic per-relay rollback on any failed gate approved?
- Does Lou accept that this action disturbs historical unattended-window
  evidence and must be recorded as maintenance?

Silence, general release approval, repo merge approval, or permission to update
the A6 checkout is not relay-restart approval.

## Approved Rolling Contract

Only after the preceding gates pass may an operator regenerate the exact packet
with `--include-recreate-commands`. Its contract is:

1. Confirm the publisher is parked; all three relays are running; loopback
   readiness and metrics respond; no relay reports OOM/watchdog trip; the three
   required snapshot files are nonempty, schema-valid, and checksummed.
2. Confirm the loaded image is `linux/amd64` and its OCI revision exactly equals
   the approved merged commit.
3. Capture each relay's env privately, without rewriting defaults or printing
   values.
4. Replace relay A only. Preserve its env, bind mount, network, ports, restart
   policy, configured user, and memory limits.
5. Require A readiness/health, running/non-OOM Docker state, unchanged snapshot
   checksums, zero watchdog trips, and exact env parity.
6. Probe one unique definitely-missing story id through all four endpoint-local
   contracts:
   - story with `readback=exact` returns only
     `news-story-not-found` and HTTP 404;
   - latest-index `story_id` returns only
     `news-latest-index-not-found` and HTTP 404;
   - hot-index `story_id` returns only `news-hot-index-not-found` and HTTP 404;
   - synthesis-lifecycle with `readback=exact` returns only
     `news-synthesis-lifecycle-not-found` and HTTP 404.
7. Proceed to B only after A passes every gate; proceed to C only after B passes.
8. On any failure, recreate only the current relay from its captured immutable
   prestate image id, require readiness/non-OOM/snapshot proof, exit `78`, and do
   not touch the next relay.
9. After C passes, keep the publisher parked and return evidence for independent
   review. Relay deployment success alone does not authorize publisher recovery.

## Hard Stops

Stop before any removal on:

- missing or ambiguous Lou approval;
- commit, image, revision, architecture, or packet-hash mismatch;
- unexpected container name, count, order, mount, port, network, user, memory,
  restart policy, or env drift;
- publisher active/running;
- missing, invalid, empty, or changed snapshot;
- failed readiness/health, pre-existing OOM/watchdog trip, or secret-bearing
  output;
- any unrelated active A6 maintenance.

Roll back the current relay and stop on any post-recreate mismatch, non-404
exact probe, unexpected error body, liveness failure, snapshot drift, env drift,
OOM/watchdog signal, or evidence-capture failure.

Never batch relay removal, clear data, change quorum, increase deadlines, edit
recipients, enable monitors, use the generic packet executor, recreate origin,
or start/reset the publisher from this packet.

## Post-Relay Decision Boundary

A successful A/B/C pass proves only that the reviewed relay image is running and
the four missing-key exact-readback contracts are available without observed
snapshot/env/OOM regressions. It does not prove publisher recovery, feed
freshness, alert recovery, watch closure, or S1B green.

The publisher remains parked until a separate, independently reviewed,
Lou-approved exit-78 recovery packet preserves the incident prestate, starts or
resets only the publisher, validates the first completed ticks, proves public
freshness/snapshots/liveness, and begins honest 24/48-hour evidence. Until that
happens, the release decision remains `NO-GO` and S2+ remains blocked.
