# Public Beta State Of Play Handoff - 2026-07-10

> Status: Onboarding handoff for the next release-readiness developer
> Owner: VHC Launch Ops + VHC Core Engineering
> Human authority: Lou
> Technical executor: Codex
> Current active PR: #759 (`coord/release-readiness-beta-runsheet-guard-2026-07-09`)
> Current PR head at handoff: `6a85cf701ee5c6a1eae30c1c966dbee616ea3717`
> Current target app: `https://venn.carboncaste.io`
> Current auth boundary target: `https://auth.venn.carboncaste.io`
> Support/failure mailbox: `carboncasteit@gmail.com`

## Executive Summary

The repository is close to a controlled public beta, but the live release path
is not green yet.

Repo-side Functioning MVP work is implemented and heavily guarded. Users are
intended to be able to read accepted-current summaries, inspect the
bias/framing table, vote on stable frame/reframe point ids, persist one final
stance per user per point, sign in with Apple or Google for account continuity,
bind that account/session to a beta-local LUMA identity, and contribute to
aggregate-only constituency/representative sentiment where privacy thresholds
allow it.

The active work now is not broad product construction. It is release
enablement: incident readback, credential repair, auth/provider deployment, A6
release update, accepted-synthesis canary, release evidence regeneration,
manual three-browser rehearsal, and then a first public-beta tranche.

The immediate blocker is S1A: the failure-mailbox monitor is working, but it is
still reporting public-feed criticals. Monitor `status: pass` means the monitor
ran and classified mail; it does not mean the release is green. As of the
latest local artifact at handoff,
`.tmp/vhc-failure-mailbox-monitor/latest.json` reports:

- generated at `2026-07-10T01:11:56.040Z`;
- `status: pass`;
- `newCriticalCount: 1`;
- `newWarningCount: 2`;
- newest relevant message at `2026-07-10T01:07:59`;
- critical reason `public_feed_alert_fail`;
- warning reasons include pager dead-man workflow failure and a Google account
  access notice;
- recommended next action: treat as incident, preserve email, run read-only
  repo/A6 readback before mutation, Lou retains incident/rollback authority.

Until S1A exits green or Lou makes an explicit incident decision after read-only
repo/A6/public-feed readback, do not start StoryCluster credential repair, auth
deployment, provider registration, origin redeploy, A6 update,
accepted-synthesis canary, release-evidence regeneration, manual rehearsal,
distribution, or tranche expansion.

## Current GitHub/Repo State

Current branch:

```text
coord/release-readiness-beta-runsheet-guard-2026-07-09
```

Current active PR:

```text
#759 Add beta session runsheet guard
https://github.com/CarbonCasteInc/VHC/pull/759
head: 6a85cf701ee5c6a1eae30c1c966dbee616ea3717
state: non-draft
merge state: CLEAN
CI: 9/9 green at handoff
```

Current `main` at handoff:

```text
1f860ae7 Merge pull request #758 from CarbonCasteInc/coord/release-readiness-state-alignment-2026-07-09
```

Open PRs at handoff:

- #759 only.

Open non-release follow-up issues at handoff:

- #178: Wave 2 feature-flag retirement plan.
- #277: consolidate duplicate news modules.
- #279: resolve StoryBundle schema strictness drift.

Preserved local-only files:

- DISTRIBUTION_READINESS_GOAL_2026-07-05.md
- DISTRIBUTION_READINESS_SLICES_2026-07-05.md

Those two files live locally under `docs/plans/` in Lou's workspace, but they
are intentionally untracked. Do not stage or delete them unless Lou explicitly
asks.

## What #759 Adds

#759 is a release-control/documentation guard PR. It does not deploy live code
or mutate A6.

It adds or updates:

- beta-session runsheet guard;
- launch-control decisions from Lou;
- next-phase execution checklist;
- monitor-critical S1A blocker;
- public-beta distribution and launch-control packet alignment;
- auth/provider deployment packet alignment;
- static checks that keep the launch docs from drifting.

Most important doc added by this PR:

- `docs/plans/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md`

Most important new state in that doc:

- S0: repo/PR baseline and release commit candidate.
- S1: failure-mailbox monitor and incident intake.
- S1A: monitor-critical public-feed incident readback gate.
- S2: StoryCluster headline-soak credential/endpoint repair.
- S3: auth boundary infrastructure on Cloudflare.
- S4: Apple provider registration and rehearsal.
- S5: Google provider registration and rehearsal.
- S6: PWA origin image rebuild with auth env/CSP.
- S7: A6 release-commit update and live readback.
- S8: accepted-synthesis canary.
- S9: release evidence regeneration.
- S10: manual three-browser account/vote/privacy rehearsal.
- S11: distribution packet finalization and first public-beta tranche.
- S12: post-launch watch and tranche expansion.

## Product Target

The release target is a controlled public beta of the Venn News Web PWA.

First public-beta surface:

- app name: `venn`;
- app/PWA URL: `https://venn.carboncaste.io`;
- auth worker base URL: `https://auth.venn.carboncaste.io`;
- support/contact/failure mailbox: `carboncasteit@gmail.com`;
- allowed geography: United States and Canada;
- first sign-in providers: Apple and Google;
- X is hidden/deferred;
- first tester tranche: at most 100 testers;
- later tranches: 500, then 1000, then open only after green evidence plus Lou
  approval.

Tester copy may say `public beta`. It must not claim production-grade
readiness, verified-human identity, one-human-one-vote, LUMA Silver, Sybil
resistance, residency proof, private support SLA, native app readiness, or
pager-backed 24/7 operations.

## Authority Model

Lou is the only human authority for:

- release go/no-go;
- incident decisions;
- rollback decisions;
- source/content policy decisions;
- outside-account approval;
- final tester-wave approval.

Codex is the technical executor for:

- repo work;
- release evidence;
- authorized read-only A6 readback;
- authorized A6 release update;
- authorized PWA origin image redeploy;
- publisher restart only if required by the approved release/update/canary path;
- auth setup;
- Apple/Google provider configuration after Lou completes login/MFA;
- Gmail failure-loop analysis.

Not authorized:

- Codex live execution/autonomy;
- pager cutover;
- relay restart;
- retention/compaction/eviction;
- source-surface mutation without content-policy decision;
- release approval without Lou's final go;
- pasting or storing raw secrets in chat, docs, PRs, issues, logs, or release
  artifacts.

## Implemented Repo-Side MVP Surfaces

The following are repo-side implemented and guarded, but not all are live-proven
on A6:

- Accepted-current synthesis detail and votability gating.
- Bias/framing table display gated on accepted-current `TopicSynthesisV2`.
- Stable `frame_point_id` / `reframe_point_id` stance targets.
- One final stance per user per point.
- Local/encrypted event-level signal and public aggregate-only engagement.
- Eye/Lightbulb accounting.
- Apple/Google/X account shell foundations.
- Auth-callback provider boundary, including Apple `form_post` handling and
  Google PWA callback routing.
- Identity-vault session compartment and VaultV2 forward-compatible old-bundle
  write preservation.
- Beta-local LUMA account binding.
- Public-beta LUMA signed-write layer and forbidden-claim gates.
- Constituency proof / district / office aggregate mapping.
- System-writer hardening, path-class enforcement, and default-off
  reject-unmarked coverage across migrated readers.
- Civic representative non-validating durability readback for writes.
- Public beta compliance routes, support/contact path, and private escalation
  minimums.
- Beta-session manual rehearsal contract.

Key point for the new dev: repo capability is not release clearance. A public
beta claim requires live readback, canary, release evidence, and manual
rehearsal on the intended release commit.

## Live A6 State Known From Prior Evidence

Do not infer current A6 state from repo `main`.

Latest proven A6 raw-feed recovery evidence in the docs:

- A6 was proven at `main@47ba218d` after Slice 0 alert enablement and the
  post-Slice-0 stale-feed recovery.
- A later read-only A6 readback recorded `347d2018` on 2026-07-08.
- Newer repo commits after those readbacks are not automatically live on A6.

Prior known live Scope A posture:

- raw-only publisher profile;
- synthesis disabled;
- replay disabled;
- storylines disabled;
- raw cap `8`;
- raw concurrency `2`;
- 2-of-3 relay REST quorum;
- interim email alerting enabled;
- alert-watch and watch-closure timers enabled;
- relay liveness, relay snapshot, freshness, and watch-closure had passed in
  the post-Slice-0 recovery evidence.

Current live state is not proven because the mailbox monitor now reports a
fresh public-feed critical. The next developer must run S1A read-only readback
before treating the feed as healthy or taking launch-enablement actions.

## Evidence State

Current local evidence artifacts at handoff:

