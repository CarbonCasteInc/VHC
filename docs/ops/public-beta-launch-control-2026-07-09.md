# Public Beta Launch Control Packet - 2026-07-09

> Status: `no_go_pending_operator_decisions_and_live_evidence`
> Owner: VHC Launch Ops
> Last Reviewed: 2026-07-09
> Depends On: `docs/plans/RELEASE_READINESS_SPRINT_OUTLINE_2026-07-08.md`,
> `docs/ops/BETA_SESSION_RUNSHEET.md`,
> `docs/ops/account-provider-callback-boundary.md`,
> `docs/ops/auth-callback-provider-deployment-packet-2026-07-09.md`,
> `docs/ops/public-beta-launch-readiness-closeout.md`,
> `docs/ops/public-beta-image-deploy.md`

This packet is the Lane 0 launch note for the current release-readiness sprint.
It records the intended release envelope, target URLs, claim boundaries,
rollback contacts, human authority, and Codex execution permissions that must be
filled before a tester wave can be invited. It is not a release approval or a
release evidence packet.

## Current Decision

`no_go_pending_operator_decisions_and_live_evidence`

This packet was introduced at `main@84360f64` after #751. That commit is a
launch-control documentation basis, not the intended release commit.
Source-health release evidence has recovered in the latest local packet, and
StoryCluster production-readiness now surfaces the headline-soak blocker as the
secret-safe class `storycluster_openai_invalid_api_key`. The human authority and
target-envelope decisions are now recorded: Lou is the sole human release
authority, Codex is the technical executor, and the intended launch is a public
beta for US/Canada testers. The release evidence pipeline remains blocked. A
public tester wave must not start until each live release blocker is cleared, the
remaining evidence fields below are filled, and a release packet passes on the
intended release commit.

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
| A6 deployed commit | Latest recorded read-only readback: `347d2018` on 2026-07-08; must be refreshed before claiming current `main` on A6 |
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

## Authorized Live Actions

Lou has authorized Codex to perform the following after the relevant packet
preconditions pass:

1. use the existing A6 SSH path for readback;
2. update A6 to the intended release commit;
3. rebuild/redeploy the `vhc-public-beta-origin` PWA image;
4. restart the publisher if required by the release/update/canary path;
5. enable the accepted-synthesis canary only after its preconditions pass;
6. create/configure Apple and Google OAuth app records after Lou completes
   browser login/MFA;
7. configure the auth boundary at `https://auth.venn.carboncaste.io`;
8. use Codex App automation with the Gmail connector to retrieve and analyze
   failure notifications delivered to `carboncasteit@gmail.com`.

This does not authorize Codex live execution/autonomy, pager cutover, relay
restart, retention/compaction/eviction, source-surface mutation without a
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
| Packet introduction basis | `main@84360f64` after #751 | Documentation/control basis only; the intended release commit is still `TBD` |
| Source health | Latest local source-health release evidence `pass` after the pruned source surface | Must be regenerated on the intended release commit |
| StoryCluster production-readiness | `blocked`; headline-soak diagnosis is `storycluster_openai_invalid_api_key` with action `repair_storycluster_openai_credential_or_endpoint` | Operator must repair live credential/endpoint and rerun the gate |
| Release evidence pipeline | `blocked` | No tester wave |
| MVP release gates | Stale packet still `fail`; public-feed and stance aggregate gates not refreshed on current live target | Must pass on release commit |
| LUMA MVP readiness | Previously passed at stale evidence commit | Must be included in the release-commit packet |
| A6 accepted synthesis | Repo-capable, not yet proven live on A6 | Canary required if release claims summaries/framing-table voting |
| Auth callback | Repo capability exists; deployment/provider setup pending; Lane 4/5 packet now covers deployment, provider allowlist, CSP, start-leg smoke, secret scan, and live rehearsal | Required before advertising sign-in providers |
| Manual rehearsal | Not yet run against deployed target | Required before tester invites |

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
invites, and keep email alerting live. Publisher restart is authorized only when
required by the release/update/canary path above or by a focused incident
packet. Do not restart relays while raw feed freshness, relay liveness, relay
snapshot freshness, and watch-closure are green unless an explicit operator
maintenance packet authorizes it.

## Go Rule

Change this packet to `go_for_public_beta_ramp` only after all of these are
true:

1. every owner/contact row above is filled with a real operator or an explicit
   `not_required` rationale where applicable;
2. the release commit is pinned;
3. A6 is read back or updated at the commit required by the release envelope;
4. StoryCluster production-readiness is no longer blocked by the headline-soak
   credential/endpoint failure;
5. accepted-current synthesis is live-proven if tester copy claims summaries,
   framing table, or voting;
6. the auth-callback boundary is deployed outside A6 and every advertised
   provider passes live rehearsal;
7. release evidence is regenerated and passing on the release commit;
8. the manual three-browser rehearsal and privacy spot-check pass against the
   deployed target;
9. tester copy contains only the allowed claims for the surfaces actually
   proven in the release packet.
