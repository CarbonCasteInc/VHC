# Phase 5 Publisher Liveness Preflight Design Note - 2026-06-15

> Status: Phase 5 Operational Design Note
> Owner: VHC Ops
> Last Reviewed: 2026-06-15
> Depends On: docs/ops/news-aggregator-production-service.md, docs/ops/NEWS_SOURCE_ADMISSION_RUNBOOK.md, docs/ops/public-feed-freshness-monitor.md

## Context

The A6 Phase 5 publisher start attempt on 2026-06-14 failed closed before any
approval flag or publisher write. That was correct behavior: no
`VH_NEWS_DAEMON_START_APPROVED=1` was added, `vh-news-aggregator.service` stayed
inactive, competing writer proof was clean, and the public freshness monitor
remained `disabled_manually`.

The abort exposed two different source-health concerns that were previously
coupled in the same start preflight:

- operational restart liveness: can the publisher fetch enough source surface
  and publish current content now?
- release evidence: has the source slate accumulated a clean rolling evidence
  window for release/canary claims?

`pnpm check:news-sources:health` is the second gate. It intentionally enforces
rolling release evidence, but that makes it the wrong first gate for incident
restart after a long dark period because the stopped publisher cannot generate
the evidence window it is blocked on.

## A6 Diagnostic

The non-enforcing report path was run on A6:

```bash
pnpm --filter @vh/news-aggregator report:source-health
```

Latest diagnostic artifact:

```text
/home/humble/VHC/services/news-aggregator/.tmp/news-source-admission/1781486424909/source-health-report.json
```

Result summary:

```text
readinessStatus: blocked
releaseEvidence.status: fail
releaseEvidence.reasons:
  - insufficient_release_evidence_window
  - blocked_run_within_release_window
  - non_ready_runs_exceed_threshold
  - latest_run_not_ready
runAssessment.globalFeedStageFailure: false
runAssessment.latestPublicationAction: publish_latest
enabledSourceCount: 24
contributingSourceCount: 25
corroboratingSourceCount: 25
removeSourceIds:
  - bigbendsentinel-border-wall
```

`bigbendsentinel-border-wall` was a real current source-health remove candidate,
not only a slate-reset artifact:

```text
status: rejected
decision: remove
reasons:
  - fetch-failed
feedRead: HTTP 200 XML, 10 item fragments, 4 extracted links
readableSampleRate: 0
readableSampleCount: 0
lifecycle sourceDomain: bigbendsentinel.com
lifecycle status: failing
lastErrorMessage: HTTP 500 while fetching article
```

This is a source admission follow-up. It is not evidence of a global source
outage, and it should not deadlock publisher recovery while the rest of the
slate has sufficient live contribution.

## Design

Publisher start now uses:

```bash
pnpm check:news-sources:liveness
```

The liveness gate writes the normal source-health artifact plus
`source-health-liveness-report.json`, then fails only on current restart
blockers:

- global feed-stage outage / latest publication preservation;
- enabled source count below the configured floor;
- live contributing source count below the configured floor;
- zero admitted sources.

Release evidence failures, watch candidates, remove candidates, lifecycle
instability, and zero-contribution enabled source counts are reported as
warnings in the liveness report. They remain release/canary or source-admission
work, not publisher-start blockers by themselves.

The release-grade gate remains unchanged:

```bash
pnpm check:news-sources:health
```

That command still enforces the rolling evidence window and belongs in Phase 6,
canary, and release-readiness chains.

Pull-request CI also uses the liveness command for the required Source Health
job. That keeps ordinary source-health code and wrapper changes blocked on
current source liveness without treating an unfilled release-evidence window as
a PR failure. Release/readiness commands continue to call the full evidence
gate directly.
