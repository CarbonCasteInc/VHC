# VHC Autonomous Incident Response - Slice Plan

> Status: Proposed implementation plan
> Owner: coordinating agent + VHC Launch Ops
> Last Reviewed: 2026-07-06
> Depends On: docs/ops/public-feed-freshness-monitor.md, docs/ops/news-aggregator-production-service.md, docs/plans/DISTRIBUTION_READINESS_GOAL_2026-07-05.md, docs/plans/DISTRIBUTION_READINESS_SLICES_2026-07-05.md

## Target System

Build the incident response loop that distribution readiness now needs:

```text
A6 alert/watch output
-> VHC proprietary pager outside A6
-> iPhone push notification
-> GitHub incident issue as the case file
-> Codex triage worker reads the issue and gathers read-only evidence
-> Codex opens a PR or drafts an exact operator packet
-> independent SOTA review gate approves or blocks the packet
-> Lou approves the plain-English business action
-> automation executes only the exact approved packet
-> readback verifier updates the issue and closes the loop
```

The reviewer must be switchable at any time:

- `fable`: Anthropic API path, configured by environment. Treat "Fable" as a
  VHC provider alias; do not hard-code a public model string in source.
- `sol`: Codex OAuth / ChatGPT-managed Codex path on a trusted private runner.
  Treat "Sol" as a VHC provider alias; do not hard-code a public model string
  in source.

The switch is issue-local and reversible by label or command. A human can move
an incident from Fable to Sol, or Sol to Fable, without redeploying the pager or
responder.

## Grounded Current State

Repo state observed for this plan:

- `main` is at `e665dd71` (`Harden origin deploy and release evidence manifest (#721)`).
- No open GitHub PRs were present during this grounding pass.
- The two distribution-readiness plan docs remain untracked workspace material:
  `docs/plans/DISTRIBUTION_READINESS_GOAL_2026-07-05.md` and
  `docs/plans/DISTRIBUTION_READINESS_SLICES_2026-07-05.md`. Do not silently
  overwrite or commit them as part of this plan.

Existing repo primitives to reuse:

- Alert producer: `tools/scripts/public-feed-alert-watch.mjs` already emits
  `vh-public-feed-alert-watch-v1` JSON with publisher, freshness, relay
  liveness, relay snapshot, watch-closure verdict, severity, blockers,
  fingerprint, and delivery state. It posts JSON to
  `VH_PUBLIC_FEED_ALERT_WEBHOOK_URL` and supports email delivery.
- Alert classifications: the alert watch distinguishes exit 69 self-recovery
  from exit 69 start-limit parking, exit 75 wrapper refusal, and exit 78
  fail-closed parking. It already dedupes by fingerprint and can heartbeat
  unchanged state with `VH_PUBLIC_FEED_ALERT_HEARTBEAT_MS`.
- Watch-closure evidence: `tools/scripts/phase5-scope-a-watch-closure-packet.mjs`
  writes a compact alert-safe verdict at
  `~/.local/state/vhc/phase5-scope-a-watch-closure/verdict.json` and preserves
  24h/48h blockers, relay memory trend status, and heap/RSS limit provenance.
- Heap retainer intake: `tools/scripts/analyze-early-heap-captures.mjs` reads
  only `*.heap-summary.json` plus optional soak archive summaries and refuses
  `.heapsnapshot` paths.
- Release evidence: `tools/scripts/regenerate-mvp-release-evidence.mjs`
  regenerates the reports consumed by `pnpm check:mvp-closeout`, records
  artifact sha256 values, and supports `--commit`.
- Systemd install surface: `tools/scripts/install-news-aggregator-production-service.sh`
  installs publisher, liveness, soak archive, watch-closure, and alert units,
  and verifies generated user units with `systemd-analyze verify --user` when
  available.
- GitHub support surface: `.github/ISSUE_TEMPLATE/public-beta-support.yml`
  exists for public beta support, but there is no operational incident issue
  template, incident label contract, pager receiver, or Codex responder
  workflow yet.

External API grounding:

- Codex supports non-interactive `codex exec`, JSON output, output schemas,
  explicit sandbox modes, the Codex GitHub Action, SDK control, automations,
  and ChatGPT-managed access tokens for trusted non-interactive workflows.
  For the Sol path, use ChatGPT-managed Codex auth only on a private trusted
  runner; do not paste or commit `~/.codex/auth.json`.
