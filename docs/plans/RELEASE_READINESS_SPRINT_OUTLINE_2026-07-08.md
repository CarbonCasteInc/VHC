# Release Readiness Sprint Outline - 2026-07-08

> Status: Execution outline for fastest credible tester distribution
> Owner: VHC Core Engineering + VHC Launch Ops
> Basis for this outline revision: `main@1f860ae7` after #758; this revision
> adds the beta-session runsheet guard
> Latest release evidence basis: stale packet at `1a83434b`
> Latest recorded Scope A proof packet: `47ba218d`
> Live A6 readback basis: operator read-only readback 2026-07-08, host at
> `347d2018` (#744), services green, freshness monitor pass
> Target surface: Venn News Web PWA initial controlled tester release
> Depends On: `docs/foundational/STATUS.md`,
> `docs/reports/state-of-play-docs-alignment-audit-2026-07-08.md`,
> `docs/reports/functioning-mvp-lane-repo-closeout-2026-07-07.md`,
> `docs/plans/FUNCTIONING_MVP_LANE_SLICE_PLAN_2026-07-06.md`,
> `docs/ops/NEWS_SOURCE_ADMISSION_RUNBOOK.md`,
> `docs/ops/news-aggregator-production-service.md`,
> `docs/ops/public-beta-image-deploy.md`,
> `docs/ops/public-feed-freshness-monitor.md`,
> `docs/ops/account-provider-callback-boundary.md`,
> `docs/ops/BETA_SESSION_RUNSHEET.md`,
> `docs/ops/public-beta-launch-readiness-closeout.md`

## Executive Verdict

The repository is not waiting on another broad product build. The Functioning
MVP product lanes are implemented and the known follow-up hardening sequence is
merged. The fastest credible route to testers is now a release-readiness sprint:
clear the live evidence blockers, deploy the external auth boundary, prove
accepted synthesis on the intended live surface, regenerate evidence on the
release commit, and run the manual tester rehearsal.

The current blocker class is therefore:

1. live source-health and public-feed/stance-aggregate gate evidence;
2. A6 accepted-synthesis enablement/proof;
3. auth-provider registration and callback deployment;
4. fresh release evidence at current `main`;
5. manual multi-browser rehearsal against the actual tester target.

This sprint must not expand into pager cutover, Codex live execution, retention
or compaction, native packaging, LUMA Silver, verified-human claims, one-human
one-vote claims, or public WSS mesh `release_ready` unless those become explicit
separate programs with their own gates.

## Intended Release Claim

For the first controlled tester release, users can:

1. open the Web PWA;
2. register or sign in through the account shell using Apple or Google when the
   provider is configured; X is hidden until a later packet registers and
   rehearses it;
3. create or attach a beta-local LUMA identity to that account session;
4. open a story with accepted-current synthesis;
5. read the accepted summary;
6. inspect the accepted-current bias/framing table;
7. vote on stable frame/reframe point ids;
8. reload and see one final stance per user per point persist;
9. see public aggregate-only engagement counts;
10. have beta-local constituency/representative sentiment participate in
    aggregate-only district/office surfaces when privacy thresholds allow it.

Claim boundaries:

- social sign-in is account continuity and recovery, not proof of human
  uniqueness;
- LUMA is public-beta, beta-local, device-bound identity, not Silver,
  production attestation, verified-human, Sybil resistance, cryptographic
  residency, or cross-device one-human-one-vote;
- district/office sentiment is aggregate-only; raw address, nullifier, provider
  subject, OAuth token, proof material, and per-user district rows are never
  public;
- outbound delivery to representative offices is not claimed unless separately
  proven through the Civic Action Kit send lane;
- custom pager/PWA incident response and Codex live execution are not part of
  the tester-release claim.

## Current State Grounding

Repository and GitHub state at this alignment point:

- repo basis for this outline revision: `main@1f860ae7`;
- revision PR: #759, adding
  `pnpm check:beta-session-runsheet` and wiring it into launch closeout;
- open issues: #178, #277, #279 only, all older unrelated backlog;
- local untracked operator readiness docs remain preserved and out of scope:
  `DISTRIBUTION_READINESS_GOAL_2026-07-05.md` and
  `DISTRIBUTION_READINESS_SLICES_2026-07-05.md`. They are intentionally not
  cited as committed `docs/...` dependencies because CI does not have them.

Merged repo capabilities:

- accepted-current synthesis detail gating and votability checks;
- stance/vote admission, durable queueing, projection, and aggregate engagement;
- `services/auth-callback` OAuth/PKCE callback boundary foundations;
- browser sign-in shell and LUMA account binding;
- beta-local LUMA signed-write layer and identity-vault hardening;
- constituency proof and representative aggregate mapping;
- full migrated system-writer read-class hardening;
- VaultV2 forward-compatible old-bundle write preservation;
- civic representative non-validating durability readback for writes;
- docs alignment after the hardening sequence;
- release-readiness operator packets for Lane 0 launch control, StoryCluster
  headline-soak credential repair, A6 accepted-synthesis canary,
  auth-callback/provider deployment, and first-wave distribution.

Latest local evidence state:

- `.tmp/luma-mvp-production-readiness/latest/luma-mvp-production-readiness-report.json`
  is `pass` in the stale packet;
- `.tmp/release-evidence-pipeline/latest/release-evidence-pipeline-report.json`
  is `blocked`;
- `.tmp/mvp-release-gates/latest/mvp-release-gates-report.json` fails:
  `source_health`, `public_feed_analysis_frame_reliability`,
  `public_feed_composition_freshness`,
  `public_feed_lifecycle_accountability`,
  `public_feed_fresh_propagation`, `public_feed_pagination_refresh`, and
  `stance_aggregate_decay_public_mesh`;
- `.tmp/mvp-closeout/latest/mvp-closeout-report.json` is `blocked`;
- `services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json`
  now has readiness `ready` and release evidence `pass` in the local packet
  generated 2026-07-09T13:58:21Z. The consolidated release evidence pipeline
  still has to be regenerated on the intended release commit.

Live A6 state must not be inferred from repo `main`. Operator read-only
readback, 2026-07-08 ~22:05 EDT (recorded here as Lane 2's first readback):

- A6 `/home/humble/VHC` is at `347d2018` (merge of #744), pulled 2026-07-08
  12:10 EDT; prior pulls were `1a83434b` (2026-07-07) and `47ba218d`
  (2026-07-06);
- A6 is 37 commits behind `main@1f860ae7`; the delta includes #741
  reject-unmarked system-writer adapters, #742 VaultV2 old-bundle write
  preservation, #745 civic representative durability readback, #746 docs
  alignment, #747 release-readiness sprint outline, #748 source-health
  recovery, #749 beta runsheet sign-in rehearsal, #750 headline-soak
  diagnostics, #751/#752 launch control, #753 StoryCluster credential repair
  packet, #754 A6 accepted-synthesis canary packet, #755 auth-callback
  deployment packet/provider allowlist wiring, #756 launch-control gate, and
  #757 first-wave distribution packet, and #758 release-readiness state
  alignment plus operator-packet guard;
- `vh-news-aggregator.service` and `vh-storycluster-engine.service` are both
  `active/running` with `ExecMainStatus=0`;
- `vh-public-feed-alert-watch.timer` and
  `vh-phase5-scope-a-watch-closure.timer` are both active and firing on
  schedule;
- the public-feed freshness monitor summary at 2026-07-09T02:06Z is `pass`
  with zero blockers across `https://venn.carboncaste.io/` and the three
  `gun-{a,b,c}.carboncaste.io` relays;
- the latest recorded formal Scope A proof packet still dates from
  `main@47ba218d`; the readback above is live-state evidence, not a new proof
  packet;
- the recovered raw feed should remain untouched while fresh;
- accepted synthesis is repo-capable but not yet operator-enabled and proven on
  A6.

## Sprint Operating Rules

1. Work from freshly pulled `main`.
2. Every repo change gets a branch, tests, docs if needed, push, and PR.
3. Operator-only live actions get a packet or runbook entry before execution.
4. Do not mutate A6 when a read-only gate can answer the question.
5. Do not restart relays while freshness, relay liveness, relay snapshot
   freshness, and watch-closure are green unless an explicit operator
   maintenance packet says so. Publisher restart is allowed only when required
   by the approved release/update/canary path or a focused incident packet.
6. Treat a new alert email as an incident.
7. Keep `services/auth-callback` outside A6.
8. Keep provider secrets out of repo, browser bundle, logs, issues, PRs, and
   evidence packets.
9. Keep Codex executor/autonomy dry-run only.
10. Keep email alert fallback on even after any later pager deployment.

## Sprint Structure

The sprint has nine lanes, Lane 0 through Lane 8. Lane 0 locks the release
envelope and owners. Lanes 1-3 unblock live product availability. Lanes 4-5
make account continuity real. Lanes 6-8 convert the system from "repo
implemented" to "tester distributable".

```text
Lane 0  Release envelope and ownership lock
Lane 1  Source-health recovery
Lane 2  A6 current-main readback and accepted-synthesis canary
Lane 3  Public-feed and stance aggregate gate recovery
Lane 4  Auth-callback deployment outside A6
Lane 5  Provider registration and live sign-in rehearsal
Lane 6  Fresh release evidence on the release commit
Lane 7  Manual 3-browser tester rehearsal and privacy proof
Lane 8  Distribution packet, rollback, and first tester wave
```

## Lane 0 - Release Envelope And Ownership Lock

### Goal

State exactly what the first tester release claims and who owns each live
surface before any operator action starts.

### Required decisions

1. Release envelope:
   - full intended MVP: live accepted synthesis, social sign-in, LUMA binding,
     vote persistence, and district/office aggregate sentiment;
   - or a deliberately narrower beta that does not claim whichever live surface
     is not yet deployed. Narrowing changes tester-facing claims only; it does
     not waive any release gate (see Lane 3).
2. Tester audience:
   - `dev-small`: 1-3 testers for burn-in only;
   - `beta-scale`: up to 10 testers for burn-in only;
   - `public-beta-ramp`: first public tranche capped at 100 testers, then
     500/1000/open only after green evidence plus Lou approval. A "daily gate"
     here means a daily `check:mvp-release-gates` run recorded in the evidence
     workspace.
3. Owners:
   - Lou is the sole human authority for release go/no-go, incident, rollback,
     content-policy, and external-approval decisions;
   - Codex is the technical executor for repo work, release evidence, A6
     readback/update, origin image redeploy, auth setup, and Gmail failure-loop
     analysis after Lou grants the relevant account/browser access;
   - Apple and Google are the first public-beta providers; X stays hidden until a
     later packet adds and rehearses it.
4. Release commit pinning: the launch note names the intended release commit
   once known. If `main` advances past the commit read back or deployed in
   Lane 2, the Lane 2 readback/update packet must be re-run before Lane 6
   evidence counts, or the envelope must explicitly avoid A6-newer claims.
5. Web PWA hosting target: keep the current A6-hosted
   `vhc-public-beta-origin` container at `https://venn.carboncaste.io`, or
   stand up a non-A6 host. Changing the PWA origin orphans every existing
   beta-local identity and its votes, because identity is origin-scoped
   encrypted IndexedDB — an origin change is a tester-visible reset and must
   be treated as one.
6. External release approval: Lou has recorded
   `not_required_for_public_beta`; legal/commercial hardening happens during
   testing unless the public claim changes. The closeout evidence still
   classifies an unrecorded disposition as a ship blocker.

### Exit criteria

- A one-page launch note records the release envelope, forbidden claims,
  operator owners, deployed target URLs, and rollback contacts.
- `corepack pnpm@9.7.1 check:public-beta-launch-control` passes. The current
  no-go packet must retain explicit operator blanks and live-evidence blockers;
  a future `go_for_public_beta_ramp` packet must not retain stale no-go
  language.
- If the release envelope is narrowed, every excluded claim is removed from
  tester-facing copy before distribution.

## Lane 1 - Source-Health Recovery

### Goal

Clear the source-health release blocker without weakening the source admission
contract.

### Current blocker

The sprint-start packet had `ap-topnews` escalated to removal with no ready
runs in the release evidence window. The 2026-07-09 source-health lane removes
that source from the starter surface; the latest branch-local source-health run
is `ready` with 24 enabled keep sources, no watch/remove sources, and
`releaseEvidence.status: pass` after the configured five-run window. The
consolidated release packet still has to be regenerated on the intended release
commit. The broader StoryCluster production-readiness check still blocks on
headline-soak release evidence after this recovery: correctness and
source-health pass, but the latest live headline-soak attempt produced no audit
attachments because the local real StoryCluster/OpenAI path rejected its
credential. Current production-readiness reports surface this as the
secret-safe diagnostic
`headlineSoakTrend.latestFailureDiagnosis.failureClass:
"storycluster_openai_invalid_api_key"` with recommended action
`repair_storycluster_openai_credential_or_endpoint`; raw key material remains
redacted and must not be copied into docs or issues. This lane is source-surface
and release-window recovery, not a generic StoryCluster correctness failure.

### Implementation steps

1. Inspect current source-health evidence:

   ```bash
   corepack pnpm@9.7.1 report:news-sources:health
   node -e "console.log(require('./services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json').releaseEvidence)"
   ```

2. Confirm the current source-health verdict:
   - before the 2026-07-09 source-health fix, `ap-topnews` showed
     `feed_links_unavailable`, `feed_non_xml_payload`, and/or
     `watchlist_escalated_by_history`;
   - after the fix, `ap-topnews` should be absent from the enabled source
     surface and the latest run should have no watch/remove sources.

3. Make the source-surface decision:
   - keep `ap-topnews` pruned from the starter/keep surface while the source
     continues to fail the runbook criteria;
   - readmit it only if a real source feed URL is available and passes the
     admission/health workflow.

4. If a repo change is needed, keep it narrow to the source registry and source
   evidence expectations. Do not add a new source merely to preserve count
   unless it clears the scout/admission/health workflow.

5. Validate:

   ```bash
   corepack pnpm@9.7.1 scout:news-sources:candidates
   corepack pnpm@9.7.1 report:news-sources:admission
   corepack pnpm@9.7.1 report:news-sources:health
   corepack pnpm@9.7.1 check:news-sources:health
   corepack pnpm@9.7.1 check:storycluster:production-readiness
   ```

   The final StoryCluster production-readiness check is expected to stay red
   until headline-soak release evidence recovers. A source-health fix is not
   allowed to mask or downgrade `headline_soak_release_evidence_failed`.

6. Let the configured release window accumulate clean runs after the source
   surface is clean. The 2026-07-09 lane proved this locally with
   `check:news-sources:health`; repeat it on the intended release commit and do
   not bypass `insufficient_release_evidence_window`,
   `blocked_run_within_release_window`, `non_ready_runs_exceed_threshold`, or
   `latest_run_not_ready`.

### Exit criteria

- Source-health release evidence is `pass`.
- The configured recent run window is complete and ready.
- No `remove` or new `watch` source contaminates the release window.
- The source-health artifact records the policy decision and artifact path.

## Lane 2 - A6 Current-Main Readback And Accepted-Synthesis Canary

### Goal

Prove the live tester surface is either current enough for the MVP release, or
explicitly scope the release away from unproven live accepted synthesis.

### Preconditions

- Lane 0 release envelope is decided.
- Lane 1 has no active source-health incident.
- Email alert path remains active.
- Freshness, relay liveness, relay snapshot freshness, and watch-closure are
  green immediately before the maintenance packet.

### Read-only A6 readback

A first read-only readback was performed 2026-07-08 ~22:05 EDT and is recorded
in Current State Grounding: A6 at `347d2018`, both services active, both
timers firing, freshness monitor pass. Re-run the readback immediately before
any maintenance packet, because this state goes stale:

```bash
cd /home/humble/VHC
git rev-parse --short=12 HEAD
git status --short
systemctl --user show vh-news-aggregator.service \
  -p ActiveState -p SubState -p ExecMainStatus -p NRestarts --no-pager
systemctl --user show vh-storycluster-engine.service \
  -p ActiveState -p SubState -p ExecMainStatus -p NRestarts --no-pager
systemctl --user status vh-public-feed-alert-watch.timer --no-pager
systemctl --user status vh-phase5-scope-a-watch-closure.timer --no-pager
```

Then capture the latest freshness/relay/snapshot/watch summaries and confirm
whether the host is still at `347d2018` or has already moved.

### Current-main update

If the tester release depends on post-`347d2018` repo code (the current
10-commit delta includes the #741/#742 system-writer and vault hardening and
the #745 civic representative durability fix), the operator packet must
explicitly update A6 to the intended release commit. The packet must state:

- whether publisher restart is required and, if so, the exact stop/start and
  post-restart readback;
- how freshness is observed before and after;
- how alert delivery is preserved;
- rollback target and command;
- what evidence artifact records success.

Updating the A6 repo checkout does not update the tester-facing Web PWA. The
public origin at `https://venn.carboncaste.io` serves PWA assets from the
`vhc-public-beta-origin` container image, so shipping release-commit PWA
assets (and any baked `VITE_*` values) requires an origin image rebuild and
redeploy per `docs/ops/public-beta-image-deploy.md`. That is an A6-touching
operator action: fold it into this packet or write a dedicated packet, and
preserve the relay data mounts and latest-index snapshots exactly as the
runbook's invariants require.

### Accepted-synthesis canary

If the release envelope claims accepted summaries/framing tables on live public
stories, enable accepted synthesis only through a dedicated canary packet.
The standing operator preconditions from
`docs/reports/functioning-mvp-lane-repo-closeout-2026-07-07.md` and
`docs/foundational/STATUS.md` apply in full:

- the 48-hour clean-window target (`2026-07-08T22:44:08Z`) has passed — as of
  the 2026-07-08 readback the target time is behind us, but the packet must
  verify the window actually stayed clean;
- the canary runs as a separate attended soak with an updated runbook entry
  per `STATUS.md`;
- the packet explicitly acknowledges that this touch ends the 14-day
  unattended evidence window and records the trade-off.

The packet must:

1. state exact env changes, including any `VH_BUNDLE_SYNTHESIS_*` variables;
2. use low, bounded canary scope before general enablement;
3. preserve relay write quorum at 2-of-3;
4. record StoryCluster and synthesis worker health;
5. verify lifecycle rows reach `accepted_available`;
6. verify `TopicSynthesisV2` contains non-empty `facts_summary`,
   `frame_point_id`, and `reframe_point_id`;
7. verify public story detail renders the accepted summary and table;
8. verify no vote controls appear for pending, invalid, suppressed, or stale
   synthesis;
9. preserve email alerting and record any alert transition.

### Exit criteria

- A6 commit and service state are read back and recorded.
- If the release depends on newer PWA assets or baked `VITE_*` values, the
  origin image redeploy is executed and recorded, and
  `https://venn.carboncaste.io` serves the release-commit assets.
- If accepted synthesis is in the release envelope, at least one live public
  accepted-current story is proven end to end.
- If accepted synthesis is not enabled, the release envelope and tester copy do
  not claim it.
- No unbounded publisher or relay restart occurred outside the packet.

## Lane 3 - Public-Feed And Stance Aggregate Gate Recovery

### Goal

Turn the public-feed gates from stale live/operator failures into current
release evidence.

### Gate failures to clear

- `public_feed_analysis_frame_reliability`;
- `public_feed_composition_freshness`;
- `public_feed_lifecycle_accountability`;
- `public_feed_fresh_propagation`;
- `public_feed_pagination_refresh`;
- `stance_aggregate_decay_public_mesh`.

### Implementation steps

1. After Lane 2 canary/update, run:

   ```bash
   corepack pnpm@9.7.1 check:mvp-release-gates
   ```

2. Inspect:

   ```bash
   .tmp/mvp-release-gates/latest/mvp-release-gates-report.json
   ```

3. Classify each remaining red gate:
   - source-health residue;
   - accepted-synthesis missing;
   - stale public feed;
   - public relay readback;
   - stance aggregate write/readback;
   - test harness/environment issue;
   - real repo regression.

4. Fix repo regressions through ordinary PRs. Fix live/A6 issues through
   operator packets. Do not use local fixture success to clear a live public
   gate.

5. Rerun until every gate is green. `check:mvp-release-gates` is a fixed gate
   list with no release-envelope or exclusion mechanism: it passes only when
   every gate passes, and any red gate keeps `check:mvp-closeout` and the
   release evidence pipeline blocked. Narrowing the release envelope changes
   what tester copy may claim; it does not skip, waive, or reinterpret any
   gate.

### Exit criteria

- `check:mvp-release-gates` passes — all gates, no exclusions.
- If the envelope was narrowed, the narrowing is recorded as a claims
  decision in the launch note; it is never cited as a reason a red gate is
  acceptable.

## Lane 4 - Auth-Callback Deployment Outside A6

### Goal

Make Apple/Google account continuity real on a deployed, secret-bearing service
outside A6, while keeping X hidden until a later provider packet rehearses it.

### Repo capability

`services/auth-callback` owns the server side of OAuth/OIDC with PKCE. Browser
clients receive only non-secret session payloads. Provider secrets stay in the
boundary host's private secret store. The Web PWA now also has a build-time
provider allowlist, `VITE_AUTH_CALLBACK_PROVIDERS`, so a staged release can
show only providers that have passed live registration and rehearsal.

### Deployment target

Workers-family edge host outside A6, with:

- `VH_AUTH_STATE_SECRET`;
- `VH_AUTH_ALLOWED_ORIGINS`;
- `VH_AUTH_KV` or explicit dev-only volatile store;
- per-provider client ids, redirect URIs, and secrets;
- Apple `.p8` key material stored only in host secrets.

### Implementation steps

1. Build/test locally:

   ```bash
   corepack pnpm@9.7.1 --filter @vh/auth-callback build
   corepack pnpm@9.7.1 --filter @vh/auth-callback test
   corepack pnpm@9.7.1 check:auth-callback
   corepack pnpm@9.7.1 --filter @vh/web-pwa exec vitest run src/auth/signInFlow.test.ts --config vite.config.ts
   ```

2. Use the dedicated operator packet:
   `docs/ops/auth-callback-provider-deployment-packet-2026-07-09.md`.

3. Provision the edge host and secret store.

4. Configure CORS/origin allowlist for the tester PWA origins only.

5. Deploy the boundary service.

6. Verify `/api/health` returns only constant status strings and
   configuration-presence booleans, never configuration values.

7. Verify no provider secret appears in:
   - repository files;
   - build output;
   - browser bundle;
   - service logs;
   - error responses;
   - release artifacts.

8. Configure the Web PWA public env:

   ```bash
   VITE_AUTH_CALLBACK_BASE_URL=https://auth.venn.carboncaste.io
   VITE_AUTH_CALLBACK_ROUTE=/auth/callback
   VITE_AUTH_CALLBACK_PROVIDERS=apple google
   ```

   These `VITE_*` values are baked into the PWA bundle at build time. Applying
   them to the deployed tester surface means rebuilding and redeploying the
   `vhc-public-beta-origin` image per `docs/ops/public-beta-image-deploy.md`,
   which touches A6 and needs its own operator packet (or inclusion in the
   Lane 2 current-main packet). The auth-callback service itself still stays
   outside A6.

9. Extend the content-security policy to reach the boundary. The PWA's
   `connect-src` is restricted to self, the relay origins, and localhost, so
   browser fetches to the auth boundary are CSP-blocked unless
   `https://auth.venn.carboncaste.io` is added to `VITE_VH_CSP_CONNECT_SRC` at
   PWA/origin image build time and to `VH_PUBLIC_ORIGIN_CSP_CONNECT_SRC` on the
   deployed origin. Verify the deployed page's effective `connect-src` includes
   the boundary before starting Lane 5 rehearsal.

### Exit criteria

- Deployed boundary responds from the intended host.
- Health endpoint is secret-safe.
- PWA can reach the boundary from the intended origin.
- A rollback path exists that disables sign-in without touching A6.

## Lane 5 - Provider Registration And Live Sign-In Rehearsal

### Goal

Complete live provider setup and prove account-to-LUMA binding with real
provider redirects.

### Provider order

1. Apple first, because Services ID, domain/redirect verification, and `.p8`
   key handling are the longest lead.
2. Google second.
3. X is excluded from the first public beta; keep it out of tester copy and
   `VITE_AUTH_CALLBACK_PROVIDERS` until a later packet adds and rehearses it.

### Required provider configuration

Apple:

- Apple Developer Program team;
- App ID and Services ID;
- Sign in with Apple key id, team id, `.p8` private key;
- production and staging redirect URIs;
- `POST /auth/apple/return` configured for `form_post`;
- cancellation leg tested.

Google:

- Google Cloud project;
- OAuth consent screen;
- OAuth 2.0 web client;
- redirect URIs;
- client secret in host secret store.

X (deferred for first public beta):

- X developer app;
- OAuth 2.0 confidential client;
- scopes `users.read tweet.read` unless narrowed;
- redirect URIs;
- client secret in host secret store.

### Live rehearsal matrix

For each provider:

1. start sign-in from the PWA;
2. complete provider redirect;
3. verify PKCE `POST /auth/:provider/callback` succeeds;
4. verify browser receives only `vh-auth-session-v1`;
5. verify provider tokens are absent from browser storage and network payloads;
6. verify identity-vault `signInSession` compartment stores the session
   vault-locally;
7. bind to current beta-local LUMA principal;
8. reload and confirm account continuity;
9. reset identity and confirm re-bind semantics;
10. verify telemetry redaction emits no provider subject, label, token, or
    raw LUMA sensitive material.

### Exit criteria

- At least one provider can support tester sign-in before distribution.
- Apple and Google must pass the matrix before first public-beta sign-in claims.
  If X is later claimed in tester copy, X must pass the same matrix first.
- Any unavailable provider is removed from tester copy and from
  `VITE_AUTH_CALLBACK_PROVIDERS`, not merely left visible with a failing start
  action.

## Lane 6 - Fresh Release Evidence On The Release Commit

### Goal

Replace stale `1a83434b` evidence with a clean packet stamped at the intended
release commit.

### Preconditions

- Clean git tree except intentionally ignored/generated artifacts.
- Untracked operator docs are either left untouched and moved out of the
  evidence workspace if they trip
  `repo_dirty_before_release_evidence_regeneration`, or the pipeline is run in
  a clean clone.
- Source health passes.
- Accepted synthesis/public-feed gates are expected to pass — Lane 3 left no
  red gates behind.
- Auth deployment and provider rehearsal evidence are recorded.

### Command sequence

1. Verify repo state:

   ```bash
   git fetch origin --prune
   git switch main
   git pull --ff-only
   git status --short
   git rev-parse HEAD
   ```

2. Refresh LUMA gated-write coverage in hermetic local-e2e mode:

   ```bash
   corepack pnpm@9.7.1 test:mesh:luma-gated-write-coverage -- --mode local-e2e
   ```

3. Run LUMA MVP readiness:

   ```bash
   corepack pnpm@9.7.1 check:luma:mvp-production-readiness
   ```

4. Export the coverage report path for the whole remaining sequence, then run
   mesh readiness. An inline (single-command) env assignment is not enough: the
   step 5 pipeline re-runs `check:mesh:production-readiness` in its own
   environment, and without the exported variable that re-run overwrites
   `.tmp/mesh-production-readiness/latest` with a blocked no-coverage packet.

   ```bash
   export VH_MESH_LUMA_GATED_WRITE_COVERAGE_REPORT=.tmp/mesh-luma-gated-write-coverage/latest/mesh-luma-gated-write-coverage-report.json
   corepack pnpm@9.7.1 check:mesh:production-readiness
   ```

5. Regenerate the release evidence pipeline at the release commit. Do not
   insert a bare `--` before `--commit`: the pipeline's argument parser
   rejects the literal `--` token with `unknown argument: --` and exits 64.

   ```bash
   RELEASE_COMMIT="$(git rev-parse HEAD)"
   corepack pnpm@9.7.1 report:mvp-release-evidence --commit "$RELEASE_COMMIT"
   corepack pnpm@9.7.1 check:mvp-closeout
   ```

6. Run supporting release checks:

   ```bash
   corepack pnpm@9.7.1 check:mvp-release-gates
   corepack pnpm@9.7.1 check:public-beta-launch-closeout
   corepack pnpm@9.7.1 check:public-beta-launch-control
   corepack pnpm@9.7.1 check:public-beta-distribution-packet
   corepack pnpm@9.7.1 check:release-readiness-operator-packets
   corepack pnpm@9.7.1 check:beta-session-runsheet
   corepack pnpm@9.7.1 check:launch-content-snapshot
   corepack pnpm@9.7.1 check:public-beta-compliance
   corepack pnpm@9.7.1 docs:check
   corepack pnpm@9.7.1 lint
   corepack pnpm@9.7.1 typecheck
   corepack pnpm@9.7.1 build
   git diff --check
   ```

7. Decide the multi-user product-loop claim. The closeout evidence classifies
   `full_product_engagement_claim_without_live_lane` as a ship blocker: do not
   claim the full multi-user product loop was exercised against release-like
   service wiring unless the live lane passes on the release candidate:

   ```bash
   corepack pnpm@9.7.1 live:stack:up:analysis-stub
   corepack pnpm@9.7.1 test:live:five-user-engagement
   ```

   Either run this lane at the release commit, or exclude the claim from the
   distribution packet and tester copy.

### Expected interpretation

- `luma_mvp` must pass.
- `source_health` must pass.
- `mvp_release_gates` must pass — every gate; the check has no envelope or
  exclusion mechanism.
- `mvp_closeout` must pass. The only accepted boundary outcomes
  (mesh-not-release-ready and canary-blocked-on-mesh) occur inside a passing
  closeout and produce no blocker entries; any entry that does appear in the
  pipeline report's `blockers` is release-stopping by construction.
- Any packet stamped at an older commit is not release evidence for current
  `main`.

### Exit criteria

- `.tmp/release-evidence-pipeline/latest/release-evidence-pipeline-report.json`
  has `status: pass` and `release_commit_verified: true` at the release
  commit. A passing run already accommodates the accepted mesh/canary
  boundary outcomes.
- Blockers are zero. There is no category of acceptable remaining blocker.

## Lane 7 - Manual 3-Browser Tester Rehearsal And Privacy Proof

### Goal

Prove the tester workflow as humans will experience it, not only through
deterministic reports.

### Preconditions

- Deployed Web PWA target selected; the current deployed target is
  `https://venn.carboncaste.io` served by the `vhc-public-beta-origin` image
  on A6, and it must carry the release-commit assets before rehearsal.
- Auth callback target deployed and configured.
- Live accepted-current story available if the release envelope claims it.
- Source health and release gates green.
- Session operator assigned.

### Rehearsal

Use `docs/ops/BETA_SESSION_RUNSHEET.md` as canonical procedure. The runsheet
predates the account/sign-in surface (#729/#734), so a small repo PR must
first extend it with the provider sign-in, account-to-LUMA binding, and
provider-availability steps below — keeping it the single canonical
procedure rather than forking it here. Required workflow:

1. open three browser profiles to the same deployed PWA target;
2. create distinct beta-local LUMA identities;
3. sign in with configured providers where available;
4. open the same accepted-current story;
5. verify accepted summary and framing table render;
6. verify vote controls exist only for stable point ids;
7. cast, change, and observe votes across browsers;
8. reload all browsers and prove persistence;
9. inspect public aggregate paths and telemetry for privacy leaks;
10. record convergence, ack-timeout, and any UI failure.

### Privacy spot-check must reject

- `nullifier`;
- `district_hash` plus nullifier pair;
- `merkle_root`;
- raw `constituency_proof`;
- address or region raw proof;
- wallet;
- provider token;
- provider subject on public mesh paths;
- provider display label joined with LUMA public ids;
- raw OAuth errors or secret-bearing request material.

### Exit criteria

- All run-sheet steps pass.
- Cross-client convergence is proven on a browser that did not cast the vote.
- Privacy spot-check finds no leak.
- Evidence entry records date, target URL, release commit, providers tested,
  browsers, identities, pass/fail, and known limitations.

## Lane 8 - Distribution Packet, Rollback, And First Tester Wave

### Goal

Distribute to testers only after the release packet and rehearsal prove the
claim.

### Distribution packet contents

- release commit;
- Web PWA target URL;
- auth-callback target URL;
- A6 commit and live readback;
- release evidence artifact paths and statuses;
- providers enabled;
- accepted synthesis status;
- source-health status;
- tester envelope (`dev-small`, `beta-scale`, or `public-beta-ramp`);
- forbidden claims;
- support path and privacy instructions;
- rollback commands;
- incident owner and alert channel;
- known limitations.

### Tester communication

Tester copy must say:

- this is a controlled public-beta Web PWA test;
- identity is beta-local and browser/device scoped;
- social sign-in supports account continuity and recovery only;
- do not use incognito or clear browser storage during the session;
- do not post private personal data or legal/copyright details into public
  GitHub support issues;
- report failures with story/topic ids, screenshots, and browser context.

Tester copy must not say (the first block is the full
`check:luma-forbidden-claims` registry from `spec-luma-service-v0.md` §20,
which binds UI copy, marketing, and docs):

- verified human;
- one-human-one-vote;
- Sybil-resistant;
- district-proof;
- cryptographic residency (or "residency verified");
- anonymous / fully anonymous;
- untraceable / untraceable across devices;
- permanently delete(d) (from the network);
- "Reset Identity deletes your activity";
- "Sign Out removes your data from the network";

and additionally:

- test-group ready (the closeout packet's own forbidden-claims list includes
  "The app is test-group ready." — distribution authority comes from the
  packet combined with the Lane 7 rehearsal and Lane 5 provider evidence,
  never from that claim);
- production attestation;
- full production-ready app;
- mesh release-ready;
- native/TestFlight ready;
- pager-backed 24/7 operations;
- automated production execution.

### First wave limits

- Start the first public-beta tranche at 100 testers maximum.
- Keep Codex automation watching failure email through the Gmail connector, and
  keep Lou reachable as the human incident/rollback authority.
- Pause intake on freshness alert, ack-timeout degradation, convergence p95
  above 10 seconds for 15 minutes, analysis 429 rate above 3% for 10 minutes
  or 5% for 5 minutes, or support privacy leak.
- Expand to 500, then 1000, then open intake only after green release evidence,
  no sustained 429 or ack-timeout degradation, no alert-loop failures, passing
  support/incident handling for the prior tranche, and explicit Lou approval.

### Rollback

Rollback must be possible without A6 mutation unless A6 was the changed surface:

- disable provider buttons by removing `VITE_AUTH_CALLBACK_BASE_URL` and
  redeploying the PWA — note this is an origin-image redeploy on A6 per
  `docs/ops/public-beta-image-deploy.md`, so faster non-A6 mitigations
  (disabling the auth-callback service or its provider configuration at the
  edge host) come first;
- disable or roll back auth-callback service at the edge host;
- if accepted synthesis canary causes failures, execute the canary packet's
  explicit rollback;
- keep raw feed and email alerting active unless the incident packet says
  otherwise;
- preserve evidence before rollback.

### Exit criteria

- The distribution packet is complete with every listed field filled in.
- The first public-beta tranche is invited with claim-safe copy only.
- Codex automation is actively watching failure email and session telemetry, and
  Lou is reachable for incident/rollback authority.
- The rollback path has been read through by the incident owner and is
  executable without improvisation.
- Every pause-intake trigger has a named owner who can act on it.

## Go / No-Go Matrix

| Area | Go condition | No-go condition |
| --- | --- | --- |
| Repo state | `main` clean, release commit known, no blocking PRs | dirty tree (beyond the documented preserved untracked operator docs handled per Lane 6), unmerged release PR, unknown commit |
| Source health | release evidence `pass`, full clean window on release commit | any source keeps the window blocked, or the clean window has not accrued |
| Headline soak | fresh promotable trend evidence from the real StoryCluster path | `headline_soak_release_evidence_failed`, missing audit attachments, or invalid live credentials |
| A6 raw feed | freshness, relay liveness, relay snapshot, watch closure pass | stale feed, parked publisher, relay quorum loss |
| Accepted synthesis | accepted-current story proven live if claimed | no live accepted synthesis but copy claims summaries/table |
| Auth callback | deployed outside A6, health secret-safe | no deployed callback while copy advertises social sign-in |
| Providers | each advertised provider passes live rehearsal | provider unavailable but visible as active |
| LUMA | current release commit passes MVP readiness | stale pass only, current run blocked |
| Vote persistence | 3-browser convergence and reload pass | local echo only, ack timeouts, reload loss |
| Privacy | no sensitive fields in public paths/telemetry | any raw proof/provider/nullifier leak |
| Evidence packet | `status: pass` with `release_commit_verified: true` at release commit | stale packet reused, blocked/failed pipeline, or unverified commit |
| External approval | signoff recorded, or not-required decision recorded | approval required but unrecorded |
| Ops | email alert path active, incident owner assigned | silent failure mode or owner missing |

## Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Source-health window regresses on the release commit | Release gates stay blocked | Keep the pruned source surface clean and rerun the configured clean window |
| Accepted synthesis increases A6 load | Fresh raw feed regresses | Bounded canary, low scope, alert watch active, rollback packet |
| Auth provider setup lags | Sign-in claim delayed | Start Apple first; hide unavailable providers; allow narrowed beta only if copy is honest |
| Provider secret leakage | Severe security/privacy incident | Host secret store only; secret scans; health booleans only; no logs/evidence values |
| Stale evidence reused | False release readiness | Require packet stamped at release commit |
| Browser local echo mistaken for mesh convergence | Vote loop appears healthier than it is | Run-sheet requires observation on non-voting browsers |
| District/proof material leaks | Privacy violation | Public namespace leak gates plus manual devtools spot-check |
| A6 touch resets unattended window | Reliability proof ambiguity | Record every touch; do not conflate raw-feed proof with accepted-synthesis canary |
| Heap retainer remains unknown | Sustained-operation risk | Keep alerting on; wait for the post-recovery 500 MB -> 700 MB heap-summary pair and its secret-safe analyzer verdict before memory remediation |

## Sprint Definition Of Done

The release-readiness sprint is complete when all of these are true:

1. source-health release evidence passes with a clean configured window;
2. A6 live state is read back at the intended release commit or the release
   envelope explicitly avoids A6-newer claims;
3. accepted-current synthesis is proven live if the release claims summaries and
   framing-table voting;
4. auth-callback is deployed outside A6;
5. every advertised provider passes live sign-in and account-to-LUMA binding;
6. release evidence is regenerated at the release commit;
7. `check:mvp-release-gates`, `check:mvp-closeout`,
   `check:public-beta-launch-closeout`, `check:public-beta-launch-control`,
   `check:public-beta-distribution-packet`,
   `check:release-readiness-operator-packets`,
   `check:beta-session-runsheet`,
   `check:launch-content-snapshot`, `check:public-beta-compliance`,
   `docs:check`, typecheck, lint, build, and
   `git diff --check` all pass — the accepted mesh/canary boundary outcomes
   already occur inside a passing closeout, and no red check is excusable by
   envelope narrowing;
8. the manual 3-browser rehearsal passes;
9. tester copy and support instructions are claim-safe;
10. rollback and incident owners are named;
11. first public-beta tranche is capped at 100 testers and cannot expand without
    green evidence plus Lou approval.

## Immediate Next Actions

1. Keep the Lane 0 launch-control packet current:
   `docs/ops/public-beta-launch-control-2026-07-09.md`. The packet now records
   the envelope, target URLs, claim boundaries, rollback/stop rules, and the
   current `no_go_pending_operator_decisions_and_live_evidence` decision; it
   now records Lou as the sole human authority, Codex as technical executor,
   `https://auth.venn.carboncaste.io` as the auth boundary, Apple/Google as the
   first provider set, X as hidden, `carboncasteit@gmail.com` as support/failure
   mailbox, and `not_required_for_public_beta` as the external-approval
   disposition. It remains no-go until release commit and live evidence are
   recorded. The first A6 read-only readback (2026-07-08, `347d2018`, services
   green, freshness pass) is already recorded above.
2. Use Codex App automation with the Gmail connector for the failure mailbox at
   `carboncasteit@gmail.com`; the query should prefer high-signal alert terms,
   include unread/recent failure mail, and avoid requiring a brittle single
   subject line.
3. Rerun source-health on the intended release commit. The `ap-topnews`
   source-surface fix is already merged, and the latest local source-health
   packet is `ready`/`pass`; the consolidated release evidence packet still
   needs the current-commit run.
4. Repair the live headline-soak credential/endpoint and rerun
   `corepack pnpm@9.7.1 collect:storycluster:headline-soak` plus
   `corepack pnpm@9.7.1 check:storycluster:production-readiness` until the
   blocker is real product evidence rather than a local secret/config failure.
   Use the secret-safe operator packet in
   `docs/ops/storycluster-headline-soak-credential-repair-2026-07-09.md`;
   it distinguishes the local release-evidence runner from A6 service env and
   does not authorize a publisher restart.
   When the gate is red, read
   `.tmp/storycluster-production-readiness/latest/production-readiness-report.json`
   and use `headlineSoakTrend.latestFailureDiagnosis` as the first diagnostic;
   it is designed to expose a stable failure class and action without copying
   credential-bearing runtime logs.
5. Draft the A6 accepted-synthesis canary packet, but do not run it until
   source health and pre-canary readbacks are green and the standing
   attended-soak preconditions are met. The draft packet is
   `docs/ops/a6-accepted-synthesis-canary-packet-2026-07-09.md`; it uses a
   one-shot `catchup:public-synthesis` canary and does not authorize a live
   Scope B publisher flip.
6. Stand up the auth-callback edge host at
   `https://auth.venn.carboncaste.io`, start Apple provider registration,
   and plan the origin-image rebuild that bakes the auth, provider allowlist,
   and CSP env into the deployed PWA. Use
   `docs/ops/auth-callback-provider-deployment-packet-2026-07-09.md`; it
   records the Apple/Google redirect URI split and the deferred X boundary, the
   `VITE_AUTH_CALLBACK_PROVIDERS` build-time allowlist, start-leg smoke, secret
   scan, and rollback sequence.
7. Keep the sign-in/account-binding rehearsal in
   `docs/ops/BETA_SESSION_RUNSHEET.md` current with the deployed
   auth-callback/provider surface; the runsheet now defines provider health,
   same-browser sign-out/sign-in preservation, Reset Identity re-bind, and
   cross-browser distinct-principal checks.
8. Regenerate release evidence only after the live blockers are cleared.
9. Run the 3-browser rehearsal against the deployed target.
10. Ship the first public-beta tranche, capped at 100 testers, with claim-safe
    copy.