- Release evidence pipeline:
  `.tmp/release-evidence-pipeline/latest/release-evidence-pipeline-report.json`
  reports `status: blocked`.
- Release evidence blockers include:
  `source_health_command_exit_1`, `mvp_release_gates_command_exit_1`,
  `mvp_closeout_command_exit_1`, and `mvp_closeout_status_blocked`.
- MVP release gates:
  `.tmp/mvp-release-gates/latest/mvp-release-gates-report.json` reports
  `overallStatus: fail` as of 2026-07-07, with failing public-feed/source gates
  including source health, public feed analysis/frame reliability,
  composition/freshness, lifecycle accountability, fresh propagation,
  pagination refresh, and stance aggregate public mesh.
- LUMA MVP readiness:
  `.tmp/luma-mvp-production-readiness/latest/luma-mvp-production-readiness-report.json`
  reports `status: pass`, but that packet is at stale commit
  `1a83434b0d33278369791891ba9212fcc6b859f6`, not the intended release commit.
- StoryCluster production readiness:
  `.tmp/storycluster-production-readiness/latest/production-readiness-report.json`
  reports `status: blocked`.

StoryCluster details:

- correctness gate: `pass`;
- source-health trend: `pass`, 24 enabled sources, 24 contributing sources,
  23 corroborating sources;
- headline-soak trend: `fail`;
- headline-soak reasons:
  - `insufficient_headline_soak_execution_count`;
  - `promotable_execution_count_below_threshold`;
  - `latest_headline_soak_execution_not_promotable`;
- latest failure diagnosis:
  `storycluster_openai_invalid_api_key`;
- recommended action:
  `repair_storycluster_openai_credential_or_endpoint`.

Source-health note:

- Post-#748 source-health evidence recovered after pruning `ap-topnews`.
- The consolidated release packet still needs a fresh run on the intended
  release commit.

## Active Blockers

These are the blockers that matter before tester distribution.

1. S1A mailbox-critical incident readback is active.

   Latest local monitor has `newCriticalCount: 1` with
   `public_feed_alert_fail`. This blocks mutation and launch-enablement work
   until read-only repo/A6/public-feed readback classifies the incident and
   either proves recovery or Lou approves a focused recovery action.

2. StoryCluster headline-soak credential/endpoint is not release-ready.

   The latest production-readiness report diagnoses the headline-soak failure
   as `storycluster_openai_invalid_api_key`. Repair the credential or endpoint
   through the correct secret store; do not paste or print the credential.

3. Auth boundary is not deployed.

   `https://auth.venn.carboncaste.io` must be stood up outside A6, with durable
   nonce storage, secret-safe health, and allowed PWA origin
   `https://venn.carboncaste.io`.

4. Apple and Google providers are not rehearsed.

   Apple and Google app records must be configured after Lou logs in/MFA, and
   each provider must pass start-leg and full PWA rehearsal. X remains hidden.

5. PWA origin image is not rebuilt with auth env/CSP.

   The origin must know:
   `VITE_AUTH_CALLBACK_BASE_URL=https://auth.venn.carboncaste.io` and
   `VITE_AUTH_CALLBACK_PROVIDERS=apple google`, and CSP must allow the auth
   boundary.

6. A6 is not proven at the intended release commit.

   Use the existing A6 SSH path only after S1A is clear or Lou has made an
   explicit incident decision. Read back before mutation. Update/restart only
   inside the approved release path.

7. Accepted synthesis is not live-proven on A6.

   The canary is required before tester copy can claim accepted summaries,
   framing tables, or stable-point voting.

8. Release evidence is stale/blocked.

   Regenerate the full release evidence pipeline at the intended release commit
   after live blockers clear.

9. Manual three-browser rehearsal has not passed.

   The release still needs Apple/Google account binding, beta-local LUMA
   binding, stance persistence, cross-client aggregate convergence, reload
   persistence, and privacy spot-check against the deployed target.

10. Distribution packet is still blocked.

   Do not invite testers until launch-control and distribution packets are
   filled with passing, secret-safe evidence and Lou says go.

## Immediate Next Sequence

Do this in order.

### 1. Keep #759 current and merge or carry it explicitly

PR #759 is green and clean at handoff. It can be merged when Lou wants the
launch-control/checklist docs on `main`, or carried as the release-control
branch if Lou decides not to merge yet.

Before acting:

```bash
git fetch origin --prune
gh pr view 759 --json number,title,headRefName,headRefOid,isDraft,mergeStateStatus,statusCheckRollup,url
git status --short --branch
```