- Anthropic's Claude API supports official SDKs, the Messages API, API-key
  auth through `ANTHROPIC_API_KEY` / `x-api-key`, and Workload Identity
  Federation for production workloads. For the Fable path, put the exact model
  alias in operator-owned env, not source.

## Standing Boundaries

- No live A6 mutation without an explicit approved packet. This includes
  restarts, deploys, timer changes, env changes, compaction, retention,
  eviction, publisher clear, and mesh writes.
- Read-only A6 checks are allowed only through a locked-down evidence collector
  that emits secret-safe summaries. No raw heap snapshots, tokens, webhook
  URLs, private env values, signatures, or payload bodies may enter GitHub
  issues or model context.
- Preserve 2-of-3 relay write quorum. Never count successes across attempts.
- Exit 78 remains the non-restarting write-safety park. Exit 69 remains the
  transport-total restartable class. Do not soften fail-close behavior.
- No retention, compaction, eviction, or memory remediation until early heap
  summary evidence names the retainer class.
- GitHub issues are public-safe case files. Anything private must be represented
  by hashes, counts, timestamps, status classes, or links to host-private paths
  that are not themselves copied into the issue body.

## Slice 1 - Incident Contract And Case-File Template

Goal: define the durable GitHub issue shape before any automation writes issues.

Implement:

- Add `.github/ISSUE_TEMPLATE/a6-incident.yml` for operator/system-created A6
  incidents. It must warn that issues are public-safe records and must not
  request secrets, raw heap artifacts, private payloads, or private env values.
- Add a spec file under docs/specs for the VHC incident-response contract with:
  - incident schema `vhc-incident-v1`;
  - required fields: severity, alert class, source fingerprint, first seen,
    last seen, affected service, current status, safe evidence, runbook links,
    SOTA reviewer, approval state, execution packet hash, readback state;
  - allowed labels and state transitions.
- Add `tools/scripts/check-vhc-incident-response.mjs` plus a package script
  `check:vhc-incident-response` to verify the issue template, labels in docs,
  required redaction warnings, and no forbidden private-data prompts.
- Add fixtures under `tools/fixtures/incidents/` for critical, warning,
  recovered, and test-fire incidents.

Tests:

- `corepack pnpm@9.7.1 check:vhc-incident-response`
- `corepack pnpm@9.7.1 docs:check`
- `git diff --check`

Done when:

- A GitHub issue can function as the incident record without exposing private
  material.
- Automation has one schema to validate before creating or updating issues.

## Slice 2 - Proprietary Pager Receiver Outside A6

Goal: replace third-party paging with a small VHC-owned receiver that can run
outside the A6 failure domain.

Implement:

- Add `services/vhc-pager/` as a Cloudflare Worker-compatible TypeScript
  service, with a Node test harness. The service must not require A6 to be
  healthy once an alert has already left A6.
- Endpoints:
  - `GET /healthz`
  - `POST /api/a6-alert`
  - `POST /api/a6-heartbeat`
  - `POST /api/test-fire`
  - `POST /api/ack`
  - `POST /api/push/subscribe`
  - `DELETE /api/push/subscribe/:id`
- Authenticate A6 calls with HMAC over the raw request body using
  `VH_PAGER_A6_WEBHOOK_SECRET`. Persist only sanitized alert summaries and
  request hashes.
- Store incident state by normalized incident key:
  `a6:<source>:<severity>:<fingerprint>`.
- Implement dedupe and repeat rules:
  - first critical: push immediately and create/update issue;
  - unchanged critical: repeat until acknowledged at configured interval;
  - warning: push once, then digest unless it worsens;
  - recovered: update issue and send recovery push;
  - missing heartbeat: critical if no A6 heartbeat within the configured window.
- Add a local in-memory storage adapter for tests and a production storage
  adapter for the chosen worker platform.

Tests:

- Unit tests for HMAC verification, dedupe, repeat, ack, recovery, and missing
  heartbeat.
- Fixture replay using real `public-feed-alert-watch` summary shapes.

Done when:

- The pager can receive today's `public-feed-alert-watch` JSON without changing
  the producer.
- The pager can alert when A6 goes silent after heartbeats were previously
  healthy.

## Slice 3 - iPhone Web Push PWA

Goal: give Lou a private iPhone notification surface without a paid pager.

Implement:

- Add a private pager PWA under `services/vhc-pager/pwa/` or an equivalent
  static bundle served by the pager worker.
