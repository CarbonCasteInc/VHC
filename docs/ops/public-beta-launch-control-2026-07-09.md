# Public Beta Launch Control Packet - 2026-07-09

> Status: `no_go_pending_operator_decisions_and_live_evidence`
> Owner: VHC Launch Ops
> Last Reviewed: 2026-07-11
> Depends On: `docs/sprints/PUBLIC_BETA_MVP_COMPLETION_SPRINT_2026-07-11.md`,
> `docs/ops/BETA_SESSION_RUNSHEET.md`,
> `docs/ops/account-provider-callback-boundary.md`,
> `docs/ops/auth-callback-provider-deployment-packet-2026-07-09.md`,
> `docs/ops/public-beta-launch-readiness-closeout.md`,
> `docs/ops/public-beta-image-deploy.md`,
> `docs/ops/a6-s1b-relay-timeout-recovery-packet-2026-07-10.md`,
> `docs/ops/public-beta-operational-state.md`,
> `docs/plans/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md`

This packet is the launch-control note for the active MVP completion sprint.
It records the intended release envelope, target URLs, claim boundaries,
rollback contacts, human authority, and Codex execution permissions that must be
filled before a tester wave can be invited. It is not a release approval or a
release evidence packet.

## Current Decision

`no_go_pending_operator_decisions_and_live_evidence`

Lou is the sole human release authority, Codex is the technical executor, and
the intended launch remains a public beta for US/Canada testers.
The release evidence pipeline remains blocked. A public tester wave must not start until
each live release blocker is cleared, the remaining evidence fields below are
filled, and a release packet passes on the intended release commit.

The S1 recovery implementation is merged through PR #769 at
`3c8907f056ee5e482ddd5cec55ea2b32d6d04c5e`. The exact image and executable
tuple received independent review and the original exact Lou binding.
Supervised load attempt 001 then stopped at read-only prestate because its
remote staging base was shared mode `0775` with unrelated entries. No live
mutation occurred. The original attempt cannot be retried; a fresh private
staging envelope, independent review, and new exact binding are required.
Immediate recovery and T0+24h cannot clear S1 or launch work; T0+48h remains
mandatory.

## Release Envelope

| Field | Current value |
| --- | --- |
| Release profile | `public-beta-ramp`; first invite tranche capped at 100 testers, then 500/1000/open only after green evidence plus Lou approval |
| Tester surface | Venn News Web PWA |
| Tester geography | US and Canada |
| Tester copy label | `public beta` |
| PWA origin | `https://venn.carboncaste.io` |
| Public relay HTTP origins | `https://gun-a.carboncaste.io`, `https://gun-b.carboncaste.io`, `https://gun-c.carboncaste.io` |
| Public relay WSS peers | `wss://gun-a.carboncaste.io/gun`, `wss://gun-b.carboncaste.io/gun`, `wss://gun-c.carboncaste.io/gun` |
| Support intake | Public GitHub issue form plus tester-visible contact email `carboncasteit@gmail.com` |
| Private escalation path | `carboncasteit@gmail.com`; required for sensitive support, legal/copyright, abuse/safety, account/access, and deletion/correction cases |
| Intended release commit | `TBD(release-owner)`; must be the commit used by the passing release evidence packet |
| S1 recovery final revision | `3c8907f056ee5e482ddd5cec55ea2b32d6d04c5e`; exact full commit binds publisher checkout, relay image, capture, and packet; a later merge invalidates the tuple unless rebuilt |
| A6 deployed commit | Last read-only orchestration refresh: `347d20187d164699a35dbd8d76c299570011b1a1` at `2026-07-10T15:48:16Z`; must be refreshed before any mutation or current-live claim |
| Auth-callback host | `https://auth.venn.carboncaste.io`; must be outside A6 |
| Advertised sign-in providers | Apple and Google for first public beta; X is excluded/hidden until a later live provider packet rehearses it |
| External release approval | Lou records `not_required_for_public_beta`; legal/commercial hardening happens during beta unless the release claim changes |

