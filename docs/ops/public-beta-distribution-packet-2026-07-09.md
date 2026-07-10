# Public Beta Distribution Packet - 2026-07-09

> Status: `blocked_pending_release_evidence_rehearsal_and_live_fields`
> Owner: VHC Launch Ops
> Last Reviewed: 2026-07-10
> Depends On: `docs/plans/RELEASE_READINESS_SPRINT_OUTLINE_2026-07-08.md`,
> `docs/ops/public-beta-launch-control-2026-07-09.md`,
> `docs/ops/public-beta-launch-readiness-closeout.md`,
> `docs/ops/BETA_SESSION_RUNSHEET.md`,
> `docs/ops/auth-callback-provider-deployment-packet-2026-07-09.md`,
> `docs/ops/a6-accepted-synthesis-canary-packet-2026-07-09.md`,
> `docs/ops/storycluster-headline-soak-credential-repair-2026-07-09.md`,
> `docs/ops/public-beta-image-deploy.md`,
> `docs/ops/a6-s1b-relay-timeout-recovery-packet-2026-07-10.md`,
> `docs/plans/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md`,
> `docs/launch/public-beta-copy.md`

This is the Lane 8 distribution packet for the first Venn News Web PWA public
beta ramp. It is the artifact the session operator fills after the live release
evidence packet, provider rehearsal, and manual three-browser rehearsal have
passed.

This packet is not a release approval in its current state. It authorizes no
A6 mutation, no origin image redeploy, no auth-provider registration, no
publisher or relay restart, no pager cutover, and no Codex live execution. It
is a release-control checklist and tester-copy boundary.

## Current Decision

`blocked_pending_release_evidence_rehearsal_and_live_fields`

Do not invite testers while this status remains blocked. Change the status to
`go_for_public_beta_distribution` only after every required field below is filled
with secret-safe evidence and the final go checklist passes.

## Distribution Envelope

| Field | Current value | Required before invite |
| --- | --- | --- |
| Release profile | `public-beta-ramp` | First invite tranche capped at 100 testers; expand to 500/1000/open only after green evidence plus Lou approval. |
| Release commit | `TBD(release-owner)` | Exact commit with passing release evidence packet. |
| S1 recovery closure | `TBD(watch-operator)` | Exact final tuple plus serial A/B/C, immediate recovery, T0+24h intermediate, and passing T0+48h closure evidence. |
| Web PWA target URL | `https://venn.carboncaste.io` | Must serve release-commit assets. |
| Auth-callback target URL | `https://auth.venn.carboncaste.io` | Must be outside A6 and health-checked. |
| A6 deployed commit | `TBD(A6-operator)` | Read back immediately before distribution, or record why the release envelope avoids A6-newer claims. |
| A6 service state | `TBD(A6-operator)` | Freshness, relay liveness, relay snapshot, watch closure, and alert email path pass. |
| Accepted synthesis status | `TBD(A6-operator)` | Required if tester copy claims summaries, framing tables, or voting on accepted-current stories. |
| Source-health status | `TBD(source-health-owner)` | Release evidence `pass` on the release commit. |
| StoryCluster production-readiness | `TBD(source-health-owner)` | Headline-soak credential/endpoint blocker cleared if live headline readiness is claimed. |
| Providers enabled | `apple google`; `x` hidden/excluded | Only providers that passed live rehearsal may appear in UI/copy and `VITE_AUTH_CALLBACK_PROVIDERS`. |
| Release evidence packet | `TBD(release-evidence-owner)` | `.tmp/release-evidence-pipeline/latest/release-evidence-pipeline-report.json` status `pass`, `release_commit_verified: true`, blockers `[]`. |
| MVP release gates | `TBD(release-evidence-owner)` | `check:mvp-release-gates` pass. |
| MVP closeout | `TBD(release-evidence-owner)` | `check:mvp-closeout` pass. |
| Launch control | `TBD(release-owner)` | `docs/ops/public-beta-launch-control-2026-07-09.md` status is go and has no stale TBD/blocker language. |
| Manual rehearsal | `TBD(session-operator)` | `docs/ops/BETA_SESSION_RUNSHEET.md` three-browser and privacy checks pass. |
| Incident owner | Lou | Named person watching email alerts and session telemetry during the wave. |
| Alert-channel owner | Lou; `carboncasteit@gmail.com` | Confirm alert email reachability before invite. |
| Rollback owner | Lou authorizes; Codex prepares/executes approved steps | Named authority has read the rollback section and can execute it. |
| Private support/escalation contact | `carboncasteit@gmail.com` | Non-public channel for sensitive support handoffs. |
| External release approval | Lou: `not_required_for_public_beta` | Lou has recorded that legal/commercial approval is not required before public beta testing. |

## Required Evidence Paths

Record exact artifact paths and statuses. Do not paste secrets, raw provider
subjects, tokens, nullifiers, raw proof material, state values, PKCE verifiers,
or private user details.