- Support:
  - add-to-Home-Screen onboarding;
  - push permission request;
  - subscription registration;
  - current incident list;
  - acknowledge button;
  - test-fire button;
  - recovery status.
- Use Web Push with VAPID keys stored outside source control. Do not commit
  private keys.
- Keep notification content short and safe:
  `[VHC A6] critical: publisher exit_78_fail_closed` plus issue link.
- Add a visual "last pager heartbeat" and "last A6 heartbeat" status so the
  human can tell whether the pager itself is alive.

Tests:

- Unit tests for push payload construction and redaction.
- Browser smoke for subscription UI using mocked Push APIs.
- Manual iPhone acceptance test recorded in docs: install PWA, enable alerts,
  receive test-fire, acknowledge test incident.

Done when:

- Lou's iPhone receives a test push from the VHC pager.
- The push links to the GitHub incident case file.

## Slice 4 - GitHub Incident Bridge

Goal: make the GitHub issue the durable case file.

Implement:

- Add a GitHub client module inside `services/vhc-pager/` that can:
  - create an incident issue from a sanitized alert;
  - update an existing issue by fingerprint or open incident key;
  - add labels;
  - append timeline comments;
  - post recovery comments;
  - avoid duplicate issues during repeated alerts.
- Required labels:
  - `incident`
  - `a6`
  - `public-feed`
  - `severity:critical` or `severity:warning`
  - `needs-codex-triage`
  - `reviewer:fable` or `reviewer:sol`
  - `operator-action-needed`
  - `waiting-for-readback`
  - `resolved`
- Issue body sections:
  - alert summary;
  - current state;
  - safe evidence;
  - blocked/forbidden actions;
  - Codex triage checklist;
  - SOTA review state;
  - approved packet hash;
  - readback log.
- Use a GitHub token scoped to issue write only for the pager service. The
  pager must not have code-write permission.

Tests:

- Mock GitHub REST tests for create/update/dedupe/recovery.
- Redaction tests proving webhook URLs, tokens, private env names, raw payload
  bodies, and raw heap paths are not written.

Done when:

- A test-fire alert creates or updates exactly one issue.
- Repeated identical alerts update the timeline without issue spam.

## Slice 5 - Alert Egress And Heartbeat Runbook

Goal: connect the existing A6 alert producer to the pager without weakening
current alert fail-close behavior.

Implement:

- Update `docs/ops/public-feed-freshness-monitor.md` with a pager-specific
  Block A/Block B:
  - configure `VH_PUBLIC_FEED_ALERT_WEBHOOK_URL` to the pager endpoint;
  - configure `VH_PUBLIC_FEED_ALERT_HEARTBEAT_MS` for positive heartbeat;
  - run `VH_PUBLIC_FEED_ALERT_TEST_FIRE=1`;
  - require pager push receipt and GitHub issue creation before enabling timer.
- Add a small `tools/scripts/validate-public-feed-alert-pager-output.mjs`
  helper that checks local alert output plus pager issue/readback summary.
- Do not change the alert watch's existing webhook/email behavior unless tests
  prove a compatibility gap.

Tests:

- Existing `check:public-feed:alert-watch`.
- New validation helper tests using mocked pager/GitHub responses.
- `docs:check`.

Done when:

- A6 can be configured to send the existing alert JSON to the VHC pager.
- The enablement runbook fails closed unless iPhone push and GitHub issue
  creation are both confirmed.

## Slice 6 - Codex Incident Triage Worker

Goal: let Codex continuously inspect incident issues and produce useful work
without unattended production-write authority.

Implement:

- Add `tools/scripts/vhc-incident-triage-worker.mjs`.
- It polls GitHub issues with:
  - `incident`
  - `a6`
  - `needs-codex-triage`
  - not `codex-investigating`
  - not `resolved`
- It creates a dedicated worktree or temporary clone per issue.
- It runs a read-only evidence collection phase first:
  - repo state and current head;
  - relevant docs/code grep;
  - public endpoint checks when configured;
  - safe alert/watch JSON summaries from the issue;
  - optional locked-down read-only A6 collector output, if separately
    provisioned.
- It then invokes Codex through the Sol path when code work is needed:
  - `codex exec` or Codex SDK;
  - `Sandbox.read_only` for diagnosis;
  - `Sandbox.workspace_write` only for repo-side fixes;
  - output schema for diagnosis and action proposal.
