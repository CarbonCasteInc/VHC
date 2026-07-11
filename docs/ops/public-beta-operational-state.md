# Public Beta Operational State

> Status: Current Operational Truth
> Owner: VHC Launch Ops + VHC Core Engineering
> Last Reviewed: 2026-07-11
> Depends On: docs/specs/spec-news-aggregator-v0.md, docs/ops/news-aggregator-production-service.md, docs/ops/public-beta-launch-readiness-closeout.md, docs/ops/public-beta-launch-control-2026-07-09.md, docs/ops/a6-s1b-relay-timeout-recovery-packet-2026-07-10.md

This is the stable entry point for the current public-beta operational decision.
It records secret-safe facts only. Re-read moving mailbox and A6 evidence before
every live gate; a dated snapshot never authorizes a later action.

## Current Verdict

`NO_GO_STOP_REPORT_REMOTE_STAGING_BASE_UNSAFE`

The repository-side S1 recovery implementation and exact executable tuple are
reviewed. Live recovery has not started. Supervised load attempt 001 stopped at
read-only remote prestate because the reviewed staging base was shared and
contained unrelated entries.

Consequences:

- S1A/S1B remain red.
- Relay A/B/C replacement has not started.
- The publisher remains outside the completed authority scope.
- Recovery T0 does not exist.
- T0+24h and T0+48h evidence do not exist.
- S2 and all later launch-enablement work remain blocked.

Monitor `status: pass` means the monitor executed and classified messages. It is
not incident clearance or release approval.

## Frozen Repository And Artifact Truth

| Field | Verified value |
| --- | --- |
| S1 recovery revision | `3c8907f056ee5e482ddd5cec55ea2b32d6d04c5e` |
| Source PR | #769 |
| Relay image | `vhc-public-beta-relay:20260710-s1b-3c8907f0-amd64` |
| Relay image platform | `linux/amd64` |
| Immutable image ID | `sha256:cb44eb9e94c1716311efc0d80c672d2b031018e6fc94bfcb7b23d96d20cee763` |
| Single-session capture SHA-256 | `8250dde3d1d1c34bd638f669355d4237fda085568da78df60a6bff69e2aa97d0` |
| Reviewed file-index SHA-256 | `fff0e17ee8fb31d9032d9ef9afd91eed53037dc36de774c22e20130a1cb26c6c` |
| Executable supplement SHA-256 | `b69e298ceec1d6074cf18ba3c81775f64a5e77a7776dd7a946e1a7fc78e1513d` |
| Executable packet SHA-256 | `f4c83bb7853716da5b90a9424645168ab26e46b358f151d9eac56f2dcc407101` |
| Static validation SHA-256 | `ae41483fa0f974951bc6f010bc86a84eb25da7aa0448940806ce08dc0247a697` |
| Execution binding SHA-256 | `2185ca8aafc67c6752b869c66e945b7e39971e09f259b2df152c13c23097cf4f` |
| Original Lou authorization SHA-256 | `c3962a489afbf33e004a289e81d008bf570271b796f2432fef2f867e4ac9d020` |

Independent review closed the exact executable tuple with P0/P1/P2 zero. The
original authority bound private staging, transfer, checksum verification,
Docker image load, immutable verification, attended serial A then B then C, and
current-relay-only rollback.

It excluded publisher, checkout, origin, data, quorum, timeout, recipient,
provider, pager, and monitor changes. It also required any exit `78` to stop
without retry or hand patch.

## Supervised Load Attempt 001

Attempt 001 ran on 2026-07-11 and exited `78` during
`read_only_remote_prestate` with reason:

`remote_staging_unexpected_content`

The read-only staging diagnosis found:

| Check | Observation |
| --- | --- |
| Base | `/tmp/vhc-public-beta-images` |
| Exists | yes |
| Symlink | no |
| Owner UID | `1002` |
| Mode | `0775` |
| Existing entries | three sibling directories, names withheld |
| Expected exact child | absent |

The attempt record SHA-256 is
`018def645678cbbeefff20f3da97038c6c4709435e7583d9a7241f691ec3e2f7`.
Its evidence index SHA-256 is
`758f6a97a85708e5ec1f06d7675736a8f8f7b40ac2d3e6352a6a8a49fd6bf5ec`.

## Zero-Mutation Result

