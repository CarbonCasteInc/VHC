# Public Beta Next-Phase Orchestration Prompt And Sprint Checklist - 2026-07-09

> Status: Action prompt and technical execution checklist for the next release phase
> Owner: VHC Core Engineering + VHC Launch Ops
> Human authority: Lou
> Technical executor: Codex orchestrator through isolated implementation and review subagents
> Branch basis: #759 release-readiness control branch
> Target public app: `https://venn.carboncaste.io`
> Target auth boundary: `https://auth.venn.carboncaste.io`
> Support/failure mailbox: `carboncasteit@gmail.com`
> First advertised providers: Apple and Google
> Deferred provider: X
> Depends On: `docs/ops/public-beta-launch-control-2026-07-09.md`,
> `docs/ops/auth-callback-provider-deployment-packet-2026-07-09.md`,
> `docs/ops/public-beta-distribution-packet-2026-07-09.md`,
> `docs/ops/a6-accepted-synthesis-canary-packet-2026-07-09.md`,
> `docs/ops/storycluster-headline-soak-credential-repair-2026-07-09.md`,
> `docs/ops/public-beta-image-deploy.md`,
> `docs/ops/BETA_SESSION_RUNSHEET.md`,
> `docs/plans/RELEASE_READINESS_SPRINT_OUTLINE_2026-07-08.md`

## Orchestration-Agent Action Prompt

You are the orchestration agent responsible for executing this checklist end to
end through delegated implementation, independent review, integration, and
evidence collection. Treat the detailed slice requirements below as the
normative contract. Do not merely summarize or rewrite them.

Your mission is to move the controlled public beta from its verified current
state through S0-S12 without weakening release gates, quorum, privacy, incident
authority, or secret boundaries. Delegate bounded work to subagents, inspect
their actual diffs and evidence, send defects back to the owning implementer,
require a subsequent review, and integrate only work that passes every gate.

### Start From Live Truth

Before assigning implementation work:

1. Read this file, its `Depends On` documents, every applicable `AGENTS.md`,
   and the exact source/test files named by the active slice.
2. Run `git fetch origin --prune`, inspect the current branch/worktree, and
   resolve the live PR head/base/check state. Remote PR truth overrides stale
   status prose.
3. Preserve unrelated user changes. In Lou's current workspace, the local-only
   files `DISTRIBUTION_READINESS_GOAL_2026-07-05.md` and
   `DISTRIBUTION_READINESS_SLICES_2026-07-05.md` are untracked and must not be
   staged, deleted, or copied into a lane.
4. Read the latest `.tmp/vhc-failure-mailbox-monitor/latest.json` and dedupe
   state. Monitor `status: pass` is execution health, not incident clearance.
5. Re-run read-only A6/public-feed readback if the latest critical or live state
   differs from the evidence below. Do not mutate A6 during truth refresh.
6. Create `.tmp/public-beta-orchestration/<run-id>/ledger.json` and record the
   verified base SHA, PR state, active incident, lane assignments, gates, test
   evidence, review verdicts, and authority decisions. Store no secrets.

Review-time snapshot at `2026-07-10T01:38:58Z`, not execution authority:

- PR #759 is open and non-draft at head `7a32f9fc95ae6d1208ce32fa49027353bb3f7863`;
- base is `main@1f860ae71b51b588e69cb892bcc479675f6c0a9c`;
- all 9 reported CI checks passed, including Lighthouse and E2E;
- GitHub reported merge state `CLEAN`, but the PR remained open;
- S1A is classified but unresolved, and S1B is the first implementable repo
  slice.

Revalidate all five facts before acting. Do not call S0 green from this
snapshot.

### Authority Model

Repo-only implementation subagents may edit their assigned files, run tests,
commit, push a dedicated branch, and open a focused PR. They may not:

- merge their own PR;
- edit another lane's files;
- use the orchestrator's integration worktree;
- mutate A6, production services, relay state, Gmail, provider accounts, DNS,
  Cloudflare, Apple, Google, tester distribution, or pager configuration;
- print or persist raw secrets, private data, provider error bodies, relay
  tokens, URLs from host-private env, or story bodies.

The orchestrator owns integration, shared control documents, gate adjudication,
and merge order. Lou alone owns live incident/restart/rollback authority,
secret-bearing account actions, provider MFA, release go/no-go, and tester-wave
approval. A merged repo PR never implies live mutation approval.

### Isolation Rules

- One implementation lane equals one subagent, one branch, one isolated
  worktree or clone, and one focused PR.
- Never run parallel implementation agents in the same worktree.
- Branch every lane from the exact recorded base SHA. If PR #759 is not merged,
  either wait for G0 or use an explicitly stacked base and preserve merge order.
- If isolated worktrees/clones are unavailable, run lanes sequentially. Finish,
  test, review, push, and open the first lane PR before starting the next.
- Review agents inspect the real branch diff and test artifacts read-only. They
  do not patch the implementation they review.
- An implementer may not review its own lane. The cross-lane reviewer must be
  distinct from both G1 implementers and both first-pass reviewers.
- The orchestrator does not absorb Runtime or Alert implementation into the
  integration lane for convenience. If a required implementation subagent is
  unavailable, record that constraint and use the sequential fallback while
  retaining an independent reviewer.
- Shared files belong to the orchestrator/integration lane. A subagent that
  needs a shared-file change must return a proposed patch or requirement in its
  report instead of editing the file.

Orchestrator-owned shared surfaces include:

- this checklist;
- `docs/foundational/STATUS.md`;
- public-beta launch-control, distribution, closeout, and operator docs;
- `docs/CANON_MAP.md`;
- root `package.json` and cross-slice guard scripts;
- release evidence indexes and orchestration ledger files.

### Delegation Waves

| Wave | Delegated work | Parallelism | GO gate |
| --- | --- | --- | --- |
| G0 | Repo/PR/CI truth audit for S0 plus latest mailbox/A6 read-only state | One read-only auditor may assist the orchestrator | Exact base selected; PR #759 green/merged or stacked-base decision recorded |
| G1 | S1B Runtime lane and S1B Alert lane | Parallel only in isolated worktrees | Both implementation PRs independently reviewed, corrected, re-reviewed, and green |
| G2 | Cross-lane integration review, shared docs, full S1B gate | Sequential after G1 | Combined behavior preserves quorum/exit semantics, alert contract, and CI |
| G3 | Recovery-packet author and independent packet reviewer | Sequential after merged S1B commit | Secret-safe packet verified; Lou gives explicit live-action approval |
| G4 | A6 recovery/readback and required 24/48-hour soak | Single live operator session; subagents read-only only | S1A/S1B green with preserved evidence |
| G5 | S2 StoryCluster repair, then S3 auth-boundary deployment | Sequential; subagents may prepare/review, but the orchestrator owns live action under Lou's authority | Production-readiness and auth health pass without secret leakage |
| G6 | S4 Apple and S5 Google registration/rehearsal | Repo preparation/review may parallelize after S3; secret-bearing provider actions serialize through Lou-supervised sessions | Both advertised providers pass; X remains hidden |
| G7 | S6 origin build/deploy, S7 A6 release update, S8 synthesis canary | Strictly sequential | Each slice's live readback is green before the next starts |
| G8 | S9 evidence, S10 three-browser rehearsal, S11 distribution decision | Strictly sequential | Release packet green and Lou gives final go |
| G9 | S12 monitored ramp | Recurring monitor plus one orchestrator ledger | Each tranche has green watch evidence and separate Lou approval |

No later wave may consume a fixture-only pass, a stale artifact, an implementer
summary, or a pending CI run as proof that its prior gate is green.

For G3-G9, subagents may prepare packets, inspect repo changes, review plans,
or collect read-only evidence. They do not perform live mutations. The
orchestrator is the single technical driver for an approved live session, and
only after Lou supplies the exact authority required by that gate.

### G1 Lane Ownership

Runtime implementation lane:

- branch suggestion: `codex/s1b-relay-availability-total`;
- owns `packages/gun-client/src/newsAdapters.ts` and its focused tests;
- owns `services/news-aggregator/src/daemonWriteLane.ts`, `daemonCli.ts`, the
  minimum required `daemon.ts` logging change, and focused tests for those
  files;
- owns the minimum required `infra/relay/server.js` change and focused
  `packages/e2e/src/live/relay-server.vitest.mjs` coverage solely to expose
  nonmutating by-key signed-record readback for latest-index and hot-index;
- may propose, but must not directly edit, shared operational docs;
- must prove all four critical POST/readback contracts before making deadline
  retry eligible: story, latest-index, hot-index, and synthesis-lifecycle.

Alert implementation lane:

- branch suggestion: `codex/s1b-alert-fingerprint-mime`;
- owns `tools/scripts/public-feed-alert-watch.mjs` and its focused tests;
- owns directly affected publisher-liveness tests only if exit-class display
  needs adjustment;
- must preserve full diagnostic values outside the fingerprint, failed-delivery
  retry, explicit heartbeat, real state changes, and recovery delivery;
- may propose, but must not directly edit, shared operational docs.

Assign a separate reviewer to each implementation lane. After both lane
reviewers approve, assign a third cross-lane reviewer to inspect the combined
diff for timeout classification, brand propagation, exit mapping, fingerprint
migration, MIME parsing, redaction, and test omissions.

