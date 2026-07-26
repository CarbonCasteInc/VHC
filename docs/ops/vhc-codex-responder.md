# VHC Codex Incident Responder

> Status: Draft / Dry-Run-Only Live Boundary
> Owner: VHC Launch Ops
> Last Reviewed: 2026-07-25
> Depends On: docs/ops/public-beta-operational-state.md, docs/ops/vhc-incident-response.md, docs/specs/spec-vhc-incident-response.md

Current-state override: repository investigation and PR work remain allowed,
but governed recovery is `NO_GO_BLOCKED_EXTERNAL_LOST_CUSTODY`. The July 10
incident readback below is historical; no July 25 live readback or A6 action
was performed. See `docs/ops/public-beta-operational-state.md`.

## Role

The Codex responder turns a public-safe GitHub incident issue into engineering
work:

- read the case file;
- run repo-side and read-only checks;
- write failing tests when the repo needs a regression guard;
- open focused PRs;
- draft operator packets;
- never execute live A6 mutation from the issue.

The responder tooling exists in repo after #722. Repository defaults keep live
A6 execution/autonomy disabled.

<!-- PUBLIC_BETA_HISTORICAL_LIVE_SNAPSHOT_START -->
## Historical Incident Snapshot - 2026-07-10

The July 10 readback classified a real alert as
`relay_rest_story_timeout_total_0_of_3_exit_78`; the publisher was parked exit
`78`. At that date, repo-only S1B implementation/review could proceed while A6
update, service action, alert-channel change, and downstream launch work
remained blocked.

Those facts have not been revalidated as July 25 current-live state.
<!-- PUBLIC_BETA_HISTORICAL_LIVE_SNAPSHOT_END -->

The next valid boundary is the custody decision and independent review owned by
`docs/ops/public-beta-operational-state.md`, followed in order by Gate P, Gate
R, Gate I, and a fresh separately authorized Gate L packet. The July 10 packet
or approval cannot supply that authority.

## First Checks

From a fresh checkout:

```bash
git fetch origin main
git status --short --branch
corepack pnpm@9.7.1 check:vhc-incident-response
```

If the issue points to a current alert-watch output, do not copy raw payloads or
private logs into the repo. Use only the safe summary fields from the issue or
from approved read-only A6 readback.

If there is no active incident and the request is only to inspect the current
proof window, stay read-only. No publisher restart, relay restart, alert-channel
change, retention/compaction work, or executor enablement is implied by a stale
historical issue.

## Triage Worker

For fixture-driven local triage:

```bash
node tools/scripts/vhc-incident-triage-worker.mjs \
  --fixture tools/fixtures/incidents/github-issue-exit69.json
```

In production, a GitHub-backed wrapper should provide open issues and comments
to the same planner. The planner ignores unallowlisted edited command comments.

## Reviewer Lanes

Use `fable` when the Anthropic API path is selected:

```bash
node tools/scripts/vhc-incident-reviewer.mjs \
  --provider fable \
  --packet /path/to/packet.json \
  --triage /path/to/triage.json
```

Use `sol` when the Codex OAuth path is selected:

```bash
node tools/scripts/vhc-incident-reviewer.mjs \
  --provider sol \
  --packet /path/to/packet.json \
  --triage /path/to/triage.json
```

The default policy is reviewer not proposer. If Codex/Sol proposed the packet,
Fable should review unless the issue is explicitly labeled
`same-provider-review`.

## Approval Packet Verification

Before an executor can act, verify:

```bash
node tools/scripts/vhc-operator-packet-verify.mjs \
  --packet /path/to/packet.json \
  --review /path/to/review.json \
  --approval /path/to/approval-comment.json \
  --review-public-key /path/to/review-public-key.pem \
  --systemctl /path/to/publisher-systemctl.json
```

The verifier fails closed on:

- packet hash mismatch;
- invalid or expired review signature;
- non-allowlisted or edited approval comment;
- action not allowed in the current trust phase;
- forbidden action id;
- publisher restart packet when readback shows exit 75 or exit 78;
- automation kill switch.

The shipped executor action is deliberately limited to
`restart_publisher_exit69_only`. It cannot authorize an exit-78 recovery, and
changing that guard is not part of S1B. Any future exit-78 recovery must use
the fresh dedicated attended packet and authority boundary described above.

## Pull Executor

The executor is designed to run locally on A6 and is pull-based; repository
capability does not prove current deployment or enablement:

```bash
node tools/scripts/vhc-packet-executor.mjs \
  --packet /path/to/packet.json \
  --review /path/to/review.json \
  --approval /path/to/approval-comment.json \
  --review-public-key /path/to/review-public-key.pem \
  --systemctl /path/to/publisher-systemctl.json
```

Without `--execute` it prints the dry-run plan. With `--execute`, it still
refuses live action unless `VH_PACKET_EXECUTOR_ENABLE_LIVE=1` is present on A6.

## Readback Verification

After any approved action, verify readback:

```bash
node tools/scripts/vhc-incident-readback-verifier.mjs \
  --action restart_publisher_exit69_only \
  --evidence /path/to/readback.json
```

Readback is part of the action. A restart without first clean tick and public
freshness proof is not a completed recovery.

## Safe Output Rules

Do not include:

- tokens, keys, private env values, webhook URLs, signatures, or raw request
  bodies;
- raw heap snapshots or heap profiles;
- private logs or story payload bodies.

Use hashes, counts, statuses, ages, and failure classes.