### 2. Run S1A read-only incident readback

Do not mutate A6. Do not restart services. Do not repair credentials yet.

Read back:

- current repo branch/SHA and PR state;
- latest mailbox monitor artifact;
- A6 deployed commit;
- `vh-news-aggregator.service` state;
- `vh-public-feed-alert-watch.timer` state and latest service result;
- `vh-phase5-scope-a-watch-closure.timer` state and latest verdict;
- latest public-feed freshness summary;
- relay liveness summary;
- relay snapshot/watch-closure summary;
- most recent publisher clean tick or parked/failure reason.

Classify:

- active publisher/freshness incident;
- publisher ticking but writes/readbacks failing;
- relay/snapshot stale while publisher writes pass;
- alert/watch false-positive or stale baseline;
- public monitor failure from source scarcity;
- duplicate/known/recovered alert;
- other, with evidence path.

If a recovery action is needed, stop and ask Lou to approve that exact action.

### 3. Only after S1A exits green, repair StoryCluster credential/endpoint

Packet:

```text
docs/ops/storycluster-headline-soak-credential-repair-2026-07-09.md
```

Commands:

```bash
corepack pnpm@9.7.1 collect:storycluster:headline-soak
corepack pnpm@9.7.1 check:storycluster:production-readiness
```

Done when `check:storycluster:production-readiness` no longer blocks on the
headline-soak credential/endpoint class.

### 4. Stand up auth boundary

Packet:

```text
docs/ops/auth-callback-provider-deployment-packet-2026-07-09.md
```

Target:

```text
https://auth.venn.carboncaste.io
```

Required:

- Lou-supervised Cloudflare session;
- DNS/routing under Cloudflare, or Namecheap only if delegation is missing;
- durable nonce store;
- secret-safe health;
- `VH_AUTH_ALLOWED_ORIGINS=https://venn.carboncaste.io`;
- `VH_AUTH_PWA_ORIGIN=https://venn.carboncaste.io`.

### 5. Register and rehearse Apple and Google

Apple:

- redirect: `https://auth.venn.carboncaste.io/auth/apple/return`;
- Apple Developer login/MFA required;
- provider health must show configured;
- live PWA rehearsal must pass.

Google:

- redirect: `https://venn.carboncaste.io/auth/callback`;
- Google Cloud login/MFA required;
- provider health must show configured;
- live PWA rehearsal must pass.

X stays hidden/deferred.

### 6. Rebuild/redeploy PWA origin image

Use:

```text
docs/ops/public-beta-image-deploy.md
```

Required PWA build env:

```text
VITE_AUTH_CALLBACK_BASE_URL=https://auth.venn.carboncaste.io
VITE_AUTH_CALLBACK_ROUTE=/auth/callback
VITE_AUTH_CALLBACK_PROVIDERS=apple google
```

CSP must allow `https://auth.venn.carboncaste.io`.

### 7. Update/read back A6 at release commit

Only after S1A and upstream prerequisites clear.

Rules:

- read back before mutation;
- do not restart relays;
- restart publisher only if required by the approved release/update/canary path;
- record exact service state and freshness/liveness/snapshot/watch-closure
  outputs.

### 8. Run accepted-synthesis canary

Use:

```text
docs/ops/a6-accepted-synthesis-canary-packet-2026-07-09.md
```

Required before claiming:

- accepted summaries;
- bias/framing table;
- stable point voting.

### 9. Regenerate release evidence

Run at intended release commit after live blockers clear:

```bash
corepack pnpm@9.7.1 check:luma:mvp-production-readiness
corepack pnpm@9.7.1 check:mvp-release-gates
corepack pnpm@9.7.1 check:mvp-closeout
corepack pnpm@9.7.1 report:mvp-release-evidence
corepack pnpm@9.7.1 docs:check
git diff --check
```

The release packet must have:

```text
status: pass
release_commit_verified: true
blockers: []
```

### 10. Run manual three-browser rehearsal

Use:

```text
docs/ops/BETA_SESSION_RUNSHEET.md
```

Must prove:

- Apple account binding;
- Google account binding;
- beta-local LUMA identity binding;
- reset identity clears account binding and requires re-bind;
- distinct browser profiles get distinct beta-local principals;
- accepted-current story renders;
- frame/reframe vote persists;
- non-voting browsers see aggregate update;
- reload persistence works;
- no provider/nullifier/proof/address/wallet leak appears.