### Subagent Assignment Contract

Every assignment must include:

- lane id and one-sentence objective;
- exact base SHA, branch, worktree, and allowed file list;
- forbidden files and external actions;
- exact invariants and acceptance criteria copied from the relevant slice;
- exact tests the agent must run;
- requirement to inspect existing helpers before adding abstractions;
- requirement to preserve unrelated worktree changes;
- stop-and-report conditions;
- required completion report schema.

Each subagent must return:

```text
laneId:
role: implementer | reviewer | integration-reviewer | evidence-auditor
baseSha:
headSha:
branch:
filesChanged:
tests: command, exit status, concise result
artifacts:
findings: severity, file/line, rationale
unresolved:
authorityUsed: repo-only | read-only-external | Lou-approved-live
recommendedGate: GO | NO-GO
```

An implementer's `GO` is never self-approving. Missing test output, an
unexpected file, a changed base, an unreported live action, or a command that
exits zero while running zero matching tests is `NO-GO`.

### Review And Subsequent-Review Protocol

For each implementation PR:

1. The orchestrator verifies branch/base identity, changed-file scope, and test
   output before assigning review.
2. The independent reviewer leads with actionable findings ordered by severity
   and cites exact file/line locations.
3. Any P0/P1 finding is `NO-GO`. P2 findings must be fixed or explicitly
   adjudicated by the orchestrator with a written rationale. Test gaps affecting
   quorum, exit mapping, secret handling, or live rollback are at least P1.
4. The owning implementer fixes accepted findings in the same lane branch and
   reruns its complete required test set.
5. The same reviewer performs a subsequent review of the new head and confirms
   every prior finding as fixed, still open, or superseded.
6. The cross-lane reviewer then checks the integrated result and reruns the
   contract tests independently.
7. Merge only when there are no unresolved P0/P1 findings, every P2 is fixed or
   explicitly accepted, required CI is complete and green, and the ledger links
   the exact reviewed head SHA.

Do not replace review with test output. Do not replace tests with review.

### Orchestrator Decision Loop

At every gate, record exactly one verdict:

- `GO`: all prerequisites and evidence pass on the recorded SHA/state;
- `NO-GO`: a product, safety, CI, review, privacy, or live-readback requirement
  failed;
- `WAITING_FOR_LOU`: a secret-bearing login, MFA, incident mutation, rollback,
  provider approval, release decision, or tester-wave decision is required;
- `BLOCKED_EXTERNAL`: the required connector, host, provider, or network surface
  is unavailable after bounded retries.

On `NO-GO`, stop downstream dispatch, preserve evidence, and return work to the
owning lane. On `WAITING_FOR_LOU`, continue only unrelated repo work that this
checklist explicitly allows. On `BLOCKED_EXTERNAL`, do not substitute fixtures
or stale artifacts for live proof.

### Completion Contract

Do not declare the sprint complete until S12 exit criteria are met. At each
intermediate stop, report:

- current branch/PR/commit truth;
- lane and review status;
- tests and evidence actually verified;
- unresolved blockers and their owner;
- live mutations performed, each with Lou's approval reference;
- next eligible lane and why it is GO, NO-GO, or waiting.

The final report must separate merged repo capability, deployed live state,
release evidence, manual rehearsal, distribution approval, and post-launch
watch evidence. Never collapse them into one optimistic readiness claim.

## Review And Validation Record - 2026-07-10

First review found and resolved:

- single-executor prose with no delegation topology;
- no worktree/branch isolation or sequential fallback;
- no independent reviewer or subsequent-review contract;
- no shared-file owner or structured subagent handoff;
- minimum tests omitted the actual exit-code consumer in
  `services/news-aggregator`;
- S1B assumed route-level readback without requiring all four critical
  POST/readback contracts to be proven.

Subsequent review found and resolved:

- provider/live work could be misread as delegable to repo subagents;
- implementer and reviewer identities were not explicitly required to differ;
- S1B's lane/workstream count was internally inconsistent;
- S1B could be read as green when repo work finished but required A6 recovery
  had not run;
- the first relay-server test command used the root Vitest config, which
  excludes `packages/e2e`;
- the first news-runtime command targeted a package with no `test` script and
  could exit zero while running no tests.

Execution-time G0 contract audit found and resolved:

- latest-index and hot-index exposed only bounded aggregate GETs, so the Runtime
  lane could not prove exact endpoint-local timeout reconciliation;
- Runtime ownership omitted the two relay files required for the smallest
  permanent repair. The lane now owns by-key nonmutating signed-record GETs and
  focused relay integration coverage for those routes.

Current review verdict: no unresolved checklist-level P0/P1/P2 finding. This is
a verdict on the orchestration artifact, not on the unimplemented S1B code or
the unresolved live incident.

Validated locally after refinement:

- gun-client `newsAdapters.test.ts`: 168 passed;
- ai-engine `newsRuntime.test.ts`: 54 passed;
- news-aggregator daemon write-lane/exit coverage: 22 passed;
- relay-server integration: 53 passed;
- public-feed alert watch: 25 passed;
- publisher-liveness watch: 6 passed;
- VHC incident-response suite: 58 passed;
- gun-client and news-aggregator typechecks: pass;
- next-phase sprint guard: 8 passed;
- public-beta launch closeout: pass;
- docs governance: pass;
- `git diff --check`: pass.

GitHub validation at `2026-07-10T01:38:58Z`: PR #759 head
`7a32f9fc95ae6d1208ce32fa49027353bb3f7863` was open, merge-clean, and 9/9 CI
checks were green. The orchestration refinements in the current worktree are
newer local changes and require their own reviewed commit/CI before they can be
treated as remote PR truth.

Local Node is `v23.10.0`, outside the repo-declared `>=20 <23` engine range.
Commands passed with that warning, but CI on the supported runtime remains the
merge authority.

## Executive Frame

The next phase is not another broad product-build sprint. The product path is
implemented enough to attempt a controlled public beta once live evidence is
green. The work now is a deployment, credentials, evidence, and rehearsal sprint.

The human operating model is:

- Lou is the only human authority for release go/no-go, incident decisions,
  rollback, source/content policy, and outside-account approval.
- Codex is the technical staff and may execute the authorized technical work.
- Secret-bearing browser consoles and MFA prompts require Lou to log in or
  approve the prompt in real time.
- No raw secret is copied into chat, docs, PRs, GitHub issues, release artifacts,
  or terminal transcripts.

The public-beta target is:

- public app/PWA: `https://venn.carboncaste.io`;
- auth-callback boundary: `https://auth.venn.carboncaste.io`;
- app name in provider consoles: `venn`;
- geography: US and Canada;
- tester copy label: `public beta`;
- first sign-in providers: Apple and Google;
- X is hidden until a later provider packet adds and rehearses it;
- first tranche: at most 100 testers;
- later tranches: 500, 1000, then open only after green evidence plus Lou
  approval.

## Current Monitor Evidence Fold-In - 2026-07-10

The latest failure-mailbox monitor report changes the immediate sequence.
Monitor `status: pass` means the mailbox monitor ran and classified mail; it is not release clearance.

Monitor artifact:
`.tmp/vhc-failure-mailbox-monitor/latest.json`.

Current incremental monitor readout:

- generated at `2026-07-10T01:11:56.040Z`;
- `newCriticalCount: 1`;
- `newWarningCount: 2`;
- `newInfoCount: 0`;
- newest relevant message was `2026-07-10T01:07:59`;
- critical class includes `public_feed_alert_fail` for public-feed freshness;
- warning class includes `pager_deadman_workflow_failed`;
- recorded next action: treat as incident; preserve email; run read-only
  repo/A6 readback before mutation; Lou retains incident/rollback authority.

The first monitor baseline remains relevant incident history: it found 85 new
critical, 12 warning, and 5 info messages through `2026-07-10T00:07:57`. The
smaller incremental count means dedupe is working; it does not mean the
underlying public-feed incident recovered.

Read-only A6 diagnosis completed at `2026-07-10T01:17:07Z`:

- `vh-news-aggregator.service` is parked at `ExecMainStatus=78`;
- the triggering tick failed at `2026-07-09T18:11:39Z` when one raw
  `/vh/news/story` fanout produced `0/3` validated relay acknowledgements where
  `2/3` are required;
- all three public HTTPS requests hit the configured 10-second client deadline;
- the deployed fanout performs those requests sequentially, so one failed
  attempt can consume about 30 seconds before returning;
- timeout/abort failures are intentionally excluded from the existing
  transport-total retry class, so this failure bypassed bounded retry and
  entered the non-restarting exit-78 write-safety park;
- relay loopback liveness passed immediately before and after the incident, with
  no container restart, watchdog trip, queue backlog, OOM, or event-loop-lag
  breach; current public relay `/readyz` checks also pass;
- public-feed and relay-snapshot staleness are downstream consequences of the
  parked publisher, not separate root causes;
- repeated failure emails are amplified by a second defect: changing
  watch-window values such as `window_short:33.49/48` enter the alert
  fingerprint and generate false `state_changed` deliveries for one unresolved
  incident.

Current incident reason code:
`relay_rest_story_timeout_total_0_of_3_exit_78`.

