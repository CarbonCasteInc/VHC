# Public Beta State Of Play Handoff - 2026-07-10

> Status: Onboarding handoff for the next release-readiness developer
> Owner: VHC Launch Ops + VHC Core Engineering
> Human authority: Lou
> Technical executor: Codex
> Shared-integration parent base: `main@297d1bb4bd7654e713953930d61f55ca930df50e`
> Merged recovery chain: #759, #763, #764, #765, #766, and #767
> Integration transition: this reviewed PR's merge commit becomes `FINAL_REV`
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

The active work now is not broad product construction. It is the current
public-feed incident remediation first, then release enablement: StoryCluster
credential repair, auth/provider deployment, A6 release update,
accepted-synthesis canary, release evidence regeneration, manual three-browser
rehearsal, and then a first public-beta tranche.

The immediate blocker is S1A/S1B: the failure-mailbox monitor is working, and
S1A readback classified a real public-feed incident. Monitor `status: pass`
means the monitor ran and classified mail; it does not mean the release is
green. At shared-integration preparation, the dated orchestration snapshot then
copied from `.tmp/vhc-failure-mailbox-monitor/latest.json` reported:

- generated at `2026-07-10T15:02:20.895Z`;
- `status: pass`;
- `newCriticalCount: 2`;
- `newWarningCount: 1`;
- both criticals remain in the `public_feed_alert_fail` incident family;
- recommended next action: treat as incident, preserve email, run read-only
  repo/A6 readback before mutation, Lou retains incident/rollback authority.

That path is a moving alias. Re-read it before every gate and record the new
timestamp and classifications in the private orchestration ledger. The dated
counts above are incident history, not current clearance; any newer critical
keeps the gate closed.

The last read-only A6 refresh at `2026-07-10T15:48:16Z` observed checkout
`347d20187d164699a35dbd8d76c299570011b1a1`, all three old-image relays
running with `/readyz` 200 and no new restart/OOM/watchdog trip, and the
publisher still `failed/failed` at exit `78`. This is a dated snapshot, not
authority to infer unchanged live state later.

S1A readback completed at `2026-07-10T01:17:07Z` and classified the incident as
`relay_rest_story_timeout_total_0_of_3_exit_78`: the publisher is parked at
`ExecMainStatus=78` after one raw `/vh/news/story` relay fanout received `0/3`
validated relay acknowledgements where `2/3` are required. Loopback/public
relay readiness was not enough to prove a persistent relay-container failure;
the current design still fails closed and the publisher remains parked.

Repo-only S1B remediation may proceed while the incident is active. Do not
start StoryCluster credential repair, auth deployment, provider registration,
origin redeploy, A6 update outside the approved incident packet,
accepted-synthesis canary, release-evidence regeneration, manual rehearsal,
distribution, or tranche expansion until S1A/S1B are green through the required
T0+48h closure evidence. Lou's incident decision authorizes only the scoped
recovery action; it cannot make S1 green or unblock S2.

## Current Recovery Integration And Final-Tuple Gate

The reviewed repo capability chain inherited by this integration is merged
through parent `main@297d1bb4bd7654e713953930d61f55ca930df50e`:

- #764 closed the exact packet's relay cardinality, semantic network, and full
  immutable image-ID binding findings;
- #765 closed runtime diagnostic classification at the actual publisher exit
  consumer;
- #766 added the exact-revision publisher installer, private one-use attended
  and exit-69 automatic-restart authority, park/preflight/start/verify/finalize
  controller, four-route signed readback, and fail-closed evidence binding;
- #767 made the live-start refusal classifier exact and case-sensitive at all
  producer sites.

`297d1bb4` is the shared-integration base, not the live recovery revision. The
integration PR must first make the complete recovery suite plus sprint,
launch-control, and launch-closeout guards unconditional hosted-CI gates. Its
reviewed merge commit becomes `FINAL_REV`; any later commit invalidates the
artifact tuple.

The tuple binds the publisher checkout, relay OCI revision, full immutable
relay image ID, manifest/tar hashes, packet SHA-256, capture SHA-256, reviewer
identity, relay order `A -> B -> C`, and reviewed loopback relay origins.
`FINAL_MAIN_REVISION_BINDS_RELAY_IMAGE_AND_PUBLISHER_CHECKOUT`.

After the exact image/capture/packet tuple is independently reviewed and Lou
confirms it, execute relay A, review its evidence, then B, then C. Keep the
publisher parked throughout and roll back only the current relay on failure.
Publisher recovery is a separate attended gate using this order:

```bash
FINAL_REV=<full-40-hex-reviewed-shared-integration-merge>
./tools/scripts/install-news-aggregator-production-service.sh --expected-revision "$FINAL_REV"
./tools/scripts/news-aggregator-publisher-recovery-control.sh park --expected-revision "$FINAL_REV" --approve-park
./tools/scripts/news-aggregator-publisher-recovery-control.sh preflight --expected-revision "$FINAL_REV" --output-file "$PREFLIGHT" --approve-preflight
./tools/scripts/news-aggregator-publisher-recovery-control.sh start --expected-revision "$FINAL_REV" --relay-recovery-evidence "$RELAY_EVIDENCE" --relay-recovery-expected-sha256 "$RELAY_EVIDENCE_SHA256" --preflight-artifact "$PREFLIGHT" --mailbox-artifact "$MAILBOX" --mailbox-expected-sha256 "$MAILBOX_SHA256" --mailbox-expected-critical-count "$MAILBOX_CRITICAL_COUNT" --start-control-output "$START_CONTROL" --approve-attended-start
./tools/scripts/news-aggregator-publisher-recovery-control.sh verify --expected-revision "$FINAL_REV" --start-control-artifact "$START_CONTROL" --current-run-file "$CURRENT_RUN" --runtime-diagnostics-file "$RUNTIME_DIAGNOSTICS" --output-file "$READBACK" --relay-origin "$RELAY_A_ORIGIN" --relay-origin "$RELAY_B_ORIGIN" --relay-origin "$RELAY_C_ORIGIN" --approve-verification-and-abort
node ./tools/scripts/update-phase5-scope-a-watch-t0.mjs --file "$WATCH_ENV" --new-t0 "$READBACK_GENERATED_AT" --expected-start "$OLD_WATCH_START" --expected-clean-start "$OLD_CLEAN_START"
./tools/scripts/news-aggregator-publisher-recovery-control.sh finalize --expected-revision "$FINAL_REV" --start-control-artifact "$START_CONTROL" --readback-artifact "$READBACK" --watch-env-file "$WATCH_ENV" --first-alert-file "$FIRST_ALERT" --second-alert-file "$SECOND_ALERT" --mailbox-artifact "$FINAL_MAILBOX" --finalization-output "$FINALIZATION" --approve-finalization-and-abort
```

`IMMEDIATE_RECOVERY_IS_NOT_S1_GREEN`.
`T0_PLUS_24H_IS_INTERMEDIATE_ONLY`.
`T0_PLUS_48H_REQUIRED_TO_UNBLOCK_S2`.

Current shared-integration local evidence on supported Node `20.20.2`: the
serialized recovery control-plane gate passes 225/225 after a deliberate
fresh-build failure exposed and corrected incomplete dependency closure; sprint
12/12, launch-control 11/11, distribution 7/7, launch closeout, docs governance
159/159, workflow YAML, and whitespace all pass. This is not independent review,
hosted CI, a merged final revision, or live recovery evidence.

## S1B Repo Execution Addendum - 2026-07-10

S1B has moved from design to reviewed repo implementation. Both isolated lanes
were based on #759 head `a2899ad2f32b0b09d55dfcd1f468e6eb0bc907ef`:

- Runtime PR #761 is frozen at
  `2a7b010929368180399b4575f69d6285f01382ef`, independently reviewed `GO`
  after mandatory correction/re-review, and 9/9 hosted CI checks pass. It
  implements concurrent bounded fanout, closed exact signed-record readback for
  story/latest/hot/lifecycle, generation-aware fresh-vertex settlement,
  unresolved-only retry, preserved `2/3` quorum, and exit `69` only for
  exhausted zero-confirmed availability-total.
- Alert PR #760 is frozen at
  `c3cff10927cf4bc8e6f00e5cd6829920dd857e6f`, independently reviewed `GO`,
  and 9/9 hosted CI checks pass. It implements the closed v2 public projection,
  v3 dedupe state, stable semantic fingerprints, readable secret-safe MIME,
  and canonical anonymous identities.
- The integration lane adds one shared pager-family normalizer used by both
  ingest and incident-contract code. Historical v1 underscore blockers and
  current v2 colon blockers for `public_feed`, `relay_liveness`,
  `relay_snapshot`, and `watch_closure` now resolve to the same incident keys.
- Combined local validation passes 187 gun-client tests, 23 focused daemon
  write/coverage tests, 24 daemon/exit tests, 54 AI-runtime tests, 60 relay
  integration tests, 56 alert tests, 6 publisher-liveness tests, 29 pager tests,
  61 incident-response tests plus its 28-file contract, both focused
  typechecks, pager build, docs governance, and `git diff --check`.

