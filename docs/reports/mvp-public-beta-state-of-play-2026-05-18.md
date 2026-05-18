# MVP Public Beta State Of Play

Date: 2026-05-18
Updated at: 2026-05-18T19:00:31Z
Branch: `coord/mvp-production-grade-distribution-ready-v1`
Target PR: `#630`
Base commit: `bb120a2e376784475202d59552f4b04531ee798b`
Head at start of this update: `20785c35c8fe1c03c2e36f3424097f630ad2d95c`

## Current Decision

`blocked_engineering_evidence`

The launch infrastructure access blocker moved materially: DNS authority is Cloudflare, the A6 Cloudflare Tunnel is active, the token remains host-local, `https://venn.carboncaste.io` now serves the Web PWA, `/api/analyze/*` is healthy, `/mesh-peer-config.json` is signed, and the TLS-valid fallback peers `gun-a/b/c.carboncaste.io` return `200` on `/healthz`. This is not yet a public beta launch clearance. The public feed browser smoke fails with `public-feed-headlines-timeout`, live StoryCluster headline-soak evidence is still blocked by timed-out/hung browser semantic readback after live publication, Mesh is not `release_ready`, and the production app canary has not passed.

## Work Completed

| Area | Result |
| --- | --- |
| DNS authority | `carboncaste.io` nameservers changed to Cloudflare and propagated: `eric.ns.cloudflare.com`, `riya.ns.cloudflare.com`. |
| Public ingress | Cloudflare Tunnel selected to bypass Starlink CGNAT and avoid home-router inbound 80/443 requirements. |
| Tunnel | Created `vhc-a6-public-beta`, tunnel id `1479d29e-4a0a-4e53-9aaf-b9984672ff9e`. |
| Token handling | Stored on A6 at `/home/humble/.config/vhc/cloudflared.env`; token value was not printed or committed. |
| Token permissions | `/home/humble/.config/vhc` mode `700`; `/home/humble/.config/vhc/cloudflared.env` mode `600`; owner `humble:humble`. |
| A6 host admin | `sudo -n true` is ready on `humble`. |
| A6 Docker | Docker is installed and `sudo docker ps` works. |
| A6 cloudflared | `cloudflared` version `2026.5.0`; systemd service is active. |
| A6 to Mac reachability | A6 can ping Mac mini LAN IP `192.168.1.56` with 0% loss. |

## Host Packet

| Field | Value |
| --- | --- |
| Ingress choice | Cloudflare Tunnel |
| Ingress host | `humble` / `ccibootstrap` |
| Ubuntu ingress LAN IP | `192.168.1.198` |
| Mac mini LAN IP | `192.168.1.56` |
| Public IPv4 seen before tunnel selection | `129.222.193.128` |
| Router | Not needed for the selected tunnel path; Starlink CGNAT is bypassed by outbound A6 tunnel connections. |
| TLS path | Cloudflare edge TLS via Tunnel |
| Release env path | `/Users/benjamintucker/Desktop/VHC/VHC-mvp-public-beta-go-no-go-v1/packages/e2e/.env.dev-small.local` |

## Configured Cloudflare Routes

Requested hostnames:

| Public hostname | Origin |
| --- | --- |
| `https://venn.carboncaste.io` | A6 `http://localhost:8080` |
| `wss://gun-a.venn.carboncaste.io/gun` | A6 `http://localhost:8765` |
| `wss://gun-b.venn.carboncaste.io/gun` | A6 `http://localhost:8766` |
| `wss://gun-c.venn.carboncaste.io/gun` | Mac mini `http://192.168.1.56:8767` |

TLS-valid fallback peer hostnames:

| Public hostname | Origin |
| --- | --- |
| `wss://gun-a.carboncaste.io/gun` | A6 `http://localhost:8765` |
| `wss://gun-b.carboncaste.io/gun` | A6 `http://localhost:8766` |
| `wss://gun-c.carboncaste.io/gun` | Mac mini `http://192.168.1.56:8767` |

The fallback hostnames are first-level subdomains under `carboncaste.io`, so they are covered by Cloudflare Free Universal SSL. They should be used for the near-term Mesh public WSS proof unless Cloudflare Advanced Certificate Manager or a custom certificate is enabled for `*.venn.carboncaste.io`.

## Verification Snapshot

| Probe | Observed result |
| --- | --- |
| `dig +short NS carboncaste.io` | `eric.ns.cloudflare.com.`, `riya.ns.cloudflare.com.` |
| `dig +short venn.carboncaste.io` | Cloudflare edge IPs `104.21.86.178`, `172.67.223.77` |
| `dig +short gun-a/b/c.venn.carboncaste.io` | Cloudflare edge IPs `104.21.86.178`, `172.67.223.77` |
| `dig +short gun-a/b/c.carboncaste.io` | Cloudflare edge IPs `104.21.86.178`, `172.67.223.77` |
| `curl -I https://venn.carboncaste.io` | `HTTP/2 200`; Web PWA origin is serving through Cloudflare with CSP `connect-src 'self' https://venn.carboncaste.io wss://gun-a.carboncaste.io wss://gun-b.carboncaste.io wss://gun-c.carboncaste.io`. |
| `curl -I https://gun-a/b/c.venn.carboncaste.io` | TLS handshake failure; nested wildcard cert coverage is unavailable on Cloudflare Free Universal SSL. |
| `curl -I https://gun-a/b/c.carboncaste.io/healthz` | `HTTP/2 200`; fallback first-level peer health endpoints are reachable through Cloudflare. |
| `curl -i https://venn.carboncaste.io/api/analyze/health` | `200 OK`; `{"ok":true,"model":"gpt-5-nano","upstream":"reachable"}`. |
| `curl -i https://venn.carboncaste.io/mesh-peer-config.json` | `200 OK`; signed config `public-beta-fallback-wss-v1`, minimum peers `3`, quorum `2`, peers `gun-a/b/c.carboncaste.io`, signer public key recorded in PR evidence. |
| `ssh humble 'sudo systemctl is-active cloudflared'` | `active` |
| `ssh humble 'sudo -n true'` | ready |
| `ssh humble 'sudo docker ps'` | ready |

