# MVP Public Beta State Of Play

Date: 2026-05-18
Updated at: 2026-05-20T02:55:00Z
Branch: `coord/mvp-production-grade-distribution-ready-v1`
Target PR: `#630`
Base commit: `bb120a2e376784475202d59552f4b04531ee798b`
Engineering evidence commit before this documentation update: `0a394a97c86e8950cff739c03bb3bfa5c139991e`

## Current Decision

`go_for_public_beta_launch`

The public-beta launch packet is now green for the implemented Web PWA MVP scope, using the Cloudflare Tunnel deployment and the TLS-valid first-level fallback peers `gun-a/b/c.carboncaste.io`. The final public proof must continue to use those fallback peer names unless Cloudflare Advanced Certificate Manager or a custom certificate is added for the nested `gun-a/b/c.venn.carboncaste.io` names.

This is a bounded public-beta clearance. It does not claim LUMA Silver, verified-human identity, one-human-one-vote, Sybil resistance, native App Store/TestFlight readiness, legal approval, commercial approval, a private support desk, or an SLA.

## Public Topology

| Surface | Current fact |
| --- | --- |
| DNS authority | Cloudflare is authoritative for `carboncaste.io`. |
| Ingress | A6 Cloudflare Tunnel `vhc-a6-public-beta`, id `1479d29e-4a0a-4e53-9aaf-b9984672ff9e`. |
| App route | `https://venn.carboncaste.io` -> A6 `http://localhost:8080`. |
| Public peer A | `wss://gun-a.carboncaste.io/gun` -> A6 `http://localhost:8765`. |
| Public peer B | `wss://gun-b.carboncaste.io/gun` -> A6 `http://localhost:8766`. |
| Public peer C | `wss://gun-c.carboncaste.io/gun` -> Mac mini `http://192.168.1.56:8767`. |
| TLS path | Cloudflare edge TLS through Tunnel. |
| Router | Not required; the tunnel bypasses Starlink CGNAT. |
| Release env | `/Users/benjamintucker/Desktop/VHC/VHC-mvp-public-beta-go-no-go-v1/packages/e2e/.env.dev-small.local`, presence verified without printing secrets. |

## Evidence Snapshot

| Evidence | Status | Artifact or probe |
| --- | --- | --- |
| Public app origin | `HTTP/2 200`; serves built Web PWA with exact fallback-peer CSP | `curl -I https://venn.carboncaste.io` |
| Analysis relay health | `200 OK`; upstream `reachable`; model `gpt-5-nano` | `curl -i https://venn.carboncaste.io/api/analyze/health` |
| Signed peer config | `public-beta-fallback-wss-v1`; peers exactly `gun-a/b/c.carboncaste.io`; minimum `3`; quorum `2`; signed by public key `YJiBPKmsoq9_IZkBWOG8rMZJdFKTtUKiAkphraZsRnc.MQ19LAvrVK3a3Cv-9bEQs0SuoThSpWiGvmYM4haP62w` | `https://venn.carboncaste.io/mesh-peer-config.json` |
| Public peer health | `HTTP/2 200` for `gun-a`, `gun-b`, and `gun-c` `/healthz` | curl evidence |
| Public WSS proof | pass with no failures against fallback peers | `.tmp/mesh-production-readiness/mesh-public-wss-proof-1779245639941-54195d30/mesh-production-readiness-report.json` |
| StoryCluster production readiness | `release_ready` | `.tmp/storycluster-production-readiness/latest/production-readiness-report.json` |
| Latest headline soak | promotable; 5/5 pass; 30 sampled stories; 74 audited pairs; 30 corroborated bundles; 0 related-topic-only pairs | `.tmp/daemon-feed-semantic-soak/1779240135591/semantic-soak-summary.json` |
| Public feed browser smoke | pass; 14 current public headlines visible; source labels, timestamps, detail, synthesis, identity, stance, comments, reload persistence, and second-browser visibility covered | `.tmp/release-evidence/public-feed-browser-smoke/latest/public-feed-browser-smoke-summary.json` |
| Mesh production readiness | `release_ready`; no release blockers; clean commit-sensitive evidence | `.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json` |
| Production app canary | `pass`; real downstream observations recorded | `.tmp/production-app-canary/latest/production-app-canary-report.json` |
| Relay daemon token rotation | rotated after earlier evidence-log exposure; tokens stored outside git with mode `600`; values were not printed | A6 `/home/humble/.config/vhc/public-beta-relay-daemon-token-v2.env`; Mac mini `~/.config/vhc/public-beta-relay-daemon-token-v2.env` |

## StoryCluster Semantics

Singleton stories are valid public feed items when no matching same-story/topic/event article is present. The release gate does not require every story to be bundled. It requires that when overlapping coverage exists, the bundler groups it accurately and avoids `related_topic_only` contamination.

The headline-soak release window is green because the latest execution produced corroborated bundles with sufficient audited-pair density and source diversity. Historical singleton and continuity telemetry is retained separately: the trend artifacts record retained topics, singleton-to-corroborated transitions, later attachments, and bundle growth across runs. Those continuity metrics are useful launch telemetry, but they are not used to reject legitimate one-off stories.

## Approval And Ownership

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
- No legal approval claim; legal/external review is recorded as `not_required`.
- No commercial approval claim.
- No nested `gun-a/b/c.venn.carboncaste.io` TLS validity claim.
- No private support desk or SLA claim.

## Remaining Blockers

None for the bounded Web PWA public-beta launch packet, provided final post-documentation verification is green on the pushed PR head.
