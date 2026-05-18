# MVP Production-Grade Distribution Readiness Packet

Date: 2026-05-14
Updated at: 2026-05-18T01:17:56Z
Branch: `coord/mvp-production-grade-distribution-ready-v1`
Base commit: `bb120a2e376784475202d59552f4b04531ee798b`
Target PR: `#630`
Node: `v20.20.2`
pnpm: `9.7.1`

## Final Status

`blocked_engineering_evidence`

Current StoryCluster production readiness is `blocked`: correctness and source-health release evidence pass, but the latest headline-soak execution is not promotable. The real local public/remote Web PWA feed smoke passed, the clean-tree Mesh evidence chain includes a passing canonical 30-minute soak with required write/resource sample floors, and operator-provided launch-control approvals/owners are recorded. Public ingress setup has advanced: Cloudflare is authoritative for `carboncaste.io`, the A6 Cloudflare Tunnel is active, and public app/peer routes exist. This packet remains blocked because live headline freshness is not `release_ready`, the app and WSS origin services are not deployed behind the tunnel, the original nested `gun-a/b/c.venn.carboncaste.io` peer names do not have valid TLS on Cloudflare Free Universal SSL, public WSS proof has not passed, Mesh is not `release_ready`, and the production app canary has not passed. StoryCluster `release_ready`, Mesh `release_ready`, production app canary pass, public WSS proof, and `https://venn.carboncaste.io` public app service are not claimed.

State of Play summary: `docs/reports/mvp-public-beta-state-of-play-2026-05-18.md`

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

Result: `blocked`

Artifact: `.tmp/storycluster-production-readiness/latest/production-readiness-report.json`

Key evidence: correctness gate `pass`; source-health release evidence `pass`; headline-soak release evidence `fail`; current production-readiness report reason `headline_soak_release_evidence_failed`; 5 recent executions; 4 promotable executions; 1 not-ready execution; latest headline-soak execution `.tmp/daemon-feed-semantic-soak/1779011264028` is `not_ready` with `latest_headline_soak_execution_not_promotable`.

Production-grade live headline freshness is not claimed until the aggregate headline-soak gate promotes a current execution.

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

Cloudflare Tunnel setup was completed after the prior blocker packet.

| Surface | Observed |
| --- | --- |
| Mac mini | `Benjamins-Mac-mini.local`, macOS 26.3 build 25D125, root disk 926Gi with 788Gi available, LAN IP `192.168.1.56` |
| Ubuntu A6 | `ssh humble`, host `ccibootstrap`, Ubuntu 24.04 kernel 6.17.0-22-generic, root disk 1.9T with 1.7T available, 58Gi memory with 56Gi available, LAN IP `192.168.1.198` |
| Public ingress | Cloudflare Tunnel on A6, tunnel `vhc-a6-public-beta`, id `1479d29e-4a0a-4e53-9aaf-b9984672ff9e` |
| Tunnel token | stored only at `/home/humble/.config/vhc/cloudflared.env`; file mode `600`, parent directory mode `700`; token value not printed or committed |
| A6 service state | `cloudflared` version `2026.5.0`, systemd service `active`; `sudo -n true` ready; Docker installed and `sudo docker ps` works |
| DNS authority | `carboncaste.io` nameservers are `eric.ns.cloudflare.com` and `riya.ns.cloudflare.com` |
| Requested app route | `https://venn.carboncaste.io` -> A6 `http://localhost:8080`; DNS resolves through Cloudflare and TLS works, currently `HTTP/2 502` until the origin app is deployed |
| Requested peer routes | `gun-a/b/c.venn.carboncaste.io` route to A6 `8765`, A6 `8766`, and Mac `192.168.1.56:8767`; DNS resolves, but TLS handshake fails because Cloudflare Free Universal SSL does not cover nested `*.venn.carboncaste.io` names |
| TLS-valid fallback peer routes | `gun-a/b/c.carboncaste.io` route to the same origins; DNS resolves through Cloudflare and TLS works, currently `HTTP/2 502` until the origin peer services are deployed |
| Router | not needed for the chosen tunnel path; Starlink CGNAT is bypassed by outbound A6 tunnel connections |

