# MVP Production-Grade Distribution Readiness

Date: 2026-05-14
Updated at: 2026-05-20T11:26:16Z
Branch: `coord/mvp-production-grade-distribution-ready-v1`
Base commit: `bb120a2e376784475202d59552f4b04531ee798b`
Commit-sensitive evidence is rerun from the final PR head after this documentation update.
Launch control packet: `docs/reports/mvp-public-beta-launch-control-2026-05-13.md`
Node: `v20.20.2`
pnpm: `9.7.1`

## Final Status

`go_for_public_beta_launch`

The production-grade distribution blockers for the implemented Web PWA public-beta scope are cleared. The deployment is real infrastructure behind Cloudflare Tunnel, not a fixture stack or analysis stub. The final public proof uses the TLS-valid fallback peers `gun-a/b/c.carboncaste.io`.

## Release Stack

| Surface | Evidence |
| --- | --- |
| Web PWA origin | A6 `127.0.0.1:8080`, public via `https://venn.carboncaste.io`, serving built PWA assets and origin routes. |
| Public app routes | `/mesh-peer-config.json`, `/api/analyze/config`, `/api/analyze/health`, `/api/analyze`, and `/article-text`. |
| Relay A | A6 `127.0.0.1:8765`, public `wss://gun-a.carboncaste.io/gun`, `/healthz`, `/readyz`, `/metrics`. |
| Relay B | A6 `127.0.0.1:8766`, public `wss://gun-b.carboncaste.io/gun`, `/healthz`, `/readyz`, `/metrics`. |
| Relay C | Mac mini `0.0.0.0:8767`, public `wss://gun-c.carboncaste.io/gun`, `/healthz`, `/readyz`, `/metrics`. |
| Relay persistence | A6 relays use host-backed `/home/humble/.local/share/vhc/vhc-relay-a/data` and `/home/humble/.local/share/vhc/vhc-relay-b/data`; Mac relay uses `~/Library/Application Support/VHC/public-beta/relay-c`. |
| Relay auth | `VH_RELAY_ALLOWED_ORIGINS=https://venn.carboncaste.io`; daemon tokens rotated after evidence-log exposure and stored outside git with mode `600`. |
| Analysis | Release env path `/Users/benjamintucker/Desktop/VHC/VHC-mvp-public-beta-go-no-go-v1/packages/e2e/.env.dev-small.local`; public `/api/analyze/health` returned `200 OK`, upstream `reachable`. |

## Evidence Matrix

| Gate | Status | Artifact |
| --- | --- | --- |
| StoryCluster production readiness | `release_ready` | `.tmp/storycluster-production-readiness/latest/production-readiness-report.json` |
| Headline soak release evidence | `pass`; latest execution promotable | `.tmp/daemon-feed-semantic-soak/1779240135591/semantic-soak-summary.json` |
| Public feed browser smoke | `pass` | `.tmp/release-evidence/public-feed-browser-smoke/latest/public-feed-browser-smoke-summary.json` |
| Public WSS peer config proof | pass with no failures | `.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json` |
| Mesh production readiness | `release_ready`; no release blockers; final evidence is rerun against the current PR head | `.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json` |
| Production app canary | `pass`; final evidence is rerun against the current PR head | `.tmp/production-app-canary/latest/production-app-canary-report.json` |
| Public app edge | `HTTP/2 200` | `curl -I https://venn.carboncaste.io` |
| Public peer health | `HTTP/2 200` for `gun-a/b/c.carboncaste.io/healthz` | curl evidence |

## StoryCluster Readiness

The latest headline soak is promotable:

- 5 runs, 5 passes, 0 failures.
- 30 sampled stories.
- 74 audited pairs.
- 30 corroborated bundles.
- 0 related-topic-only pairs.
- Average audited pairs per sampled story: `2.5214285714285714`.
- Average unique source count: `9`.

Singleton stories remain valid and are not penalized merely for being one-off public events. The release gate proves that overlapping stories bundle accurately when overlap exists, while continuity telemetry records retained topics, singleton-to-corroborated transitions, later attachments, and bundle growth across runs.

## Mesh And Canary

The signed peer config is:

- `https://venn.carboncaste.io/mesh-peer-config.json`
- config id `public-beta-fallback-wss-v1`
- public verification key `YJiBPKmsoq9_IZkBWOG8rMZJdFKTtUKiAkphraZsRnc.MQ19LAvrVK3a3Cv-9bEQs0SuoThSpWiGvmYM4haP62w`
- peers `wss://gun-a.carboncaste.io/gun`, `wss://gun-b.carboncaste.io/gun`, `wss://gun-c.carboncaste.io/gun`
- minimum peer count `3`
- quorum required `2`

The production app canary observed the deployed public app, exact WSS relay config, public `/api/analyze`, news synthesis publication, point stance write/readback, and story thread/comment behavior. The public feed browser smoke also verified reload persistence and second-browser visibility.

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

## Explicit Non-Claims

- No LUMA Silver claim.
- No verified-human claim.
- No one-human-one-vote claim.
- No Sybil-resistance claim.
- No native App Store or TestFlight readiness claim.
- No legal approval claim.
- No commercial approval claim.
- No nested `gun-a/b/c.venn.carboncaste.io` TLS validity claim.
- No private support desk or SLA claim.

## Remaining Blockers

None for the bounded Web PWA public-beta launch packet, provided final post-documentation verification is green on the pushed PR head.