- It may open a branch and draft PR for repo-side changes. Branches must use
  `coord/incident-<issue-number>-<slug>`.
- It may draft an operator packet. It may not execute it.

Runner:

- Preferred: trusted private runner outside A6 with ChatGPT-managed Codex auth
  or Codex access token. Do not use a public GitHub-hosted runner for the OAuth
  auth cache.
- Acceptable fallback: GitHub Action using OpenAI API key through
  `openai/codex-action@v1`, but that is not the "Sol via Codex OAuth" path and
  should be recorded as a fallback.

Tests:

- Mock GitHub issue polling and label transitions.
- Fixture incident -> read-only diagnosis comment.
- Fixture incident -> branch + draft PR without production commands.
- Prompt-injection tests against issue body content.

Done when:

- A new incident issue gets a Codex diagnosis comment within the configured
  polling interval.
- Repo-side fixes become draft PRs with tests.
- Live actions become exact packets, not executed commands.

## Slice 7 - Switchable Fable/Sol Review Gate

Goal: replace the missing technical human review with an independent structured
model review that Lou can switch at any time.

Implement:

- Add `tools/scripts/vhc-incident-reviewer.mjs`.
- Add provider adapters:
  - `fable-anthropic`: direct Anthropic Messages API via `ANTHROPIC_API_KEY`
    or Workload Identity Federation. Env: `VH_INCIDENT_FABLE_MODEL`.
  - `sol-codex`: Codex non-interactive or SDK path using ChatGPT-managed Codex
    auth on the trusted runner. Env: `VH_INCIDENT_SOL_MODEL`.
- Add provider selection:
  - default env: `VH_INCIDENT_REVIEW_PROVIDER=fable|sol`;
  - issue labels: `reviewer:fable`, `reviewer:sol`;
  - issue commands: `/vhc reviewer fable`, `/vhc reviewer sol`.
- Add normalized review packet:
  - incident issue body and safe comments;
  - Codex diagnosis;
  - diff or PR URL;
  - proposed operator packet;
  - forbidden action checklist;
  - evidence-preservation risks;
  - expected readbacks;
  - rollback/stop conditions.
- Required structured verdict:
  - `pass`, `block`, or `needs_more_evidence`;
  - risk: `low`, `medium`, `high`;
  - approved action IDs;
  - blocked action IDs;
  - required readbacks;
  - plain-English summary for Lou.
- Fail closed on malformed JSON, missing required fields, provider timeout,
  provider mismatch, or review of a stale packet hash.

Tests:

- Provider-switch tests without changing issue content.
- Fable and Sol stub adapters returning pass/block/malformed verdicts.
- Packet hash mismatch blocks approval.
- Forbidden actions are blocked even if a model says pass.

Done when:

- Lou can switch reviewer by label/comment.
- No execution packet can advance without a passing structured review from the
  currently selected provider.

## Slice 8 - Plain-English Approval And Exact-Packet Executor

Goal: let a non-technical human approve a reviewed action without judging logs
or commands.

Implement:

- Add an execution packet schema `vhc-operator-packet-v1`.
- Add `tools/scripts/vhc-operator-packet-verify.mjs`:
  - validates action IDs against an allowlist;
  - validates packet hash;
  - validates SOTA review pass against the same hash;
  - validates Lou's approval comment references the same hash;
  - refuses forbidden actions.
- Approval command:
  - `/vhc approve packet <packet-id> <sha256>`
- Executor runs only on a trusted private runner with scoped production access.
  It must execute the exact packet body whose hash was approved.
- Initial allowlist:
  - run read-only A6 collector;
  - enable alert/watch timers after test-fire proof;
  - restart publisher after network recovery proof;
  - deploy a named already-merged commit using an emitted deploy packet;
  - run heap analyzer on summary files.
- Explicitly forbidden until separately reviewed:
  - retention;
  - compaction;
  - eviction;
  - publisher clear;
  - quorum reduction;
  - fail-close weakening;
  - raw heap snapshot export;
  - mesh production write.

Tests:

- Approval parser tests.
- Hash mismatch blocks.
- Missing SOTA pass blocks.
- Forbidden action blocks.
- Dry-run executor test with a no-op command.

Done when:

- Lou's approval responsibility is reduced to approving a named, reviewed,
  bounded business action.
- The executor cannot drift from the reviewed packet.

