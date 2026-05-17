# MVP Production-Grade Distribution Readiness Packet

Date: 2026-05-14
Updated at: 2026-05-17T08:10:26Z
Branch: `coord/mvp-production-grade-distribution-ready-v1`
Base commit: `bb120a2e376784475202d59552f4b04531ee798b`
Target PR: `#630`
Node: `v20.20.2`
pnpm: `9.7.1`

## Final Status

`blocked_engineering_evidence`

StoryCluster production readiness is now `release_ready`, the real local public/remote Web PWA feed smoke passed, the clean-tree Mesh evidence chain now includes a passing canonical 30-minute soak with required write/resource sample floors, and operator-provided launch-control approvals/owners are recorded. This packet remains blocked because public self-hosted deployment cannot proceed truthfully without external infrastructure access: DNS registrar access, inbound router/firewall reachability, TLS issuance ability, and noninteractive host admin/service-manager permissions are unavailable. Mesh `release_ready`, production app canary pass, public WSS proof, and `https://venn.carboncaste.io` public deployment are not claimed.

## Release Env And Analysis Health

Release env path used:

`/Users/benjamintucker/Desktop/VHC/VHC-mvp-public-beta-go-no-go-v1/packages/e2e/.env.dev-small.local`

Secrets were not printed or committed. Presence-only verification found `OPENAI_API_KEY` and `ANALYSIS_RELAY_API_KEY`.

| Probe | Result |
| --- | --- |
| `curl -i http://127.0.0.1:2048/api/analyze/config` | `200 OK`; configured `true`; model `gpt-5-nano`; provider `remote-analysis-relay` |
| `curl -i http://127.0.0.1:2048/api/analyze/health` | `200 OK`; `{"ok":true,"model":"gpt-5-nano","upstream":"reachable"}` |

## StoryCluster

Commands:

```bash
pnpm collect:storycluster:headline-soak
pnpm check:storycluster:production-readiness
```

Result: `release_ready`

Artifact: `.tmp/storycluster-production-readiness/latest/production-readiness-report.json`

Key evidence: correctness gate `pass`; source-health release evidence `pass`; headline-soak release evidence `pass`; 4 recent executions; 4 promotable executions; 0 not-ready executions; latest execution 8 sampled stories, 30 audited pairs, corroborated bundle rate 1, average unique source count 10.

Production-grade live headline freshness is allowed only to the extent represented by this StoryCluster report. It does not imply public WSS Mesh or production app readiness.

## Public Web PWA Feed Proof

Command:

```bash
VH_PUBLIC_FEED_APP_URL=http://127.0.0.1:2048/ \
VH_PUBLIC_FEED_GUN_PEER_URL=http://127.0.0.1:7777/gun \
VH_PUBLIC_FEED_SMOKE_READY_TIMEOUT_MS=600000 \
VH_PUBLIC_FEED_SMOKE_ANALYSIS_TIMEOUT_MS=240000 \
pnpm test:public-feed:browser-smoke
```

Result: `pass`

Artifact directory: `.tmp/release-evidence/public-feed-browser-smoke/1778996451746`

Summary: `.tmp/release-evidence/public-feed-browser-smoke/1778996451746/public-feed-browser-smoke-summary.json`

Screenshots:

- `.tmp/release-evidence/public-feed-browser-smoke/1778996451746/01-feed-initial.png`
- `.tmp/release-evidence/public-feed-browser-smoke/1778996451746/02-feed-after-refresh.png`
- `.tmp/release-evidence/public-feed-browser-smoke/1778996451746/03-feed-after-scroll.png`
- `.tmp/release-evidence/public-feed-browser-smoke/1778996451746/04-story-detail-synthesis.png`
- `.tmp/release-evidence/public-feed-browser-smoke/1778996451746/05-story-comment.png`
- `.tmp/release-evidence/public-feed-browser-smoke/1778996451746/06-reload-persistence.png`

Observed proof: 32 latest-index entries, 16 story readbacks, 15 visible current headlines, 15 source-label rows, 15 timestamp rows, refresh and scroll pass, story detail opens, accepted synthesis visible, identity creation passes, point stance write/readback passes, story comments pass, reload persistence passes, and second-browser vote/comment visibility passes.

