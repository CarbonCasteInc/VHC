# VHC Codex Incident Responder

> Status: Draft / Dry-Run-Only Live Boundary
> Owner: VHC Launch Ops
> Last Reviewed: 2026-07-06
> Depends On: docs/ops/vhc-incident-response.md, docs/specs/spec-vhc-incident-response.md

## Role

The Codex responder turns a public-safe GitHub incident issue into engineering
work:

- read the case file;
- run repo-side and read-only checks;
- write failing tests when the repo needs a regression guard;
- open focused PRs;
- draft operator packets;
- never execute live A6 mutation from the issue.

As of 2026-07-06, the responder tooling exists in repo after #722, but live A6
execution/autonomy is not enabled. The active guardrail is the Slice 0 email
alert path: if no alert is firing and the feed remains fresh, the responder
should not manufacture live work. The next allowed engineering triggers are a
new alert or the first post-recovery 500 MB -> 700 MB heap-summary pair.

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
