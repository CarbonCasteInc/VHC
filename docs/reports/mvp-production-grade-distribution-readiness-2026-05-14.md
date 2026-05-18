# MVP Production-Grade Distribution Readiness Packet

Date: 2026-05-14
Updated at: 2026-05-18T19:00:31Z
Branch: `coord/mvp-production-grade-distribution-ready-v1`
Base commit: `bb120a2e376784475202d59552f4b04531ee798b`
Target PR: `#630`
Node: `v20.20.2`
pnpm: `9.7.1`

## Final Status

`blocked_engineering_evidence`

Current StoryCluster production readiness is `blocked`: correctness and source-health release evidence pass, and the code now preserves singleton stories so they can later be upgraded into bundles, but public headline-soak evidence still fails because browser semantic readback hangs or times out after live publication. The deployed public Web PWA, `/api/analyze/*`, signed peer config, and fallback peer health endpoints are reachable through Cloudflare. Public feed browser smoke against `https://venn.carboncaste.io` failed with `public-feed-headlines-timeout`; terminal output also showed system-writer signature validation failures for public news index rows. Public WSS peer-config proof ran with no failures and status `review_required`, but Mesh is not `release_ready`, and the production app canary has not passed. StoryCluster `release_ready`, Mesh `release_ready`, production app canary pass, and public feed UX pass are not claimed.

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

Key evidence: correctness gate `pass`; source-health release evidence `pass`; headline-soak release evidence `fail`; current production-readiness report reason `headline_soak_release_evidence_failed`. Latest completed failed public soak: `.tmp/daemon-feed-semantic-soak/20260518T174409Z-release-root-trend-v6/semantic-soak-summary.json`, `not_ready`, `auditError: spawnSync pnpm ETIMEDOUT`. A later optimized attempt published live bundles but hung in browser readback and was stopped before a summary artifact was produced. This is not a singleton-policy failure; singleton persistence and later upgrade are covered by `services/storycluster-engine/src/remoteContract.test.ts`.

Production-grade live headline freshness is not claimed until the aggregate headline-soak gate promotes current public executions and deployed public feed smoke renders current headlines.

## Public Web PWA Feed Proof

Command:

```bash
VH_PUBLIC_FEED_APP_URL=http://127.0.0.1:2048/ \
VH_PUBLIC_FEED_GUN_PEER_URL=http://127.0.0.1:7777/gun \
VH_PUBLIC_FEED_SMOKE_READY_TIMEOUT_MS=600000 \
VH_PUBLIC_FEED_SMOKE_ANALYSIS_TIMEOUT_MS=240000 \
pnpm test:public-feed:browser-smoke
```

Local public/remote result: `pass`

Artifact directory: `.tmp/release-evidence/public-feed-browser-smoke/1778996451746`

Summary: `.tmp/release-evidence/public-feed-browser-smoke/1778996451746/public-feed-browser-smoke-summary.json`

Screenshots:

- `.tmp/release-evidence/public-feed-browser-smoke/1778996451746/01-feed-initial.png`
- `.tmp/release-evidence/public-feed-browser-smoke/1778996451746/02-feed-after-refresh.png`
- `.tmp/release-evidence/public-feed-browser-smoke/1778996451746/03-feed-after-scroll.png`
- `.tmp/release-evidence/public-feed-browser-smoke/1778996451746/04-story-detail-synthesis.png`
- `.tmp/release-evidence/public-feed-browser-smoke/1778996451746/05-story-comment.png`
- `.tmp/release-evidence/public-feed-browser-smoke/1778996451746/06-reload-persistence.png`

Observed local proof: 32 latest-index entries, 16 story readbacks, 15 visible current headlines, 15 source-label rows, 15 timestamp rows, refresh and scroll pass, story detail opens, accepted synthesis visible, identity creation passes, point stance write/readback passes, story comments pass, reload persistence passes, and second-browser vote/comment visibility passes.

Deployed public result: `fail`

Command:

```bash
VH_PUBLIC_FEED_APP_URL=https://venn.carboncaste.io \
VH_PUBLIC_FEED_GUN_PEER_URL=wss://gun-a.carboncaste.io/gun \
pnpm test:public-feed:browser-smoke
```

Artifact: `.tmp/release-evidence/public-feed-browser-smoke/20260518T184701Z-public/public-feed-browser-smoke-summary.json`

