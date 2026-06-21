# Public News MVP Release Decisions

> Status: Owner Decision Ledger
> Owner: VHC Product + Launch Ops
> Last Reviewed: 2026-06-20
> Depends On: docs/ops/public-beta-launch-readiness-closeout.md, docs/reports/mesh-readiness-state-of-play-2026-06-12.md

## Status

These decisions are required before broad public-beta claims. This file records
the current repo-side defaults and the remaining owner sign-off needed; it does
not grant release approval by itself.

## Decisions

| Decision | Current repo stance | Owner action needed |
| --- | --- | --- |
| Retention promise | No committed TTL/eviction promise for stories, syntheses, lifecycle rows, or aggregates. The freshness monitor only proves new accepted rows remain recent. | State the beta retention promise, for example `feed history retained at least N days`, `best-effort beta history`, or `indefinite beta retention`, and decide whether it becomes a gate or monitor. |
| Live multi-source launch copy | `VH_PUBLIC_FEED_FRESH_PROPAGATION_REQUIRE_MULTI_SOURCE` is available and defaults to `false`. Current launch copy must not claim live breaking-news corroboration unless this flag is run against live RSS and passes. | Choose whether the beta pitch promises live cross-source corroboration. If yes, run fresh propagation with the flag enabled and capture a live multi-source event. |
| Raw latest-root hygiene bar | User-visible readers filter invalid raw children, but the 2026-06-12 browser walkthrough still emitted raw latest-root `unknown-signer-id` warnings. Scrub tooling remains owner-gated because it writes production mesh state. | Decide whether zero invalid raw latest-root children blocks beta. If yes, approve dry-run evidence and then approve `--apply` scrub separately. |
| Quorum/host asymmetry | Current verified Phase 5 topology has all three public-news relay containers on A6, with `gun-c` locally redirected to relay C. A6 loss takes down origin plus all three relay votes; this is a known MVP single-host durability risk, not a current A6/Mac-mini split. | Explicitly accept this for controlled beta or schedule peer redistribution before broad beta. |

## Claim Boundary

Until the owner decisions above are recorded as accepted and the release gates
pass on the final head, launch language must stay inside controlled-beta,
public-news usability. Do not claim mesh `release_ready`, production app canary
pass, full-app readiness, test-group readiness, LUMA Silver, verified-human,
one-human-one-vote, or Sybil resistance from this document.
