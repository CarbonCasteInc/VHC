# MVP Public Beta Launch Control Packet

Date: 2026-05-13
Updated at: 2026-05-20T11:26:16Z
Branch: `coord/mvp-production-grade-distribution-ready-v1`
Release-control base commit: `bb120a2e376784475202d59552f4b04531ee798b`
Production-grade readiness packet: `docs/reports/mvp-production-grade-distribution-readiness-2026-05-14.md`
State of Play summary: `docs/reports/mvp-public-beta-state-of-play-2026-05-18.md`
Node: `v20.20.2`
pnpm: `9.7.1`

## Final Status

`go_for_public_beta_launch`

The bounded Web PWA public-beta packet is green for the implemented MVP scope. Public ingress is Cloudflare Tunnel, `https://venn.carboncaste.io` serves the built Web PWA, `/api/analyze/*` is healthy against the remote analysis relay, the signed peer config points to the TLS-valid fallback public peers, StoryCluster is `release_ready`, the public feed browser smoke passes, Mesh is `release_ready`, and the production app canary passes with real downstream observations.

The original nested peer names `gun-a/b/c.venn.carboncaste.io` remain excluded from MVP proof because Cloudflare Free Universal SSL does not cover those nested names. The launch proof uses `gun-a/b/c.carboncaste.io`.

## Release Env

Release env path used without printing secrets:

`/Users/benjamintucker/Desktop/VHC/VHC-mvp-public-beta-go-no-go-v1/packages/e2e/.env.dev-small.local`

Presence-only verification found `OPENAI_API_KEY` and `ANALYSIS_RELAY_API_KEY`. Secrets were not printed or committed.

## Evidence Summary

| Evidence | Result | Artifact |
| --- | --- | --- |
| Public deployed Web PWA | `HTTP/2 200`; strict CSP for exact fallback WSS peers | `curl -I https://venn.carboncaste.io` |
| Public analysis health | `200 OK`; upstream `reachable`; model `gpt-5-nano` | `curl -i https://venn.carboncaste.io/api/analyze/health` |
| Signed public peer config | pass; config `public-beta-fallback-wss-v1`, minimum `3`, quorum `2`, exact peer order | `https://venn.carboncaste.io/mesh-peer-config.json` |
| Public peer health | `HTTP/2 200` for `gun-a/b/c.carboncaste.io/healthz` | curl evidence |
| Public WSS proof | pass with no failures | `.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json` |
| StoryCluster production readiness | `release_ready` | `.tmp/storycluster-production-readiness/latest/production-readiness-report.json` |
| StoryCluster headline soak | promotable; 5/5 pass; 30 sampled stories; 74 audited pairs; 30 corroborated bundles; 0 related-topic-only pairs | `.tmp/daemon-feed-semantic-soak/1779240135591/semantic-soak-summary.json` |
| Public Web PWA feed smoke | `pass`; public headlines, source labels, timestamps, refresh, scroll, detail, accepted synthesis, identity, stance, comments, reload persistence, and second-browser visibility | `.tmp/release-evidence/public-feed-browser-smoke/latest/public-feed-browser-smoke-summary.json` |
| Mesh production-readiness aggregate | `release_ready`; no release blockers; final evidence is rerun against the current PR head | `.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json` |
| Production app canary | `pass`; real downstream observations recorded; final evidence is rerun against the current PR head | `.tmp/production-app-canary/latest/production-app-canary-report.json` |
| Relay daemon-token rotation | pass; tokens rotated after earlier evidence-log exposure, stored outside git with mode `600`, not printed | A6 `/home/humble/.config/vhc/public-beta-relay-daemon-token-v2.env`; Mac mini `~/.config/vhc/public-beta-relay-daemon-token-v2.env` |

## Signed Peer Config

| Field | Value |
| --- | --- |
| Config URL | `https://venn.carboncaste.io/mesh-peer-config.json` |
| Config id | `public-beta-fallback-wss-v1` |
| Verification public key | `YJiBPKmsoq9_IZkBWOG8rMZJdFKTtUKiAkphraZsRnc.MQ19LAvrVK3a3Cv-9bEQs0SuoThSpWiGvmYM4haP62w` |
| Peers | `wss://gun-a.carboncaste.io/gun`, `wss://gun-b.carboncaste.io/gun`, `wss://gun-c.carboncaste.io/gun` |
| Minimum peer count | `3` |
| Quorum required | `2` |
| CSP `connect-src` | `'self' https://venn.carboncaste.io wss://gun-a.carboncaste.io wss://gun-b.carboncaste.io wss://gun-c.carboncaste.io` |

## StoryCluster Singleton And Bundle Policy

Singleton stories are acceptable feed items when they are genuinely one-off coverage. They should persist and remain eligible to become bundled later when a matching same-story/topic/event article arrives.

Release readiness does not force every story to be multi-source. It proves that overlap is handled correctly when overlap exists. The latest headline soak provides that corroboration evidence, and continuity telemetry remains recorded for retained topics, singleton-to-corroborated transitions, later attachments, and bundle growth across runs.

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

## Allowed Launch Copy

The approved bounded copy is in `docs/launch/public-beta-copy.md`.

## Forbidden Claims

- LUMA Silver.
- Verified-human identity.
- One-human-one-vote.
- Sybil resistance.
- Native App Store or TestFlight readiness.
- Legal approval; legal/external disposition is `not_required`.
- Commercial approval.
- Original nested `gun-a/b/c.venn.carboncaste.io` TLS validity.
- Private support desk or SLA.

## Decision Rule

`go_for_public_beta_launch` requires StoryCluster `release_ready`, deployed public feed browser smoke pass, Mesh `release_ready`, production app canary pass, public `https://venn.carboncaste.io` proof, exact public WSS proof, and all approval/owner fields to be green and recorded.

Current decision: `go_for_public_beta_launch`.

Remaining blockers: none for the bounded Web PWA public-beta launch packet.
