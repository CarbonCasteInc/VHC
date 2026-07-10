# Public Beta Next-Phase Sprint Checklist - 2026-07-09

> Status: Technical execution checklist for the next release phase
> Owner: VHC Core Engineering + VHC Launch Ops
> Human authority: Lou
> Technical executor: Codex
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

Current monitor readout:

- generated at `2026-07-10T00:40:48.348445Z`;
- `newCriticalCount: 85`;
- `newWarningCount: 12`;
- `newInfoCount: 5`;
- newest relevant message was `2026-07-10T00:07:57`;
- critical class includes `public_feed_alert_fail` for public-feed freshness;
- warning class includes `pager_deadman_workflow_failed`;
- recorded next action: treat as incident; preserve email; run read-only
  repo/A6 readback before mutation; Lou retains incident/rollback authority.

`recommendedNextAction` requesting `treat as incident; preserve email; run
read-only repo/A6 readback before mutation; Lou retains incident/rollback
authority.` is a blocker for mutation until that readback is complete.

If `.tmp/vhc-failure-mailbox-monitor/latest.json` has `newCriticalCount > 0`,
the release is blocked even when `status: pass`.

Before any mutation, deploy, provider registration, A6 update, canary,
distribution, or tranche expansion, `newCriticalCount == 0` or Lou has made an
explicit incident decision after read-only repo/A6 readback.

`public_feed_alert_fail`, `public_feed_freshness_workflow_failed`, and
`public_feed_freshness_workflow_cancelled` are public-feed freshness blockers.

`pager_deadman_workflow_failed` warnings must be triaged and the pager dead-man workflow must be green before launch, post-launch watch, or tranche expansion.

Resulting sprint rule: no StoryCluster credential repair, auth setup, origin
redeploy, A6 update, accepted-synthesis canary, release-evidence regeneration,
manual rehearsal, distribution-packet finalization, or tester invite may proceed
until S1A exits green. Pager dead-man warnings remain a watch item; they do not
authorize pager cutover.

Guard tokens:

- `MAILBOX_PASS_IS_MONITOR_HEALTH_NOT_RELEASE_GREEN`
- `READ_ONLY_INCIDENT_TRIAGE_ONLY`
- `PUBLIC_FEED_ALERT_FAIL_BLOCKS_MUTATION`
- `A6_READBACK_BEFORE_ANY_MUTATION`
- `NO_STORYCLUSTER_AUTH_DEPLOY_UNTIL_INCIDENT_CLASSIFIED`
- `LOU_RETAINS_INCIDENT_ROLLBACK_AUTHORITY`

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
- [ ] If `newCriticalCount > 0`, S1A is mandatory before S2 or later launch
  work.

## S1A - Monitor-Critical Public-Feed Incident Readback Gate

### Goal

Resolve the live public-feed freshness incident signaled by the failure-mailbox
monitor before doing launch-enablement work.

### Trigger

This gate is active when `.tmp/vhc-failure-mailbox-monitor/latest.json` reports
`newCriticalCount > 0`, including the current 2026-07-10 report with
`newCriticalCount: 85` and public-feed freshness failures.

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
  - [ ] generated at `2026-07-10T00:40:48.348445Z`;
  - [ ] newest relevant message at `2026-07-10T00:07:57`;
  - [ ] `critical=85`;
  - [ ] `warning=12`;
  - [ ] `info=5`.
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

### Exit Criteria

- [ ] The incident has a named reason code and evidence path.
- [ ] Public-feed freshness, relay liveness, relay snapshot, and watch-closure
  are either passing or have a Lou-approved incident packet for the smallest
  recovery action.
- [ ] No live mutation occurred during readback.
- [ ] If a recovery action is needed, stop here and get Lou approval for that
  action; do not continue launch-enablement work under this sprint.
- [ ] If readback proves recovery/pass, proceed to S2 and keep the monitor
  active.

## S2 - StoryCluster Headline-Soak Credential/Endpoint Repair

### Goal

Clear the current StoryCluster production-readiness blocker without exposing
credentials.

### Required Input

- [ ] Lou provides an access window for the account/host that holds the
  StoryCluster/OpenAI credential.
- [ ] Codex can inspect only redacted env names, file mode/owner/hash, health
  booleans, and stable reason codes.
- [ ] S1A is green if the latest failure-mailbox monitor reported critical
  items.
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
  has cleared them with read-only evidence.
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
2. because the 2026-07-10 monitor found 85 critical public-feed freshness
   items, perform S1A read-only repo/A6 incident readback and stop if recovery
   action is needed;
3. repair StoryCluster headline-soak credential/endpoint only after S1A is
   green;
4. use a Lou-supervised Cloudflare browser session to stand up
   `https://auth.venn.carboncaste.io`;
5. use Lou-supervised Apple and Google browser sessions to register provider
   apps;
6. redeploy the PWA origin with Apple/Google auth enabled;
7. update/read back A6 at the release commit;
8. run the accepted-synthesis canary;
9. regenerate release evidence;
10. run the three-browser rehearsal;
11. invite the first 100 public beta testers only after Lou says go.
