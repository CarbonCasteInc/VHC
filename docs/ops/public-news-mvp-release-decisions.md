# Public News MVP Release Decisions

> Status: Owner Decision Ledger
> Owner: VHC Product + Launch Ops
> Last Reviewed: 2026-06-24
> Depends On: docs/ops/public-beta-launch-readiness-closeout.md, docs/reports/mesh-readiness-state-of-play-2026-06-12.md

## Status

These decisions are required before broad public-beta claims. This file records
the current repo-side defaults and the remaining owner sign-off needed; it does
not grant release approval by itself.

Phase 5 Scope A launched on 2026-06-24 under the controlled raw-only operating
profile recorded in `docs/reports/phase5-scope-a-launch-closeout-2026-06-24.md`.
That launch accepts a constrained public-news claim: raw-fresh, signed,
product-visible latest-index rows with pending lifecycle state and relay REST
2-of-3 quorum on the current A6 topology. It does not expand the allowed claims
to accepted synthesis, storyline overlays, full public beta, mesh
`release_ready`, or production app readiness.

## Decisions

| Decision | Current repo stance | Owner action needed |
| --- | --- | --- |
| Retention promise | No committed TTL/eviction promise for stories, syntheses, lifecycle rows, or aggregates. Phase 5 Scope A keeps pruning disabled, while relay heap is bounded by snapshot/body cache caps and the public freshness monitor proves only that product-visible latest-index rows remain recent. | State the beta retention promise, for example `feed history retained at least N days`, `best-effort beta history`, or `indefinite beta retention`, and decide whether it becomes a gate or monitor. |
| Live multi-source launch copy | `VH_PUBLIC_FEED_FRESH_PROPAGATION_REQUIRE_MULTI_SOURCE` is available and defaults to `false`. Current launch copy must not claim live breaking-news corroboration unless this flag is run against live RSS and passes. | Choose whether the beta pitch promises live cross-source corroboration. If yes, run fresh propagation with the flag enabled and capture a live multi-source event. |
| Raw latest-root hygiene bar | User-visible readers filter invalid raw children, but the 2026-06-12 browser walkthrough still emitted raw latest-root `unknown-signer-id` warnings. Scrub tooling remains owner-gated because it writes production mesh state. | Decide whether zero invalid raw latest-root children blocks beta. If yes, approve dry-run evidence and then approve `--apply` scrub separately. |
| Quorum/host asymmetry | Current verified Phase 5 topology has all three public-news relay containers on A6, with `gun-c` locally redirected to relay C. A6 loss takes down origin plus all three relay votes; this is accepted only for the constrained 2026-06-24 Scope A launch and remains a known single-host durability risk, not a current A6/Mac-mini split. | Schedule peer redistribution before broad beta, production-grade durability claims, or higher-scope enrichment launch; otherwise explicitly re-accept the single-host risk in the release packet. |

## Claim Boundary

Until the owner decisions above are recorded as accepted and the release gates
pass on the final head, launch language must stay inside controlled-beta,
public-news usability. Do not claim mesh `release_ready`, production app canary
pass, full-app readiness, test-group readiness, LUMA Silver, verified-human,
one-human-one-vote, or Sybil resistance from this document.
