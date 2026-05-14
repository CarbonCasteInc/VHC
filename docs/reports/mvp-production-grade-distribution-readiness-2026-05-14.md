# MVP Production-Grade Distribution Readiness Packet

Date: 2026-05-14
Branch: `coord/mvp-production-grade-distribution-ready-v1`
Base commit: `bb120a2e376784475202d59552f4b04531ee798b`
Supersedes draft PR: `#629` (`coord/mvp-public-beta-go-no-go-v1`)
Superseded PR commit included: `de1c1eb4457a77d1a1e664c1b24d162c6f520478`
Node: `v20.20.0`
pnpm: `9.7.1`

## Final Status

`blocked_engineering_evidence`

The constrained Web PWA MVP public-beta candidate is still not production-grade distribution-ready. This branch fixed one real local-stack startup blocker and one analysis-relay compatibility weakness, but the real public/remote release lane remains blocked by upstream OpenAI API authentication and by failing public headline-soak release evidence.

Do not claim `go_for_public_beta_launch`, production-grade live headline freshness, StoryCluster `release_ready`, Mesh `release_ready`, production app canary pass, legal approval, commercial approval, LUMA Silver, verified-human identity, one-human-one-vote, Sybil resistance, native App Store/TestFlight readiness, or full production app readiness from this packet.

## Fixes Landed In This Branch

| Area | Change | Verification |
| --- | --- | --- |
| News daemon stack startup | `services/news-aggregator` now builds `@vh/luma-sdk` before `@vh/gun-client`, matching `@vh/gun-client` runtime imports. | `pnpm --filter @vh/news-aggregator build:source-health-deps`; `pnpm --filter @vh/news-aggregator exec vitest run --config ./vitest.config.ts src/packageScripts.test.ts`; public stack reaches ready state. |
| Analysis relay GPT-5 empty-content compatibility | Relay retries now expand `max_completion_tokens` / `max_tokens` after missing-content responses, preserve finish-reason diagnostics, and read text-array choice content. | `pnpm --filter @vh/web-pwa exec vitest run src/server/analysisRelay.test.ts src/server/analysisRelay.budgetAndErrors.test.ts`; `node tools/scripts/check-diff-coverage.mjs` |

## Release-Shaped Stack Result

Command:

```bash
ENV_FILE=/Users/bldt/Desktop/VHC/VHC/.env VH_LOCAL_STACK_ANALYSIS_MODE=remote pnpm live:stack:up:public
```

Result: stack startup passed in `mode=public`, `analysis=remote`.

Observed services:

| Service | Status |
| --- | --- |
| web-pwa | running on `127.0.0.1:2048` |
| relay | running on `127.0.0.1:7777/gun` |
| news-daemon | starts, acquires lease, then runtime tick fails on upstream auth |
| StoryCluster | running on `127.0.0.1:4310` |

Required probes:

| Probe | Result |
| --- | --- |
| `pnpm live:stack:status` | `mode=public`, `analysis=remote`, services start; daemon can later degrade after upstream auth failure. |
| `curl -i http://127.0.0.1:2048/api/analyze/config` | `200 OK`; configured `true`; model `gpt-5-nano`; provider `remote-analysis-relay`; upstream URL configured. |
| `curl -i http://127.0.0.1:2048/api/analyze/health` | `502 Bad Gateway`; upstream `401 Incorrect API key provided`. |
| `tail -n 200 /tmp/vh-local-news-daemon.log` | Runtime tick fails during StoryCluster remote request with OpenAI chat request `HTTP 401`. |

Root cause status: the prior missing-content/output-limit relay weakness is patched and unit-tested, but the current local release env key is rejected upstream. Real public/remote analysis cannot be considered healthy until a valid release env key is supplied and `/api/analyze/health` returns `200`.

## Public Feed UX Result

Playwright CLI browser check against `http://127.0.0.1:2048/`:

