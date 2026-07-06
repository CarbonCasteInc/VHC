# VHC Incident Response Contract

> Status: Draft
> Owner: VHC Launch Ops
> Last Reviewed: 2026-07-06
> Depends On: docs/ops/vhc-incident-response.md, docs/plans/AUTONOMOUS_INCIDENT_RESPONSE_SLICES_2026-07-06.md

## Purpose

This contract defines the repo-side incident-response loop for A6 public-feed
distribution readiness. Its job is to turn a silent production problem into a
public-safe case file, assisted diagnosis, independent model review, explicit
human approval, local A6 verification, and readback evidence.

It does not give Codex or any model standing permission to mutate A6. The
operator boundary stays intact unless a later approved packet passes the local
A6 pull-executor checks.

## Incident Shape

An incident record has:

- `schemaVersion`: `vhc-incident-v1`
- `incidentKey`: stable grouping key such as `a6:public-feed:exit_69`
- `severity`: `critical`, `warning`, or `info`
- `alertClass`: the classified failure class from the alert watch
- `safeEvidence`: statuses, counts, ages, public hashes, and failure classes
- `labels`: includes `incident`, `a6`, `public-feed`, one severity label, and
  a triage/reviewer state label
- `boundaries`: the human-readable no-secrets and no-live-mutation rules

Incident keys group recoveries/escalations for the same failure family. For
example, `exit_69_transport_unavailable` and `exit_69_start_limit_parked` share
`a6:public-feed:exit_69` so the issue remains one case file instead of splitting
the incident in two.

## Alert Authentication

A6 alert webhook delivery may be signed with:

- `x-vhc-alert-timestamp`
- `x-vhc-alert-nonce`
- `x-vhc-alert-signature`

The signature is `sha256=<hex>` over:

```text
timestamp.nonce.body
```

using HMAC-SHA256 and the secret from
`VH_PUBLIC_FEED_ALERT_WEBHOOK_HMAC_SECRET` on A6 and
`VH_PAGER_A6_WEBHOOK_SECRET` on the pager. The pager rejects stale timestamps,
nonce replay, and mismatched signatures. Unsigned bootstrap exists only for
initial setup and is latched off after the first signed alert.

## Command Authentication

GitHub commands are only accepted when all are true:

- the comment author is in the configured allowlist;
- the comment was not edited;
- the command starts with `/vhc`;
- approval commands name both the packet id and exact packet SHA-256.

Valid commands are:

```text
/vhc reviewer fable
/vhc reviewer sol
/vhc approve packet <packet-id> <packet-sha256>
/vhc pause
/vhc resume
```

The issue body is public and editable. The local A6 pull executor therefore
does not trust issue text as the packet. It verifies a packet file pinned by
hash, a signed review verdict over that hash, and a separate approval command
that repeats the same hash.

## Review Contract

The reviewer verdict schema is `vhc-review-verdict-v1`. The signed payload
includes:

- packet hash
- verdict
- risk
- approved action ids
- blocked action ids
- required readbacks
- expiry

The signature is an Ed25519 signature over the stable JSON payload emitted by
`canonicalReviewPayload` in `services/vhc-pager/src/incident-contract.mjs`.
The executor rejects expired, failed, missing, or invalid review signatures.

`fable` and `sol` are switchable reviewer lanes. Reviewer selection defaults to
the provider that did not propose the packet unless an explicit
`same-provider-review` label is present.

## Executor Phases

Allowed action ids by phase:

| Phase | Actions |
| --- | --- |
| 1 | `read_only_a6_collector`, `enable_alert_watch_timers`, `run_heap_analyzer` |
| 2 | Phase 1 plus `restart_publisher_exit69_only` |
| 3 | Phase 2 plus `deploy_named_merged_commit` |

Always forbidden:

- retention
- compaction
- eviction
- publisher clear
- quorum reduction
- fail-close weakening
- raw heap export
- mesh production write

For `restart_publisher_exit69_only`, the executor refuses if local readback shows
`ExecMainStatus=78` or `ExecMainStatus=75`. Those classes remain operator-owned.

## Pager Honesty

The iPhone PWA is a convenience path, not the reliability guarantee. iOS Web
Push depends on the phone, Apple delivery, network reachability, notification
permission, Focus, and silent-mode/user settings. The distribution-grade alert
path is layered:

- signed A6 alert;
- pager issue persistence;
- iPhone push wakeup;
- email fallback;
- repeat-until-ack;
- external dead-man check of the pager itself.

## Secret Safety

No component should emit:

- tokens, keys, webhook URLs, private env values, raw request bodies, or
  signatures;
- raw heap snapshots or heap profiles;
- private logs or story payload bodies.

Tools should emit hashes, counts, statuses, ages, and summarized failure classes.