## Slice 9 - Readback Verifier And Incident Closure

Goal: make recovery proof automatic and issue-based.

Implement:

- Add `tools/scripts/vhc-incident-readback-verifier.mjs`.
- For each packet action, define required readbacks:
  - alert enablement: latest alert output is test-fire, delivery sent, iPhone
    receipt confirmed, timer active;
  - publisher restart: unit active/running, first clean tick, public freshness
    under SLO, no exit 78/75/parked 69;
  - heap analyzer: summary-only input, classified retainer or named missing
    measurement, no raw heap path in output;
  - release evidence: chosen commit matches, pipeline report exists, sha256s
    present, closeout blockers recorded.
- Post readback summaries to the issue.
- Move labels:
  - `operator-action-needed` -> `waiting-for-readback`;
  - `waiting-for-readback` -> `resolved` only when readbacks pass;
  - add `needs-more-evidence` on inconclusive results.
- Do not auto-close an incident while the pager still reports critical state or
  watch-closure verdict is failing.

Tests:

- Fixture readbacks for pass/fail/inconclusive.
- Label transition tests.
- Secret-safety tests.

Done when:

- Every executed packet leaves an auditable issue timeline.
- Incidents cannot close on "command ran" alone; they close on readback proof.

## Slice 10 - End-To-End Drill And Operating Docs

Goal: prove the whole loop before trusting it with production incidents.

Implement:

- Add an end-to-end dry-run fixture:
  - synthetic critical alert;
  - pager receives and sends mock push;
  - GitHub issue created;
  - Codex triage comment posted;
  - Fable review pass;
  - Sol review pass after switching labels;
  - Lou approval command parsed;
  - no-op packet executed;
  - readback verifier resolves issue.
- Add ops docs for VHC incident response, pager iPhone setup, and the Codex
  responder.
- Add a one-page lay operator version:
  - what the phone alert means;
  - what button/comment Lou uses;
  - what actions are always forbidden;
  - how to switch Fable/Sol;
  - how to pause automation.

Tests:

- `corepack pnpm@9.7.1 check:vhc-incident-response`
- `corepack pnpm@9.7.1 check:public-feed:alert-watch`
- `corepack pnpm@9.7.1 check:scope-a-watch-closure`
- `corepack pnpm@9.7.1 check:early-heap-captures`
- `corepack pnpm@9.7.1 docs:check`
- `git diff --check`

Done when:

- A synthetic incident completes the full loop without touching live A6.
- The first live enablement session has a documented dry-run proof.

## Dependency Order

```text
Slice 1 incident contract
  -> Slice 2 pager receiver
  -> Slice 3 iPhone PWA
  -> Slice 4 GitHub incident bridge
  -> Slice 5 A6 alert egress/heartbeat runbook
  -> Slice 6 Codex triage worker
  -> Slice 7 Fable/Sol review gate
  -> Slice 8 approval/executor
  -> Slice 9 readback verifier
  -> Slice 10 end-to-end drill/docs
```

Slices 6 and 7 can begin after Slice 1 if they use issue fixtures, but they
cannot be enabled against live incidents until Slices 2-5 prove the alert and
case-file path.

## First Physical PR

Start with Slice 1. It is the lowest-risk PR and prevents later automation from
inventing incompatible issue formats.

Expected first branch:

```text
coord/incident-response-contract
```

Expected first checks:

```bash
corepack pnpm@9.7.1 check:vhc-incident-response
corepack pnpm@9.7.1 docs:check
git diff --check
```

## Sources Checked

- Current repo alert producer and delivery code:
  `tools/scripts/public-feed-alert-watch.mjs`
- Current watch-closure packet:
  `tools/scripts/phase5-scope-a-watch-closure-packet.mjs`
- Current heap analyzer:
  `tools/scripts/analyze-early-heap-captures.mjs`
- Current release evidence pipeline:
  `tools/scripts/regenerate-mvp-release-evidence.mjs`
- Current A6 production docs:
  `docs/ops/public-feed-freshness-monitor.md`,
  `docs/ops/news-aggregator-production-service.md`
- Codex non-interactive, SDK, automations, GitHub Action, and auth docs:
  https://developers.openai.com/codex/
- Anthropic API auth and SDK docs:
  https://platform.claude.com/docs/en/manage-claude/authentication,
  https://platform.claude.com/docs/en/cli-sdks-libraries/overview