`recommendedNextAction` requesting `treat as incident; preserve email; run
read-only repo/A6 readback before mutation; Lou retains incident/rollback
authority.` triggered S1A. The readback is now complete, but it classified an
unresolved exit-78 incident; readback completion alone does not clear mutation
or release work.

If `.tmp/vhc-failure-mailbox-monitor/latest.json` has `newCriticalCount > 0`,
the release is blocked even when `status: pass`.

Before any mutation, deploy, provider registration, A6 update, canary,
distribution, or tranche expansion, `newCriticalCount == 0` or Lou has made an
explicit incident decision after read-only repo/A6 readback.

`public_feed_alert_fail`, `public_feed_freshness_workflow_failed`, and
`public_feed_freshness_workflow_cancelled` are public-feed freshness blockers.

`pager_deadman_workflow_failed` warnings must be triaged and the pager dead-man workflow must be green before launch, post-launch watch, or tranche expansion.

Resulting sprint rule: repo-only S1B remediation may proceed while the incident
is active, but no StoryCluster credential repair, auth setup, origin redeploy,
A6 update outside the approved incident packet, accepted-synthesis canary,
release-evidence regeneration, manual rehearsal, distribution-packet
finalization, or tester invite may proceed until S1A and S1B exit green. Pager
dead-man warnings remain a watch item; they do not authorize pager cutover.

Guard tokens:

- `MAILBOX_PASS_IS_MONITOR_HEALTH_NOT_RELEASE_GREEN`
- `READ_ONLY_INCIDENT_TRIAGE_ONLY`
- `PUBLIC_FEED_ALERT_FAIL_BLOCKS_MUTATION`
- `A6_READBACK_BEFORE_ANY_MUTATION`
- `NO_STORYCLUSTER_AUTH_DEPLOY_UNTIL_INCIDENT_CLASSIFIED`
- `LOU_RETAINS_INCIDENT_ROLLBACK_AUTHORITY`
- `RELAY_WRITE_QUORUM_REMAINS_2_OF_3`
- `TIMEOUT_TOTAL_IS_UNACKNOWLEDGED_NOT_PROVABLY_UNPUBLISHED`
- `HTTP_BACKPRESSURE_REMAINS_FAIL_CLOSED`
- `DYNAMIC_AGE_FIELDS_ARE_NOT_ALERT_FINGERPRINT_INPUTS`
- `EXIT_78_RESTART_REQUIRES_LOU_INCIDENT_AUTHORITY`

## Non-Negotiable Boundaries

1. No Codex live execution/autonomy is enabled.
2. No pager cutover is part of this sprint.
3. No relay restart unless a focused incident packet authorizes it.
4. Publisher restart is allowed only when required by the approved release,
   update, canary, or incident path.
5. Accepted synthesis is enabled only through the bounded canary packet after
   preconditions pass.
6. Social sign-in is account continuity and profile recovery only. It is not
   verified-human identity. It is not LUMA Silver, one-human-one-vote, Sybil
   resistance, residency proof, or cross-device same-human continuity.
7. Public evidence must never contain provider tokens, provider subjects, raw
   email/profile labels, nullifiers, PKCE verifiers, signed state values, private
   keys, raw provider errors, addresses, wallet material, or raw constituency
   proof material.
8. The release evidence packet must pass on the intended release commit. Old
   passing packets do not count.
9. A new critical monitor item places the sprint in
   `READ_ONLY_INCIDENT_TRIAGE_ONLY` and blocks launch-enablement work until
   read-only repo/A6 readback classifies and clears it.
10. The durable timeout fix must not weaken relay quorum, treat an ambiguous
    timeout as a proven non-write, retry explicit HTTP/backpressure failures, or
    make an exit-78 publisher restart available to the exit-69-only executor.

## Access Window Needed From Lou

Codex can do the work once Lou provides browser/account access for these windows:

1. Cloudflare:
   - create or configure `auth.venn.carboncaste.io`;
   - create/deploy the auth worker;
   - create/bind the durable nonce store;
   - store worker secrets;
   - update DNS/routing/CSP as needed.
2. Namecheap only if the domain is not already delegated to Cloudflare:
   - verify nameserver delegation;
   - update nameservers only if required for Cloudflare DNS control.
3. Google Cloud:
   - create/select a Google Cloud project;
   - configure OAuth consent for public beta;
   - create the OAuth 2.0 web client;
   - set redirect URI `https://venn.carboncaste.io/auth/callback`;
   - store client id/secret in the auth boundary secret store.
4. Apple Developer:
   - confirm the Apple Developer Program membership is active;
   - configure App ID / Services ID for Sign in with Apple;
   - configure `https://auth.venn.carboncaste.io/auth/apple/return`;
   - create or select the Sign in with Apple key;
   - store key id, team id, client id, and `.p8` private key in the auth boundary
     secret store.
5. A6:
   - Codex may use the existing A6 SSH path for readback, release-commit
     update, public beta origin image redeploy, accepted-synthesis canary after
     preconditions, and publisher restart if required.
6. Gmail:
   - Codex App automation uses the Gmail connector against `carboncasteit@gmail.com`;
   - no send/archive/delete/label action is authorized by the monitor.

## Sprint Sequence

Run the slices in order. A later slice can start only when its required inputs
are present and the prior slice's stop rules are clear.

```text
S0  Repo/PR baseline and release commit candidate
S1  Failure-mailbox monitor and incident intake loop
S1A Monitor-critical public-feed incident readback gate
S1B Durable relay-timeout and alert-dedupe remediation
S2  StoryCluster headline-soak credential/endpoint repair
S3  Auth boundary infrastructure on Cloudflare
S4  Apple provider registration and rehearsal
S5  Google provider registration and rehearsal
S6  PWA origin image rebuild with auth env/CSP
S7  A6 release-commit update and live readback
S8  Accepted-synthesis canary
S9  Release evidence regeneration
S10 Manual 3-browser account/vote/privacy rehearsal
S11 Distribution packet finalization and first public-beta tranche
S12 Post-launch watch, incident loop, and tranche expansion
```

## S0 - Repo/PR Baseline And Release Commit Candidate

### Goal

Make the branch, PR, and release-commit basis unambiguous before touching live
systems.

### Checklist

- [ ] Confirm #759 is current with its base.
- [ ] Confirm CI is green on #759.
- [ ] Merge #759 or explicitly carry it as the release-candidate branch.
- [ ] Pull `main` after merge, or record the exact branch SHA if launching from a
  pre-merge release branch.
- [ ] Preserve the two untracked distribution-readiness docs out of release
  evidence unless Lou explicitly chooses to commit them.
- [ ] Record the release commit candidate in:
  - [ ] `docs/ops/public-beta-launch-control-2026-07-09.md`;
  - [ ] `docs/ops/public-beta-distribution-packet-2026-07-09.md`;
  - [ ] `docs/foundational/STATUS.md`.

### Commands

```bash
git fetch origin --prune
git status --short --branch
gh pr view 759 --json number,title,headRefName,headRefOid,baseRefOid,isDraft,mergeStateStatus,statusCheckRollup,url
corepack pnpm@9.7.1 check:public-beta-launch-control
corepack pnpm@9.7.1 check:public-beta-distribution-packet
corepack pnpm@9.7.1 check:public-beta-launch-closeout
corepack pnpm@9.7.1 docs:check
git diff --check
```

### Exit Criteria

- [ ] There is one named release commit candidate.
- [ ] No intended release file is dirty except the active PR branch.
- [ ] The release-control docs still say no-go until live evidence is actually
  green.

## S1 - Failure-Mailbox Monitor And Incident Intake Loop

### Goal

Make the email alert loop operational before inviting testers.

### Checklist

- [ ] Confirm Codex App automation `vhc-failure-mailbox-monitor` exists and is
  active.
- [ ] Confirm it uses the Gmail connector for `carboncasteit@gmail.com`.
- [ ] Confirm it writes only local `.tmp/vhc-failure-mailbox-monitor/*`
  artifacts.
- [ ] Confirm it does not send, delete, archive, or label email.
- [ ] Confirm it does not mutate A6, create GitHub issues, restart services, or
  push repo changes.
- [ ] Run or wait for one monitor cycle.
- [ ] Inspect `.tmp/vhc-failure-mailbox-monitor/latest.json`.
- [ ] If Gmail connector access fails, classify the release as blocked until the
  connector is restored.

### Robust Gmail Query Policy

Use overlapping searches so one subject-line change does not blind the monitor:

```text
to:carboncasteit@gmail.com newer_than:2d (critical OR alert OR stale OR failure OR failed OR watchdog OR incident OR "watch closure" OR "public-feed" OR "relay liveness" OR "relay snapshot" OR StoryCluster OR "source health" OR "accepted synthesis")
newer_than:1d ("VHC" OR "public feed" OR "vh-public-feed" OR "watch-closure" OR "StoryCluster" OR "source-health")
newer_than:7d is:unread (critical OR alert OR failure OR stale OR watchdog)
```

### Exit Criteria

- [ ] Monitor latest artifact exists.
- [ ] Dedupe state exists.
- [ ] A test-fire or existing alert email is classified without leaking secret
  content.
