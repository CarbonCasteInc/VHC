# Release Readiness Sprint Outline - 2026-07-08

> Status: Execution outline for fastest credible tester distribution
> Owner: VHC Core Engineering + VHC Launch Ops
> Current repo basis: `main@ec252804` after #746
> Latest release evidence basis: stale packet at `1a83434b`
> Live A6 proof basis: raw Scope A proof at `47ba218d`
> Target surface: Venn News Web PWA initial controlled tester release
> Depends On: `docs/foundational/STATUS.md`,
> `docs/reports/state-of-play-docs-alignment-audit-2026-07-08.md`,
> `docs/reports/functioning-mvp-lane-repo-closeout-2026-07-07.md`,
> `docs/plans/FUNCTIONING_MVP_LANE_SLICE_PLAN_2026-07-06.md`,
> `docs/ops/NEWS_SOURCE_ADMISSION_RUNBOOK.md`,
> `docs/ops/news-aggregator-production-service.md`,
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

1. live source-health evidence;
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
2. register or sign in through the account shell using Apple, Google, or X when
   the provider is configured;
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

Repository and GitHub state at sprint start:

- current repo: `main@ec252804`;
- open PRs: none;
- open issues: #178, #277, #279 only, all older unrelated backlog;
- local untracked operator readiness docs remain preserved and out of scope:
  `docs/plans/DISTRIBUTION_READINESS_GOAL_2026-07-05.md` and
  `docs/plans/DISTRIBUTION_READINESS_SLICES_2026-07-05.md`.

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
- docs alignment after the hardening sequence.

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
  has release evidence `fail` with `blocked_run_within_release_window`,
  `non_ready_runs_exceed_threshold`, and `latest_run_not_ready`.

Live A6 state must not be inferred from repo `main`:

- latest recorded A6 live proof is raw Scope A at `main@47ba218d`;
- email alerting and watch-closure timers are enabled;
- the recovered raw feed should remain untouched while fresh;
- accepted synthesis is repo-capable but not yet operator-enabled and proven on
  A6;
- no current evidence proves newer repo commits are deployed on A6.

## Sprint Operating Rules

1. Work from freshly pulled `main`.
2. Every repo change gets a branch, tests, docs if needed, push, and PR.
3. Operator-only live actions get a packet or runbook entry before execution.
4. Do not mutate A6 when a read-only gate can answer the question.
5. Do not restart publisher or relays while freshness, relay liveness, relay
   snapshot freshness, and watch-closure are green unless an explicit operator
   maintenance packet says so.
6. Treat a new alert email as an incident.
7. Keep `services/auth-callback` outside A6.
8. Keep provider secrets out of repo, browser bundle, logs, issues, PRs, and
   evidence packets.
9. Keep Codex executor/autonomy dry-run only.
10. Keep email alert fallback on even after any later pager deployment.

## Sprint Structure

The sprint has eight incremental lanes. Lanes 1-3 unblock live product
availability. Lanes 4-5 make account continuity real. Lanes 6-8 convert the
system from "repo implemented" to "tester distributable".

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
     is not yet deployed.
2. Tester audience:
   - `dev-small`: 1-3 testers;
   - `beta-scale`: up to 10 testers only after two consecutive daily gates and
     3-browser passes.
3. Owners:
   - source-health/content policy owner;
   - A6 operator;
   - auth boundary deploy owner;
   - Apple/Google/X registration owners;
   - release evidence owner;
   - session operator for tester wave.

### Exit criteria

- A one-page launch note records the release envelope, forbidden claims,
  operator owners, deployed target URLs, and rollback contacts.
- If the release envelope is narrowed, every excluded claim is removed from
  tester-facing copy before distribution.

## Lane 1 - Source-Health Recovery

### Goal

Clear the source-health release blocker without weakening the source admission
contract.

### Current blocker

`ap-topnews` is escalated to removal in the latest source-health packet. The
release evidence window has no ready runs. This is a content/operator decision,
not a generic StoryCluster correctness failure.

### Implementation steps

1. Inspect current source-health evidence:

   ```bash
   corepack pnpm@9.7.1 report:news-sources:health
   node -e "console.log(require('./services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json').releaseEvidence)"
   ```

2. Confirm the current `ap-topnews` verdict and reasons in the latest artifact:
   `feed_links_unavailable`, `feed_non_xml_payload`, and/or
   `watchlist_escalated_by_history`.

3. Make the source-surface decision:
   - remove `ap-topnews` from the starter/keep surface if the artifact still
     marks it remove;
   - or remediate only if a real source feed URL is available and passes the
     runbook criteria.

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

6. Let the configured release window accumulate clean runs. Do not bypass
   `insufficient_release_evidence_window`,
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

