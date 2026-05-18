# MVP Public Beta Launch Control Packet

Date: 2026-05-13
Updated at: 2026-05-18T01:17:56Z
Branch: `coord/mvp-production-grade-distribution-ready-v1`
Release-control commit: `bb120a2e376784475202d59552f4b04531ee798b`
Production-grade readiness packet: `docs/reports/mvp-production-grade-distribution-readiness-2026-05-14.md`
Node: `v20.20.2`
pnpm: `9.7.1`

## Final Status

`blocked_engineering_evidence`

StoryCluster is currently `blocked`: correctness and source-health release evidence pass, but the latest headline-soak execution is not promotable. The local public/remote Web PWA feed smoke passed, the clean-tree Mesh evidence chain passed the canonical 30-minute local soak and required sample floors, and the operator-provided approval/owner fields are recorded. Public ingress setup has advanced: Cloudflare is now authoritative for `carboncaste.io`, the A6 Cloudflare Tunnel is active, and public app/peer routes exist. This packet cannot move to `go_for_public_beta_launch` because live headline freshness is not `release_ready`, the Web PWA and public WSS origins are not deployed behind the tunnel, the original nested `gun-a/b/c.venn.carboncaste.io` peer names do not have valid TLS on Cloudflare Free Universal SSL, Mesh is not `release_ready`, and the production app canary has not passed. Therefore StoryCluster `release_ready`, Mesh `release_ready`, production app canary pass, public WSS proof, and `https://venn.carboncaste.io` public app service are not claimed.

State of Play summary: `docs/reports/mvp-public-beta-state-of-play-2026-05-18.md`

## Release Env

Release env path used without printing secrets:

`/Users/benjamintucker/Desktop/VHC/VHC-mvp-public-beta-go-no-go-v1/packages/e2e/.env.dev-small.local`

Presence-only verification found `OPENAI_API_KEY` and `ANALYSIS_RELAY_API_KEY`. `/api/analyze/config` returned configured `true`, model `gpt-5-nano`, provider `remote-analysis-relay`. `/api/analyze/health` returned `200 OK` with `{"ok":true,"model":"gpt-5-nano","upstream":"reachable"}`.

## Evidence Summary

| Evidence | Result | Artifact |
| --- | --- | --- |
| StoryCluster production readiness | `blocked`; `headline_soak_release_evidence_failed` | `.tmp/storycluster-production-readiness/latest/production-readiness-report.json` |
| Public/remote Web PWA feed smoke | `pass` | `.tmp/release-evidence/public-feed-browser-smoke/1778996451746/public-feed-browser-smoke-summary.json` |
| Public feed screenshots | saved | `.tmp/release-evidence/public-feed-browser-smoke/1778996451746/` |
| Analysis relay health | `200 OK` | local curl output |
| Mesh production-readiness aggregate | `blocked` | `.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json` |
| Mesh canonical 30-minute soak | `pass` | source run `mesh-soak-20260517T082555Z-3053b8aa` |
| Public WSS Mesh proof | blocked | `public-wss-deployment-proof`; external infrastructure access unavailable |
| Production app canary | blocked | `.tmp/production-app-canary/latest/production-app-canary-report.json`; `mesh_not_release_ready` |

Public-feed proof covered daemon/Gun latest-index readback, current public headlines, source labels, timestamps, refresh, scroll, story detail, accepted synthesis, identity creation, point stance write/readback, story comments, reload persistence, and second-browser visibility.

Mesh local proof covered topology, signed peer config, state resolution, disconnect, partition, read repair, a canonical 30-minute soak, clock skew, conflict, and LUMA-gated write coverage on clean commit `f56dc609fd102694d14d7626a4d3467d9f99a27a`. The soak passed full duration with zero terminal failures, zero duplicate canonical writes, cleanup `pass`, all required write sample floors `pass`, and `relay_open_sockets_file_descriptors` `pass`. The Mesh aggregate remains blocked on `public-wss-deployment-proof` and `evidence-scrub-promotion`.

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

## Infrastructure State

| Surface | Observed fact | Required next action |
| --- | --- | --- |
| Cloudflare DNS | `carboncaste.io` is delegated to `eric.ns.cloudflare.com` and `riya.ns.cloudflare.com`; app and peer hostnames resolve through Cloudflare. | None for authority; preserve unrelated Cloudflare records. |
| Tunnel | A6 tunnel `vhc-a6-public-beta` is active; token is stored at `/home/humble/.config/vhc/cloudflared.env` with mode `600`; token value was not printed or committed. | Keep token file host-local; rotate only through Cloudflare if needed. |
| Public app route | `https://venn.carboncaste.io` routes to A6 `http://localhost:8080`; TLS works and currently returns `HTTP/2 502`. | Deploy the Web PWA origin on A6 `localhost:8080`. |
| Requested nested peer routes | `gun-a/b/c.venn.carboncaste.io` route to A6 `8765`, A6 `8766`, and Mac `192.168.1.56:8767`; DNS resolves but TLS handshake fails. | Enable Cloudflare ACM/custom certificate for `*.venn.carboncaste.io`, or use fallback peer names. |
| TLS-valid fallback peer routes | `gun-a/b/c.carboncaste.io` route to the same origins; TLS works and currently returns `HTTP/2 502`. | Deploy the WSS peer origins and use these fallback peers for the near-term Mesh public proof unless nested TLS is fixed. |
| A6 permissions | `sudo -n true`, Docker, and `cloudflared` systemd service are ready on A6. | Deploy persistent app/peer services and health checks. |
| Router/firewall | Not needed for the selected Cloudflare Tunnel path. | No home-router action required for this path. |

## Allowed Launch Copy

The approved bounded copy is in `docs/launch/public-beta-copy.md`. It allows only the local public/remote evidence recorded here. It explicitly does not activate a public launch while headline-soak and infrastructure blockers remain.

## Forbidden Claims

- `go_for_public_beta_launch`
- StoryCluster `release_ready`
- Mesh `release_ready`
- production app canary pass
- public WSS proof satisfied
- `https://venn.carboncaste.io` serving the deployed Web PWA
- original nested `gun-a/b/c.venn.carboncaste.io` peer TLS validity
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