- [ ] `status: pass` is interpreted only as monitor-execution success.
- [ ] Critical classification says: treat as incident, preserve email, perform
  read-only readback before mutation, Lou retains incident/rollback authority.
- [ ] If `newCriticalCount > 0`, S1A and any resulting S1B remediation are
  mandatory before S2 or later launch work.

## S1A - Monitor-Critical Public-Feed Incident Readback Gate

### Goal

Resolve the live public-feed freshness incident signaled by the failure-mailbox
monitor before doing launch-enablement work.

### Trigger

This gate is active when `.tmp/vhc-failure-mailbox-monitor/latest.json` reports
`newCriticalCount > 0`, including the `2026-07-10T01:11:56.040Z` incremental
report with `newCriticalCount: 1` and a new public-feed freshness failure. The
first-run count of 85 remains incident history, not the current incremental
count.

### Boundaries

- [ ] Read-only repo/A6 readback comes before mutation.
- [ ] Preserve the email evidence.
- [ ] Do not send, delete, archive, or label email from the monitor.
- [ ] Do not restart publisher, relays, origin, StoryCluster, or auth services
  from this gate.
- [ ] Do not repair credentials, deploy auth, redeploy origin, run the
  accepted-synthesis canary, regenerate release evidence, or invite testers
  until this gate exits green.
- [ ] Lou retains incident and rollback authority.

### Checklist

- [ ] Record the monitor artifact path:
  `.tmp/vhc-failure-mailbox-monitor/latest.json`.
- [ ] Record the monitor snapshot:
  - [ ] generated at `2026-07-10T01:11:56.040Z`;
  - [ ] newest relevant message at `2026-07-10T01:07:59`;
  - [ ] `critical=1`;
  - [ ] `warning=2`;
  - [ ] `info=0`;
  - [ ] initial dedupe baseline preserved as `critical=85`, `warning=12`,
    `info=5`.
- [ ] Confirm the newest critical reason is `public_feed_alert_fail`.
- [ ] Confirm whether the pager dead-man warnings are still only warnings and
  not a pager-cutover blocker.
- [ ] Run a read-only repo/A6 readback:
  - [ ] current repo branch/SHA and PR state;
  - [ ] A6 deployed commit;
  - [ ] `vh-news-aggregator.service` state;
  - [ ] `vh-public-feed-alert-watch.timer` state and latest service result;
  - [ ] `vh-phase5-scope-a-watch-closure.timer` state and latest verdict;
  - [ ] latest public-feed freshness summary;
  - [ ] relay liveness summary;
  - [ ] relay snapshot/watch-closure summary;
  - [ ] most recent publisher clean tick or parked/failure reason.
- [ ] Classify the incident cause without changing live state:
  - [ ] publisher not ticking or parked;
  - [ ] publisher ticking but writes/readbacks failing;
  - [ ] relays/snapshots stale while publisher writes pass;
  - [ ] alert/watch closure false-positive or stale baseline;
  - [ ] public monitor failure caused by upstream/live source scarcity;
  - [ ] other, with evidence path.
- [ ] Write a short incident readback note in the launch-control packet or a
  linked secret-safe local artifact before proceeding.

### Current Classified Finding

The 2026-07-10 read-only pass classifies the incident as
`relay_rest_story_timeout_total_0_of_3_exit_78`:

- publisher state: `failed/failed`, `ExecMainStatus=78`;
- failed surface: raw `/vh/news/story` publication;
- quorum result: `0/3`, required `2/3`;
- endpoint result: three sequential 10-second client-deadline aborts;
- relay state: loopback liveness healthy before and after, with no persistent
  relay-container fault proven;
- downstream state: public latest-index and relay snapshots stale after the
  publisher stopped;
- alert-path state: failure delivery works, but changing watch-window numbers
  cause duplicate state-change emails.

This is enough to design S1B. It is not restart authorization and it does not
prove which public-network or relay-request condition caused the transient
stall.

### Exit Criteria

- [ ] The incident has a named reason code and evidence path.
- [ ] Public-feed freshness, relay liveness, relay snapshot, and watch-closure
  are either passing or have a Lou-approved incident packet for the smallest
  recovery action.
- [ ] No live mutation occurred during readback.
- [ ] If a recovery action is needed, stop here and get Lou approval for that
  action; repo-only S1B implementation may proceed, but launch-enablement work
  remains blocked.
- [ ] If readback proves recovery/pass and S1B is complete, proceed to S2 and
  keep the monitor active.

## S1B - Durable Relay-Timeout And Alert-Dedupe Remediation

### Goal

Prevent a fully unacknowledged transient relay deadline from becoming an
immediate non-restarting exit-78 outage, without weakening raw-write quorum or
hiding real relay backpressure, and restore state-change-only alert delivery.

S1B has two independently reviewable delegated lanes spanning five workstreams:

1. Runtime lane: concurrent fanout, availability-total retry/exit semantics,
   and secret-safe availability telemetry (Workstreams A-C);
2. Alert lane: stable fingerprinting and readable secret-safe email bodies
   (Workstreams D-E).

Repo implementation and review are allowed while the incident is active. A6
deployment and publisher restart remain incident mutations and require Lou's
explicit approval after the repo change is merged and independently reviewed.

### Invariants

- [x] Raw story, latest-index, hot-index, and pending-lifecycle publication keep
  the configured `2/3` relay quorum.
- [x] A timeout means unacknowledged, not provably unpublished.
- [x] Every retry reuses the exact serialized and signed id-keyed record; it
  does not regenerate timestamps, ids, signatures, or payloads.
- [x] A timed-out POST is reconciled through bounded signed readback before a
  resend; a matching readback can satisfy quorum, while missing readback keeps
  the endpoint unacknowledged.
- [x] Id-keyed first-write-wins relay semantics are covered by tests before a
  timeout is made retryable.
- [x] `2/3` validated acknowledgements pass even if the third endpoint times
  out; `0/3` and `1/3` never pass.
- [x] Explicit HTTP responses, relay backpressure, validation failures, and
  mixed acknowledged/unacknowledged failures are not relabeled as
  availability-total.
- [x] Exit `75` remains wrapper refusal, exit `78` remains write-safety or
  configuration park, and exit `69` remains bounded restartable total relay
  unavailability.
- [x] Relay containers are not restarted as part of this slice.
- [x] Full numeric evidence remains in local alert artifacts even when volatile
  numbers are removed from the dedupe fingerprint.

### Workstream A - Concurrent Bounded Relay Fanout

Target:
`packages/gun-client/src/newsAdapters.ts`.

- [x] Serialize `{ record }` once before fanout and reuse the same bytes on
  every endpoint and retry attempt.
- [x] Start all relay requests for one attempt concurrently rather than waiting
  up to 10 seconds per endpoint sequentially.
- [x] Keep an independent abort controller and configured deadline per endpoint.
- [x] Wait for every endpoint in the attempt to settle so the final quorum and
  failure classification are deterministic; do not return early at the second
  acknowledgement while another write remains unobserved.
- [x] Record one secret-safe endpoint result from this closed set:
  `acknowledged_success`, `network_unacknowledged`,
  `deadline_unacknowledged`, `http_response`, or `validation_failure`.
- [x] Record whether an HTTP response was received before a body/validation
  failure so an application response cannot be mistaken for a network failure.
- [x] Keep endpoint labels hashed or ordinal; do not log raw origins, tokens, or
  response bodies.
- [x] Bound one three-relay attempt to approximately one endpoint deadline, not
  three sequential deadlines.

### Workstream B - Availability-Total Retry And Exit Semantics

Targets:

- `packages/gun-client/src/newsAdapters.ts`;
- `services/news-aggregator/src/daemonWriteLane.ts`;
- `services/news-aggregator/src/daemonCli.ts`;
- the minimum required `services/news-aggregator/src/daemon.ts` logging change;
- the minimum required `infra/relay/server.js` route change;
- associated gun-client, news-aggregator, and
  `packages/e2e/src/live/relay-server.vitest.mjs` tests.

- [x] Define availability-total as zero validated acknowledgements where every
  endpoint result is `network_unacknowledged` or
  `deadline_unacknowledged`.
- [x] Inventory and test the deployed nonmutating per-relay readback contract
  for `/vh/news/story`, `/vh/news/latest-index`, `/vh/news/hot-index`, and
  `/vh/news/synthesis-lifecycle` before enabling timeout reconciliation for that
  class. A generic fallback or aggregate read is not sufficient proof.
- [x] For latest-index and hot-index, add bounded `story_id` GET branches that
  return the complete stored signed record without scanning an aggregate root,
  mutating a latest-index snapshot, or changing the existing aggregate response
  when `story_id` is absent.
- [x] If any critical class lacks bounded endpoint-local signed readback, keep
  that class on exit `78` and stop/report the missing contract instead of
  silently using blind retry.
- [x] For `network_unacknowledged` and `deadline_unacknowledged`, issue a bounded
  endpoint-local readback for the same stable record key using the existing
  signed validation contract; a response-leg network failure can also occur
  after a relay committed the write.
- [x] Count only a signature-valid record with the expected canonical key and
  signed payload fields as `readback_confirmed`; a missing row remains
  unacknowledged and a conflicting, invalid, or tampered row is a write-safety
  failure.