| Evidence | Required status | Artifact path or readback |
| --- | --- | --- |
| Release evidence pipeline | `pass` | `TBD` |
| LUMA MVP readiness | `pass` | `TBD` |
| Source health | `pass` | `TBD` |
| StoryCluster production-readiness | `release_ready` or claim narrowed away | `TBD` |
| MVP release gates | `pass` | `TBD` |
| MVP closeout | `pass` | `TBD` |
| Public beta launch closeout | `pass` | `TBD` |
| Public beta compliance | `pass` | `TBD` |
| Launch content snapshot | `pass` | `TBD` |
| A6 readback | current for envelope | `TBD` |
| Origin image readback | release-commit assets served | `TBD` |
| Auth boundary health | secret-safe and reachable | `TBD` |
| Provider rehearsal | each advertised provider pass | `TBD` |
| Three-browser rehearsal | pass | `TBD` |
| Privacy spot-check | no leak | `TBD` |
| Alert delivery | confirmed reachable | `TBD` |
| Final S1 recovery tuple | independent `GO` | `TBD`; bind final revision, publisher checkout, relay OCI revision, full immutable relay image ID, manifest/tar hashes, packet SHA-256, capture SHA-256, reviewer identity, relay order `A -> B -> C`, and reviewed loopback relay origins |
| Serial A/B/C relay replacement | `pass` | `TBD` |
| Immediate publisher recovery | `pass` but interim | `TBD` |
| S1 T0+24h evidence | intermediate only | `TBD` |
| S1 T0+48h closure | `pass` | `TBD`; mandatory before distribution |
| Failure-mailbox monitor | no unresolved criticals | `TBD`; the first 2026-07-10 snapshot's 85 criticals are historical, while the moving latest artifact remains incident-blocking and S1A is classified exit `78`; distribution stays blocked until S1A/S1B pass T0+48h closure |

Recovery boundaries: `FINAL_MAIN_REVISION_BINDS_RELAY_IMAGE_AND_PUBLISHER_CHECKOUT`;
`IMMEDIATE_RECOVERY_IS_NOT_S1_GREEN`; `T0_PLUS_24H_IS_INTERMEDIATE_ONLY`;
`T0_PLUS_48H_REQUIRED_TO_UNBLOCK_S2`.

## Final Go Checklist

All checks must be true before changing the status to
`go_for_public_beta_distribution`.

1. `docs/ops/public-beta-launch-control-2026-07-09.md` is go for the same
   release commit and target URLs.
2. The release evidence packet is stamped at the release commit and has
   `status: pass`, `release_commit_verified: true`, and zero blockers.
3. `check:public-beta-s1-recovery-control-plane`, `check:mvp-release-gates`, `check:mvp-closeout`,
   `check:public-beta-launch-closeout`, `check:public-beta-compliance`,
   `check:launch-content-snapshot`, `docs:check`, lint, typecheck, build, and
   `git diff --check` are green on the release commit.
4. The deployed Web PWA target serves release-commit assets.
5. The auth-callback boundary is outside A6, secret-safe, and reachable from
   the PWA under the deployed CSP.
6. Every advertised sign-in provider passed the live matrix in
   `docs/ops/BETA_SESSION_RUNSHEET.md`.
7. Unavailable providers are removed from tester copy and from
   `VITE_AUTH_CALLBACK_PROVIDERS`.
8. Accepted-current synthesis is live-proven if tester copy claims accepted
   summaries, framing tables, or stable point voting.
9. The manual three-browser run proves cross-client convergence on a browser
   that did not cast the vote.
10. The privacy spot-check finds no forbidden public path, network, console,
    telemetry, or support-artifact leak.
11. Source health has release evidence `pass` and no active remove/watch
    contamination in the release window.
12. One incident owner is actively watching alert email and session telemetry.
13. The rollback owner has read the rollback sequence below.
14. External release approval is recorded, or `not_required` is recorded with
    rationale.
15. The latest failure-mailbox monitor has `newCriticalCount == 0` and no
    unresolved public-feed critical; preserve the final read-only repo/A6 readback.
16. The S1 T0+48h closure artifact passes for the exact final recovery tuple;
    incident classification or human authority cannot substitute for elapsed
    evidence.

## Tester Invite Copy

Use this copy only after the final go checklist passes. Replace bracketed
fields with release-specific values. Delete any sentence whose surface did not
pass live evidence and rehearsal.

```text
You are invited to the Venn News Web PWA public beta.

Open: [WEB_PWA_TARGET_URL]

Use one normal browser profile for the session. Do not use incognito and do not
clear browser storage during the test. Your beta-local identity is scoped to
this browser/device.

During this session, please:
- open a current story;
- read the accepted summary if it appears;
- inspect the framing table;
- vote on the available framing points;
- reload and confirm your state persists;
- report any issue with the story id, browser, screenshot, and what you saw.

If sign-in is enabled for this wave, use only these provider buttons:
[ADVERTISED_PROVIDERS].

Sign-in is for account continuity and profile recovery on this beta surface. It
does not verify a unique person, merge identities across devices, prove
residency, or make votes one-human-one-vote.

Public support goes through the VHC GitHub public beta support form. Do not post
private personal data, legal notices, identity documents, raw proof material,
provider secrets, contact details, or full copyrighted articles into public
issues, story replies, or report reasons. For sensitive requests, create only a
public-safe issue stub and wait for the private handoff path.
```

