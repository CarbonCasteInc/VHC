# Public News MVP Release Decisions

> Status: Owner Decision Ledger
> Owner: VHC Product + Launch Ops
> Last Reviewed: 2026-07-11
> Depends On: docs/ops/public-beta-operational-state.md, docs/ops/public-beta-launch-readiness-closeout.md, docs/reports/mesh-readiness-state-of-play-2026-06-12.md

## Status

These decisions are required before broad public-beta claims. This file records
the current repo-side defaults and the remaining owner sign-off needed; it does
not grant release approval by itself.

Historical launch, stability, and recovery reports prove only their dated
windows. They do not establish current feed health or release clearance.

The current decision is `NO_GO_STOP_REPORT_REMOTE_STAGING_BASE_UNSAFE`; S1
recovery stopped before mutation and S2+ remains blocked. Read
`docs/ops/public-beta-operational-state.md` before using this ledger. The product
decisions below remain unresolved downstream choices and authorize no live
action while the operational gate is red.

## Decisions

| Decision | Current repo stance | Owner action needed |
| --- | --- | --- |
| Retention promise | No committed TTL/eviction promise for stories, syntheses, lifecycle rows, or aggregates. Phase 5 Scope A keeps pruning disabled. Latest-index snapshot and story-body REST caches are capped, but those caps do not prove the relay process heap is bounded because Gun keeps distinct graph souls in memory. Graph metrics and early heap snapshots are the diagnostic path; no publisher retention or relay compaction fix is selected without new driver evidence and separate authority. | State the beta retention promise, for example `feed history retained at least N days`, `best-effort beta history`, or `indefinite beta retention`, and decide whether it becomes a gate or monitor after current driver evidence is reviewed. |
| Live multi-source launch copy | `VH_PUBLIC_FEED_FRESH_PROPAGATION_REQUIRE_MULTI_SOURCE` is available and defaults to `false`. Current launch copy must not claim live breaking-news corroboration unless this flag is run against live RSS and passes. | Choose whether the beta pitch promises live cross-source corroboration. If yes, run fresh propagation with the flag enabled and capture a live multi-source event. |
| Raw latest-root hygiene bar | User-visible readers filter invalid raw children, but the 2026-06-12 browser walkthrough still emitted raw latest-root `unknown-signer-id` warnings. Scrub tooling remains owner-gated because it writes production mesh state. | Decide whether zero invalid raw latest-root children blocks beta. If yes, approve dry-run evidence and then approve `--apply` scrub separately. |
| Quorum/host asymmetry | Current verified Phase 5 topology has all three public-news relay containers on A6, with `gun-c` locally redirected to relay C. A6 loss takes down origin plus all three relay votes; this is accepted only for the constrained Scope A posture and remains a known single-host durability risk, not a current A6/Mac-mini split. #694 staggers per-relay heap watchdog ceilings to reduce process-level phase-lock after the 2026-06-29 correlated trip, but it does not create host-failure tolerance. | Schedule peer redistribution before broad beta, production-grade durability claims, or higher-scope enrichment launch; otherwise explicitly re-accept the single-host risk in the release packet. |

## Draft Options

These are decision notes for owner review, not defaults. Pick one option per
decision in a release packet after the relevant current evidence and release
gate packet are attached.

### Retention Promise

| Option | Copy allowed | Engineering gate |
| --- | --- | --- |
| Best-effort beta history | "Recent public-news cards are retained on a best-effort beta basis." | No TTL claim. Continue public freshness, relay heap/RSS slope tracking, graph `userValueBytes`, and early-snapshot retainer review. |
| Fixed short TTL | "Recent public-news cards are retained for at least N days." | Add pruning/retention job, retention monitor, and proof that the oldest expected rows remain readable through the public route. |
| Indefinite beta retention | "Public-news history remains available unless removed for safety or policy." | Requires a durable storage/eviction plan beyond in-memory Gun graph growth, plus alerting on heap/RSS projection. |

Current default until an owner records a superseding decision: keep best-effort language. Do
not turn fresh public latest-index rows into a retention guarantee.

### Live Multi-Source Claims

| Option | Copy allowed | Engineering gate |
| --- | --- | --- |
| Raw-singleton-first | "Shows fresh raw public-news cards; corroboration may appear as coverage grows." | Current Scope A gate plus source-health freshness. |
| Demonstrated live corroboration | "Shows cross-source corroborated stories when live coverage overlaps." | Run `VH_PUBLIC_FEED_FRESH_PROPAGATION_REQUIRE_MULTI_SOURCE=true` against live RSS and capture at least one current multi-source event. |
| Product promise of corroboration | "Prioritizes corroborated live coverage." | Requires source breadth/readability expansion, retained-window evidence, and source-health release evidence passing on final head. |

Current default until an owner records a superseding decision: stay with raw-singleton-first
copy.

### Raw Latest-Root Hygiene

| Option | Release posture | Engineering gate |
| --- | --- | --- |
| Reader-filtered beta | Invalid raw latest-root children may remain if public readers filter them and valid latest-index rows are fresh. | Keep browser/read-path warnings visible in evidence. No production scrub. |
| Zero-warning beta bar | Broad beta is blocked until raw latest-root invalid children are gone. | Approve dry-run scrub evidence, then separately approve `--apply`; capture readback after scrub. |
| Migration-only bar | Do not scrub old roots; require all new writes to land on the signed/current path and report legacy warnings separately. | Add a recurring latest-root hygiene monitor that distinguishes legacy residue from new invalid writes. |

Current default until an owner records a superseding decision: do not scrub; gather dry-run
evidence only if owners choose zero-warning as a beta blocker.

### A6 Single-Host Quorum Asymmetry

| Option | Copy allowed | Engineering gate |
| --- | --- | --- |
| Re-accept for controlled beta | "Controlled beta on current A6 infrastructure." | Watch packet must state that 2-of-3 relay quorum is process-level on one host, that #694 staggers relay process watchdog trips, and that neither fact proves host-failure tolerance. |
| Redistribute before broad beta | "Public beta with relay redundancy." | Move at least one relay vote off A6, verify read/write quorum and public freshness through a rolling restart. |
| Enrichment-gated redistribution | Scope B stays disabled until relay votes are redistributed. | Add `VH_NEWS_SCOPE_B_ENRICHMENT_ENABLED=1` rollout checklist item requiring redistributed relay proof first. |

Current default until an owner records a superseding decision: keep controlled-beta wording
and do not describe current 2-of-3 quorum as host redundancy.

## Claim Boundary

Until the owner decisions above are recorded as accepted and the release gates
pass on the final head, launch language must stay inside controlled-beta,
public-news usability. Do not claim mesh `release_ready`, production app canary
pass, full-app readiness, test-group readiness, LUMA Silver, verified-human,
one-human-one-vote, or Sybil resistance from this document.