Required public topology is partially configured but not deployed or proven: Cloudflare routing exists, but the Web PWA and Gun relay services are not running behind the configured origins and no public WSS proof has passed.

## Mesh And Production App Canary

Required public WSS peers from the original target topology:

- `wss://gun-a.venn.carboncaste.io/gun`
- `wss://gun-b.venn.carboncaste.io/gun`
- `wss://gun-c.venn.carboncaste.io/gun`

TLS-valid fallback peers configured for the near-term Cloudflare Free proof path:

- `wss://gun-a.carboncaste.io/gun`
- `wss://gun-b.carboncaste.io/gun`
- `wss://gun-c.carboncaste.io/gun`

Status: routes configured, origins not deployed, public WSS proof not run, not claimed. The original nested peer hostnames require Cloudflare Advanced Certificate Manager or a custom certificate before they can satisfy WSS TLS.

Clean-tree Mesh evidence refreshed on commit `f56dc609fd102694d14d7626a4d3467d9f99a27a`:

- LUMA-gated write coverage: `pass`, artifact `.tmp/mesh-luma-gated-write-coverage/latest/mesh-luma-gated-write-coverage-report.json`
- Mesh aggregate: `blocked`, run `mesh-production-readiness-20260517T081752Z-42e9559c`, artifact `.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json`
- Passing Mesh source gates: topology, signed peer config, state resolution, disconnect, partition, read repair, canonical 30-minute soak, clock skew, conflict
- Canonical soak source: run `mesh-soak-20260517T082555Z-3053b8aa`; full duration satisfied; zero terminal failures; zero duplicate canonical writes; cleanup `pass`; all required write sample floors `pass`; `relay_open_sockets_file_descriptors` `pass`
- Aggregate blockers: `public-wss-deployment-proof`, `evidence-scrub-promotion`

Production app canary: `blocked`, run `production-app-canary-20260517T085915Z-6610ccfa`, artifact `.tmp/production-app-canary/latest/production-app-canary-report.json`. It failed closed with `mesh_not_release_ready`; downstream observations for production WSS relay config, app deployment shape, `/api/analyze`, news synthesis publication, point stance write/readback, and story thread/comment were not run because Mesh is blocked and `https://venn.carboncaste.io` is not deployed.

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

## Exact Remaining Blockers

| Blocker | Required human action |
| --- | --- |
| `public_headline_soak_release_evidence_failed` | Restore live headline-soak release evidence so `pnpm check:storycluster:production-readiness` returns `release_ready`; current failure is `latest_headline_soak_execution_not_promotable` from `.tmp/daemon-feed-semantic-soak/1779011264028`. |
| `public_origin_services_not_deployed` | Deploy the Web PWA on A6 `localhost:8080`, Gun peers on A6 `localhost:8765` and `localhost:8766`, and the Mac mini peer on `192.168.1.56:8767`; current Cloudflare routes return `502` because origins are not serving yet. |
| `nested_peer_tls_certificate_missing` | Either enable Cloudflare Advanced Certificate Manager/custom certificate for `*.venn.carboncaste.io`, or use the TLS-valid fallback peers `gun-a/b/c.carboncaste.io` for the public Mesh proof. |
| `public_wss_deployment_proof_missing` | After origins are deployed, publish signed public peer config, set CSP connect-src, verify health/restart persistence, and rerun public Mesh proof without threshold dilution. |
| `mesh_release_ready_not_proven` | Run Mesh public WSS proof and production-readiness checks to `release_ready`; current aggregate blockers are `public-wss-deployment-proof` and `evidence-scrub-promotion`. |
| `production_app_canary_not_proven` | After Mesh `release_ready`, run the production app canary against `https://venn.carboncaste.io` with real downstream observations. |

Current decision: `blocked_engineering_evidence`.
