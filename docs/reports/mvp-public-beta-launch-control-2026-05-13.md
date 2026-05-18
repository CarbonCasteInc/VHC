# MVP Public Beta Launch Control Packet

Date: 2026-05-13
Updated at: 2026-05-18T19:00:31Z
Branch: `coord/mvp-production-grade-distribution-ready-v1`
Release-control commit: `bb120a2e376784475202d59552f4b04531ee798b`
Production-grade readiness packet: `docs/reports/mvp-production-grade-distribution-readiness-2026-05-14.md`
Node: `v20.20.2`
pnpm: `9.7.1`

## Final Status

`blocked_engineering_evidence`

StoryCluster is currently `blocked`: correctness and source-health release evidence pass, and singleton persistence/later bundling is covered by tests, but public headline-soak evidence still fails because browser semantic readback hangs or times out after live publication. The deployed Web PWA, `/api/analyze/*`, signed peer config, and TLS-valid fallback peer health endpoints are public and reachable. Public feed browser smoke against `https://venn.carboncaste.io` failed with `public-feed-headlines-timeout`, with terminal evidence of system-writer signature validation failures on public news index rows. Public WSS peer-config proof ran with no failures and status `review_required`, but Mesh is not `release_ready`, and the production app canary has not passed. Therefore `go_for_public_beta_launch`, StoryCluster `release_ready`, Mesh `release_ready`, production app canary pass, and public feed UX pass are not claimed.

State of Play summary: `docs/reports/mvp-public-beta-state-of-play-2026-05-18.md`

## Release Env

Release env path used without printing secrets:

`/Users/benjamintucker/Desktop/VHC/VHC-mvp-public-beta-go-no-go-v1/packages/e2e/.env.dev-small.local`

Presence-only verification found `OPENAI_API_KEY` and `ANALYSIS_RELAY_API_KEY`. `/api/analyze/config` returned configured `true`, model `gpt-5-nano`, provider `remote-analysis-relay`. `/api/analyze/health` returned `200 OK` with `{"ok":true,"model":"gpt-5-nano","upstream":"reachable"}`.

## Evidence Summary

| Evidence | Result | Artifact |
| --- | --- | --- |
| StoryCluster production readiness | `blocked`; `headline_soak_release_evidence_failed` | `.tmp/storycluster-production-readiness/latest/production-readiness-report.json`; latest completed failed soak `.tmp/daemon-feed-semantic-soak/20260518T174409Z-release-root-trend-v6/semantic-soak-summary.json` |
| Public deployed Web PWA | `200 OK`; strict CSP for fallback WSS peers | `curl -I https://venn.carboncaste.io` |
| Public signed peer config | `200 OK`; config `public-beta-fallback-wss-v1`, minimum `3`, quorum `2` | `curl -i https://venn.carboncaste.io/mesh-peer-config.json` |
| Public peer health | `200 OK` for `gun-a/b/c.carboncaste.io/healthz` | curl evidence |
| Public Web PWA feed smoke | `fail`; `public-feed-headlines-timeout` | `.tmp/release-evidence/public-feed-browser-smoke/20260518T184701Z-public/public-feed-browser-smoke-summary.json` |
| Public/remote Web PWA feed smoke | `pass` | `.tmp/release-evidence/public-feed-browser-smoke/1778996451746/public-feed-browser-smoke-summary.json` |
| Public feed screenshots | saved | `.tmp/release-evidence/public-feed-browser-smoke/1778996451746/` |
| Analysis relay health | `200 OK` | local curl output |
| Mesh production-readiness aggregate | `blocked` | `.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json` |
| Mesh canonical 30-minute soak | `pass` | source run `mesh-soak-20260517T082555Z-3053b8aa` |
| Public WSS Mesh proof | `review_required`; no failures | `.tmp/mesh-production-readiness/mesh-public-wss-proof-1779130008482-f3d66cf8/mesh-production-readiness-report.json` |
| Production app canary | blocked | `.tmp/production-app-canary/latest/production-app-canary-report.json`; `mesh_not_release_ready` |

Earlier local public/remote feed proof covered daemon/Gun latest-index readback, current public headlines, source labels, timestamps, refresh, scroll, story detail, accepted synthesis, identity creation, point stance write/readback, story comments, reload persistence, and second-browser visibility. The deployed public feed smoke has not passed.

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
| Public app route | `https://venn.carboncaste.io` routes to A6 `http://localhost:8080`; TLS works and returns `HTTP/2 200` with the deployed Web PWA and exact fallback-peer CSP. | Fix public feed readback/signature validation; keep origin persistent. |
| Requested nested peer routes | `gun-a/b/c.venn.carboncaste.io` route to A6 `8765`, A6 `8766`, and Mac `192.168.1.56:8767`; DNS resolves but TLS handshake fails. | Enable Cloudflare ACM/custom certificate for `*.venn.carboncaste.io`, or use fallback peer names. |
| TLS-valid fallback peer routes | `gun-a/b/c.carboncaste.io` route to the same origins; TLS works and `/healthz` returns `HTTP/2 200` for all three. | Use these fallback peers for the near-term Mesh public proof unless nested TLS is fixed. |
| A6 permissions | `sudo -n true`, Docker, and `cloudflared` systemd service are ready on A6. | Deploy persistent app/peer services and health checks. |
| Router/firewall | Not needed for the selected Cloudflare Tunnel path. | No home-router action required for this path. |

## Allowed Launch Copy

The approved bounded copy is in `docs/launch/public-beta-copy.md`. It allows only the local public/remote evidence recorded here. It explicitly does not activate a public launch while headline-soak and infrastructure blockers remain.

## Forbidden Claims

- `go_for_public_beta_launch`
- StoryCluster `release_ready`
- Mesh `release_ready`
- production app canary pass
- Mesh `release_ready` from the public WSS proof alone
- public feed browser smoke pass
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

`go_for_public_beta_launch` requires StoryCluster `release_ready`, deployed public feed browser smoke pass, Mesh `release_ready`, production app canary pass, public `https://venn.carboncaste.io` proof, and all approval/owner fields to be green and recorded.

Current decision: `blocked_engineering_evidence`.