## Infrastructure Verification

| Surface | Observed |
| --- | --- |
| Mac mini | `Benjamins-Mac-mini.local`, macOS 26.3 build 25D125, root disk 926Gi with 792Gi available |
| Ubuntu A6 | `ssh humble`, host `ccibootstrap`, Ubuntu 24.04 kernel 6.17.0-22-generic, root disk 1.9T with 1.7T available, 58Gi memory with 56Gi available |
| Public IP | both hosts report `129.222.193.128` |
| DNS | `carboncaste.io` nameservers are `dns1.registrar-servers.com` and `dns2.registrar-servers.com`; root A record is `38.45.14.38`; `venn.carboncaste.io` and `gun-a/b/c.venn.carboncaste.io` have no A records |
| Inbound | TCP 80 and 443 to `129.222.193.128` timed out |
| Host admin | `sudo -n true` requires a password on both hosts |
| TLS tooling | no Caddy/certbot/nginx binary found on either host |

Required public topology was not deployed because these checks failed before public infrastructure changes.

## Mesh And Production App Canary

Required public WSS peers:

- `wss://gun-a.venn.carboncaste.io/gun`
- `wss://gun-b.venn.carboncaste.io/gun`
- `wss://gun-c.venn.carboncaste.io/gun`

Status: not deployed, not probed, not claimed.

Clean-tree Mesh evidence refreshed on commit `b7f37edac904673b8b22704eaa081f8a7fb3db8e`:

- LUMA-gated write coverage: `pass`, artifact `.tmp/mesh-luma-gated-write-coverage/latest/mesh-luma-gated-write-coverage-report.json`
- Mesh aggregate: `blocked`, run `mesh-production-readiness-20260517T072725Z-8f7a7e43`, artifact `.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json`
- Passing Mesh source gates: topology, signed peer config, state resolution, disconnect, partition, read repair, canonical 30-minute soak, clock skew, conflict
- Canonical soak source: run `mesh-soak-20260517T073528Z-142f7543`; full duration satisfied; zero terminal failures; zero duplicate canonical writes; cleanup `pass`; all required write sample floors `pass`; `relay_open_sockets_file_descriptors` `pass`
- Aggregate blockers: `public-wss-deployment-proof`, `evidence-scrub-promotion`

Production app canary: `blocked`, run `production-app-canary-20260517T080920Z-447d5576`, artifact `.tmp/production-app-canary/latest/production-app-canary-report.json`. It failed closed with `mesh_not_release_ready`; downstream observations for production WSS relay config, app deployment shape, `/api/analyze`, news synthesis publication, point stance write/readback, and story thread/comment were not run because Mesh is blocked and `https://venn.carboncaste.io` is not deployed.

## Launch Control

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

## Exact Remaining Blockers

| Blocker | Required human action |
| --- | --- |
| `dns_registrar_access_required` | Provide registrar/DNS access or create A/AAAA records for `venn.carboncaste.io`, `gun-a.venn.carboncaste.io`, `gun-b.venn.carboncaste.io`, and `gun-c.venn.carboncaste.io`. |
| `public_inbound_router_firewall_required` | Provide router/firewall/NAT control or another public ingress so inbound 80/443 and WSS traffic reach the selected bootstrap hosts. |
| `host_admin_rights_required` | Provide noninteractive sudo/admin rights or preconfigure services/firewall/privileged ports. |
| `tls_issuance_blocked_by_dns_and_inbound` | Provide TLS tooling plus DNS challenge credentials, or open inbound 80/443 and authorize installation/configuration of an ACME-capable reverse proxy. |
| `public_wss_deployment_proof_missing` | After access is available, deploy the three public WSS peers, signed peer config, CSP connect-src, health checks, restart persistence, and rerun public Mesh proof without threshold dilution. |
| `mesh_release_ready_not_proven` | Run Mesh public WSS proof and production-readiness checks to `release_ready`; current aggregate blockers are `public-wss-deployment-proof` and `evidence-scrub-promotion`. |
| `production_app_canary_not_proven` | After Mesh `release_ready`, run the production app canary against `https://venn.carboncaste.io` with real downstream observations. |

Current decision: `blocked_engineering_evidence`.
