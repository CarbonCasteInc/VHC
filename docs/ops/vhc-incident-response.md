# VHC Incident Response Runbook

> Status: Operational Design / Repo Capability
> Owner: VHC Launch Ops
> Last Reviewed: 2026-07-06
> Depends On: docs/specs/spec-vhc-incident-response.md, docs/ops/public-feed-freshness-monitor.md

## Plain-Language Model

The system has four jobs:

1. A6 notices the feed has a problem and sends a signed alert.
2. A pager service outside A6 records the alert, creates or updates a GitHub
   incident issue, and reaches the operator by phone notification and email.
3. Codex can read the public-safe issue and draft diagnosis, tests, PRs, and
   operator packets.
4. Any packet that could touch A6 must pass independent review, explicit human
   approval, local A6 verification, and readback checks before it can execute.

The point is not to make the human diagnose production. The point is to make
the human receive the page, choose the model lane when needed, and approve only
packets whose safety checks already passed.

## What Exists In Repo

- Alert producer: `tools/scripts/public-feed-alert-watch.mjs`
- Pager service package: `services/vhc-pager`
- GitHub incident bridge: `services/vhc-pager/src/github-bridge.mjs`
- iPhone PWA assets: `services/vhc-pager/pwa`
- Triage worker: `tools/scripts/vhc-incident-triage-worker.mjs`
- Reviewer worker: `tools/scripts/vhc-incident-reviewer.mjs`
- Packet verifier: `tools/scripts/vhc-operator-packet-verify.mjs`
- Pull executor: `tools/scripts/vhc-packet-executor.mjs`
- Readback verifier: `tools/scripts/vhc-incident-readback-verifier.mjs`
- Pager dead-man: `tools/scripts/vhc-pager-deadman.mjs`

Run the repo-side gate with:

```bash
corepack pnpm@9.7.1 check:vhc-incident-response
```

## Current Operating Posture

As of 2026-07-06, PR #722 is merged on `main` and the repo contains the full
incident-response/pager implementation. The live A6 alert path is still the
Slice 0 interim email channel, not the custom pager/PWA.

Current boundaries:

- `vh-public-feed-alert-watch.timer` is enabled on A6.
- `vh-phase5-scope-a-watch-closure.timer` is enabled on A6.
- Email delivery is configured in host-private env and has sent failure and
  recovery state changes.
- The custom pager should be deployed only after the current alert loop keeps
  proving itself; email fallback stays on permanently.
- Codex may investigate, write tests, open PRs, and draft operator packets from
  public-safe incident evidence.
- Codex live execution/autonomy remains off. The executor is dry-run unless a
  later approved rollout explicitly enables it after the proof window and
  drills.

## Slice 0: Interim Channel Complete

Slice 0 is complete. The operator configured the email channel, confirmed a
test-fire reached the phone, and enabled both timers. A later real stale-feed
alert proved that the channel was paging a real condition, and the recovery
transition after #723 was also delivered.

For a new host or channel reconfiguration, repeat the Block-A/Block-B procedure
from `docs/ops/public-feed-freshness-monitor.md`. Do not edit host alert env,
disable timers, or rerun test-fire while A6 is green unless the operator has
explicitly opened a maintenance session.

## Pager Deployment Inputs

The pager needs these secret or environment values in its hosting environment:

| Variable | Purpose |
| --- | --- |
| `VH_PAGER_A6_WEBHOOK_SECRET` | Verifies signed A6 alert webhooks. |
| `VH_PAGER_REQUIRE_SIGNED` | Set to `1` after bootstrap. |
| `VH_PAGER_UNSIGNED_BOOTSTRAP_SECRET` | Temporary setup secret if unsigned bootstrap is used. |
| `VH_PAGER_DEVICE_TOKEN` | Authenticates iPhone ack and incident readback. |
| `VH_PAGER_ENROLLMENT_SECRET` | Allows a phone to enroll for push. |
| `VH_PAGER_VAPID_PUBLIC_KEY` | Public Web Push key served to the PWA. |
| `VH_PAGER_VAPID_PRIVATE_JWK` | Private Web Push key; never put in repo. |
| `VH_PAGER_KV` | Durable pager state binding for alerts, incident records, nonces, subscriptions, outbox, and bootstrap latch state. Production must not use volatile memory. |
| `VH_PAGER_PUSH_ENDPOINT_HOST_ALLOWLIST` | Optional allowlist for push-service endpoint hosts, for example `web.push.apple.com *.push.apple.com`. |
| `VH_PAGER_MAX_BODY_BYTES` | Optional request body cap for alert and enrollment endpoints; defaults to 128 KiB. |
| `GITHUB_TOKEN` or equivalent | Issue-write token scoped to this repository. |

On A6, the existing alert watch can sign pager webhooks with:

```bash
VH_PUBLIC_FEED_ALERT_WEBHOOK_URL=https://<pager-host>/api/a6-alert
VH_PUBLIC_FEED_ALERT_WEBHOOK_HMAC_SECRET=<same secret as VH_PAGER_A6_WEBHOOK_SECRET>
```

## Test Fire Readback

After pager deployment, the enablement session should prove:

- the alert watch generated a post-start test-fire summary;
- the webhook delivery status is `sent`;
- the sent channel is the pager webhook, not only email;
- the pager accepted and persisted it;
- the pager readback incident key matches the alert class/family;
- a GitHub issue URL or number exists;
- the operator received the phone/email alert.

The repo helper for the machine-readable part is:

```bash
node tools/scripts/validate-public-feed-alert-pager-output.mjs \
  --alert-summary ~/.local/state/vhc/public-feed-alert/latest.json \
  --pager-readback /path/to/pager-readback.json \
  --started-at "$TEST_FIRE_STARTED_AT"
```

## Incident Flow

When an incident issue appears:

1. The triage worker builds a public-safe Codex prompt from the issue.
2. Codex investigates repo-side and drafts tests, PRs, and an operator packet if
   needed.
3. The reviewer worker runs either `fable` or `sol`.
4. The signed review verdict is written beside the packet.
5. The operator writes an unedited GitHub comment:

```text
/vhc approve packet <packet-id> <packet-sha256>
```

6. The A6 pull executor verifies the packet, review signature, comment identity,
   allowed phase, kill switch, and exit-class guard.
7. The readback verifier proves the expected health signal after action.

## Kill Switch

Set `VH_INCIDENT_AUTOMATION_PAUSED=1` anywhere the automation runs to stop
triage/execution. Paging should not be disabled by this switch; a paused
automation still needs alerts.

## Executor Safety

`tools/scripts/vhc-packet-executor.mjs` is dry-run unless
`VH_PACKET_EXECUTOR_ENABLE_LIVE=1` is present. Even with live execution enabled,
it refuses packets that fail verification and refuses publisher restarts for
exit 75 or exit 78.

`VH_INCIDENT_TRUST_PHASE` is trusted local executor configuration. Packet JSON
may document its intended phase, but the verifier does not use packet-controlled
`trustPhase` to expand the allowed action set.

The shipped user-systemd files are:

- `infra/systemd/user/vh-vhc-packet-executor.service`
- `infra/systemd/user/vh-vhc-packet-executor.timer`

They are not enabled by this PR.
They are also not enabled by the current A6 operating posture.

## Pager Dead-Man

`.github/workflows/vhc-pager-deadman.yml` checks the pager health endpoint every
30 minutes. It fails if the pager is unreachable, unhealthy, has zero active
subscriptions, or reports a stale heartbeat. On failure it opens a GitHub
incident issue so the pager cannot fail silently.

## Non-Goals

- No Scope B promotion.
- No quorum weakening.
- No retention, compaction, eviction, or publisher clear.
- No raw heap artifact movement through GitHub, email, pager, or model prompts.
- No production-grade freshness claim until the separate distribution-readiness
  evidence window supports it.