## Claim-Safe Copy Rules

Tester copy may say only what the evidence proves for this release commit.

Allowed after evidence passes:

- controlled public-beta Web PWA test;
- beta-local identity scoped to the browser/device;
- configured sign-in providers support account continuity and recovery;
- accepted-current summaries and framing tables, only if the canary and public
  gates pass;
- stable point voting, only if accepted-current story evidence and
  three-browser convergence pass;
- aggregate-only engagement counts;
- aggregate-only constituency/representative sentiment where privacy
  thresholds allow it.

Forbidden in every invite, support note, issue, release note, and social copy:

- verified human;
- one-human-one-vote;
- Sybil-resistant;
- district-proof;
- cryptographic residency;
- residency verified;
- anonymous;
- fully anonymous;
- untraceable;
- permanently deleted from the network;
- Reset Identity deletes your activity;
- Sign Out removes your data from the network;
- LUMA Silver;
- production attestation;
- full production-ready app;
- mesh release-ready;
- native App Store ready;
- TestFlight ready;
- pager-backed 24/7 operations;
- automated production execution;
- private support desk;
- SLA;
- test-group ready as a standalone claim.

## Session Limits

- Start with at most 100 testers in the first public-beta tranche.
- Expand to 500 testers only after 24 hours green evidence and Lou approval.
- Expand to 1000 testers only after another 24 hours green evidence and Lou
  approval.
- Open beyond 1000 only after the release evidence packet, alert loop, support
  loop, and incident/rollback process remain green through the prior tranche and
  Lou explicitly approves open intake.
- Keep Codex automation watching failure email and keep Lou reachable during the
  entire wave.
- Pause intake immediately if any stop rule below fires.
- Do not change flow, env, or code mid-wave. A tranche expansion requires the
  run-sheet flip-switch criteria and a packet update or appended evidence entry.

## Stop Rules

Stop invites, pause the session, preserve evidence, and route to the incident
owner if any condition occurs:

1. public-feed freshness, relay liveness, relay snapshot, or watch-closure
   alert email fires;
2. accepted-synthesis canary fails or raw-feed freshness regresses;
3. advertised provider health becomes missing/unconfigured;
4. provider rehearsal or live use leaks token, provider subject, PKCE verifier,
   state value, nullifier, proof material, or private profile data;
5. voting appears only as local echo and does not converge cross-client;
6. convergence p95 exceeds 10 seconds for 15 minutes;
7. analysis 429 rate exceeds 3 percent for 10 minutes or 5 percent for
   5 minutes;
8. mesh write-ack timeout rate exceeds 5 percent for 10 minutes;
9. support or telemetry exposes private details;
10. any release gate turns red on the release commit.

## Rollback

Rollback is claim-first unless the changed surface itself must be disabled.

1. Stop invites and tell active testers:
   `Session paused for an environment issue. Your data is preserved.`
2. Preserve current artifacts, alert email, browser screenshots, and public-safe
   issue ids before changing state.
3. Remove or narrow tester copy for the failed surface.
4. If auth fails, first disable the provider at the auth boundary or provider
   config outside A6. UI-hiding rollback through `VITE_AUTH_CALLBACK_PROVIDERS`
   requires a PWA origin image rebuild and therefore an A6 operator packet.
5. If accepted synthesis fails, execute the explicit rollback in
   `docs/ops/a6-accepted-synthesis-canary-packet-2026-07-09.md`.
6. Keep raw feed and email alerting active unless a separate incident packet
   authorizes otherwise.
7. Publisher restart is allowed only when required by the approved
   release/update/canary path or a focused incident packet. Do not restart relays
   while raw feed freshness, relay liveness, relay snapshot freshness, and watch
   closure are green unless an explicit operator packet authorizes it.

## Evidence Entry Template

Append one entry per tester wave.

```text
Date:
Release commit:
Web PWA target:
Auth callback target:
A6 commit/readback:
Release evidence packet:
Providers advertised:
Providers rehearsed:
Accepted synthesis status:
Source-health status:
StoryCluster production-readiness:
Manual rehearsal:
Privacy spot-check:
Testers invited:
Session duration:
Incidents:
Rollback invoked:
Known limitations:
Final disposition:
```

## Current Status

This packet remains blocked because the release commit, live evidence, deployed
auth/provider proof, A6/origin readbacks, and manual rehearsal fields are not
filled yet. The next valid actions are the operator-owned items already listed
in `docs/plans/RELEASE_READINESS_SPRINT_OUTLINE_2026-07-08.md`: repair the
headline-soak credential/endpoint, complete A6 accepted-synthesis canary
preconditions and execution if the release claims accepted summaries/tables,
deploy the auth boundary outside A6, rehearse advertised providers, regenerate
release evidence on the release commit, and run the manual three-browser
rehearsal.