Observed failure: `public-feed-headlines-timeout`; terminal output showed `system-writer-validation-failed` / `signature-invalid` for public news index rows before timeout.

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
| Requested app route | `https://venn.carboncaste.io` -> A6 `http://localhost:8080`; DNS resolves through Cloudflare, TLS works, and the deployed Web PWA returns `HTTP/2 200` with exact fallback-peer CSP |
| Requested peer routes | `gun-a/b/c.venn.carboncaste.io` route to A6 `8765`, A6 `8766`, and Mac `192.168.1.56:8767`; DNS resolves, but TLS handshake fails because Cloudflare Free Universal SSL does not cover nested `*.venn.carboncaste.io` names |
| TLS-valid fallback peer routes | `gun-a/b/c.carboncaste.io` route to the same origins; DNS resolves through Cloudflare, TLS works, and `/healthz` returns `HTTP/2 200` for all three |
| Router | not needed for the chosen tunnel path; Starlink CGNAT is bypassed by outbound A6 tunnel connections |

Required public topology is now partially deployed and partly proven: the Web PWA, analysis routes, signed peer config, and fallback peer health endpoints are public. Public feed UX still fails, and Mesh aggregate release readiness has not passed.

## Mesh And Production App Canary

Required public WSS peers from the original target topology:

- `wss://gun-a.venn.carboncaste.io/gun`
- `wss://gun-b.venn.carboncaste.io/gun`
- `wss://gun-c.venn.carboncaste.io/gun`

TLS-valid fallback peers configured for the near-term Cloudflare Free proof path:

- `wss://gun-a.carboncaste.io/gun`
- `wss://gun-b.carboncaste.io/gun`
- `wss://gun-c.carboncaste.io/gun`

Status: fallback routes configured and peer health endpoints reachable; public WSS peer-config proof ran with no failures and status `review_required`. The original nested peer hostnames still require Cloudflare Advanced Certificate Manager or a custom certificate before they can satisfy WSS TLS.

Clean-tree Mesh evidence refreshed on commit `f56dc609fd102694d14d7626a4d3467d9f99a27a`:

- LUMA-gated write coverage: `pass`, artifact `.tmp/mesh-luma-gated-write-coverage/latest/mesh-luma-gated-write-coverage-report.json`
- Mesh aggregate: `blocked`, run `mesh-production-readiness-20260517T081752Z-42e9559c`, artifact `.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json`
- Passing Mesh source gates: topology, signed peer config, state resolution, disconnect, partition, read repair, canonical 30-minute soak, clock skew, conflict
- Canonical soak source: run `mesh-soak-20260517T082555Z-3053b8aa`; full duration satisfied; zero terminal failures; zero duplicate canonical writes; cleanup `pass`; all required write sample floors `pass`; `relay_open_sockets_file_descriptors` `pass`
- Public WSS peer-config proof: `review_required`, no failures, run `mesh-public-wss-proof-1779130008482-f3d66cf8`, artifact `.tmp/mesh-production-readiness/mesh-public-wss-proof-1779130008482-f3d66cf8/mesh-production-readiness-report.json`
- Aggregate blockers still require a clean final Mesh readiness run; Mesh `release_ready` is not claimed.

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
| `public_headline_soak_release_evidence_failed` | Fix browser semantic readback after live publication and rerun headline-soak readiness; latest completed failed artifact is `.tmp/daemon-feed-semantic-soak/20260518T174409Z-release-root-trend-v6/semantic-soak-summary.json` with `spawnSync pnpm ETIMEDOUT`. |
| `public_feed_browser_smoke_failed` | Fix deployed public feed headline rendering/signature validation; current deployed artifact `.tmp/release-evidence/public-feed-browser-smoke/20260518T184701Z-public/public-feed-browser-smoke-summary.json` failed with `public-feed-headlines-timeout`. |
| `nested_peer_tls_certificate_missing` | Either enable Cloudflare Advanced Certificate Manager/custom certificate for `*.venn.carboncaste.io`, or use the TLS-valid fallback peers `gun-a/b/c.carboncaste.io` for the public Mesh proof. |
| `mesh_release_ready_not_proven` | Run the final clean-tree Mesh production-readiness sequence using the public WSS proof artifact; do not claim `release_ready` from the `review_required` public proof alone. |
| `production_app_canary_not_proven` | After StoryCluster, public feed smoke, and Mesh are green, run the production app canary against `https://venn.carboncaste.io` with real downstream observations. |

Current decision: `blocked_engineering_evidence`.
