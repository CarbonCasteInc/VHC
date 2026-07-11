# Public Beta Next-Phase Orchestration Prompt And Sprint Checklist

> Status: Active execution checklist
> Compatibility Path: retained from 2026-07-09; operationally refreshed 2026-07-11
> Human authority: Lou
> Technical executor: Codex
> First advertised providers: Apple and Google
> Deferred provider: X
> Current operational owner: `docs/ops/public-beta-operational-state.md`

The archived pre-attempt checklist is at
`docs/archive/public-beta-pre-recovery-2026-07-10/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md`.
It preserves completed G0-G3 history and stale transition prose for audit only.

## Orchestration-Agent Action Prompt

You are the orchestration agent responsible for executing this checklist through
delegated implementation, independent review, integration, and evidence
collection. This is a binding execution checklist derived from canonical product,
specification, status, and operations owners; it does not override them.

Move the controlled public beta through the remaining G4 and S1-S12 gates
without weakening release evidence, `2/3` quorum, fail-closed behavior, privacy,
secret handling, incident authority, or elapsed-time requirements.

Do not merely summarize. Verify current repo, mailbox, and read-only A6 truth;
delegate bounded non-live work; inspect actual diffs and artifacts; return
defects to the owning lane; require subsequent review; and stop whenever a gate
is not green.

## Current Truth

Repository and artifact state:

- PRs #759-#769 are merged.
- S1 recovery `FINAL_REV` is
  `3c8907f056ee5e482ddd5cec55ea2b32d6d04c5e`.
- The exact `linux/amd64` relay image, capture, executable packet, and execution
  binding received independent same-reviewer `GO` with P0/P1/P2 zero.
- Lou bound the original exact tuple for private staging, transfer, checksum,
  image load, immutable verification, serial A then B then C, and
  current-relay-only rollback.
- Publisher, checkout, origin, data, quorum, timeout, recipient, provider, pager,
  and monitor changes were excluded.
- Supervised load attempt 001 exited `78` at read-only prestate with
  `remote_staging_unexpected_content`.
- No staging change, `scp`, `docker load`, relay, publisher, service, retry,
  chmod, cleanup, alternate path, or hand patch occurred.
- Current decision is `NO_GO_STOP_REPORT_REMOTE_STAGING_BASE_UNSAFE`.
- A fresh private-staging load/supervision envelope, independent review, and new
  exact Lou binding are required before another attempt.
- S1A/S1B remain red; S2+ remains blocked.

Read `docs/ops/public-beta-operational-state.md` before acting. Its dated mailbox
snapshot is incident history once a newer moving artifact exists.

Fixed public-beta envelope:

- public origin: `https://venn.carboncaste.io`;
- auth boundary: `https://auth.venn.carboncaste.io`;
- private support mailbox: `carboncasteit@gmail.com`;
- first advertised providers: Apple and Google; X remains hidden;
- initial markets: US and Canada;
- first tranche: at most 100 testers; later 500, 1000, then open intake only
  after green evidence plus a separate Lou decision.

## Start From Live Truth

Before every gate:

1. Run `git fetch origin --prune` and resolve the exact current branch, SHA, PR,
   review, and hosted-check state. Remote truth overrides stale prose.
2. Preserve unrelated user changes. The local-only files
   `DISTRIBUTION_READINESS_GOAL_2026-07-05.md` and
   `DISTRIBUTION_READINESS_SLICES_2026-07-05.md` must not be staged, deleted, or
   copied into a lane.
3. Read the moving `.tmp/vhc-failure-mailbox-monitor/latest.json`, record its
   timestamp/hash/counts, and preserve dedupe state.
4. Treat monitor `status: pass` as monitor execution health, not release
   clearance.
5. Run the required read-only repo/A6 comparison before mutation. Do not infer
   publisher/feed health from relay `/readyz` alone.
6. Append secret-safe decisions to
   `.tmp/public-beta-orchestration/<run-id>/ledger.json`.
7. Stop if evidence differs from the exact reviewed/bound state.