This is repo evidence only. The first distinct G2 cross-lane review at
`ddae488e` correctly returned `NO-GO`: a present conflicting exact relay row
could collapse to retry-eligible 404, and durable producer fixtures were
v1-only. Both corrections are now integrated at `cb03c44c`; the Runtime lane's
same reviewer returned final `GO` at `2a7b0109`, and the v1/v2 replay is green.
A subsequent G2 review at `231962bc` found that the v2 fixture was hand-shaped
rather than producer-authentic. It is now the exact deterministic producer
webhook payload with a producer-side deep-equality guard. The focused alert,
pager, incident-response, sprint, docs, and diff gates pass. The same G2
reviewer returned final `GO` with no P0/P1/P2 at `d6e03308`; PR #762 completed
hosted CI without failure (8 `SUCCESS`; Ownership Scope `SKIPPED`) and merged
into the coordination branch at `5116616a`. Final coordination head
`0e5bac8f` passed same-reviewer audit and 9/9 hosted CI; PR #759 merged to
`main` as `98277475`.

Recovery-packet design exposed the immutable-image restart boundary before any
live action. PR #763 supplied the repo-side boundary packet and merged to
`main@bb934010`; Lou explicitly approved #763 and instructed an attended A/B/C
restart on 2026-07-10. The first exact packet review correctly returned
`NO-GO`: its capture admitted duplicate/extra relay entries, its topology
comparison reduced network attachment state to names, and a mutable tag with a
matching revision could resolve to the wrong image. PR #764 corrected all three
findings and passed subsequent review before merge. PRs #765-#767 then closed
the publisher diagnostic, control-plane, and liveness seams. No A6 update,
service action, relay action, Gmail/provider mutation, alert-channel change, or
recovery was performed by these lanes. S1A/S1B remain red and every S2+ launch
slice remains blocked.

The exact-readback routes live in `infra/relay/server.js`, which the relay
Dockerfile copies into an immutable image; public-beta compose mounts only
`/data`. Updating the A6 checkout cannot activate those routes without rolling
relay replacement. Lou has now corrected that boundary, but independent `GO` on
the corrected exact packet/capture/image tuple remains mandatory.

Corrected repo-only tooling requires an inspect array containing exactly one
each of canonical relay A/B/C and binds the packet to the export manifest's full
immutable image id, not only a mutable tag/revision. It captures portable
semantic network state including name, `NetworkID`, static IPAM intent, aliases,
links, driver options, gateway priority, and configured MAC intent. Supported
state is recreated and compared at the removal boundary, immediately after
recreate, after verification, and after rollback; runtime-assigned endpoint ids
and addresses are not treated as stable. Unsupported/nonportable topology is a
hard stop. Recreate commands remain opt-in, the generic packet executor was not
widened, and relay deployment evidence still would not authorize publisher
recovery or make S1B green.

The current read-only A6 structure is the supported `host`/`host` case on all
three relays: one valid shared 64-hex `NetworkID`, all 15 canonical endpoint
keys, null IPAM/aliases/links/driver options, `GwPriority=0`, and no configured
MAC intent. Correct packet output uses exact `--network host` and captured
`GUN_PORT` loopback verifier URLs.

The fail-closed packet contract treats parked as exactly `failed/failed`,
`Result=exit-code`, `ExecMainStatus=78` and rechecks that tuple in the final
pre-mutation sequence before each A/B/C removal and after verification before
GO. At initial executable precheck and freshly before each mutation latch,
`systemctl --user list-jobs --no-legend --no-pager` must succeed with no output;
the packet withholds returned job rows and fails closed. Every removal boundary
also freshly verifies the current relay's captured three-snapshot SHA baseline
after topology/image checks. Only after that expensive boundary work passes does
the packet freshly recheck the parked publisher tuple, then run the final
empty-job check. It also compares every stage's live image/env/mount/network/port/restart/user/memory
topology with the capture, preserves and rejects pre-existing watchdog-trip
evidence before counters can reset, never prints hostile unexpected 404 bodies,
and normalizes each rollback failure class to a closed reason and exit `78`.
Deterministic adversarial tests cover A/B/C job appearance and snapshot drift,
transitional/resumed publisher state, every captured topology dimension,
duplicate/extra/malformed capture scope, same-revision wrong-image binding,
runtime endpoint churn, pre-existing trips, secret-bearing bodies, and rollback
remove/run/readiness/checksum failures. A and B emit next-relay GO only after
success; C reports rolling replacement complete with the publisher still
parked. These are repo safeguards, not live proof.