- [x] If readback reaches `2/3`, complete the write without resending. If it
  confirms fewer than `2/3`, retry only unresolved endpoints and combine the
  prior confirmed set with new validated acknowledgements.
- [x] Generalize the existing transport-total error contract to represent
  availability-total without breaking the current brand-based cross-package
  guard. Prefer a new explicit availability brand with a compatibility path for
  the existing transport-total brand.
- [x] Apply bounded retry count and backoff only after deadline reconciliation
  leaves an availability-total outcome. Use a dedicated timeout retry budget if
  needed so timeout recovery cannot multiply relay load beyond the reviewed
  bound.
- [x] Treat a successful retry that reaches `2/3` as a completed idempotent
  write and include the attempt count in secret-safe telemetry.
- [x] After availability-total retries are exhausted, map the generalized
  branded failure to exit `69`, allowing the existing bounded systemd restart
  path and start-limit parking behavior to operate.
- [x] Preserve exit `78` for `1/3` partial quorum, explicit 4xx/5xx,
  `relay-backpressure`, validation failure, mixed failure classes, critical
  lifecycle failure, and any unclassified write error.
- [x] Do not increase the 10-second deadline as the primary fix.
- [x] Do not weaken `RestartPreventExitStatus=78`, start-limit behavior, or the
  executor rule that only permits its narrowly verified exit-69 action.

### Workstream C - Secret-Safe Availability Telemetry

- [x] Add per-attempt counts for acknowledged, network-unacknowledged,
  deadline-unacknowledged, readback-confirmed, HTTP-response, and validation
  failures.
- [x] Add attempt duration, total attempt count, required quorum, and final
  availability classification to safe logs/diagnostics.
- [x] Preserve only hashed/ordinal endpoint identity.
- [x] Never include raw relay URL, authorization header, daemon token, record
  body, story body, provider response body, or host-private env value.
- [x] Ensure the publisher liveness and public-feed alert summaries can
  distinguish `exit_69_transport_unavailable`,
  `exit_69_start_limit_parked`, and `exit_78_fail_closed` after the change.

### Workstream D - Stable Alert Fingerprint

Targets:

- `tools/scripts/public-feed-alert-watch.mjs`;
- `tools/scripts/public-feed-alert-watch.test.mjs`.

- [x] Build the fingerprint from semantic state only: overall status, publisher
  failure class/state, source status, threshold status, relay identity/status,
  and normalized blocker reason codes.
- [x] Exclude or canonicalize volatile ages, decimal watch-window progress,
  archive failure counts, restart counters, timestamps, and generated-at values.
- [x] Do not include the raw `watchClosure.thresholds` object in the fingerprint;
  include only stable threshold status and blocker reason codes.
- [x] Keep the full values in `latest.json` and outbound payloads for diagnosis.
- [x] Bump the alert state schema so migration deliberately sends at most one
  state-change notification for an unresolved incident, then suppresses
  repeats.
- [x] Preserve delivery retry when the prior delivery failed, explicit
  heartbeat delivery, real failure-class transitions, and recovery/pass
  delivery.
- [x] Prove `window_short:33.49/48` to `window_short:33.99/48`, archive failures
  8 to 9, and advancing stale ages produce the same fingerprint.
- [x] Prove publisher exit `78` to restartable exit `69`, threshold status
  change, relay failure, and recovery produce different fingerprints.

### Workstream E - Readable Email Contract

Gmail connector readback returned the alert subject but no parsed body while the
sender emits `Content-Type: application/json`. Keep the JSON payload, but make
the email MIME readable to normal clients and connector text extraction.

- [x] Emit the secret-safe JSON as `text/plain; charset=utf-8`, or as a proper
  multipart message with a text/plain part.
- [x] Preserve the subject status plus fingerprint; never put blocker details,
  origins, or secrets in the subject.
- [x] Add a parser-level test that the email contains a non-empty text body and
  the expected secret-safe reason codes.
- [x] Preserve tests that reject raw URLs, tokens, story bodies, private data,
  and host-private values.

### Required Tests

- [x] Three relay fetches begin in the same attempt before any endpoint settles.
- [x] First-attempt total deadlines followed by `2/3` success retry the exact
  same body and complete.
- [x] Total deadlines followed by matching `2/3` signed readback complete
  without a resend.
- [x] One matching readback plus one successful unresolved-endpoint retry
  reaches `2/3` without rewriting the already-confirmed endpoint.
- [x] Conflicting, invalid, or tampered timeout readback remains exit `78`.
- [x] Exhausted total deadlines produce the generalized availability-total
  brand and daemon exit `69`.
- [x] Exhausted network-total behavior remains exit `69`.
- [x] `1/3` success plus two deadlines remains exit `78` with no quorum waiver.
- [x] Three explicit 503 backpressure responses remain exit `78` and are not
  retried as availability-total.
- [x] A timeout plus any HTTP/validation failure remains exit `78`.
- [x] `2/3` success plus one timeout passes.
- [x] Timeout retry preserves byte-identical signed record content.
- [x] Alert volatile-age/window changes are suppressed.
- [x] Alert failure-class and recovery changes deliver once.
- [x] Failed delivery retry and configured heartbeat behavior remain intact.
- [x] Email body is readable and secret-safe.

Run at minimum:

```bash
corepack pnpm@9.7.1 --filter @vh/gun-client test -- newsAdapters.test.ts
corepack pnpm@9.7.1 --filter @vh/gun-client typecheck
corepack pnpm@9.7.1 --filter @vh/news-aggregator test -- daemonWriteLane.test.ts daemon.coverage.test.ts
corepack pnpm@9.7.1 --filter @vh/news-aggregator typecheck
corepack pnpm@9.7.1 exec vitest run packages/ai-engine/src/newsRuntime.test.ts
corepack pnpm@9.7.1 --filter @vh/e2e exec vitest run src/live/relay-server.vitest.mjs --config ./vitest.config.ts
corepack pnpm@9.7.1 check:public-feed:alert-watch
node --test tools/scripts/news-aggregator-publisher-liveness-watch.test.mjs
corepack pnpm@9.7.1 check:vhc-incident-response
corepack pnpm@9.7.1 check:public-beta-next-phase-sprint
corepack pnpm@9.7.1 docs:check
git diff --check
```

### Repo Execution Record - 2026-07-10

- G1 Runtime: PR #761, base `a2899ad2`, frozen head `2a7b0109`, independent
  same-reviewer final `GO`, hosted CI 9/9. The corrected lane closes all four
  exact-readback contracts, including closed StoryBundle projection, bounded
  fresh-vertex reconciliation, and generation-plus-fingerprint settlement.
- G1 Alert: PR #760, base `a2899ad2`, frozen head `c3cff109`, independent
  review `GO` after six correction/re-review cycles, hosted CI 9/9.
- Combined shared seam: one dependency-free pager family normalizer is consumed
  by both alert ingest and the incident contract; historical v1 underscore and
  current v2 colon forms preserve the four public-feed incident families.
- Combined local evidence: gun client 187, daemon write/coverage 23, daemon/exit
  24, AI runtime 54, relay integration 60, alert 55, publisher liveness 6,
  pager 29, incident response 61 plus 28 required files; focused typechecks,
  pager build, docs governance, and `git diff --check` pass.
- Authority used: repo-only plus read-only incident evidence. No A6/service,
  relay, Gmail/provider, pager, alert-channel, or production mutation occurred.
- Live gate: latest mailbox state remains incident-blocking; S1A classification
  remains `relay_rest_story_timeout_total_0_of_3_exit_78`. Repo completion does
  not make S1A/S1B green.
- G2 status at this record: combined exact-head cross-lane review, hosted CI,
  and merge remain required. Every recovery, immediate-readback, soak, and
  live-green checkbox below intentionally remains open.
- First G2 cross review at `ddae488e` returned `NO-GO`: P1 present conflicting
  latest/hot/lifecycle rows were hidden as retry-eligible 404s at the real relay
  boundary; P2 the durable producer-fixture set was v1-only despite the
  dual-version claim. Both corrections are now integrated at `cb03c44c`: the v2
  fixture/replay is green, and Runtime head `2a7b0109` passed all-four-route
  adversarial coverage plus mandatory same-reviewer follow-up with no remaining
  finding. The corrected combined worktree has also passed the full local
  matrix and strict diff coverage. Integration remains unpushed and unmergeable
  until hosted CI and subsequent review by the same G2 cross-lane reviewer.

### Review And Merge Gate

- [ ] Use one focused branch/PR for the runtime lane and one focused branch/PR
  for the alert lane, then require a cross-lane integration review. If isolated
  worktrees are unavailable, run those PRs sequentially.
- [ ] Include the incident reason code and sanitized timing/quorum evidence in
  the PR description.
- [ ] Require review of idempotency, quorum, retry eligibility, exit mapping,
  state-schema migration, and secret redaction.
- [ ] CI and every required test above pass on the PR head.
- [ ] Merge before preparing any A6 mutation packet.

### Lou-Approved A6 Recovery Packet

The packet must be generated from the merged remediation commit. It is not the
existing exit-69-only executor action because the pre-action state is exit 78.
Lou must explicitly authorize the exit-78 incident recovery after independent
review.

#### G3 repo preparation and relay-restart boundary - 2026-07-10