## Authority Model

Lou alone owns live incident, restart, rollback, release, provider-account,
external-approval, and tester-wave decisions. A merged PR or green test never
creates live authority.

Codex owns repo integration, evidence adjudication, and the single technical
driver role for an exact separately authorized live session.

Subagents may prepare packets, inspect files/artifacts, run local tests, and
review evidence. They may not mutate A6, production services, relay state,
Gmail, DNS, Cloudflare, Apple, Google, tester distribution, pager configuration,
or production data.

No Codex live execution/autonomy is enabled. No pager cutover is part of this
sprint. No relay action outside Lou's exact independently reviewed serial A/B/C
is eligible.

No raw secret is copied into chat, docs, PRs, GitHub issues, release artifacts,
or terminal transcripts. Do not persist provider error bodies, relay tokens,
host-private environment values, story bodies, identity proof material, or
private support details.

## Isolation And Review Protocol

- One implementation lane equals one subagent, one branch, one isolated
  worktree or clone, and one focused PR.
- If isolated worktrees/clones are unavailable, run lanes sequentially.
- Never run parallel implementation agents in one worktree.
- An implementer may not review its own lane.
- The same reviewer performs a subsequent review after every correction.
- A cross-lane reviewer is distinct from implementers and lane reviewers.
- An implementer's `GO` is never self-approving.
- A command that exits zero while running zero matching tests is `NO-GO`.
- Subagents return structured completion reports with branch, base/head SHA,
  files changed, tests, risks, authority used, blockers, and recommended gate.

Recommended historical lane names remain:

- `codex/s1b-relay-availability-total`
- `codex/s1b-alert-fingerprint-mime`

Use the repository-accepted branch prefix when ownership policy requires a
different prefix.

## Orchestrator Decisions

Record exactly one decision at every gate:

- `GO`: all exact prerequisites and evidence pass;
- `NO-GO`: a product, safety, review, CI, privacy, or live-readback condition
  failed;
- `WAITING_FOR_LOU`: exact human authority, login, MFA, rollback, provider,
  release, or tester-wave decision is required;
- `BLOCKED_EXTERNAL`: a required host, connector, provider, or network surface
  remains unavailable after bounded retries.

On `NO-GO`, stop downstream dispatch and preserve evidence. On
`WAITING_FOR_LOU`, continue only explicitly unrelated repo work. On
`BLOCKED_EXTERNAL`, never substitute fixture or stale evidence for live proof.

## Delegation Waves

| Wave | Work | Current state / GO gate |
| --- | --- | --- |
| G0 | Repo, PR, CI, mailbox, read-only A6 truth | Complete historically; revalidate moving truth before each gate. |
| G1 | S1B Runtime and Alert lanes | Complete, independently reviewed, merged. |
| G2 | Cross-lane integration | Complete, reviewed, merged. |
| G3 | Recovery tooling, exact tuple, review, original binding | Complete for the original tuple. |
| G4 | Private staging, load, A/B/C, publisher recovery, 24/48-hour evidence | Active `NO-GO`; attempt 001 stopped before mutation. |
| G5 | S2 StoryCluster repair, then S3 auth boundary | Blocked until S1 T0+48h closure. |
| G6 | S4 Apple and S5 Google | Blocked; provider sessions require Lou-supervised login/MFA. |
| G7 | S6 origin, S7 release update, S8 synthesis canary | Blocked; strictly sequential. |
| G8 | S9 evidence, S10 rehearsal, S11 distribution | Blocked; strictly sequential. |
| G9 | S12 monitored ramp | Blocked; every tranche needs green evidence and separate approval. |

## Sprint Sequence

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

S0/G0-G3 implementation history is complete and archived. G4 is the current
active gate. S2-S12 remain ordered and cannot consume a stale or fixture-only
pass from an earlier gate.

## S1 - Failure-Mailbox Monitor And Incident Intake Loop

The moving monitor may classify:

- `public_feed_alert_fail`;
- `public_feed_freshness_monitor_workflow_failed`;
- historical aliases `public_feed_freshness_workflow_failed` and
  `public_feed_freshness_workflow_cancelled`;
- `pager_deadman_workflow_failed`.

If `newCriticalCount > 0`, the release is blocked even when `status: pass`.
Before launch, `newCriticalCount == 0`, the S1 T0+48h packet passes, and no
unresolved public-feed critical remains. The pager dead-man workflow must be
green before launch or tranche expansion.

Guard tokens:

- `MAILBOX_PASS_IS_MONITOR_HEALTH_NOT_RELEASE_GREEN`
- `READ_ONLY_INCIDENT_TRIAGE_ONLY`
- `PUBLIC_FEED_ALERT_FAIL_BLOCKS_MUTATION`
- `A6_READBACK_BEFORE_ANY_MUTATION`
- `NO_STORYCLUSTER_AUTH_DEPLOY_UNTIL_INCIDENT_CLASSIFIED`
- `LOU_RETAINS_INCIDENT_ROLLBACK_AUTHORITY`

Monitor `recommendedNextAction` remains incident escalation input. The monitor
does not send, delete, archive, or label email.

## S1A - Monitor-Critical Public-Feed Incident Readback Gate

Current classified incident:

`relay_rest_story_timeout_total_0_of_3_exit_78`

The triggering raw `/vh/news/story` publication received `0/3` validated relay
acknowledgements where `2/3` are required. The deployed path waited on three
sequential ten-second deadlines. Relay readiness remained healthy, but the
publisher parked at exit `78`; latest-index, snapshots, and freshness then went
stale. Volatile alert window values also created duplicate incident messages.

This classification explains the remediation. It is not restart authority and
does not prove unchanged current A6 state.

Exit only after current publisher, feed freshness, relay liveness, snapshot,
watch closure, and mailbox evidence satisfy the S1B immediate and elapsed gates.

## S1B - Durable Relay-Timeout And Alert-Dedupe Remediation

### Repo Capability - Complete

The Runtime lane owns the real daemon exit consumer:

- `services/news-aggregator/src/daemonWriteLane.ts`
- `services/news-aggregator/src/daemonCli.ts`
- `services/news-aggregator/src/daemon.ts`
- `packages/gun-client/src/newsAdapters.ts`
- `infra/relay/server.js`
- `packages/e2e/src/live/relay-server.vitest.mjs`

The merged implementation preserves these invariants:

- concurrent bounded fanout waits for all outcomes to settle deterministically;
- timeout is unacknowledged, not provably unpublished;
- every retry reuses the exact serialized and signed record;
- endpoint-local exact readback covers `/vh/news/story`,
  `/vh/news/latest-index`, `/vh/news/hot-index`, and
  `/vh/news/synthesis-lifecycle`;
- bounded `story_id` GET branches return the complete stored signed record
  without scanning an aggregate root;
- `2/3` unique validated acknowledgements pass; `0/3` and `1/3` never pass;
- only fully unacknowledged availability-total exhaustion maps to exit `69`;
- partial/HTTP/backpressure/conflict/validation/tamper/unknown failures stay
  fail-closed at exit `78`;
- semantic alert fingerprints exclude volatile ages, window decimals, archive
  counts, counters, timestamps, and generated-at values;
- failure and recovery mail is readable and secret-safe.

Focused command inventory:

```bash
corepack pnpm@9.7.1 --filter @vh/gun-client test -- newsAdapters.test.ts
corepack pnpm@9.7.1 --filter @vh/news-aggregator test -- daemonWriteLane.test.ts daemon.coverage.test.ts
corepack pnpm@9.7.1 --filter @vh/e2e exec vitest run src/live/relay-server.vitest.mjs --config ./vitest.config.ts
corepack pnpm@9.7.1 exec vitest run packages/ai-engine/src/newsRuntime.test.ts
corepack pnpm@9.7.1 check:public-feed:alert-watch
corepack pnpm@9.7.1 check:public-beta-s1-recovery-control-plane
```