Before mutating anything, Launch Ops reads:

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
whether the host is still at `47ba218d` or has already moved.

### Current-main update

If the tester release depends on post-`47ba218d` repo code, the operator packet
must explicitly update A6 to the intended release commit. The packet must state:

- whether publisher restart is included or explicitly excluded;
- how freshness is observed before and after;
- how alert delivery is preserved;
- rollback target and command;
- what evidence artifact records success.

### Accepted-synthesis canary

If the release envelope claims accepted summaries/framing tables on live public
stories, enable accepted synthesis only through a dedicated canary packet. The
packet must:

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
- If accepted synthesis is in the release envelope, at least one live public
  accepted-current story is proven end to end.
- If accepted synthesis is not enabled, the release envelope and tester copy do
  not claim it.
- No unbounded publisher/relay restart occurred outside the packet.

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

5. Rerun until the gate failures are either green or explicitly excluded by a
   narrowed release envelope.

### Exit criteria

- `check:mvp-release-gates` passes for the intended release envelope; or
- the release packet records a narrower claim and explains why excluded gates
  are not part of tester distribution.

## Lane 4 - Auth-Callback Deployment Outside A6

### Goal

Make Apple/Google/X account continuity real on a deployed, secret-bearing
service outside A6.

### Repo capability

`services/auth-callback` owns the server side of OAuth/OIDC with PKCE. Browser
clients receive only non-secret session payloads. Provider secrets stay in the
boundary host's private secret store.

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
   ```

2. Provision the edge host and secret store.

3. Configure CORS/origin allowlist for the tester PWA origins only.

4. Deploy the boundary service.

5. Verify `/api/health` returns configuration booleans only.

6. Verify no provider secret appears in:
   - repository files;
   - build output;
   - browser bundle;
   - service logs;
   - error responses;
   - release artifacts.

7. Configure the Web PWA public env:

   ```bash
   VITE_AUTH_CALLBACK_BASE_URL=https://<auth-boundary>
   VITE_AUTH_CALLBACK_ROUTE=/auth/callback
   ```

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
3. X third.

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

X:

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
- If Apple/Google/X are all claimed in tester copy, all three pass the matrix.
- Any unavailable provider is hidden or labeled unavailable, not advertised.

## Lane 6 - Fresh Release Evidence On The Release Commit

### Goal

Replace stale `1a83434b` evidence with a clean packet stamped at the intended
release commit.

### Preconditions

- Clean git tree except intentionally ignored/generated artifacts.
- Untracked operator docs are either left untouched and moved out of the evidence
  workspace if they trip `repo_dirty`, or the pipeline is run in a clean clone.
- Source health passes.
- Accepted synthesis/public-feed gates are expected to pass for the release
  envelope.
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

4. When running mesh readiness, pass the coverage report explicitly:

   ```bash
   VH_MESH_LUMA_GATED_WRITE_COVERAGE_REPORT=.tmp/mesh-luma-gated-write-coverage/latest/mesh-luma-gated-write-coverage-report.json \
     corepack pnpm@9.7.1 check:mesh:production-readiness
   ```

5. Regenerate the release evidence pipeline at the release commit:

   ```bash
   RELEASE_COMMIT="$(git rev-parse HEAD)"
   corepack pnpm@9.7.1 report:mvp-release-evidence -- --commit "$RELEASE_COMMIT"
   corepack pnpm@9.7.1 check:mvp-closeout
   ```

6. Run supporting release checks:

   ```bash
   corepack pnpm@9.7.1 check:mvp-release-gates
   corepack pnpm@9.7.1 check:public-beta-launch-closeout
   corepack pnpm@9.7.1 check:launch-content-snapshot
   corepack pnpm@9.7.1 check:public-beta-compliance
   corepack pnpm@9.7.1 docs:check
   corepack pnpm@9.7.1 lint
   corepack pnpm@9.7.1 typecheck
   corepack pnpm@9.7.1 build
   git diff --check
   ```

### Expected interpretation

- `luma_mvp` must pass.
- `source_health` must pass.
- `mvp_release_gates` must pass for the intended release envelope.
- `mvp_closeout` must pass or record only expected boundary blocks that are not
  claimed, such as mesh/canary readiness outside the release envelope.
- Any packet stamped at an older commit is not release evidence for current
  `main`.

### Exit criteria

- `.tmp/release-evidence-pipeline/latest/release-evidence-pipeline-report.json`
  is generated at the release commit.
- Closeout status is compatible with the release claim.
- Blockers are zero, or any remaining block is outside the explicit release
  envelope and forbidden from tester-facing copy.

## Lane 7 - Manual 3-Browser Tester Rehearsal And Privacy Proof

### Goal

Prove the tester workflow as humans will experience it, not only through
deterministic reports.

### Preconditions

- Deployed Web PWA target selected.
- Auth callback target deployed and configured.
- Live accepted-current story available if the release envelope claims it.
- Source health and release gates green.
- Session operator assigned.

### Rehearsal

Use `docs/ops/BETA_SESSION_RUNSHEET.md` as canonical procedure. Required
workflow:

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
- tester envelope (`dev-small` or `beta-scale`);
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

Tester copy must not say:

- verified human;
- one-human-one-vote;
- residency verified;
- production attestation;
- full production-ready app;
- mesh release-ready;
- native/TestFlight ready;
- pager-backed 24/7 operations;
- automated production execution.

### First wave limits

- Start with `dev-small`: 1-3 testers.
- Keep one operator watching email alerts and session telemetry.
- Pause intake on freshness alert, ack-timeout degradation, convergence p95
  above 10 seconds for 15 minutes, analysis 429 above threshold, or support
  privacy leak.
- Move to `beta-scale` only after two consecutive daily gates and two passing
  manual 3-browser checks.

### Rollback

Rollback must be possible without A6 mutation unless A6 was the changed surface:

- disable provider button by removing `VITE_AUTH_CALLBACK_BASE_URL` and
  redeploying PWA;
- disable or roll back auth-callback service at the edge host;
- if accepted synthesis canary causes failures, execute the canary packet's
  explicit rollback;
- keep raw feed and email alerting active unless the incident packet says
  otherwise;
- preserve evidence before rollback.

## Go / No-Go Matrix

| Area | Go condition | No-go condition |
| --- | --- | --- |
| Repo state | `main` clean, release commit known, no blocking PRs | dirty tree, unmerged release PR, unknown commit |
| Source health | release evidence `pass`, full clean window | `ap-topnews` or any source keeps window blocked |
| A6 raw feed | freshness, relay liveness, relay snapshot, watch closure pass | stale feed, parked publisher, relay quorum loss |
| Accepted synthesis | accepted-current story proven live if claimed | no live accepted synthesis but copy claims summaries/table |
| Auth callback | deployed outside A6, health secret-safe | no deployed callback while copy advertises social sign-in |
| Providers | each advertised provider passes live rehearsal | provider unavailable but visible as active |
| LUMA | current release commit passes MVP readiness | stale pass only, current run blocked |
| Vote persistence | 3-browser convergence and reload pass | local echo only, ack timeouts, reload loss |
| Privacy | no sensitive fields in public paths/telemetry | any raw proof/provider/nullifier leak |
| Evidence packet | regenerated at release commit | stale packet reused |
| Ops | email alert path active, incident owner assigned | silent failure mode or owner missing |

## Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| `ap-topnews` remains dead | Release gates stay blocked | Remove/remediate per source runbook; wait for clean window |
| Accepted synthesis increases A6 load | Fresh raw feed regresses | Bounded canary, low scope, alert watch active, rollback packet |
| Auth provider setup lags | Sign-in claim delayed | Start Apple first; hide unavailable providers; allow narrowed beta only if copy is honest |
| Provider secret leakage | Severe security/privacy incident | Host secret store only; secret scans; health booleans only; no logs/evidence values |
| Stale evidence reused | False release readiness | Require packet stamped at release commit |
| Browser local echo mistaken for mesh convergence | Vote loop appears healthier than it is | Run-sheet requires observation on non-voting browsers |
| District/proof material leaks | Privacy violation | Public namespace leak gates plus manual devtools spot-check |
| A6 touch resets unattended window | Reliability proof ambiguity | Record every touch; do not conflate raw-feed proof with accepted-synthesis canary |
| Heap retainer remains unknown | Sustained-operation risk | Keep alerting on; wait for 500 MB -> 700 MB analyzer before memory remediation |

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
   `check:public-beta-launch-closeout`, `check:launch-content-snapshot`,
   `check:public-beta-compliance`, `docs:check`, typecheck, lint, build, and
   `git diff --check` pass or have explicit non-claimed boundary blocks;
8. the manual 3-browser rehearsal passes;
9. tester copy and support instructions are claim-safe;
10. rollback and incident owners are named;
11. first wave starts at `dev-small`, not `beta-scale`.

## Immediate Next Actions

1. Assign owners for Lane 1 source-health and Lane 4/5 auth provider setup.
2. Resolve `ap-topnews` and recover the source-health window.
3. Draft the A6 accepted-synthesis canary packet, but do not run it until source
   health and pre-canary readbacks are green.
4. Stand up the auth-callback edge host and start Apple provider registration.
5. Regenerate release evidence only after the live blockers are cleared.
6. Run the 3-browser rehearsal against the deployed target.
7. Ship `dev-small` tester invites with claim-safe copy.