The intended full MVP envelope includes accepted-current summaries, the
bias/framing table, stable point voting, one final stance per user per point,
aggregate-only engagement counts, social sign-in for configured providers,
beta-local LUMA account binding, and aggregate-only constituency/representative
sentiment where privacy thresholds allow it. If any of those surfaces is not
live and rehearsed by the release commit, tester copy must be narrowed instead
of implying that surface is available. Narrowing copy does not waive failing
release gates.

## Required Owners And Contacts

| Responsibility | Owner/contact | Status |
| --- | --- | --- |
| Release owner | Lou | recorded; final go/no-go still requires passing release evidence |
| Source-health/content policy owner | Lou; Codex prepares evidence and recommendations | recorded |
| A6 operator | Lou authorizes; Codex executes through the existing A6 SSH path | recorded |
| Auth-callback deploy owner | Lou authorizes; Codex configures/deploys via Cloudflare/browser access | recorded |
| Apple registration owner | Lou authorizes; Codex configures records after Lou completes browser login/MFA | recorded for first public beta |
| Google registration owner | Lou authorizes; Codex configures records after Lou completes browser login/MFA | recorded for first public beta |
| X registration owner | Lou; excluded from first public beta provider set | not required until X is advertised |
| Release evidence owner | Codex runs and interprets; Lou approves go/no-go | recorded |
| Session operator | Codex runs checks/automation; Lou remains human authority | recorded |
| Incident owner | Lou | recorded |
| Alert-channel owner | Lou; monitored at `carboncasteit@gmail.com` | recorded |
| Rollback owner | Lou authorizes; Codex prepares and executes approved rollback steps | recorded |
| Private support/escalation contact | `carboncasteit@gmail.com` | recorded |
| Legal/commercial approval owner | Lou: `not_required_for_public_beta` | recorded |

## Live-Action Authority Ledger

Lou authorized the existing A6 SSH path for read-only capture and approved
#763's serial A/B/C incident boundary. Lou also confirmed the original exact
revision/image/capture/packet tuple, but attempt 001 closed that execution path on
exit `78` before mutation. The boundary remains; the changed private-staging
envelope requires independent review and a new exact confirmation before load or
relay A. The publisher remains a separate not-yet-authorized mutation; after C
and independent relay-evidence acceptance, Lou must separately confirm attended
publisher recovery authority for the exact same revision.

Authority state by action:

1. read-only A6 capture through the existing SSH path: authorized;
2. scoped serial relay replacement in order `A -> B -> C`: boundary approved,
   but not executable until the new private-staging/load envelope is reviewed,
   exactly confirmed, and the immutable image is loaded; keep the publisher
   parked and roll back only the current relay;
3. exact-revision publisher park/preflight/start/verify/T0/finalize: pending a
   separate Lou confirmation after C and independent relay-evidence acceptance;
4. update A6 to a later intended release commit: blocked until S1 T0+48h closure;
5. rebuild/redeploy the `vhc-public-beta-origin` PWA image: blocked until S1 closure;
6. enable the accepted-synthesis canary only after its preconditions pass;
7. create/configure Apple and Google OAuth app records after Lou completes
   browser login/MFA;
8. configure the auth boundary at `https://auth.venn.carboncaste.io`;
9. use Codex App automation with the Gmail connector to retrieve and analyze
   failure notifications delivered to `carboncasteit@gmail.com`.

This does not authorize Codex live execution/autonomy, pager cutover, any relay
action outside the exact reviewed A/B/C tuple, origin mutation during S1
recovery, retention/compaction/eviction, source-surface mutation without a
content-policy decision, or release approval without Lou's final go.

## Allowed Tester Copy

Tester-facing copy may say, after the passing release packet exists, that this
is a controlled Web PWA public beta for the implemented MVP scope. It may
describe:

- reading accepted-current story summaries when the live accepted-synthesis
  canary has passed;