Pre-mutation refusals are isolated from rollback: topology,
readiness/watchdog, publisher, snapshot-baseline, or user-job failure exits `78`
without removing, running, or rolling back the untouched relay. Only the
mutation-started latch at the removal boundary can enter recovery. The packet creates and validates its
non-symlink, current-user-owned `0700` evidence directory before the first
write. Healthy relays may omit the watchdog-trip row because its source map is
initially empty; absence is semantic zero only when exactly one valid uptime and
process-RSS row authenticates the producer, while empty/random, malformed,
duplicate, or nonzero telemetry fails closed. The executable fixture covers these cases plus a
publisher resume during/post-verification.

## Current GitHub/Repo State

Current branch:

```text
coord/s1-recovery-shared-integration-2026-07-10
```

Current review state:

```text
G3 shared CI/docs integration branch
base: main@297d1bb4 (merged PR #767)
decision: NO-GO_PENDING_FINAL_REVISION_IMAGE_PACKET_AND_REVIEW
live action: not started
```

Parent `main` at the shared-integration branch point:

```text
297d1bb4bd7654e713953930d61f55ca930df50e Merge PR #767: exact publisher liveness classification
```

Merged S1B PRs:

- #760 Alert lane.
- #761 Runtime lane.
- #762 Cross-lane integration.
- #759 Coordination and `main` merge.
- #763 Approved relay-restart boundary and recovery-packet preparation.
- #764 Exact packet/capture/image binding correction.
- #765 Runtime diagnostic boundary.
- #766 Publisher recovery authority/control plane.
- #767 Exact publisher liveness classification.

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

## What #759 Added

#759 is now merged. It carries the release-control guard plus reviewed S1B code;
the merge did not deploy live code or mutate A6.

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
- S1B: durable relay-timeout and alert-dedupe remediation.
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
- the serial A/B/C relay boundary only after independent `GO` and Lou bind the
  exact final tuple; and
- any later live action only after its own recorded preconditions and Lou's
  exact attended authorization are present.

Not authorized:

- unspecified or autonomous live execution;
- relay A before the final revision/image/capture/packet tuple receives
  independent `GO` and Lou confirms that exact tuple;
- publisher recovery before C, independent relay-evidence acceptance, and a
  separate later Lou confirmation for the exact revision;
- A6 release update, PWA origin redeploy, auth/provider configuration, canary,
  Gmail mutation, or other launch-enablement action before S1 T0+48h closure
  and its own explicit gate;
- pager cutover;
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
fresh public-feed critical. The S1A read-only readback has now classified the
publisher as parked at `ExecMainStatus=78`; the next developer must preserve
that evidence and work S1B before treating the feed as healthy or taking
launch-enablement actions.

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

1. S1A mailbox-critical incident is classified but unresolved.

   The preserved orchestration snapshot at `2026-07-10T15:02:20.895Z` had
   `newCriticalCount: 2` and `newWarningCount: 1`; both criticals remain in the
   `public_feed_alert_fail` family. Re-read the moving `latest.json` before
   every gate; no change in its incremental count clears S1 without the
   required evidence. S1A readback classified the incident as
   `relay_rest_story_timeout_total_0_of_3_exit_78`: publisher parked at
   `ExecMainStatus=78` after `0/3` raw story relay acknowledgements against a
   required `2/3` quorum. Only read-only evidence and the exact gated S1
   recovery path may proceed. Launch-enablement remains blocked until S1 has a
   passing T0+48h closure packet; human authority or immediate readback cannot
   waive that evidence gate.

2. S1B repo remediation is implemented but not live recovery-proven.

   Runtime, Alert, cross-lane integration, and recovery capability PRs #759 and
   #763-#767 are independently reviewed, hosted-CI green, and merged. This
   shared CI/docs integration branch must receive same-reviewer `GO` and hosted
   CI before merge. The merge commit containing this integration becomes
   `FINAL_REV`; do not create a separate post-merge docs commit. The exact immutable
   image, fresh capture, and inert packet must then be generated and reviewed
   as one tuple. Relay A remains blocked until Lou confirms that exact tuple;
   publisher recovery remains blocked behind C, independent relay-evidence
   acceptance, and a separate later Lou confirmation for the same revision.

3. StoryCluster headline-soak credential/endpoint is not release-ready.

   The latest production-readiness report diagnoses the headline-soak failure
   as `storycluster_openai_invalid_api_key`. Repair the credential or endpoint
   through the correct secret store; do not paste or print the credential.

4. Auth boundary is not deployed.

   `https://auth.venn.carboncaste.io` must be stood up outside A6, with durable
   nonce storage, secret-safe health, and allowed PWA origin
   `https://venn.carboncaste.io`.