The S1B route remediation changes `infra/relay/server.js`. The relay Dockerfile
copies that file into an immutable image, while the public-beta compose mounts
only `/data`; an A6 checkout update cannot install the new exact-readback routes
into running relays. A rolling relay image replacement is therefore technically
required before publisher recovery can exercise the merged contract.

That fact conflicts with the standing no-relay-restart line below. G3 remains
`blocked_pending_relay_restart_boundary_correction` and `WAITING_FOR_LOU`; repo
preparation is not authority and no live recovery is claimed.

- [x] Add inert `--relay-only` image-export and deploy-packet generation that
  excludes origin, requires exactly relay A/B/C, and defaults to no recreate
  commands.
- [x] Preserve captured env, mount, network, ports, restart policy, user, and
  memory limits; verify exact revision plus `linux/amd64`.
- [x] Encode A/B/C readiness, three-snapshot integrity, liveness/OOM/watchdog,
  all-four exact missing-key probes, immediate current-relay rollback, and hard
  stop conditions.
- [x] Keep `tools/scripts/vhc-packet-executor.mjs` unchanged; the executor is not
  authorized for this rolling action.
- [x] Register the blocked authority packet at
  `docs/ops/a6-s1b-relay-timeout-recovery-packet-2026-07-10.md`.
- [ ] Merge S1B and generate the exact packet from the merged commit and fresh
  secret-safe inspect evidence.
- [ ] Independent packet reviewer returns `GO` on the exact packet hash; any
  correction receives subsequent review by the same reviewer.
- [ ] Lou explicitly replaces the no-relay-restart boundary for that exact
  revision and authorizes attended A/B/C rolling replacement plus rollback.
- [ ] The approved rolling relay packet passes and evidence is independently
  reviewed before a separate publisher recovery is considered.

Pre-mutation readback:

- [ ] Preserve `failed/failed`, `ExecMainStatus=78`, current deployed commit,
  last clean tick, and incident journal markers.
- [ ] Confirm all relay containers are running with no new watchdog/OOM trip.
- [ ] Confirm all three loopback and public relay readiness probes pass.
- [ ] Confirm alert and watch-closure timers remain enabled.
- [ ] Confirm no unrelated A6 or env change is bundled into the packet.

Mutation boundary:

- [ ] Update only to the reviewed remediation commit using the existing deploy
  packet controls.
- [ ] Do not restart relays unless Lou first replaces this boundary for the exact
  independently reviewed S1B relay-only packet. If approved, replace only
  `vhc-relay-a`, then `vhc-relay-b`, then `vhc-relay-c`, with publisher parked,
  per-relay verification, and immediate serial rollback on failure.
- [ ] Never alter quorum, increase timeouts, clear relay data, recreate origin,
  edit alert recipients, enable autonomy/pager cutover, or broaden the generic
  packet executor as part of that relay-only action.
- [ ] Reset/start the publisher only after Lou's explicit incident approval and
  the separately reviewed relay deployment evidence and publisher packet's
  preconditions pass.
- [ ] Stop on any commit mismatch, failed relay readiness probe, unexpected
  exit code, secret-bearing output, or packet verification failure.

Immediate readback:

- [ ] Publisher reaches `active/running` and does not return to exit 75/78.
- [ ] First two completed ticks report `raw_write_attempted_count > 0`,
  `raw_write_failed_count=0`, and no critical lifecycle failure.
- [ ] At least one completed tick reports the expected capped raw writes with
  `raw_wrote_count == raw_write_attempted_count`.
- [ ] Public latest-index advances through the nonmutating public read path and
  returns below the six-hour freshness SLO.
- [ ] Relay snapshots advance and relay liveness remains pass.
- [ ] Any total timeout is visibly classified, bounded, and either recovers or
  enters the expected exit-69 path; it must not silently weaken quorum.
- [ ] One recovery email is delivered with a readable secret-safe body.

Soak readback:

- [ ] Preserve hourly archive samples until the required 24/48-hour watch
  thresholds are honestly satisfied.
- [ ] Require no new failed publisher tick, exit-69 start-limit park, exit 75,
  exit 78, relay watchdog trip, stale public feed, or stale relay snapshot.
- [ ] Confirm unchanged failure/recovery state is suppressed between samples;
  only a configured heartbeat may repeat.
- [ ] Do not relabel historical window blockers as current failures. Record the
  distinction until the watch naturally ages them out.

### Exit Criteria

- [ ] Runtime and alert changes are merged with required tests green.
- [ ] Relay write quorum remains `2/3` and no exit-78 class was weakened.
- [ ] Repo remediation may finish without an A6 action, but S1B cannot exit
  green until any required A6 recovery is Lou-approved and passes all immediate
  readbacks.
- [ ] Publisher, public freshness, relay liveness, and relay snapshots are
  green after recovery.
- [ ] Watch closure truthfully distinguishes current green operation from
  historical-window evidence and reaches the required release threshold before
  launch.
- [ ] The mailbox receives one incident transition and one recovery transition,
  not a new email for every decimal window/age change.
- [ ] S1A closes only after these recovery facts are preserved; then S2 may
  begin.

## S2 - StoryCluster Headline-Soak Credential/Endpoint Repair

### Goal

Clear the current StoryCluster production-readiness blocker without exposing
credentials.

### Required Input

- [ ] Lou provides an access window for the account/host that holds the
  StoryCluster/OpenAI credential.
- [ ] Codex can inspect only redacted env names, file mode/owner/hash, health
  booleans, and stable reason codes.
- [ ] S1A and S1B are green if the latest failure-mailbox monitor reported
  critical items.
- [ ] S1 has no active critical incident, or Lou has classified the incident and
  explicitly authorized this slice to proceed.

### Checklist

- [ ] Open `docs/ops/storycluster-headline-soak-credential-repair-2026-07-09.md`.
- [ ] Confirm the latest failure class in
  `.tmp/storycluster-production-readiness/latest/production-readiness-report.json`.
- [ ] Repair the credential or endpoint in the correct secret store.
- [ ] Do not paste or print the credential.
- [ ] Rerun the headline-soak collection.
- [ ] Rerun production-readiness.
- [ ] Preserve artifact paths.

### Commands

```bash
corepack pnpm@9.7.1 collect:storycluster:headline-soak
corepack pnpm@9.7.1 check:storycluster:production-readiness
```

### Exit Criteria

- [ ] `check:storycluster:production-readiness` no longer blocks on
  `headline_soak_release_evidence_failed`.
- [ ] If the check still blocks, the blocker is product evidence, not an invalid
  credential or missing endpoint.
- [ ] No publisher restart occurred from this packet.

## S3 - Auth Boundary Infrastructure On Cloudflare

### Goal

Deploy `services/auth-callback` outside A6 at
`https://auth.venn.carboncaste.io`.

### Required Input

- [ ] Lou logs into Cloudflare or grants a browser session.
- [ ] DNS for `auth.venn.carboncaste.io` is controllable.
- [ ] If Cloudflare does not control DNS, Lou logs into Namecheap to confirm or
  update nameserver delegation.
- [ ] S1 has no active critical incident, or Lou has classified the incident and
  explicitly authorized this slice to proceed.

### Checklist

- [ ] Build/test the auth-callback package locally.
- [ ] Create/select the Cloudflare Worker project.
- [ ] Create a durable nonce store and bind it as `VH_AUTH_KV`.
- [ ] Configure route/host for `https://auth.venn.carboncaste.io`.
- [ ] Set non-provider env/bindings:
  - [ ] `VH_AUTH_STATE_SECRET`;
  - [ ] `VH_AUTH_ALLOWED_ORIGINS=https://venn.carboncaste.io`;
  - [ ] `VH_AUTH_KV`;
  - [ ] `VH_AUTH_PWA_CALLBACK_ROUTE=/auth/callback`;
  - [ ] `VH_AUTH_PWA_ORIGIN=https://venn.carboncaste.io`;
  - [ ] body/TTL limits if not using defaults.
- [ ] Deploy the worker.
- [ ] Confirm `/api/health` returns only booleans/reason codes.

### Commands

```bash
corepack pnpm@9.7.1 --filter @vh/auth-callback build
corepack pnpm@9.7.1 --filter @vh/auth-callback test
corepack pnpm@9.7.1 check:auth-callback

AUTH_BASE="https://auth.venn.carboncaste.io"
curl -fsS "${AUTH_BASE}/api/health" \
  | jq '{status, schemaVersion, durableStore, providersConfigured}'
```

### Exit Criteria

- [ ] `status == "ok"`.
- [ ] `schemaVersion == "vh-auth-callback-health-v1"`.
- [ ] `durableStore == true`.
- [ ] Apple and Google may still show unconfigured until S4/S5; X may remain
  false.
- [ ] No secret value appears in health, logs, docs, or release artifacts.

## S4 - Apple Provider Registration And Rehearsal

### Goal

Make Apple sign-in work end to end without leaking provider or PKCE material.

### Required Input

- [ ] Lou logs into Apple Developer.
- [ ] Apple Developer Program membership is active.
- [ ] App display name is `venn`.
- [ ] S1 has no active critical incident, or Lou has classified the incident and
  explicitly authorized this slice to proceed.

### Checklist

