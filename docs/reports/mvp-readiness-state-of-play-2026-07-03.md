# MVP Readiness State Of Play - 2026-07-03

> Status: Readiness Review And Docs Alignment Audit
> Owner: VHC Core Engineering
> Last Reviewed: 2026-07-03
> Depends On: docs/foundational/STATUS.md, docs/ops/public-beta-launch-readiness-closeout.md, docs/plans/VENN_NEWS_MVP_ROADMAP_2026-04-20.md, docs/reports/phase5-scope-a-driver-verdict-2026-07-02.md

## Reviewed Baseline

- Current `main`: `215b5c8f` (`Close out next-owner diagnostics and LUMA gates (#701)`).
- Scope: repo-side documentation, readiness state, and next-step alignment only.
- No A6 service action, relay/publisher restart, retention, compaction, deploy,
  or live data mutation was performed for this review.

## Current Verdict

The MVP is closer to a constrained public beta than it was before the outage
work, but it is not ready for a broader readiness claim yet.

The critical distinction is lane separation:

- Scope A raw public-news publication is recovered and fresh, but sustained
  stability is not proven. The current heap-growth verdict is
  `heap_driver_off_graph_likely`, so publisher-visible retention and relay
  compaction are not the next fixes.
- The Web PWA MVP release machinery is materially stronger: public-beta
  closeout, compliance, LUMA public-beta profile, forbidden-claim, production
  profile, telemetry source-discipline, and release-gate packets are all named
  deterministic surfaces.
- LUMA is public-beta/beta-local only. It now has stronger controls, UI, and
  telemetry discipline, but it still does not support production-attestation,
  Silver, verified-human, one-human-one-vote, Sybil-resistance, cryptographic
  residency, or `<TrustClaim>` claims.
- Public WSS Mesh `release_ready`, full production app readiness, accepted
  synthesis/storyline production claims, and legal/commercial launch approval
  remain separate downstream gates.

## Evidence Read

### Scope A

The post-outage driver verdict in
`docs/reports/phase5-scope-a-driver-verdict-2026-07-02.md` rejects graph live
bytes as the heap driver: relay heap rose at about `11 MiB/h` while graph live
bytes rose at about `0.008 MiB/h`, with tombstoned souls at `0` and total graph
souls too small to explain the heap slope.

The early-capture artifact did not appear because the observed heap stayed near
`300 MiB`, below the configured `~800 MiB` trigger. That is threshold math, not
a repeat of the old trip-time zero-byte capture failure.

### Alerting

The repo now contains the host-local public feed alert watch and runbook, but
A6 enablement is still operator-owned. The alert timer must not be enabled
without a reachable delivery channel; doing that would recreate the outage #2
silence failure under a different mechanism.

### Release Gates

The release evidence contract remains:

- `pnpm check:mvp-release-gates`
- `pnpm check:mvp-closeout`
- `pnpm check:public-beta-launch-closeout`
- `pnpm check:launch-content-snapshot`
- `pnpm check:public-beta-compliance`
- `pnpm docs:check`

A public-beta release note needs a fresh packet on the release commit. Green CI
on #701 is useful merge evidence, not a substitute for the final release packet.

### LUMA

The current LUMA lane is public-beta hardening:

- M1.B identity controls and `/account/identity` are implemented at MVP scope;
- M1.C profile hardening is locked by `pnpm check:luma-production-profile`;
- M1.D forbidden claims are locked by `pnpm check:luma-forbidden-claims`;
- M1.E telemetry source discipline and fixture replay are locked by
  `pnpm check:luma-telemetry-redaction`;
- full spec `§21.4` recorded product replay remains a prerequisite before
  `<TrustClaim>`.

## Right Next Steps

1. Build the Scope A early-capture threshold-retune PR.
   - Lower or profile the diagnostic threshold so the next climb produces a
     secret-safe heap summary before the heap ceiling is relevant.
   - Assert the intended per-relay capture stagger in repo-side checks
     (`relay-a=500/700 MiB`, `relay-b=520/720 MiB`, `relay-c=540/740 MiB`).
   - Add or tighten the watch/liveness check that reports when early capture is
     expected but no `.heap-summary.json` appears after threshold.
   - Keep graph metrics as the negative control.

2. Keep retention and compaction off the board.
   - Current evidence does not support story-body retention as the primary
     driver.
   - Current evidence does not support tombstone/link-only graph growth as the
     primary driver.
   - Do not build eviction, publisher clear, or relay compaction until a
     secret-safe retainer summary names the owner.

3. Complete the operator-owned A6 checks.
   - Investigate the all-relay restart around `2026-07-03T13:04Z`; it happened
     below every known ceiling, so threshold math should not be trusted until
     the cause is known.
   - Configure and enable the public feed alert channel only after webhook or
     email delivery is reachable and test-fired.

4. Produce the final MVP release packet on the intended release commit.
   - Treat a missing or failing packet as `ship_blocker`.
   - Keep accepted synthesis, public WSS Mesh, production app, and LUMA
     production-assurance claims out of MVP copy unless their separate gates
     pass.

5. Triage old open/draft PRs before using them as readiness evidence.
   - Open PRs predating the current public-beta state should be classified as
     `still-valid`, `superseded`, or `conflicts-with-current-claims-posture`
     before refresh or closure.

## Open PR Triage Snapshot

Read from GitHub on 2026-07-03 after refreshing local `main`.

| PR | State | Current disposition |
| --- | --- | --- |
| #631 `Stabilize public analysis frame pipeline` | Draft, clean, based on `coord/mvp-production-grade-distribution-ready-v1` | Revalidate before use. It predates the current Scope A raw-only/off-graph verdict and is not a release blocker by itself. |
| #629 `MVP public beta go/no-go approval hold` | Draft, dirty against `main` | Superseded as current go/no-go evidence until refreshed against the current release packet and claim boundaries. |
| #544 `Align docs after report intake admin merge` | Draft, dirty against `main` | Superseded by later docs alignment unless a specific surviving delta is cherry-picked after review. |
| #525 `Document VHC automation teardown retrospective` | Open, behind `main` | Likely still useful historical docs work, but not MVP readiness-critical. Refresh or close deliberately. |
| #524 `Wire bundle synthesis daemon spine` | Draft, dirty against `main` | Superseded by later bundle synthesis and Scope A raw-only launch posture unless re-scoped. |
| #516 `Move related links into publish-time bundle enrichment` | Open, dirty against `main` | Revalidate as post-beta enrichment; do not treat as current MVP blocker. |
| #512 `fix: recover source health from stale retries` | Open, dirty against `main` | Revalidate against current source-health runtime policy before merge consideration. |

## Non-Goals For The Next Readiness Push

- No live A6 action without explicit operator authorization.
- No public schema epoch change.
- No provider/profile promotion.
- No production verifier deployment.
- No Silver, verified-human, one-human-one-vote, Sybil-resistance,
  cryptographic-residency, Mesh `release_ready`, or full production app claim.
- No accepted synthesis/storyline promotion from raw Scope A recovery evidence.