5. Apple and Google providers are not rehearsed.

   Apple and Google app records must be configured after Lou logs in/MFA, and
   each provider must pass start-leg and full PWA rehearsal. X remains hidden.

6. PWA origin image is not rebuilt with auth env/CSP.

   The origin must know:
   `VITE_AUTH_CALLBACK_BASE_URL=https://auth.venn.carboncaste.io` and
   `VITE_AUTH_CALLBACK_PROVIDERS=apple google`, and CSP must allow the auth
   boundary.

7. A6 is not proven at the intended release commit.

   Use the existing A6 SSH path for the scoped reviewed S1 recovery only under
   its exact tuple authority. Any later release update waits for passing
   T0+48h S1 closure. Read back before every mutation.

8. Accepted synthesis is not live-proven on A6.

   The canary is required before tester copy can claim accepted summaries,
   framing tables, or stable-point voting.

9. Release evidence is stale/blocked.

   Regenerate the full release evidence pipeline at the intended release commit
   after live blockers clear.

10. Manual three-browser rehearsal has not passed.

   The release still needs Apple/Google account binding, beta-local LUMA
   binding, stance persistence, cross-client aggregate convergence, reload
   persistence, and privacy spot-check against the deployed target.

11. Distribution packet is still blocked.

   Do not invite testers until launch-control and distribution packets are
   filled with passing, secret-safe evidence and Lou says go.

## Immediate Next Sequence

Do this in order.

### 1. Finish shared integration and freeze the final revision

PRs #759 and #763-#767 are already merged. Do not replay their repo work. Treat
`main@297d1bb4bd7654e713953930d61f55ca930df50e` only as the shared-integration
base. Merge the reviewed integration/CI/docs gate first; its full merge commit
becomes `FINAL_REV`.

Before acting:

```bash
git fetch origin --prune
gh pr list --state open --json number,title,headRefName,headRefOid,statusCheckRollup,url
git rev-parse origin/main
git status --short --branch
```

### 2. Build and review the exact final artifact tuple

Do not mutate A6 from an unreviewed packet. Do not repair credentials yet.

Preserve the classified S1A finding:

```text
relay_rest_story_timeout_total_0_of_3_exit_78
```

Runtime, Alert, exact-packet correction, publisher control, liveness, and their
hosted CI are complete. Build the linux/amd64 relay image from `FINAL_REV`, take
a fresh private A6 capture, emit the inert packet, and obtain independent `GO`
on the exact revision/image/capture/packet tuple. Lou's recorded approval then
permits only the attended A/B/C rolling relay action; publisher recovery remains
a separate reviewed incident mutation. Do not proceed to S2 until the resulting
publisher recovery has a passing T0+48h closure artifact.

### 3. Only after S1A/S1B exit green, repair StoryCluster credential/endpoint

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

Only after S1A/S1B and upstream prerequisites clear.

Rules:

- read back before mutation;
- do not restart relays;
- if publisher activation is required, use a newly reviewed exact-revision
  controller sequence; never issue a direct service restart;
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
- latest mailbox monitor has no unresolved criticals and the S1 T0+48h closure
  artifact passes;
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
- restart relays except through Lou's approved, independently reviewed exact
  A/B/C packet;
- restart publisher unless the approved path requires it;
- deploy auth or configure providers before the active mailbox critical is
  closed by passing S1 T0+48h evidence;
- enable accepted synthesis outside the bounded canary packet;
- enable Codex live execution/autonomy;
- cut over the custom pager;
- paste secrets into chat/docs/PRs/issues/logs;
- claim verified-human, one-human-one-vote, LUMA Silver, Sybil resistance,
  residency proof, production app readiness, or private support SLA.

## Plain-English Current Status

The repo-side S1B remediation, exact packet correction, runtime diagnostic,
publisher control, and liveness classification inherited by this integration
are merged through #767 at parent `main@297d1bb4`. The product MVP is largely
built at repo level.

The live release is still blocked. The alert mailbox is doing its job and is
still reporting a public-feed critical. S1A readback has already proved this is
a real parked-publisher incident, not setup noise. The next dev's first real
job is not Cloudflare, Google, Apple, broad A6 update, or canary. It is to merge
and review the shared integration gate, freeze `FINAL_REV`, build and review the
exact artifact tuple, then execute only Lou's attended A/B/C relay action.
Publisher recovery remains separate.

Once S1A/S1B are green after T0+48h, the path is straightforward: repair StoryCluster
credentials, stand up auth, register Apple/Google, redeploy the PWA origin,
update/read back A6, run the accepted-synthesis canary, regenerate release
evidence, rehearse in three browsers, finalize the packets, and invite no more
than 100 testers after Lou says go.