Attempt 001 performed none of the following:

- create or change remote staging;
- transfer the image;
- run `docker load`;
- remove or recreate a relay;
- change the publisher or any service;
- retry, hand patch, chmod, clean, unload, or select an alternate path.

The refusal is a successful safety result. It is not recovery evidence.

## Moving Incident Evidence

The mailbox alias is `.tmp/vhc-failure-mailbox-monitor/latest.json`. The last
snapshot observed during this documentation audit was generated at
`2026-07-11T05:02:14.679Z`, had SHA-256
`ddaea453e14a6b13329971a946facf020d522c64772fe5a35864f70be71990ad`, and
contained one critical classification: `public_feed_alert_fail`.

That count is incident history as soon as a newer artifact exists. Before every
gate, re-read the moving alias, preserve its hash and timestamp, and run the
required read-only A6 comparison. Never copy raw mail, secrets, story bodies, or
host-private configuration into committed documentation.

The latest preserved direct A6 service readback predates attempt 001 and observed
the publisher parked at exit `78`, the older checkout, and three ready relays.
Do not infer unchanged current service state from that dated evidence.

## Exact Next Gate

Before any second attempt:

1. Select a genuinely private, current-user-owned, non-symlink, mode-`0700`,
   non-shared staging root.
2. Regenerate every load/supervision artifact affected by the new path.
3. Recompute and record the affected hashes.
4. Obtain independent subsequent review on the exact new envelope.
5. Obtain a new exact Lou binding.
6. Re-read moving mailbox and A6 prestate. Any unbound drift stops again.
7. Stage, transfer, checksum, load, and verify the immutable image before relay
   A is eligible.

Do not chmod, clean, reuse, or hand patch `/tmp/vhc-public-beta-images`.

If a tracked generator change is required, the repository revision changes and
the revision-bound image/capture/packet chain must be rebuilt and independently
reviewed. A docs-only commit must not be merged ahead of tuple-sensitive
recovery unless that invalidation is explicitly accepted.

## Remaining S1 Sequence

After a successful image load:

1. replace relay A;
2. independently accept A evidence;
3. replace relay B;
4. independently accept B evidence;
5. replace relay C;
6. independently accept C and aggregate relay evidence;
7. stop for separate publisher authority;
8. run the exact publisher controller sequence from
   `docs/ops/news-aggregator-production-service.md`;
9. preserve immediate recovery evidence;
10. preserve T0+24h intermediate evidence;
11. preserve a passing T0+48h final closure packet.

The publisher stays parked during A/B/C. A rollback restores only the current
relay and stops. Any rollback leaves S1 red and requires a fresh tuple.

Durable boundaries:

- `FINAL_MAIN_REVISION_BINDS_RELAY_IMAGE_AND_PUBLISHER_CHECKOUT`
- `IMMEDIATE_RECOVERY_IS_NOT_S1_GREEN`
- `T0_PLUS_24H_IS_INTERMEDIATE_ONLY`
- `T0_PLUS_48H_REQUIRED_TO_UNBLOCK_S2`

Only a passing T0+48h closure plus no unresolved public-feed critical can make
S2 eligible. Classification, immediate readback, or human authority cannot
substitute for elapsed evidence.

## Public-Beta Boundary After S1

S1 completion does not mean launch readiness. S2 through S12 still cover:

- StoryCluster headline-soak credential/endpoint repair;
- auth boundary and durable nonce deployment;
- Apple and Google registration/rehearsal, with X hidden;
- PWA origin and release-commit deployment;
- accepted-synthesis canary;
- fresh release evidence;
- three-browser persistence/convergence/privacy rehearsal;
- distribution decision, first tranche, monitoring, and later expansion.

The public beta remains `NO-GO` until the launch control packet, distribution
packet, closeout gates, manual evidence, and Lou's final decision are complete.

The active non-authoritative outcome/dependency map is
`docs/sprints/PUBLIC_BETA_MVP_COMPLETION_SPRINT_2026-07-11.md`; the compact
orchestration companion is
`docs/plans/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md`.

## Update Rule

Update this document when the top-level operational decision changes. Preserve
attempt-specific evidence in an immutable report or archive; do not append an
incident diary here.

Historical pre-attempt status is preserved under
`docs/archive/public-beta-pre-recovery-2026-07-10/`.
