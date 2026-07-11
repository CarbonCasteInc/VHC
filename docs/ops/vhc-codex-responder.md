# VHC Codex Incident Responder

> Status: Draft / Dry-Run-Only Live Boundary
> Owner: VHC Launch Ops
> Last Reviewed: 2026-07-11
> Depends On: docs/ops/public-beta-operational-state.md, docs/ops/vhc-incident-response.md, docs/specs/spec-vhc-incident-response.md

## Role

The Codex responder turns a public-safe GitHub incident issue into engineering
work:

- read the case file;
- run repo-side and read-only checks;
- write failing tests when the repo needs a regression guard;
- open focused PRs;
- draft operator packets;
- never execute live A6 mutation from the issue.

The responder tooling exists in repo, but live A6 execution/autonomy is not
enabled. S1A classified `relay_rest_story_timeout_total_0_of_3_exit_78`, and the
S1B remediation is merged and reviewed. Supervised load attempt 001 stopped
before mutation at `remote_staging_unexpected_content`; it did not refresh or
recover A6. The current `NO_GO_STOP_REPORT_REMOTE_STAGING_BASE_UNSAFE` decision
and exact next gate are owned by `docs/ops/public-beta-operational-state.md`.

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
`restart_publisher_exit69_only`. It cannot authorize the current exit-78
recovery, and changing that guard is not part of S1B. The exit-78 recovery must
use the dedicated attended packet and authority boundary described above.

## Pull Executor

The executor is local to A6 and pull-based:

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
