# MVP Public Beta State Of Play

Date: 2026-05-18
Updated at: 2026-05-18T01:17:56Z
Branch: `coord/mvp-production-grade-distribution-ready-v1`
Target PR: `#630`
Base commit: `bb120a2e376784475202d59552f4b04531ee798b`
Head at start of this update: `20785c35c8fe1c03c2e36f3424097f630ad2d95c`

## Current Decision

`blocked_engineering_evidence`

The launch infrastructure access blocker moved materially: DNS authority is now Cloudflare, the A6 Cloudflare Tunnel is installed and active, the tunnel token is stored only on the Ubuntu host with restrictive permissions, and public routes exist for the app and WSS peer origins. This is not yet a public beta launch clearance. The app and peer services behind the tunnel are not deployed, the original nested peer hostnames fail TLS on Cloudflare Free Universal SSL, StoryCluster headline freshness is still blocked, Mesh is not `release_ready`, and the production app canary has not passed.

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
| `curl -I https://venn.carboncaste.io` | `HTTP/2 502`; TLS works, origin service is not up on A6 `localhost:8080`. |
| `curl -I https://gun-a/b/c.venn.carboncaste.io` | TLS handshake failure; nested wildcard cert coverage is unavailable on Cloudflare Free Universal SSL. |
| `curl -I https://gun-a/b/c.carboncaste.io` | `HTTP/2 502`; TLS works, origin peer services are not up yet. |
| `ssh humble 'sudo systemctl is-active cloudflared'` | `active` |
| `ssh humble 'sudo -n true'` | ready |
| `ssh humble 'sudo docker ps'` | ready |

`502` is expected until the Web PWA and Gun relay services are deployed behind the configured origins.

## Claims Allowed Now

- Cloudflare is authoritative for `carboncaste.io`.
- The A6 Cloudflare Tunnel is created, tokenized, installed as a systemd service, and active.
- The app hostname and six peer hostnames resolve through Cloudflare.
- TLS works for `https://venn.carboncaste.io` and the fallback first-level peer hostnames.
- A6 sudo and Docker are ready.
- The Mac mini is reachable from A6 over LAN at `192.168.1.56`.

## Explicit Non-Claims

- Do not claim `go_for_public_beta_launch`.
- Do not claim StoryCluster `release_ready`.
- Do not claim Mesh `release_ready`.
- Do not claim production app canary pass.
- Do not claim public WSS proof passed.
- Do not claim `https://venn.carboncaste.io` serves the deployed app yet.
- Do not claim the original nested WSS hostnames have valid TLS.
- Do not claim LUMA Silver, verified-human, one-human-one-vote, Sybil resistance, legal approval, commercial approval, native App Store readiness, or TestFlight readiness.

## Remaining Blockers

| Blocker | Type | Current fact | Required next action |
| --- | --- | --- | --- |
| `public_headline_soak_release_evidence_failed` | Engineering | StoryCluster headline-soak release evidence remains blocked; prior latest soak had zero sampled stories and zero audited pairs. | Fix the article-text/feed path and rerun `pnpm collect:storycluster:headline-soak` plus `pnpm check:storycluster:production-readiness` until `release_ready`. |
| `public_origin_services_not_deployed` | Engineering/infrastructure | Cloudflare routes exist, but origins on A6 `8080`, A6 `8765/8766`, and Mac `8767` are not serving the app/peers yet; Cloudflare returns `502`. | Deploy the Web PWA and the three Gun peer services with restart persistence and health checks. |
| `nested_peer_tls_certificate_missing` | External/Cloudflare config | `gun-a/b/c.venn.carboncaste.io` resolve but fail TLS handshake because nested wildcard coverage requires Cloudflare Advanced Certificate Manager or a custom certificate. | Either enable ACM/custom cert for `*.venn.carboncaste.io` or switch the Mesh public proof to the TLS-valid fallback peers `gun-a/b/c.carboncaste.io`. |
| `public_wss_deployment_proof_missing` | Engineering | No public WSS peer proof has been run against deployed services. | Run public WSS proof with real peer config URL, config id, public key, peers, CSP connect-src, minimum peer count 3, quorum 2, and `VH_MESH_PUBLIC_APP_URL=https://venn.carboncaste.io`. |
| `mesh_release_ready_not_proven` | Engineering | Mesh aggregate remains blocked until public WSS proof and evidence-scrub promotion pass. | Run `pnpm test:mesh:luma-gated-write-coverage -- --mode local-e2e`, then `VH_MESH_DEPLOYED_WSS_PUBLIC_PROOF=true VH_MESH_SOAK_DURATION_MS=1800000 ... pnpm check:mesh:production-readiness`. |
| `production_app_canary_not_proven` | Engineering | Canary still fails closed because Mesh is not `release_ready` and the public app is not deployed. | After Mesh `release_ready`, run `pnpm check:production-app-canary -- --mesh-report .tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json` against `https://venn.carboncaste.io`. |

## Recommended Next Execution Path

1. Use the TLS-valid fallback peer URLs for the first public Mesh proof unless ACM/custom certs are enabled for the nested `*.venn.carboncaste.io` names.
2. Deploy A6 services behind `localhost:8080`, `localhost:8765`, and `localhost:8766`; deploy the Mac mini peer behind `192.168.1.56:8767`.
3. Verify public app HTTP and WebSocket upgrades through Cloudflare.
4. Fix StoryCluster headline-soak freshness to `release_ready`.
5. Generate signed public peer config and CSP connect-src for the final hostname set.
6. Run Mesh public WSS proof and production-readiness checks without lowering thresholds.
7. Run the production app canary only after Mesh is `release_ready`.
8. Update the PR from `blocked_engineering_evidence` only if StoryCluster, public feed proof, Mesh, production canary, and launch-control fields are all green.
