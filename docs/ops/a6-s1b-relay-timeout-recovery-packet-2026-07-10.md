# A6 S1B Relay-Timeout Recovery Packet - 2026-07-10

> Status: `final_revision_image_packet_and_review_pending`
> Owner: VHC Ops + VHC Core Engineering
> Last Reviewed: 2026-07-10
> Depends On: `docs/ops/public-beta-image-deploy.md`,
> `docs/ops/news-aggregator-production-service.md`,
> `docs/plans/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md`,
> `docs/plans/PUBLIC_BETA_STATE_OF_PLAY_HANDOFF_2026-07-10.md`
> Decision: `NO-GO_PENDING_FINAL_REVISION_IMAGE_PACKET_AND_REVIEW`
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
the relay image and recreating the relay containers. Lou approved PR #763 and
the attended A/B/C restart boundary on 2026-07-10. That resolves the authority
contradiction, but it does not waive exact-packet review. Review of the first
candidate packet returned `NO-GO` for inspect-scope, network-prestate, and
immutable-image binding gaps. PR #764 corrected those tooling defects and
merged; #765-#767 then closed the publisher diagnostic, control-plane, and
liveness seams. Merged tooling is not a final packet. The shared integration
gate starts from `main@297d1bb4`; only its eventual reviewed merge may be frozen
as `FINAL_REV` and used to build the image, capture fresh A6 prestate, and
generate the inert packet.

No relay, origin, publisher, service, timer, Gmail/provider, pager, alert
channel, or production state was changed. No live packet was generated or run.
S1A/S1B are not recovered or green.

The final review record must bind the publisher checkout, relay OCI revision,
full immutable relay image ID, manifest/tar hashes, packet SHA-256, capture
SHA-256, reviewer identity, relay order `A -> B -> C`, and reviewed loopback
relay origins. Any later commit, rebuild, recapture, origin change, or packet
regeneration invalidates the prior review and Lou tuple confirmation.

Durable boundaries:

- `FINAL_MAIN_REVISION_BINDS_RELAY_IMAGE_AND_PUBLISHER_CHECKOUT`
- `IMMEDIATE_RECOVERY_IS_NOT_S1_GREEN`
- `T0_PLUS_24H_IS_INTERMEDIATE_ONLY`
- `T0_PLUS_48H_REQUIRED_TO_UNBLOCK_S2`

## Recorded Boundary Approval And Remaining Gate

Lou's recorded approval permits one attended replacement of only
`vhc-relay-a`, then `vhc-relay-b`, then `vhc-relay-c`, with serial rollback and
stop authority preserved. It does not authorize origin or publisher mutation,
relay data changes, quorum/timeout changes, provider work, pager cutover,
monitor enablement, or a live-green claim. The remaining gate is technical:
the corrected exact packet, capture hash, merged revision, and immutable image
id must receive independent `GO` before the approved action starts.

## Repo-Only Preparation That Is Complete

The existing image tooling now has explicit inert relay-only modes:

- `tools/scripts/export-public-beta-image-artifacts.sh --relay-only` validates
  the local relay image revision, full `sha256:` image id, and `linux/amd64`,
  exports only that image, and emits load commands that reject a loaded mutable
  ref unless it resolves to that same immutable id;
- `tools/scripts/emit-a6-public-beta-deploy-packet.sh --relay-only` requires
  an inspect array containing exactly one each of `/vhc-relay-a`,
  `/vhc-relay-b`, and `/vhc-relay-c`, plus expected relay revision and the
  export manifest's full immutable image id. It excludes origin from the
  inspect/deploy scope and emits no recreate commands unless
  `--include-recreate-commands` is also explicitly supplied;
- `tools/scripts/vhc-packet-executor.mjs` is unchanged. Its live action surface
  has not been widened to execute this rolling recovery.

The generator is not packet review or execution authority. Its default output
contains only read-only checks plus secret-safe env/snapshot capture
instructions.

## Preparation Inputs

Do not collect live inputs until the repo remediation is merged, independent
packet review is `GO`, and Lou authorizes the read-only capture session.

Required inputs are:

- exact merged remediation commit;
- immutable relay image tag or digest whose OCI
  `org.opencontainers.image.revision` equals that commit;
- full immutable relay image id from the exporter's `artifact-manifest.json`;
- local image platform `linux/amd64`;
- secret-safe `docker inspect` JSON for exactly `vhc-relay-a`,
  `vhc-relay-b`, and `vhc-relay-c`;
- confirmation that the publisher is exactly parked as `ActiveState=failed`,
  `SubState=failed`, `Result=exit-code`, and `ExecMainStatus=78`; any inactive,
  active, activating, deactivating, wrong-result, or other exit state is not
  parked;