### G4 Current Gate - Private Staging And Load

The original attempt is closed. Before attempt 002 is eligible:

- preserve attempt 001 and its hashes unchanged;
- select a private current-user-owned, non-symlink, mode-`0700`, non-shared
  staging root;
- regenerate all affected load/supervision artifacts;
- require independent subsequent review;
- obtain a new exact Lou binding;
- refresh moving mailbox and read-only A6 prestate;
- stop on any unbound drift or secret-bearing output.

Do not reuse, chmod, clean, or hand patch `/tmp/vhc-public-beta-images`.

The load stage may only stage, transfer, verify checksums, run `docker load`, and
verify the exact immutable image. It does not replace a relay or start the
publisher.

### G4 Relay Replacement

`infra/relay/server.js` is copied into an immutable relay image; public-beta
compose mounts only `/data`. The exact-readback routes therefore require serial
container replacement.

The authoritative detail is
`docs/ops/a6-s1b-relay-timeout-recovery-packet-2026-07-10.md`. Required summary:

- image revision, architecture, mutable-ref resolution, and full immutable image
  ID match the reviewed tuple;
- inspect input is an array of exactly three canonical relays;
- live/captured env, mount, port, user, memory, restart, and semantic network
  attachment prestate match;
- current A6 `host`/`host` topology and exact `--network host` intent are bound;
- publisher is exactly parked;
- `systemctl --user list-jobs --no-legend --no-pager` succeeds and is empty;
- current relay's captured three-snapshot SHA baseline is rechecked immediately
  before mutation;
- pre-mutation refusals stay outside rollback; only a set mutation-started latch
  can enter rollback;
- evidence paths are current-user-owned non-symlink `0700` private work;
- absent watchdog-trip row is semantic zero only with exactly one valid uptime
  and RSS producer row; empty/random, malformed, duplicate, or nonzero telemetry
  fails closed;
- hostile/unexpected exact-readback bodies remain private;
- A passes and receives independent evidence acceptance before B; B before C;
- rollback recreates only the current relay and normalizes failure to exit `78`;
- C reports rolling replacement complete with the publisher still parked.

Keep `tools/scripts/vhc-packet-executor.mjs` unchanged. It does not execute this
rolling action.

### G4 Publisher Recovery

Publisher recovery requires accepted C evidence and separate attended authority.
Use the newly reviewed exact-revision recovery-controller sequence:

```bash
FINAL_REV=<full-40-hex-reviewed-s1-recovery-revision>
./tools/scripts/install-news-aggregator-production-service.sh --expected-revision "$FINAL_REV"
./tools/scripts/news-aggregator-publisher-recovery-control.sh park --expected-revision "$FINAL_REV" --approve-park
./tools/scripts/news-aggregator-publisher-recovery-control.sh preflight --expected-revision "$FINAL_REV" --output-file "$PREFLIGHT" --approve-preflight
./tools/scripts/news-aggregator-publisher-recovery-control.sh start --expected-revision "$FINAL_REV" --relay-recovery-evidence "$RELAY_EVIDENCE" --relay-recovery-expected-sha256 "$RELAY_EVIDENCE_SHA256" --preflight-artifact "$PREFLIGHT" --mailbox-artifact "$MAILBOX" --mailbox-expected-sha256 "$MAILBOX_SHA256" --mailbox-expected-critical-count "$MAILBOX_CRITICAL_COUNT" --start-control-output "$START_CONTROL" --approve-attended-start
./tools/scripts/news-aggregator-publisher-recovery-control.sh verify --expected-revision "$FINAL_REV" --start-control-artifact "$START_CONTROL" --current-run-file "$CURRENT_RUN" --runtime-diagnostics-file "$RUNTIME_DIAGNOSTICS" --output-file "$READBACK" --relay-origin "$RELAY_A_ORIGIN" --relay-origin "$RELAY_B_ORIGIN" --relay-origin "$RELAY_C_ORIGIN" --approve-verification-and-abort
node ./tools/scripts/update-phase5-scope-a-watch-t0.mjs --file "$WATCH_ENV" --new-t0 "$READBACK_GENERATED_AT" --expected-start "$OLD_WATCH_START" --expected-clean-start "$OLD_CLEAN_START"
./tools/scripts/news-aggregator-publisher-recovery-control.sh finalize --expected-revision "$FINAL_REV" --start-control-artifact "$START_CONTROL" --readback-artifact "$READBACK" --watch-env-file "$WATCH_ENV" --first-alert-file "$FIRST_ALERT" --second-alert-file "$SECOND_ALERT" --mailbox-artifact "$FINAL_MAILBOX" --finalization-output "$FINALIZATION" --approve-finalization-and-abort
```

