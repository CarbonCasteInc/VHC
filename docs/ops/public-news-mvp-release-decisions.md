# Public News MVP Release Decisions

> Status: Owner Decision Ledger
> Owner: VHC Product + Launch Ops
> Last Reviewed: 2026-06-28
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

The 2026-06-28 stability bake recorded the first extended clean post-#687
window for that constrained claim: 42 clean post-overlap ticks, 336/336 raw
writes, zero new StoryCluster truncation artifacts, zero rerank degeneracy
warnings, and a passing hourly archive. This closes launch firefighting for the
known StoryCluster truncation class; it does not change the owner decisions
below.

## Decisions

| Decision | Current repo stance | Owner action needed |
| --- | --- | --- |
| Retention promise | No committed TTL/eviction promise for stories, syntheses, lifecycle rows, or aggregates. Phase 5 Scope A keeps pruning disabled, while relay heap is bounded by snapshot/body cache caps and the public freshness monitor proves only that product-visible latest-index rows remain recent. | State the beta retention promise, for example `feed history retained at least N days`, `best-effort beta history`, or `indefinite beta retention`, and decide whether it becomes a gate or monitor. |
| Live multi-source launch copy | `VH_PUBLIC_FEED_FRESH_PROPAGATION_REQUIRE_MULTI_SOURCE` is available and defaults to `false`. Current launch copy must not claim live breaking-news corroboration unless this flag is run against live RSS and passes. | Choose whether the beta pitch promises live cross-source corroboration. If yes, run fresh propagation with the flag enabled and capture a live multi-source event. |
| Raw latest-root hygiene bar | User-visible readers filter invalid raw children, but the 2026-06-12 browser walkthrough still emitted raw latest-root `unknown-signer-id` warnings. Scrub tooling remains owner-gated because it writes production mesh state. | Decide whether zero invalid raw latest-root children blocks beta. If yes, approve dry-run evidence and then approve `--apply` scrub separately. |
| Quorum/host asymmetry | Current verified Phase 5 topology has all three public-news relay containers on A6, with `gun-c` locally redirected to relay C. A6 loss takes down origin plus all three relay votes; this is accepted only for the constrained 2026-06-24 Scope A launch and remains a known single-host durability risk, not a current A6/Mac-mini split. | Schedule peer redistribution before broad beta, production-grade durability claims, or higher-scope enrichment launch; otherwise explicitly re-accept the single-host risk in the release packet. |

## Draft Options

These are decision notes for owner review, not defaults. Pick one option per
decision in a release packet after the 24h/48h watch evidence is attached.

### Retention Promise

| Option | Copy allowed | Engineering gate |
| --- | --- | --- |
| Best-effort beta history | "Recent public-news cards are retained on a best-effort beta basis." | No TTL claim. Continue watch packet freshness and relay heap/RSS slope tracking. |
| Fixed short TTL | "Recent public-news cards are retained for at least N days." | Add pruning/retention job, retention monitor, and proof that the oldest expected rows remain readable through the public route. |
| Indefinite beta retention | "Public-news history remains available unless removed for safety or policy." | Requires a durable storage/eviction plan beyond in-memory Gun graph growth, plus alerting on heap/RSS projection. |

Recommended non-decision during the bake: keep best-effort language. Do not
turn a clean freshness watch into a retention guarantee.

### Live Multi-Source Claims

| Option | Copy allowed | Engineering gate |
| --- | --- | --- |
| Raw-singleton-first | "Shows fresh raw public-news cards; corroboration may appear as coverage grows." | Current Scope A gate plus source-health freshness. |
| Demonstrated live corroboration | "Shows cross-source corroborated stories when live coverage overlaps." | Run `VH_PUBLIC_FEED_FRESH_PROPAGATION_REQUIRE_MULTI_SOURCE=true` against live RSS and capture at least one current multi-source event. |
| Product promise of corroboration | "Prioritizes corroborated live coverage." | Requires source breadth/readability expansion, retained-window evidence, and source-health release evidence passing on final head. |

Recommended non-decision during the bake: stay with raw-singleton-first copy.

### Raw Latest-Root Hygiene

| Option | Release posture | Engineering gate |
| --- | --- | --- |
| Reader-filtered beta | Invalid raw latest-root children may remain if public readers filter them and valid latest-index rows are fresh. | Keep browser/read-path warnings visible in evidence. No production scrub. |
| Zero-warning beta bar | Broad beta is blocked until raw latest-root invalid children are gone. | Approve dry-run scrub evidence, then separately approve `--apply`; capture readback after scrub. |
| Migration-only bar | Do not scrub old roots; require all new writes to land on the signed/current path and report legacy warnings separately. | Add a recurring latest-root hygiene monitor that distinguishes legacy residue from new invalid writes. |

Recommended non-decision during the bake: do not scrub; gather dry-run evidence
only if owners choose zero-warning as a beta blocker.

### A6 Single-Host Quorum Asymmetry

| Option | Copy allowed | Engineering gate |
| --- | --- | --- |
| Re-accept for controlled beta | "Controlled beta on current A6 infrastructure." | Watch packet must state that 2-of-3 relay quorum is process-level on one host and does not prove host-failure tolerance. |
| Redistribute before broad beta | "Public beta with relay redundancy." | Move at least one relay vote off A6, verify read/write quorum and public freshness through a rolling restart. |
| Enrichment-gated redistribution | Scope B stays disabled until relay votes are redistributed. | Add `VH_NEWS_SCOPE_B_ENRICHMENT_ENABLED=1` rollout checklist item requiring redistributed relay proof first. |

Recommended non-decision during the bake: keep controlled-beta wording and do
not describe current 2-of-3 quorum as host redundancy.

## Claim Boundary

Until the owner decisions above are recorded as accepted and the release gates
pass on the final head, launch language must stay inside controlled-beta,
public-news usability. Do not claim mesh `release_ready`, production app canary
pass, full-app readiness, test-group readiness, LUMA Silver, verified-human,
one-human-one-vote, or Sybil resistance from this document.