### 11. Finalize distribution and invite first tranche

Use:

```text
docs/ops/public-beta-launch-control-2026-07-09.md
docs/ops/public-beta-distribution-packet-2026-07-09.md
```

Only invite testers after:

- launch-control status is `go_for_public_beta_ramp`;
- distribution status is `go_for_public_beta_distribution`;
- all evidence rows are filled;
- latest mailbox monitor has no unresolved criticals or Lou has explicitly
  cleared the incident from read-only evidence;
- Lou says go.

First tranche is capped at 100 testers.

## Commands The New Dev Should Know

Launch/control docs:

```bash
corepack pnpm@9.7.1 check:public-beta-next-phase-sprint
corepack pnpm@9.7.1 check:public-beta-launch-control
corepack pnpm@9.7.1 check:public-beta-distribution-packet
corepack pnpm@9.7.1 check:public-beta-launch-closeout
corepack pnpm@9.7.1 check:release-readiness-operator-packets
corepack pnpm@9.7.1 check:beta-session-runsheet
corepack pnpm@9.7.1 check:public-beta-compliance
corepack pnpm@9.7.1 docs:check
git diff --check
```

StoryCluster/source:

```bash
corepack pnpm@9.7.1 check:storycluster:correctness
corepack pnpm@9.7.1 collect:storycluster:headline-soak
corepack pnpm@9.7.1 check:storycluster:production-readiness
corepack pnpm@9.7.1 check:news-sources:health
```

Auth:

```bash
corepack pnpm@9.7.1 --filter @vh/auth-callback build
corepack pnpm@9.7.1 --filter @vh/auth-callback test
corepack pnpm@9.7.1 check:auth-callback
```

Release:

```bash
corepack pnpm@9.7.1 check:luma:mvp-production-readiness
corepack pnpm@9.7.1 check:mvp-release-gates
corepack pnpm@9.7.1 check:mvp-closeout
corepack pnpm@9.7.1 report:mvp-release-evidence
```

Local note: this Mac currently emits a Node engine warning because it is on
Node `v23.10.0` while the repo asks for `>=20 <23`. The relevant commands above
have been passing despite that warning.

## Files To Read First

Read these in this order:

1. `docs/plans/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md`
2. `docs/ops/public-beta-launch-control-2026-07-09.md`
3. `docs/ops/public-beta-distribution-packet-2026-07-09.md`
4. `docs/ops/public-beta-launch-readiness-closeout.md`
5. `docs/ops/BETA_SESSION_RUNSHEET.md`
6. `docs/ops/storycluster-headline-soak-credential-repair-2026-07-09.md`
7. `docs/ops/auth-callback-provider-deployment-packet-2026-07-09.md`
8. `docs/ops/a6-accepted-synthesis-canary-packet-2026-07-09.md`
9. `docs/ops/public-beta-image-deploy.md`
10. `docs/foundational/STATUS.md`

## Non-Negotiables

Do not:

- treat green CI on #759 as release readiness;
- treat monitor `status: pass` as release clearance;
- mutate A6 before S1A readback/classification;
- restart relays from this sprint;
- restart publisher unless the approved path requires it;
- deploy auth or configure providers before the active mailbox critical is
  classified/cleared or Lou explicitly authorizes return to release work;
- enable accepted synthesis outside the bounded canary packet;
- enable Codex live execution/autonomy;
- cut over the custom pager;
- paste secrets into chat/docs/PRs/issues/logs;
- claim verified-human, one-human-one-vote, LUMA Silver, Sybil resistance,
  residency proof, production app readiness, or private support SLA.

## Plain-English Current Status

The repo is in good shape for the launch-control work. #759 is green and
mergeable. The product MVP is largely built at repo level.

The live release is still blocked. The alert mailbox is doing its job and is
still reporting a public-feed critical. The next dev's first real job is not
Cloudflare, Google, Apple, A6 update, or canary. It is S1A: prove what is
happening on A6/readbacks without changing live state, then let Lou decide
whether we are returning to release work or handling an incident.

Once S1A is green, the path is straightforward: repair StoryCluster credentials,
stand up auth, register Apple/Google, redeploy the PWA origin, update/read back
A6, run the accepted-synthesis canary, regenerate release evidence, rehearse in
three browsers, finalize the packets, and invite no more than 100 testers after
Lou says go.