Immediate readback requires active/running publisher state, two clean completed
ticks, successful raw writes, exact four-route readback, advancing latest-index
and relay snapshots, green relay liveness, bounded timeout classification, and
one readable recovery transition.

Preserve hourly evidence. No new publisher failure, exit-69 start-limit park,
exit 75/78, watchdog trip, stale feed, stale snapshot, or duplicate unchanged
incident transition is allowed.

S1B cannot exit green from repo work or immediate recovery alone.

Durable boundaries:

- `FINAL_MAIN_REVISION_BINDS_RELAY_IMAGE_AND_PUBLISHER_CHECKOUT`
- `IMMEDIATE_RECOVERY_IS_NOT_S1_GREEN`
- `T0_PLUS_24H_IS_INTERMEDIATE_ONLY`
- `T0_PLUS_48H_REQUIRED_TO_UNBLOCK_S2`

## S2 - StoryCluster Headline-Soak Credential/Endpoint Repair

Required input:

- S1A/S1B have a passing T0+48h closure packet;
- moving mailbox has no unresolved public-feed critical;
- ledger records `T0_PLUS_48H_REQUIRED_TO_UNBLOCK_S2: pass`;
- Lou provides the secret-bearing access window.

Inspect only redacted env names, file owner/mode/hash, health booleans, and stable
reason codes. Repair the credential/endpoint in the correct secret store; never
print or paste it.

```bash
corepack pnpm@9.7.1 collect:storycluster:headline-soak
corepack pnpm@9.7.1 check:storycluster:production-readiness
```

Exit when the report no longer blocks on
`headline_soak_release_evidence_failed`, or when any remaining blocker is
product evidence rather than invalid credentials/missing endpoint.

## S3 - Auth Boundary Infrastructure On Cloudflare

Deploy `https://auth.venn.carboncaste.io` outside A6 with durable nonce storage,
secret-safe health, and exact allowed origin:

```text
VH_AUTH_ALLOWED_ORIGINS=https://venn.carboncaste.io
VH_AUTH_PWA_ORIGIN=https://venn.carboncaste.io
```

Requires Lou-supervised login/MFA. Health must prove `durableStore: true` without
exposing secrets.

## S4 - Apple Provider Registration And Rehearsal

Register Sign in with Apple with return URI
`https://auth.venn.carboncaste.io/auth/apple/return`. Preserve provider ids and
key material only in the boundary secret store. Exit when Apple health, start
leg, return leg, cancel/error handling, and PWA rehearsal pass secret-safely.

## S5 - Google Provider Registration And Rehearsal

Register the Google web client with redirect
`https://venn.carboncaste.io/auth/callback`. Google redirects to the PWA callback,
not directly to the worker. Exit when `providersConfigured.apple == true`,
`providersConfigured.google == true`, both full rehearsals pass, and X is hidden.

Social sign-in is account continuity and profile recovery only. It is not LUMA
Silver, verified-human identity, or one-human-one-vote.

## S6 - PWA Origin Image Rebuild With Auth Env/CSP

Build the eventual release image with:

```text
VITE_AUTH_CALLBACK_BASE_URL=https://auth.venn.carboncaste.io
VITE_AUTH_CALLBACK_PROVIDERS=apple google
```

CSP must allow the auth boundary. X must remain absent.

## S7 - A6 Release-Commit Update And Live Readback