- inspecting accepted-current framing tables;
- voting on stable frame/reframe point ids;
- seeing aggregate-only engagement counts;
- using configured sign-in providers for account continuity and profile
  recovery only;
- attaching a beta-local LUMA identity to the local account session;
- participating in aggregate-only constituency/representative sentiment when
  privacy thresholds allow it.

Until the accepted-synthesis canary, provider rehearsal, three-browser
rehearsal, and release packet all pass, tester copy must avoid presenting those
items as live facts.

## Forbidden Claims

Do not claim any of the following from this release packet:

- LUMA Silver;
- verified-human identity;
- one-human-one-vote;
- Sybil resistance;
- cryptographic residency;
- cross-device same-human continuity;
- native App Store or TestFlight readiness;
- legal or commercial approval unless the approval field above is recorded;
- production-grade live headline freshness while StoryCluster
  production-readiness is blocked;
- 48-hour Scope A stability or host-failure tolerance without superseding
  retainer/plateau evidence;
- public WSS Mesh `release_ready` unless the Mesh packet itself reports it;
- production app canary pass unless the canary report status is `pass`;
- full app production readiness;
- test-group readiness from the closeout packet alone;
- private support desk or SLA.

## Current Evidence Snapshot

| Evidence | Current state | Launch implication |
| --- | --- | --- |
| Packet introduction basis | Current operational decision, intended public-beta envelope, authority ledger, and claim boundaries | Context only; never substitutes for live evidence |
| Current S1 operational state | `NO_GO_STOP_REPORT_REMOTE_STAGING_BASE_UNSAFE`; see `docs/ops/public-beta-operational-state.md` | Preserve attempt 001; no tester wave or downstream launch work |
| Source health | Latest local source-health release evidence `pass` after the pruned source surface | Must be regenerated on the intended release commit |
| StoryCluster production-readiness | `blocked`; headline-soak diagnosis is `storycluster_openai_invalid_api_key` with action `repair_storycluster_openai_credential_or_endpoint` | Operator must repair live credential/endpoint and rerun the gate |
| Release evidence pipeline | `blocked` | No tester wave |
| MVP release gates | Stale packet still `fail`; public-feed and stance aggregate gates not refreshed on current live target | Must pass on release commit |
| LUMA MVP readiness | Previously passed at stale evidence commit | Must be included in the release-commit packet |
| A6 accepted synthesis | Repo-capable, not yet proven live on A6 | Canary required if release claims summaries/framing-table voting |
| Auth callback | Repo capability exists; deployment/provider setup pending; Lane 4/5 packet now covers deployment, provider allowlist, CSP, start-leg smoke, secret scan, and live rehearsal | Required before advertising sign-in providers |
| Manual rehearsal | Not yet run against deployed target | Required before tester invites |
| Canonical pager/dead-man | Repo capability exists; live signed-alert, durable state, subscription, push/email, acknowledgement, heartbeat, and external dead-man proof are not recorded | Separate reviewed deployment/test-fire packet required before distribution; Codex executor stays dry-run |
| Failure-mailbox monitor | Moving artifact; the latest audit snapshot (`2026-07-11T05:02:14.679Z`) had 1 critical: `public_feed_alert_fail`. Counts are incident history once a newer artifact exists. | Re-read before every gate; no launch-enablement work resumes before T0+48h closure and no unresolved feed critical |
| Final S1 recovery tuple | `3c8907f0` binds publisher checkout, relay OCI revision, full immutable relay image ID, manifest/tar hashes, packet SHA-256, capture SHA-256, reviewer identity, relay order `A -> B -> C`, and reviewed loopback relay origins; original exact binding closed on attempt-001 exit `78` | Regenerate/review/rebind the affected private-staging load envelope before attempt 002 |
| Serial A/B/C relay replacement | `TBD(A6-operator)`; not started because image load did not start | All three stages pass with publisher parked and no rollback or untouched-relay mutation |
| Immediate publisher recovery | `TBD(A6-operator)`; not authorized or started | Required but never sufficient for S1 green |
| S1 T0+24h evidence | `TBD(watch-operator)` | Intermediate evidence only; cannot unblock S2 or launch work |
| S1 T0+48h closure | `TBD(watch-operator)` | Passing final closure is mandatory before S2 or launch enablement |