| Surface | Observed |
| --- | --- |
| App shell | Loads; title `TRINITY Web PWA`; header visible. |
| Peer indicator | `Peers: 1`. |
| Feed counts | `0 live`, `0 news`, `0 topics`. |
| Feed content | `No items to show.` |
| Health widget | `Health: Disconnected`. |
| Screenshot | `.tmp/release-evidence/public-remote-feed-blocked-2026-05-14.png` local artifact. |

This does not prove real public headlines visible in the Web PWA. Story detail, accepted analysis/synthesis, source labels, timestamps, refresh, scroll, identity, stance, comments, reload, and second-browser visibility were not release-proven because the real public/remote pipeline failed to materialize current public stories.

## StoryCluster Production Readiness

Commands:

```bash
pnpm collect:storycluster:headline-soak
pnpm check:storycluster:production-readiness
```

Result: blocked.

Artifact paths:

| Artifact | Path |
| --- | --- |
| Source-health report | `services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json` |
| Headline-soak promotion decision | `.tmp/daemon-feed-semantic-soak/1778722068972/promotion-decision.json` |
| Headline-soak trend index | `.tmp/daemon-feed-semantic-soak/headline-soak-trend-index.json` |
| StoryCluster production-readiness report | `.tmp/storycluster-production-readiness/latest/production-readiness-report.json` |

Evidence:

| Gate | Status | Details |
| --- | --- | --- |
| StoryCluster correctness | pass | Deterministic corpus plus daemon-first semantic gate passed. |
| Source health | pass | `readinessStatus: ready`; `releaseEvidence.status: pass`; 5/5 ready window; 28 keep, 0 watch, 0 remove; latest observed report generated `2026-05-14T02:22:47.389Z`. |
| Public headline soak | fail | Latest execution `readinessStatus: not_ready`; 3/3 soak runs failed; 0 sampled stories; 0 audited pairs. |
| Production readiness | blocked | `headline_soak_release_evidence_failed`. |

Headline-soak blockers:

- `insufficient_headline_soak_execution_count`
- `promotable_execution_count_below_threshold`
- `latest_headline_soak_execution_not_promotable`
- `corroborated_bundle_rate_below_threshold`
- `headline_source_diversity_below_threshold`

Latest execution blockers:

- `supply_failures_present`
- `insufficient_sample_fill_rate`
- `insufficient_audited_pair_density`

Do not claim production-grade live headline freshness or StoryCluster `release_ready`.

## Mesh And Production App Canary

Commands:

```bash
pnpm test:mesh:luma-gated-write-coverage -- --mode local-e2e
VH_MESH_SOAK_DURATION_MS=1800000 VH_MESH_LUMA_GATED_WRITE_COVERAGE_REPORT=.tmp/mesh-luma-gated-write-coverage/latest/mesh-luma-gated-write-coverage-report.json pnpm check:mesh:production-readiness
pnpm check:production-app-canary -- --mesh-report .tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json
```

Current packet status: not release-proven.

Artifact paths:

| Artifact | Path |
| --- | --- |
| LUMA gated write coverage | `.tmp/mesh-luma-gated-write-coverage/latest/mesh-luma-gated-write-coverage-report.json` |
| Mesh production-readiness report | `.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json` |
| Mesh production-readiness evidence manifest | `.tmp/mesh-production-readiness/latest/mesh-production-readiness-evidence.md` |
| Production app canary report | `.tmp/production-app-canary/latest/production-app-canary-report.json` |

Observed dirty-run behavior before packet commit: the 30-minute soak satisfied duration and passed its soak gate, but the aggregate run `mesh-production-readiness-20260514T020311Z-e6f8f715` was correctly `blocked` because the worktree had uncommitted relay coverage changes. Dirty source reports are invalid release evidence.

Additional dirty-run blockers included required write/resource SLO sample floors and evidence-scrub promotion:

- `public-wss-deployment-proof`
- `evidence-scrub-promotion`
- `required-write-class-sample-floors`

A clean current-commit rerun of the same commands is required before any Mesh/app readiness claim. Until that report is clean and `release_ready`, the branch does not claim Mesh `release_ready` or production app canary pass.

The known upstream Mesh blockers from the superseded launch-control packet also remain active until a clean current-commit rerun proves otherwise:

- `public-wss-deployment-proof`
- `evidence-scrub-promotion`
- `required-write-class-sample-floors`

Production app canary remains not release-proven. Do not claim downstream production app observation or full production app readiness.

## Approval And Ownership Table

No release-owner/operator approval inputs were supplied in this work. No legal/commercial/support/escalation/rollback approval is inferred.

| Approval or owner | Status | Notes |
| --- | --- | --- |
| Release owner | pending | Required before any public launch. |
| External/legal disposition | pending | Neither approved nor marked `not_required`. |
| Launch copy approval | pending | Only bounded blocked-status copy is allowed. |
| Support intake owner | pending | Public support surface exists, but owner assignment is not recorded. |
| Private escalation owner/channel | pending | No private escalation reference supplied. |
| Rollback owner/path | pending | Engineering rollback path is documented, but owner signoff is not recorded. |

## Allowed Launch Copy

- "The Web PWA MVP remains a constrained public-beta release candidate."
- "The public/remote stack starts in public mode, but remote analysis health is blocked by upstream API authentication."
- "Source health is ready with release evidence pass."
- "StoryCluster correctness passes, but StoryCluster production readiness is blocked by headline-soak release evidence."
- "Mesh and production app readiness remain separate and are not release-ready in this packet."

## Forbidden Claims

- `go_for_public_beta_launch`
- production-grade live headline freshness
- StoryCluster `release_ready`
- Mesh `release_ready`
- production app canary pass
- downstream production app surfaces observed end to end
- legal, commercial, support, escalation, or rollback approval
- LUMA Silver
- verified-human identity
- one-human-one-vote
- Sybil resistance
- production attestation
- native App Store or TestFlight readiness
- private support desk or SLA

## Explicit Non-Claims

This packet does not claim:

- real public headlines are visible in the Web PWA;
- public stories can be opened end to end with accepted analysis/synthesis;
- stance/comment/reload/second-browser flows work against current public/remote stories;
- Mesh public WSS proof exists;
- required Mesh sample floors are satisfied;
- production app canary performs real downstream observation;
- legal/external approval is not required.

## Exact Remaining Blockers

| Blocker | Blocking status | Required next proof |
| --- | --- | --- |
| `analysis_remote_upstream_auth` | Blocks remote analysis relay health and StoryCluster live materialization. | Supply a valid release env key, rerun `pnpm live:stack:up:public`, and require `/api/analyze/health` `200 OK`. |
| `public_headline_soak_release_evidence_failed` | Blocks StoryCluster production `release_ready` and production-grade live headline claims. | Rerun `pnpm collect:storycluster:headline-soak` until the headline-soak trend release evidence passes, then rerun `pnpm check:storycluster:production-readiness`. |
| `real_public_feed_ux_not_proven` | Blocks distribution-ready Web PWA claim. | With public/remote stack healthy, browser-verify current public headlines, story detail, accepted synthesis, source labels, timestamps, refresh, scroll, identity, stance, comments, reload, and second-browser visibility. |
| `mesh_release_ready_not_proven` | Blocks Mesh/app readiness claims. | Clean current-commit rerun of LUMA/Mesh matrix, public WSS proof, evidence-scrub promotion, required write/resource sample floors, and `pnpm check:mesh:production-readiness` resolving `release_ready`. |
| `production_app_canary_not_proven` | Blocks full production app readiness. | After Mesh `release_ready`, run `pnpm check:production-app-canary -- --mesh-report <release_ready report>` with real downstream observation implemented and passing. |
| `approvals_and_owners_pending` | Blocks launch-control go decision even after engineering evidence clears. | Record release owner, legal/external disposition, launch-copy approval, support intake owner, private escalation owner/channel, and rollback owner/path. |

## Launch-Control Rule

Current launch-control status: `blocked_engineering_evidence`.

`go_for_public_beta_launch` is allowed only when remote analysis health, real public feed UX, StoryCluster production readiness, claimed Mesh/app readiness, required approvals, and support/escalation/rollback ownership are all green and recorded.