Use the existing A6 SSH path only after S1-S6 prerequisites and exact authority.
Update to the intended release commit through the reviewed packet, then verify
services, images, revision, origin, auth environment, relays, publisher, and
public routes. Record every action and rollback boundary.

## S8 - Accepted-Synthesis Canary

Run the dedicated operator packet. Prove one current accepted `TopicSynthesisV2`
with nonempty facts/frames and stable point IDs, current lifecycle/source-set
binding, public relay/PWA readback, and no raw-feed regression.

The expected catch-up command surface includes `catchup:public-synthesis`.

## S9 - Release Evidence Regeneration

Regenerate on the intended release commit. The final report must record
`release_commit_verified: true` and pass release gates, closeout, compliance,
docs, launch control, distribution, operator packets, and relevant build/type
checks. Fixture-only evidence never substitutes for live proof.

## S10 - Manual 3-Browser Account/Vote/Privacy Rehearsal

Use three isolated browser identities. Prove Apple/Google account continuity,
beta-local LUMA binding, point-stance persistence, reload behavior, cross-client
aggregate convergence, deterministic thread persistence, and privacy boundaries.

The release record must state that 3-browser convergence is proven on non-voting
browsers rather than accepting local echo.

## S11 - Distribution Packet Finalization And First Public-Beta Tranche

The first public-beta tranche is capped at 100 testers. Distribution remains
blocked until every prior gate, owner, support/private-handoff path, alert path,
rollback, rehearsal, and final decision field is complete. Claim-first rollback
removes or narrows unsupported copy before technical rollback.

## S12 - Post-Launch Watch, Incident Loop, And Tranche Expansion

Monitor feed freshness, relay liveness/snapshots, publisher liveness, auth,
provider health, support intake, privacy, and product gates. Stop on any incident
condition. Expand to 500 testers only after 24 hours of green evidence and a
separate Lou approval. Expand to 1000 testers only after another 24 hours of
green evidence and a separate Lou approval. Open intake requires the prior
tranche, release evidence, alert/support loops, and incident/rollback process to
remain green plus a separate Lou approval. Silence or optimism is never
evidence.

## Final Release-Readiness Checklist

The public beta is not ready until:

- S1 T0+48h closure passes with no unresolved public-feed critical;
- pager dead-man path is green;
- StoryCluster production readiness is no longer credential/endpoint blocked;
- auth boundary and durable nonce store are deployed;
- Apple and Google pass; X is hidden;
- PWA origin and A6 match the intended release commit;
- accepted-synthesis canary passes for every claimed analysis/stance surface;
- release evidence, MVP gates, closeout, compliance, docs, operator packets, and
  runsheet guards pass;
- manual three-browser and privacy rehearsals pass;
- tester copy is claim-safe;
- Lou records the final go.

## Stop Conditions

Stop immediately and preserve evidence on:

- any public-feed critical or `newCriticalCount > 0`;
- `recommendedNextAction` requiring incident treatment;
- publisher park/failure, stale feed/snapshot, relay liveness/watch-closure
  regression, watchdog/OOM, unexpected user job, or tuple drift;
- StoryCluster credential/endpoint failure;
- missing Apple/Google health while visible;
- token, subject, verifier, private profile, raw proof, nullifier, address,
  wallet, district hash, Merkle root, or provider error leakage;
- PWA CSP/auth failure;
- canary, release evidence, MVP, closeout, docs, compliance, or rehearsal failure;
- support path receives private data in a public issue;
- Lou says stop.

## Human-Readable Next Move

1. Preserve attempt 001.
2. Generate and independently review the private-staging load/supervision
   envelope.
3. Obtain the new exact binding.
4. Refresh moving mailbox and read-only A6 truth.
5. Load and verify the immutable image.
6. Execute A/review/B/review/C/review with publisher parked.
7. Obtain separate publisher authority and run controller recovery.
8. Preserve immediate, T0+24h, and passing T0+48h evidence.
9. Unblock S2 only after the honest final gate.