- [ ] Configure App ID / Services ID for Sign in with Apple.
- [ ] Configure domain/redirect verification for the PWA/auth boundary as Apple
  requires.
- [ ] Register Apple redirect URI:
  `https://auth.venn.carboncaste.io/auth/apple/return`.
- [ ] Create or select a Sign in with Apple key.
- [ ] Store these in the auth boundary secret store only:
  - [ ] `VH_AUTH_APPLE_CLIENT_ID`;
  - [ ] `VH_AUTH_APPLE_TEAM_ID`;
  - [ ] `VH_AUTH_APPLE_KEY_ID`;
  - [ ] `VH_AUTH_APPLE_PRIVATE_KEY`;
  - [ ] `VH_AUTH_APPLE_REDIRECT_URI`;
  - [ ] `VH_AUTH_APPLE_SCOPES`.
- [ ] Rerun auth health.
- [ ] Run start-leg smoke for Apple.
- [ ] Run live provider rehearsal from the PWA.
- [ ] Test user-cancel leg.

### Exit Criteria

- [ ] `providersConfigured.apple == true`.
- [ ] Apple authorize URL uses `response_mode=form_post`.
- [ ] Apple returns through `/auth/apple/return`, then to PWA `/auth/callback`.
- [ ] PWA POSTs PKCE verifier to `/auth/apple/callback`.
- [ ] Browser receives only `vh-auth-session-v1`.
- [ ] No provider token, provider subject, PKCE verifier, signed state, private
  key, nullifier, or raw error body appears in browser storage, public mesh,
  logs, or evidence.

## S5 - Google Provider Registration And Rehearsal

### Goal

Make Google sign-in work end to end with the same secret and identity
boundaries.

### Required Input

- [ ] Lou logs into the CarbonCaste Google account or Google Cloud account.
- [ ] Choose existing Google Cloud project or create a new project for `venn`.
- [ ] S1 has no active critical incident, or Lou has classified the incident and
  explicitly authorized this slice to proceed.

### Checklist

- [ ] Configure OAuth consent screen for public beta.
- [ ] Create OAuth 2.0 web client.
- [ ] Register redirect URI:
  `https://venn.carboncaste.io/auth/callback`.
- [ ] Store these in the auth boundary secret store only:
  - [ ] `VH_AUTH_GOOGLE_CLIENT_ID`;
  - [ ] `VH_AUTH_GOOGLE_CLIENT_SECRET`;
  - [ ] `VH_AUTH_GOOGLE_REDIRECT_URI`;
  - [ ] `VH_AUTH_GOOGLE_SCOPES`.
- [ ] Rerun auth health.
- [ ] Run start-leg smoke for Google.
- [ ] Run live provider rehearsal from the PWA.

### Exit Criteria

- [ ] `providersConfigured.google == true`.
- [ ] Google redirects to the PWA `/auth/callback`, not directly to the worker.
- [ ] PWA POSTs `code`, `state`, and PKCE verifier to
  `https://auth.venn.carboncaste.io/auth/google/callback`.
- [ ] Browser receives only `vh-auth-session-v1`.
- [ ] No secret or provider subject leaks.

## S6 - PWA Origin Image Rebuild With Auth Env/CSP

### Goal

Deploy PWA assets that know about the auth boundary and show only Apple/Google.

### Required Input

- [ ] S3 auth boundary is deployed.
- [ ] S4/S5 provider health and rehearsal pass, or provider copy is narrowed.
- [ ] Lou authorizes A6 origin image rebuild/redeploy.
- [ ] S1 has no active critical incident, or Lou has classified the incident and
  explicitly authorized this slice to proceed.

### Checklist

- [ ] Open `docs/ops/public-beta-image-deploy.md`.
- [ ] Set PWA build-time env:
  - [ ] `VITE_AUTH_CALLBACK_BASE_URL=https://auth.venn.carboncaste.io`;
  - [ ] `VITE_AUTH_CALLBACK_ROUTE=/auth/callback`;
  - [ ] `VITE_AUTH_CALLBACK_PROVIDERS=apple google`.
- [ ] Add `https://auth.venn.carboncaste.io` to:
  - [ ] `VITE_VH_CSP_CONNECT_SRC`;
  - [ ] `VH_PUBLIC_ORIGIN_CSP_CONNECT_SRC`.
- [ ] Rebuild origin image.
- [ ] Redeploy `vhc-public-beta-origin`.
- [ ] Preserve relay data mounts and latest-index snapshots.
- [ ] Verify `https://venn.carboncaste.io` serves release-commit assets.
- [ ] Verify CSP includes auth boundary.
- [ ] Verify provider buttons show Apple and Google only.

### Exit Criteria

- [ ] PWA can call the auth boundary under deployed CSP.
- [ ] X is hidden in UI/copy.
- [ ] Rollback path is documented: disable provider at auth boundary first; UI
  hiding requires another origin image deploy.

## S7 - A6 Release-Commit Update And Live Readback

### Goal

Put A6 on the release commit and prove raw-feed health before accepted synthesis.

### Required Input

- [ ] Lou authorizes A6 update and publisher restart if required.
- [ ] S1 monitor is active and the latest mailbox artifact has no unclassified
  critical incident.
- [ ] If the mailbox artifact reported a critical public-feed/pager incident,
  read-only A6/public-feed readback has been preserved before this update.
- [ ] S2 StoryCluster production-readiness no longer blocks on credentials.

### Checklist

- [ ] Read back current A6 commit and services before mutation.
- [ ] Update A6 checkout to the release commit.
- [ ] Do not restart relays.
- [ ] Restart publisher only if required by the update or release path; in guard
  language, restart publisher only if required.
- [ ] Capture post-update service state:
  - [ ] `vh-news-aggregator.service`;
  - [ ] `vh-storycluster-engine.service`;
  - [ ] alert-watch timer;
  - [ ] watch-closure timer;
  - [ ] public-feed freshness;
  - [ ] relay liveness;
  - [ ] relay snapshot freshness;
  - [ ] watch-closure summary.
- [ ] Confirm alert email path remains live.

### Exit Criteria

- [ ] A6 commit matches the release commit, or the distribution packet records
  why the release envelope avoids A6-newer claims.
- [ ] Raw feed remains fresh.
- [ ] Relay liveness/snapshot/watch closure pass.
- [ ] Any publisher restart is recorded with exact reason and readback.

## S8 - Accepted-Synthesis Canary

### Goal

Prove one live accepted-current synthesis path before claiming summaries, framing
tables, or vote controls.

### Required Input

- [ ] S7 live readback is green.
- [ ] Email alert loop is active.
- [ ] StoryCluster production-readiness is no longer credential-blocked.
- [ ] S1 has no active critical incident, or Lou has classified the incident and
  explicitly authorized this slice to proceed.
- [ ] Lou accepts the attended live touch and the effect on unattended-window
  evidence.

### Checklist

- [ ] Open `docs/ops/a6-accepted-synthesis-canary-packet-2026-07-09.md`.
- [ ] Verify canary preconditions exactly.
- [ ] Run the one-shot bounded catch-up.
- [ ] Verify at least one live public story reaches `accepted_available`.
- [ ] Verify `TopicSynthesisV2` has non-empty:
  - [ ] `facts_summary`;
  - [ ] `frame_point_id`;
  - [ ] `reframe_point_id`.
- [ ] Verify public story detail renders accepted summary and framing table.
- [ ] Verify vote controls appear only for accepted-current stable point ids.
- [ ] Verify pending, invalid, suppressed, or stale synthesis remains non-votable.
- [ ] Preserve artifact paths.

### Commands

```bash
corepack pnpm@9.7.1 catchup:public-synthesis
```

Use the exact env and command shape from the canary packet, not an improvised
variant.

### Exit Criteria

- [ ] One accepted-current story is proven end to end.
- [ ] No raw-feed freshness regression.
- [ ] No relay quorum regression.
- [ ] Any alert transition is recorded.

## S9 - Release Evidence Regeneration

### Goal

Replace stale evidence with a release-commit packet.

### Required Input

- [ ] S2 through S8 are green or explicitly narrowed without waiving gates.
- [ ] Release commit is known.
- [ ] Repo tree is clean except preserved local-only docs handled outside the
  packet.
- [ ] S1 has no active critical incident, or Lou has classified the incident and
  explicitly authorized this slice to proceed.

### Checklist

- [ ] Run LUMA readiness coverage/drill if the pipeline requires an embedded
  coverage report.
- [ ] Regenerate source-health/StoryCluster evidence as needed.
- [ ] Run the consolidated release evidence pipeline.
- [ ] Verify release commit stamping.
- [ ] Verify every blocker array is empty.
- [ ] Preserve exact report paths.

### Commands

```bash
corepack pnpm@9.7.1 check:luma:mvp-production-readiness
corepack pnpm@9.7.1 check:mvp-release-gates
corepack pnpm@9.7.1 check:mvp-closeout
corepack pnpm@9.7.1 report:mvp-release-evidence
corepack pnpm@9.7.1 docs:check
git diff --check
```

### Exit Criteria

- [ ] `.tmp/release-evidence-pipeline/latest/release-evidence-pipeline-report.json`
  has `status: pass`.
