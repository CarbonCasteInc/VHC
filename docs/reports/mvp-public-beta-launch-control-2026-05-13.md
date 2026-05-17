# MVP Public Beta Launch Control Packet

Date: 2026-05-13
Updated at: 2026-05-17T05:45:00Z
Branch: `coord/mvp-production-grade-distribution-ready-v1`
Release-control commit: `bb120a2e376784475202d59552f4b04531ee798b`
Production-grade readiness packet: `docs/reports/mvp-production-grade-distribution-readiness-2026-05-14.md`
Node: `v20.20.2`
pnpm: `9.7.1`

## Final Status

`blocked_engineering_evidence`

StoryCluster is now `release_ready`, the local public/remote Web PWA feed smoke passed, and the operator-provided approval/owner fields are recorded. This packet still cannot move to `go_for_public_beta_launch` because the required public self-hosted deployment cannot be truthfully built or proven from this agent: DNS registrar access, inbound router/firewall reachability, TLS issuance ability, and noninteractive host admin/service-manager permissions are unavailable. Therefore Mesh `release_ready`, production app canary pass, and `https://venn.carboncaste.io` public deployment are not claimed.

## Release Env

Release env path used without printing secrets:

`/Users/benjamintucker/Desktop/VHC/VHC-mvp-public-beta-go-no-go-v1/packages/e2e/.env.dev-small.local`

Presence-only verification found `OPENAI_API_KEY` and `ANALYSIS_RELAY_API_KEY`. `/api/analyze/config` returned configured `true`, model `gpt-5-nano`, provider `remote-analysis-relay`. `/api/analyze/health` returned `200 OK` with `{"ok":true,"model":"gpt-5-nano","upstream":"reachable"}`.

## Evidence Summary

| Evidence | Result | Artifact |
| --- | --- | --- |
| StoryCluster production readiness | `release_ready` | `.tmp/storycluster-production-readiness/latest/production-readiness-report.json` |
| Public/remote Web PWA feed smoke | `pass` | `.tmp/release-evidence/public-feed-browser-smoke/1778996451746/public-feed-browser-smoke-summary.json` |
| Public feed screenshots | saved | `.tmp/release-evidence/public-feed-browser-smoke/1778996451746/` |
| Analysis relay health | `200 OK` | local curl output |
| Public WSS Mesh | blocked | external infrastructure access unavailable |
| Production app canary | blocked | Mesh/public deployment prerequisite unavailable |

Public-feed proof covered daemon/Gun latest-index readback, current public headlines, source labels, timestamps, refresh, scroll, story detail, accepted synthesis, identity creation, point stance write/readback, story comments, reload persistence, and second-browser visibility.

## Approval Table

| Field | Recorded value |
| --- | --- |
| Release owner | Carbon Caste Inc |
| Legal/external disposition | `not_required` |
| Legal/external rationale | public beta copy makes no regulated/commercial/legal claims |
| Launch copy approval | `approved` |
| Approved launch copy path | `docs/launch/public-beta-copy.md` |
| Support intake owner | Venn Support |
| Public support/intake path | GitHub issue form in `CarbonCasteInc/VHC` |
| Private escalation owner/team | Venn Core |
| Private escalation channel | none; single-developer project |
| Rollback disposition | `not_required` |
| Rollback rationale | fresh launch, no release version, no userbase, no migration |

## Infrastructure Blockers

| Blocker | Observed fact | Required human action |
| --- | --- | --- |
| `dns_registrar_access_required` | `carboncaste.io` uses Namecheap nameservers; `venn.carboncaste.io` and `gun-a/b/c.venn.carboncaste.io` have no A records; no DNS API credentials are available in the environment. | Provide registrar/DNS access or create the required records. |
| `public_inbound_router_firewall_required` | Mac mini and `humble` both report public IPv4 `129.222.193.128`; inbound TCP 80/443 to that IP timed out. | Provide router/firewall/NAT control or another public ingress for 80/443/WSS. |
| `host_admin_rights_required` | `sudo -n true` requires a password on both hosts. | Provide noninteractive sudo/admin rights or preconfigure services/firewall/privileged ports. |
| `tls_issuance_blocked_by_dns_and_inbound` | No Caddy/certbot/nginx binary is installed on either host; DNS and inbound 80/443 are unavailable for ACME. | Provide TLS tooling plus DNS challenge credentials, or open HTTP-01/443 and authorize installation. |
| `public_wss_deployment_proof_missing` | Required public peers cannot be deployed or probed without the above. | Deploy and prove the three public WSS peers after access is available. |

## Allowed Launch Copy

The approved bounded copy is in `docs/launch/public-beta-copy.md`. It allows only the local public/remote and StoryCluster evidence recorded here. It explicitly does not activate a public launch while infrastructure blockers remain.

## Forbidden Claims

- `go_for_public_beta_launch`
- Mesh `release_ready`
- production app canary pass
- public WSS proof satisfied
- `https://venn.carboncaste.io` deployed or publicly reachable
- downstream production app surfaces observed end to end
- legal approval or commercial approval
- LUMA Silver
- verified-human identity
- one-human-one-vote
- Sybil resistance
- production attestation
- native App Store or TestFlight readiness
- private support desk or SLA

## Decision Rule

`go_for_public_beta_launch` requires the public WSS bootstrap mesh, Mesh `release_ready`, production app canary pass, public `https://venn.carboncaste.io` proof, and all approval/owner fields to be green and recorded.

Current decision: `blocked_engineering_evidence`.