- confirmation that no unrelated maintenance is active;
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
  --expected-relay-image-id <sha256:id-from-artifact-manifest> \
  --output .tmp/a6-s1b-relay-only-packet.review.md
```

The generator fails closed unless inspect is an array of exactly three unique
canonical A/B/C entries. Duplicates, extras, blank/malformed names, a missing or
malformed immutable image id, absent relay/data bind/host probe mapping, or an
origin image in relay-only mode are rejected.

The captured network contract includes network name and 64-hex `NetworkID`,
static IPAM intent, aliases, links, driver options, gateway priority, and an
explicit configured MAC intent when present. Supported fields are recreated and
compared before removal, immediately after recreate, after verification, and
after rollback. Runtime-assigned endpoint ids, addresses, gateways, DNS names,
and an unconfigured endpoint MAC are shape-validated but never treated as
stable prestate. Unknown, malformed, duplicate, conflicting, or nonportable
attachment state is a hard stop.

The current secret-safe A6 capture is the supported host-network case: A, B,
and C each have `HostConfig.NetworkMode=host`, one `NetworkSettings.Networks.host`
attachment with the same valid 64-hex `NetworkID`, all 15 canonical endpoint
keys, null IPAM/aliases/links/driver options, `GwPriority=0`, and no configured
MAC intent. The emitted recreate command is therefore exactly `--network host`,
and each relay verifier uses its captured `GUN_PORT` on `127.0.0.1`.

Do not add `--include-recreate-commands` before all authority and review gates
below pass. Do not generate or execute a live packet from this branch.

## Required Independent Packet Review

The reviewer must inspect the exact merged commit, generated packet hash, and
captured input hash, then return `GO` only if all of these are true:

- scope is exactly relay A, B, C in that order;
- no origin or publisher recreate/start command exists;
- the publisher must match the exact exit-78 parked tuple above at initial
  precheck and again as the final gate immediately before each A/B/C removal;
- the new image is `linux/amd64` and its OCI revision equals the merged commit;
- the mutable image ref resolves to the export manifest's full immutable image
  id immediately before every A/B/C removal; the packet runs that immutable id,
  and the recreated container `.Image` must equal it;
- each relay preserves the exact prestate env set without printing values;
- immediately before each removal, live image id/ref, env, mounts, network mode
  and attachments, ports, restart policy, user, memory, and memory-swap must
  equal the captured prestate; stale capture is a hard stop, not rollback input;
- bind mount, semantic network attachment and `NetworkID`, ports, restart
  policy, user, and memory limits are preserved from inspect evidence and
  rechecked immediately after recreate, after verification, and after rollback;
- snapshot checks cover latest-index, synthesis-lifecycle, and topic-synthesis;
- readiness, health, Docker OOM state, and watchdog metrics are checked before
  proceeding; the pre-mutation and per-stage metric artifacts are retained and
  an absent watchdog-trip row is semantic zero because the relay initializes an
  empty reason map, but only when exactly one numeric
  `vh_relay_uptime_seconds` and one positive numeric
  `vh_relay_process_rss_bytes` prove the payload is authentic relay telemetry;
  if a trip row exists it must be one well-formed zero row, while an empty,
  unrelated, malformed, duplicate, or nonzero payload is a hard stop;
- all four endpoint-local exact missing-key contracts are closed 404s with the
  expected error and story id; unexpected bodies are retained privately but
  never printed, even when they contain hostile secret-bearing fields;
- any failure rolls back only the current relay to its captured immutable image
  id, verifies basic recovery, and exits `78` before touching the next relay;
  rollback remove, start, readiness, topology, OOM, checksum, and evidence-mode
  failures each emit only a closed reason code and normalize to exit `78`;
- raw secrets and heap artifacts are absent;
- the generic packet executor remains unchanged.

Any correction requires a subsequent review by the same packet reviewer on the
new exact head and packet hash.

## Recorded Lou Approval Gate

Lou explicitly approved #763 and instructed the attended A/B/C restart on
2026-07-10. That approval covers the boundary and automatic current-relay serial
rollback, with the publisher parked. It remains conditioned on independent `GO`
for the corrected exact packet. Any change to relay count/order, origin or
publisher scope, data/quorum/timeouts, or rollback semantics invalidates the
recorded approval and returns to `WAITING_FOR_LOU`.

## Approved Rolling Contract

Only after the preceding gates pass may an operator regenerate the exact packet
with `--include-recreate-commands`. Its contract is:

1. Create `/tmp/vhc-public-beta-deploy` with private umask, refuse symlinks or
   non-directories, and require current-user ownership plus mode `0700` before
   any evidence write. Confirm the publisher matches exactly `failed/failed`,
   `Result=exit-code`, `ExecMainStatus=78`; all three relays are running;
   loopback readiness and metrics respond; no relay reports OOM; and the three
   required snapshot files are nonempty, schema-valid, and checksummed.
   Preserve initial metrics privately. An absent watchdog-trip row means zero;
   that absence is accepted only alongside exactly one valid uptime and RSS
   producer row. Empty/random telemetry and malformed/duplicate/nonzero trip or
   producer rows fail closed.
2. Confirm the loaded mutable ref resolves to the full manifest image id, is
   `linux/amd64`, and has an OCI revision exactly equal to the approved merged
   commit. Repeat that binding at every removal boundary, run the immutable id,
   and require the recreated container `.Image` to equal it.
3. Capture each relay's env privately, without rewriting defaults or printing
   values.
4. Immediately before relay A removal, compare live image, env, bind mounts,
   semantic network attachment and `NetworkID`, ports, restart policy,
   configured user, and memory limits with the captured inspect prestate;
   reject any drift. Recheck the exact exit-78 parked publisher tuple and invoke
   the atomic removal-boundary check immediately before removal, then replace A
   only.
   A refusal in topology, watchdog/readiness, or publisher preconditions exits
   `78` with no `docker rm`, no `docker run`, and no rollback of the untouched
   relay. Rollback is reachable only after the mutation-started latch is set at
   the removal boundary.
5. Immediately after recreate and again after verification, require exact
   semantic topology parity including the stable network identity, plus A
   readiness/health, running/non-OOM Docker state, unchanged snapshot checksums,
   zero watchdog trips, and exact env parity.
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
   Repeat the full live/captured topology comparison, zero-trip prestate, and
   final exact publisher-state check immediately before each removal. A publisher
   resume or transitional state between stages stops before the next mutation.
   Recheck the exact parked tuple again after each relay passes all verification
   and before emitting GO or entering the next stage; a resume during
   verification rolls back the already-mutated current relay and stops.
8. On any failure, recreate only the current relay from its captured immutable
   prestate image id, require readiness, live topology/env parity, non-OOM and
   snapshot proof, exit `78`, and do not touch the next relay. Every rollback
   command is guarded; remove/run/readiness/checksum failures produce a closed
   reason code and exit `78` rather than leaking command output or falling
   through.
9. After C passes, keep the publisher parked and return evidence for independent
   review. Relay deployment success alone does not authorize publisher recovery.

## Hard Stops

Stop before any removal on:

- missing or ambiguous Lou approval;
- commit, immutable image id, mutable-ref binding, revision, architecture, or
  packet-hash mismatch, including a retagged same-revision wrong image;
- non-array inspect input; duplicate, extra, blank, malformed, or unexpected
  container name; or mount, port, semantic network attachment/`NetworkID`, user,
  memory, restart policy, or env drift;
- publisher state differs in any field from exact exit-78 parked state,
  including inactive, active, activating, deactivating, or resumed between
  relay stages;
- missing, invalid, empty, or changed snapshot;
- failed readiness/health, pre-existing OOM/watchdog trip, or secret-bearing
  output;
- unsafe/symlinked/non-private evidence directory, malformed or duplicate
  watchdog metric, or any pre-mutation refusal that would otherwise enter
  rollback;
- any unrelated active A6 maintenance.

Roll back the current relay and stop on any post-recreate mismatch, non-404
exact probe, unexpected error body, liveness failure, snapshot drift, env drift,
OOM/watchdog signal, or evidence-capture failure. Never print an unexpected
response body; report only its closed contract-mismatch reason.

Never batch relay removal, clear data, change quorum, increase deadlines, edit
recipients, enable monitors, use the generic packet executor, recreate origin,
or start/reset the publisher from this packet.

## Post-Relay Decision Boundary

A successful A/B/C pass proves only that the reviewed relay image is running and
the four missing-key exact-readback contracts are available without observed
snapshot/env/OOM regressions. It does not prove publisher recovery, feed
freshness, alert recovery, watch closure, or S1B green.

The publisher remains parked until the separately reviewed exact-revision
recovery controller preserves the incident prestate and relay evidence, runs
park/preflight/attended-start/four-route verify/T0/finalize, validates the first
completed ticks, and proves public freshness/snapshots/liveness. Immediate
recovery is not S1 green. T0+24h is intermediate only. S1A/S1B remain `NO-GO`
and S2+ remains blocked until a passing T0+48h closure packet exists.