`502` is expected until the Web PWA and Gun relay services are deployed behind the configured origins.

## Claims Allowed Now

- Cloudflare is authoritative for `carboncaste.io`.
- The A6 Cloudflare Tunnel is created, tokenized, installed as a systemd service, and active.
- The app hostname and six peer hostnames resolve through Cloudflare.
- `https://venn.carboncaste.io` serves the deployed Web PWA and strict CSP for the fallback peers.
- TLS and `/healthz` work for the fallback first-level peer hostnames.
- Public `/api/analyze/config` and `/api/analyze/health` are reachable and remote upstream health is `ok`.
- Signed public peer config is served at `/mesh-peer-config.json`.
- A6 sudo and Docker are ready.
- The Mac mini is reachable from A6 over LAN at `192.168.1.56`.

## Explicit Non-Claims

- Do not claim `go_for_public_beta_launch`.
- Do not claim StoryCluster `release_ready`.
- Do not claim Mesh `release_ready`.
- Do not claim production app canary pass.
- Do not claim public WSS proof passed.
- Do not claim public Web PWA feed UX passed; the public smoke failed with `public-feed-headlines-timeout`.
- Do not claim the original nested WSS hostnames have valid TLS.
- Do not claim LUMA Silver, verified-human, one-human-one-vote, Sybil resistance, legal approval, commercial approval, native App Store readiness, or TestFlight readiness.

## Remaining Blockers

| Blocker | Type | Current fact | Required next action |
| --- | --- | --- | --- |
| `public_headline_soak_release_evidence_failed` | Engineering | Correctness and source-health pass, and live publication now writes bundles, but recent public headline-soak executions still fail or hang in browser semantic readback; latest completed failure is `.tmp/daemon-feed-semantic-soak/20260518T174409Z-release-root-trend-v6` with `spawnSync pnpm ETIMEDOUT`. | Fix the browser/feed hydration/readback path and rerun `pnpm collect:storycluster:headline-soak` plus `pnpm check:storycluster:production-readiness` until `release_ready`; do not weaken singleton or audited-pair thresholds. |
| `public_feed_browser_smoke_failed` | Engineering | Public smoke artifact `.tmp/release-evidence/public-feed-browser-smoke/20260518T184701Z-public/public-feed-browser-smoke-summary.json` is `fail` with `public-feed-headlines-timeout`; terminal output also showed system-writer signature validation failures for public news index rows. | Align the deployed Web PWA system-writer pin with the writer used for public mesh publication, then rerun the public-feed browser smoke against `https://venn.carboncaste.io`. |
| `nested_peer_tls_certificate_missing` | External/Cloudflare config | `gun-a/b/c.venn.carboncaste.io` resolve but fail TLS handshake because nested wildcard coverage requires Cloudflare Advanced Certificate Manager or a custom certificate. | Either enable ACM/custom cert for `*.venn.carboncaste.io` or switch the Mesh public proof to the TLS-valid fallback peers `gun-a/b/c.carboncaste.io`. |
| `mesh_release_ready_not_proven` | Engineering | Public WSS peer-config proof ran and produced `.tmp/mesh-production-readiness/mesh-public-wss-proof-1779130008482-f3d66cf8/mesh-production-readiness-report.json` with no failures and status `review_required`, but Mesh aggregate `release_ready` has not been rerun green. | Run `pnpm test:mesh:luma-gated-write-coverage -- --mode local-e2e`, then `VH_MESH_DEPLOYED_WSS_PUBLIC_PROOF=true VH_MESH_SOAK_DURATION_MS=1800000 ... pnpm check:mesh:production-readiness` from a clean tracked tree. |
| `production_app_canary_not_proven` | Engineering | Canary still cannot be claimed because Mesh is not `release_ready` and public feed smoke is failing. | After Mesh `release_ready` and public feed smoke pass, run `pnpm check:production-app-canary -- --mesh-report .tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json` against `https://venn.carboncaste.io`. |

## Recommended Next Execution Path

1. Use the TLS-valid fallback peer URLs for the first public Mesh proof unless ACM/custom certs are enabled for the nested `*.venn.carboncaste.io` names.
2. Fix the public mesh writer-signature mismatch and public browser feed hydration so the deployed Web PWA renders current headlines.
3. Fix StoryCluster headline-soak browser semantic readback to `release_ready` while preserving singleton persistence and later bundling.
4. Rerun Mesh production-readiness checks without lowering thresholds.
5. Run the production app canary only after Mesh is `release_ready` and public feed smoke passes.
6. Update the PR from `blocked_engineering_evidence` only if StoryCluster, public feed proof, Mesh, production canary, and launch-control fields are all green.