The durable recovery boundaries are:

- `FINAL_MAIN_REVISION_BINDS_RELAY_IMAGE_AND_PUBLISHER_CHECKOUT`
- `IMMEDIATE_RECOVERY_IS_NOT_S1_GREEN`
- `T0_PLUS_24H_IS_INTERMEDIATE_ONLY`
- `T0_PLUS_48H_REQUIRED_TO_UNBLOCK_S2`

## Rollback And Stop Rules

Stop the tester wave, remove or pause invite copy, and route to the incident
owner if any of these occur:

1. alert email reports public-feed freshness, relay liveness, relay snapshot, or
   watch-closure failure;
2. accepted-current synthesis canary fails or causes raw-feed freshness
   regression;
3. provider health returns missing/unconfigured for an advertised provider;
4. a provider rehearsal leaks token, subject, PKCE verifier, state value,
   nullifier, raw proof material, or private profile data into UI, logs,
   public mesh, support issues, or release artifacts;
5. the three-browser rehearsal shows local-only vote echo without cross-client
   convergence;
6. public aggregate paths or telemetry expose address, nullifier,
   `district_hash`, `merkle_root`, raw constituency proof, provider token, or
   wallet material;
7. any release gate or closeout command is red on the intended release commit.

Rollback is claim-first for this sprint: hide or narrow tester copy, stop
invites, and keep email alerting live. Publisher stop/start is controller-only.
During the scoped S1 action, rollback may touch only the current relay. Outside
the exact reviewed tuple, do not restart relays unless a new focused operator
maintenance packet is independently reviewed and authorized.

## GO Transition Record

Changing only the status is invalid. In GO state, replace every moving evidence
row from `Current S1 operational state` through `S1 T0+48h closure` with its
fresh positive state and a positive closure implication. Use exact state tokens:
`closed` plus final `pass` for S1, `release_ready` for StoryCluster, `pass` for
passing gates/canaries/rehearsals, independent `GO` plus every immutable binding
for the final tuple, and `newCriticalCount == 0` for the final mailbox. The
release-evidence row also records `release_commit_verified: true` and blockers
`[]`. Do not retain attempt-001/002, exit-78, repair, regenerate/rebind, blocked,
pending, or no-tester-wave instructions in a GO evidence row.

## Go Rule

Change this packet to `go_for_public_beta_ramp` only after all of these are
true:

1. every owner/contact row above is filled with a real operator or an explicit
   `not_required` rationale where applicable;
2. the release commit is pinned;
3. A6 is read back or updated at the commit required by the release envelope;
4. the fresh StoryCluster production-readiness report has `status: release_ready`
   with no remaining blocker;
5. accepted-current synthesis is live-proven if tester copy claims summaries,
   framing table, or voting;
6. the auth-callback boundary is deployed outside A6 and every advertised
   provider passes live rehearsal;
7. release evidence is regenerated and passing on the release commit;
8. the manual three-browser rehearsal and privacy spot-check pass against the
   deployed target;
9. tester copy contains only the allowed claims for the surfaces actually
   proven in the release packet.
10. the latest failure-mailbox monitor has no unresolved critical items;
11. the S1 T0+48h closure packet passes for the exact final recovery tuple.
12. product/live evidence binds product release commit R, transition-aware
    guards already exist on R, and any later final decision is recorded only in
    control-record-only commit C using literal `this_record_commit`, with no
    guard, runtime, or product change; hosted binding evidence resolves the
    actual C SHA.
13. the canonical pager path proves signed alert receipt, durable incident
    state, positive subscription and heartbeat, push/email fallback,
    acknowledgement/repeat behavior, and external dead-man health while the
    Codex executor remains dry-run.