- [ ] `release_commit_verified: true`.
- [ ] `blockers: []`.
- [ ] `.tmp/mvp-release-gates/latest/mvp-release-gates-report.json` passes.
- [ ] `.tmp/mvp-closeout/latest/mvp-closeout-report.json` passes.

## S10 - Manual 3-Browser Account/Vote/Privacy Rehearsal

### Goal

Prove the public beta as users experience it.

### Required Input

- [ ] Deployed PWA points at the auth boundary.
- [ ] Apple and Google pass provider rehearsal.
- [ ] Accepted-current story exists.
- [ ] Release evidence is green or the rehearsal is explicitly a pre-release
  dry run.
- [ ] S1 has no active critical incident, or Lou has classified the incident and
  explicitly authorized this slice to proceed.

### Checklist

- [ ] Use three clean browser profiles.
- [ ] Open `https://venn.carboncaste.io`.
- [ ] Create distinct beta-local LUMA identities.
- [ ] Sign in with Apple in one profile.
- [ ] Sign in with Google in one profile.
- [ ] Confirm account-to-LUMA binding and same-browser persistence.
- [ ] Confirm reset identity clears account binding and requires re-bind.
- [ ] Confirm second browser profile gets a distinct beta-local principal.
- [ ] Open the same accepted-current story in all three profiles.
- [ ] Vote on a frame/reframe point in profile A.
- [ ] Confirm profiles B and C observe aggregate change.
- [ ] Change vote and confirm aggregate correction cross-client.
- [ ] Reload all profiles and confirm persistence.
- [ ] Inspect public paths/network/console for privacy leaks.

### Exit Criteria

- [ ] 3-browser convergence is proven on non-voting browsers.
- [ ] Reload persistence passes.
- [ ] Apple and Google account binding pass.
- [ ] No forbidden claim appears in copy.
- [ ] No provider/nullifier/proof/address/wallet leak appears.

## S11 - Distribution Packet Finalization And First Public-Beta Tranche

### Goal

Convert evidence into a bounded launch decision.

### Required Input

- [ ] S1 has no active critical incident, or Lou has classified the incident and
  explicitly authorized this slice to proceed.
- [ ] Latest failure-mailbox monitor has `newCriticalCount == 0`.
- [ ] Pager dead-man workflow warnings have been triaged and the pager dead-man
  workflow is green.

### Checklist

- [ ] Fill every remaining release/evidence row in
  `docs/ops/public-beta-launch-control-2026-07-09.md`.
- [ ] Change launch-control status only if the go rule is actually satisfied:
  `go_for_public_beta_ramp`.
- [ ] Fill every remaining row in
  `docs/ops/public-beta-distribution-packet-2026-07-09.md`.
- [ ] Change distribution status only if final checklist is actually satisfied:
  `go_for_public_beta_distribution`.
- [ ] Confirm tester invite copy says public beta and only describes proven
  surfaces.
- [ ] Confirm the first public-beta tranche is capped at 100 testers.
- [ ] Confirm Lou gives final go.

### Exit Criteria

- [ ] Launch-control check passes.
- [ ] Distribution-packet check passes.
- [ ] Launch closeout check passes.
- [ ] Lou says go.
- [ ] First public-beta tranche is invited.

## S12 - Post-Launch Watch, Incident Loop, And Tranche Expansion

### Goal

Watch the first tranche tightly and scale only on evidence.

### Checklist

- [ ] Keep `vhc-failure-mailbox-monitor` active.
- [ ] Keep Lou reachable for incident/rollback authority.
- [ ] Confirm latest failure-mailbox monitor has `newCriticalCount == 0` before
  launch, post-launch watch signoff, or tranche expansion.
- [ ] Confirm pager dead-man workflow is green before launch, post-launch watch,
  or tranche expansion.
- [ ] Watch:
  - [ ] alert/failure mailbox;
  - [ ] release gates/daily gate;
  - [ ] support issues;
  - [ ] analysis 429 rate;
  - [ ] mesh write-ack timeout rate;
  - [ ] convergence p95;
  - [ ] vote-capable inventory;
  - [ ] auth provider health.
- [ ] Treat any new critical email as an incident.
- [ ] Preserve evidence before changing state.
- [ ] Pause intake before debugging if a stop rule fires.
- [ ] After 24 hours green, Lou may approve expansion to 500.
- [ ] After another 24 hours green, Lou may approve expansion to 1000.
- [ ] Open intake only after the prior tranche proves the alert loop, support
  loop, incident path, and product gates remain green.

### Exit Criteria

- [ ] Every tranche expansion has a recorded evidence entry.
- [ ] No expansion happens from optimism or silence alone.
- [ ] Support/private-handoff process works without leaking sensitive data.
- [ ] Rollback remains executable.

## Final Release-Readiness Checklist

The public beta is not ready until every item below is true:

- [ ] #759 or successor launch-control branch is merged, or explicitly selected
  as the release branch.
- [ ] Release commit is pinned.
- [ ] Failure-mailbox monitor is active and producing secret-safe artifacts.
- [ ] Latest failure-mailbox monitor has no unresolved critical items, or S1A
  and S1B have cleared them with classified evidence, merged remediation, and
  any required Lou-approved recovery readback.
- [ ] Latest failure-mailbox monitor has `newCriticalCount == 0` before launch,
  or Lou has made an explicit incident decision after read-only repo/A6
  readback.
- [ ] Pager dead-man workflow is green before launch.
- [ ] StoryCluster production-readiness no longer blocks on credential/endpoint.
- [ ] Auth boundary is deployed at `https://auth.venn.carboncaste.io`.
- [ ] Durable nonce store is bound and health reports `durableStore: true`.
- [ ] Apple health/start/rehearsal pass.
- [ ] Google health/start/rehearsal pass.
- [ ] X is hidden and absent from `VITE_AUTH_CALLBACK_PROVIDERS`.
- [ ] PWA origin image is rebuilt with auth env and CSP.
- [ ] A6 is updated/read back at the release commit.
- [ ] Relay write deadline handling uses concurrent bounded fanout, preserves
  `2/3` quorum, and keeps partial/HTTP/backpressure failures fail-closed.
- [ ] Availability-total retry exhaustion maps only fully unacknowledged relay
  outcomes to the bounded exit-69 path; true exit-78 cases remain protected.
- [ ] Alert dedupe ignores volatile age/window progress while preserving real
  failure-class, threshold, and recovery transitions.
- [ ] Failure and recovery email bodies are readable and secret-safe.
- [ ] Raw feed freshness, relay liveness, relay snapshot, watch closure, and
  alert email path pass.
- [ ] Accepted-synthesis canary passes if summaries/tables/voting are claimed.
- [ ] Release evidence pipeline passes at the release commit.
- [ ] MVP release gates pass.
- [ ] MVP closeout passes.
- [ ] Public beta compliance, launch control, distribution packet, operator
  packets, beta-session runsheet, docs, whitespace, build/typecheck/lint where
  applicable all pass.
- [ ] Manual 3-browser rehearsal passes.
- [ ] Privacy spot-check passes.
- [ ] Tester copy is claim-safe.
- [ ] Lou gives final go.

## Stop Conditions

Stop immediately and preserve evidence if any of these occur:

- public-feed freshness alert;
- failure-mailbox monitor reports `newCriticalCount > 0`;
- `recommendedNextAction` says to treat the mailbox result as an incident;
- relay liveness/snapshot/watch-closure alert;
- publisher parked/failed unexpectedly;
- StoryCluster credential/endpoint failure returns;
- auth health missing for Apple or Google while either is visible;
- Apple or Google leaks token, subject, state, verifier, private profile data, or
  raw error body;
- PWA CSP blocks the auth boundary;
- accepted-synthesis canary fails or raw feed regresses;
- 3-browser rehearsal shows local echo but not cross-client convergence;
- public paths or telemetry expose nullifier, address, wallet, district hash,
  Merkle root, provider token, or raw constituency proof;
- release evidence, MVP gate, closeout, docs, or compliance check is red;
- support path receives private data in a public issue;
- Lou says stop.

## Human-Readable Next Move

The very next operational move is:

1. merge or explicitly carry #759 as the release branch;
2. preserve the completed S1A finding
   `relay_rest_story_timeout_total_0_of_3_exit_78` and keep A6 unchanged;
3. implement, test, review, and merge S1B concurrent bounded fanout,
   availability-total exit classification, stable alert fingerprinting, and
   readable email MIME;
4. prepare the focused recovery packet from the merged commit, then update and
   restart the exit-78 publisher only if Lou explicitly approves it;
5. preserve clean-tick, public freshness, relay snapshot/liveness, alert
   transition, and 24/48-hour watch evidence until S1A/S1B are green;
6. repair StoryCluster headline-soak credential/endpoint only after S1A/S1B are
   green;
7. use a Lou-supervised Cloudflare browser session to stand up
   `https://auth.venn.carboncaste.io`;
8. use Lou-supervised Apple and Google browser sessions to register provider
   apps;
9. redeploy the PWA origin with Apple/Google auth enabled;
10. update/read back A6 at the release commit;
11. run the accepted-synthesis canary;
12. regenerate release evidence;
13. run the three-browser rehearsal;
14. invite the first 100 public beta testers only after Lou says go.
