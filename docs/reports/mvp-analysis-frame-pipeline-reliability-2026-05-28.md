# MVP Analysis Frame Pipeline Reliability - 2026-05-28

## Scope

Follow-up branch: `coord/mvp-analysis-frame-pipeline-reliability-v1`

Base branch: `origin/coord/mvp-production-grade-distribution-ready-v1`

PR #630 head used as branch point: `9c3a8ba75a6bf831e084abaeb32f8c8365c32e80`

Public app under test: `https://venn.carboncaste.io`

Public relay peers under test:

- `wss://gun-a.carboncaste.io/gun`
- `wss://gun-b.carboncaste.io/gun`
- `wss://gun-c.carboncaste.io/gun`

This report covers the implementation round for latest-index/story-body consistency,
singleton visibility, accepted synthesis lifecycle accounting, story-detail frame-table
states, and public smoke gating.

## Live Reproduction Before Code Changes

Read-only public probes were captured before implementation under:

`.tmp/analysis-frame-pipeline/20260528T012016Z/`

Artifacts:

- `curl-root.txt`
- `curl-analyze-config.txt`
- `curl-analyze-health.txt`
- `curl-latest-index-limit80.txt`
- `curl-latest-index-limit80-include-root.txt`
- `curl-gun-a-health.txt`
- `curl-gun-b-health.txt`
- `curl-gun-c-health.txt`
- `consistency-probe-summary.json`
- `consistency-probe-browser-logs.json`
- `consistency-probe-browser.png`

Baseline public measurements:

- Latest-index records sampled: 80
- Latest-index source key count: 520
- Latest-index REST shapes: 64 Gun-link records, 16 object records
- Story body readback: 14 HTTP 200, 66 HTTP 404
- Public probe singleton count: 0
- Public probe multi-source count: 14
- Latest synthesis readback: 3 HTTP 200, 11 HTTP 404
- Frame-count distribution: 11 stories with 0 rows, 1 story with 2 rows, 2 stories with 3 rows
- Frame point IDs: present for all 8 rows found
- Browser feed counts: initial 0, after refresh 12, after scroll 12
- Browser errors included Cloudflare beacon CSP noise, `/healthz` CSP errors for the public Gun health hosts, one story 404, and two system-writer signature-invalid warnings

The key reproduction was that the public latest-index exposed many IDs whose
`/vh/news/story/:id` readback failed. This made story-detail analysis confidence
unreliable because the feed and smoke harness were not measuring the same validated
story-body surface.

## Implementation Summary

Latest-index consistency:

- The relay latest-index REST path now validates story-body presence before exposing
  rows in the default visible window.
- Missing story bodies are excluded with explicit consistency metadata instead of
  being emitted as feed-visible rows.
- Rows with valid story bodies but incomplete latest-index record shape can be repaired
  from the story body and annotated with a repair reason.
- `/vh/news/latest-index` accepts `include_excluded=true`, `consistency=false`, and
  `scan_limit` for bounded operational inspection.
- The PWA live hydration path now uses the same relay-capable story reader semantics
  as the validated adapter path, and parses signed system-writer latest-index
  subscription records when `story_id` and `latest_activity_at` are valid.

Singleton visibility:

- Hydration tests cover eligible singleton signed latest-index records flowing through
  relay-backed story reads.
- Public smoke now records singleton readable counts and singleton accepted-synthesis
  visibility instead of treating singleton absence as unmeasured.
- Current undeployed public smoke found 22 readable singleton text stories but 0
  singleton accepted-synthesis stories, so the public stack remains blocked until the
  relay and synthesis changes are deployed and replayed.

Synthesis lifecycle accounting and replay:

- Worker returned statuses are now captured by the enrichment queue through
  `onWorkerResult`; thrown worker failures still flow through `onWorkerFailure`.
- The worker emits durable reasons for `story_missing`, `no_analysis_sources`,
  `source_text_unavailable`, `source_analysis_failed`, `relay_failed`, `parse_failed`,
  `source_count_mismatch`, `candidate_write_failed`, `epoch_write_failed`,
  `latest_write_skipped`, `latest_write_failed`, and `synthesis_written`.
- Accepted-synthesis epoch/latest write failures are surfaced as stage-specific errors
  instead of being collapsed into generic failures.
- The daemon writes a JSONL lifecycle ledger at
  `VH_BUNDLE_SYNTHESIS_LIFECYCLE_LEDGER`, or under the queue persistence directory
  when that environment variable is absent.
- Replay is limited to retryable infrastructure/schema-write classes:
  `relay_failed`, `parse_failed`, `candidate_write_failed`, `epoch_write_failed`, and
  `latest_write_failed`.
- Terminal domain cases are not replayed indefinitely.

Accepted synthesis coverage:

- The synthesis worker now performs one bounded schema-specific retry after strict
  parse or source-count validation failures.
- The public browser smoke joins latest-index story readback to synthesis readback,
  frame rows, and point IDs.
- Missing accepted synthesis is now a gate failure unless the story has a durable
  terminal unavailable reason.

Web PWA story detail states:

- Story detail now distinguishes `accepted_synthesis_loading`,
  `accepted_synthesis_available`, `accepted_synthesis_pending`,
  `accepted_synthesis_terminal_unavailable`,
  `accepted_synthesis_suppressed_by_correction`, and
  `provisional_analysis_available`.
- Readiness timeout no longer leaves the ambiguous "no bias analysis available yet"
  state.
- Accepted frame rows render defensively even when point IDs are malformed or missing,
  but stance controls remain unavailable for those rows.
- Provisional analysis is not labeled as accepted synthesis and is not votable.

Public smoke and gates:

- The public smoke parser now samples key-only latest-index rows using the object key
  as the story ID. This fixed a blind spot where public 404s could be skipped.
- Smoke records latest-index count, story body 200/404 counts, singleton visibility,
  media classification, source-filter status, article-text sample status, synthesis
  200/404 counts, frame distribution, point ID presence, browser detail behavior,
  screenshots, logs, and console/CSP/network errors.
- Smoke fails when top-N story-body 404s exceed the repair-window threshold, when
  visible readable text stories lack accepted synthesis or terminal unavailable
  reasons, when accepted synthesis has no frame rows, when votable rows lack point IDs,
  or when relevant browser/network/CSP errors affect app function.
- `pnpm check:mvp-release-gates` now includes the
  `public_feed_analysis_frame_reliability` gate.

## Current Public Evidence After Implementation

The fixed smoke harness was run against the still-undeployed public stack. It failed
as intended because the public deployment has not received these changes:

`.tmp/analysis-frame-pipeline/20260528T022200Z/public-feed-browser-smoke/public-feed-browser-smoke-summary.json`

Measured public state:

- Latest-index records sampled: 80
- Story readbacks attempted: 77
- Story body readback: 77 HTTP 200, 3 HTTP 404
- Latest synthesis readback: 3 HTTP 200, 74 HTTP 404
- Readable singleton text stories: 22
- Readable multi-source text stories: 55
- Singleton visible with accepted synthesis: 0
- Media classification: 77 text stories
- Source-filter status: 190 unknown source rows
- Article-text sample status for missing synthesis: 40 `200_text`, 34 `502`
- Frame-count distribution: 74 stories with 0 rows, 1 story with 2 rows, 2 stories with 3 rows
- Accepted synthesis stories: 3
- Point IDs for accepted rows: 8 of 8 frame IDs present, 8 of 8 reframe IDs present
- Gate failure: `public-relay-latest-index-story-404:3/0`

The MVP release gate integration also failed on the same public reliability blocker:

`.tmp/analysis-frame-pipeline/20260528T022800Z/mvp-gate-public-feed-smoke/public-feed-browser-smoke-summary.json`

Additional MVP gate blockers from that run:

- `public_feed_analysis_frame_reliability`: public story-body 404 count was 3 with a threshold of 0
- `luma_mvp_production_readiness`: repo was dirty during the local gate run and the referenced mesh LUMA coverage report was not from the current commit

The exact filtered package smoke command was also run:

`.tmp/analysis-frame-pipeline/20260528T025500Z/filter-public-feed-browser-smoke/public-feed-browser-smoke-summary.json`

That run failed with `public-relay-latest-index-story-404:4/0` and recorded:

- Latest-index records sampled: 80
- Story readbacks attempted: 76
- Story body readback: 76 HTTP 200, 4 HTTP 404
- Latest synthesis readback: 3 HTTP 200, 73 HTTP 404
- Readable singleton text stories: 22
- Readable multi-source text stories: 54
- Frame-count distribution: 73 stories with 0 rows, 1 story with 2 rows, 2 stories with 3 rows
- Point IDs for accepted rows: 8 of 8 frame IDs present, 8 of 8 reframe IDs present

After the implementation branch was committed and pushed, the public health path was
checked again:

- `https://venn.carboncaste.io/`: HTTP 200
- `https://venn.carboncaste.io/api/analyze/health`: HTTP 200
- `https://gun-a.carboncaste.io/health`: relay alive
- `https://gun-b.carboncaste.io/health`: relay alive
- `https://gun-c.carboncaste.io/health`: relay alive
- Release environment file presence was verified locally without printing secrets

The clean-branch MVP release-gate run failed on the undeployed public feed reliability
gate, with artifacts under:

`.tmp/analysis-frame-pipeline/20260528T031000Z/mvp-gate-public-feed-smoke-clean/public-feed-browser-smoke-summary.json`

Measured public state in that run:

- Latest-index records sampled: 80
- Story readbacks attempted: 74
- Story body readback: 74 HTTP 200, 6 HTTP 404
- Latest synthesis readback: 3 HTTP 200, 71 HTTP 404
- Readable singleton text stories: 22
- Readable multi-source text stories: 52
- Singleton visible with accepted synthesis: 0
- Frame-count distribution: 71 stories with 0 rows, 1 story with 2 rows, 2 stories with 3 rows
- Accepted synthesis stories: 3
- Point IDs for accepted rows: 8 of 8 frame IDs present, 8 of 8 reframe IDs present
- Gate failure: `public-relay-latest-index-story-404:6/0`

## Deployment Status

Public deployment was not performed.

The expected Cloudflare Tunnel host was unreachable over SSH:

- Command class: `ssh -o BatchMode=yes -o ConnectTimeout=8 humble ...`
- Host resolved by SSH config: `100.75.18.26`
- Failure: `ssh: connect to host 100.75.18.26 port 22: Operation timed out`
- Rechecked with a 5 second timeout and received the same timeout

Because the A6 host could not be reached, the public origin and A/B relays could not
be updated. Relay C on the Mac mini was intentionally not restarted as standalone
proof because the public origin chooses among public latest-index responses and a
single local relay update would not prove the full public path.

SSH was retried after the branch was committed and pushed, and the same blocker
remained:

- Command class: `ssh -o BatchMode=yes -o ConnectTimeout=8 humble true`
- Failure: `ssh: connect to host 100.75.18.26 port 22: Operation timed out`

Human blocker: restore SSH access to `humble`/A6 or provide an alternate deployment
operator for the public self-hosted stack.

## Verification

Passed locally:

- `node --check infra/relay/server.js`
- `node --check packages/e2e/src/live/public-feed-browser-smoke.mjs`
- `pnpm --filter @vh/news-aggregator typecheck`
- `pnpm --filter @vh/news-aggregator test`
- `pnpm --filter @vh/gun-client test`
- `pnpm --filter @vh/web-pwa typecheck`
- `pnpm --filter @vh/web-pwa test`
- `pnpm --filter @vh/e2e exec vitest run src/live/relay-server.vitest.mjs src/live/public-feed-browser-smoke.vitest.mjs --config ./vitest.config.ts --reporter=verbose --no-file-parallelism`
- `pnpm --filter @vh/e2e exec vitest run src/live/public-feed-browser-smoke.vitest.mjs --config ./vitest.config.ts --reporter=verbose`
- `pnpm check:public-beta-launch-closeout`
- `pnpm docs:check`
- `git diff --check origin/main...HEAD`
- `node tools/scripts/check-diff-coverage.mjs`
- `pnpm check:public-namespace-leaks`

Failed or blocked:

- `pnpm test:public-feed:browser-smoke`: failed against undeployed public stack with `public-relay-latest-index-story-404:3/0`
- `pnpm --filter @vh/e2e test:live:public-feed-browser-smoke`: failed against undeployed public stack with `public-relay-latest-index-story-404:4/0`
- `pnpm check:mvp-release-gates`: latest clean run failed only on the public feed reliability gate against the undeployed public stack
- `pnpm check:storycluster:production-readiness`: blocked because headline soak evidence was stale; a fresh collection attempt did not produce passing evidence
- `pnpm collect:storycluster:headline-soak`: failed/hung during fresh evidence collection after two strict semantic failures
- `pnpm check:mesh:production-readiness`: completed with status `review_required`; remaining release-ready blockers are canonical soak and public WSS deployment proof
- `pnpm check:production-app-canary -- --mesh-report .tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json`: blocked on `mesh_not_release_ready`

Additional clean-branch evidence after commit `e3dce209e7b6dd416fc50b9d6086d90a991f84fe`:

- `pnpm check:mesh:production-readiness`: completed with status `review_required`; all source reports passed and evidence scrub passed. Artifact:
  `.tmp/mesh-production-readiness/mesh-production-readiness-20260528T025448Z-35b024dc/mesh-production-readiness-report.json`.
- Remaining Mesh release-ready blockers from the clean run: canonical 30-minute soak,
  public WSS deployment proof, and LUMA-gated write coverage.
- `pnpm check:production-app-canary -- --mesh-report .tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json`: blocked on `mesh_not_release_ready`, not `mesh_report_dirty`.
  Artifact:
  `.tmp/production-app-canary/production-app-canary-20260528T030629Z-810e0da8/production-app-canary-report.json`.
- `pnpm check:mvp-release-gates`: failed on the undeployed public feed reliability
  gate and LUMA readiness evidence. Public feed artifact:
  `.tmp/analysis-frame-pipeline/20260528T031000Z/mvp-gate-public-feed-smoke-clean/public-feed-browser-smoke-summary.json`.
- `pnpm check:storycluster:production-readiness`: refreshed correctness and source-health evidence, then blocked on `headline_soak_evidence_stale`.
  Latest headline soak trend was generated `2026-05-22T22:27:43.129Z`, with age about
  124.8 hours against the 36 hour limit. Collection command: `pnpm collect:storycluster:headline-soak`.
- `pnpm check:luma:mvp-production-readiness` inside the clean MVP gate passed repo-clean
  and surface checks, then blocked on `mesh_luma_coverage` because the latest LUMA
  mesh reader-path coverage report was for commit
  `d201eeba8d2615ea4d25e72370de0c484c2eb7fa`, not current commit
  `e3dce209e7b6dd416fc50b9d6086d90a991f84fe`.

Current clean evidence after commit `9c42c6099755362513e06dff7d1829ae0867a1e6`:

- `pnpm test:mesh:luma-gated-write-coverage -- --mode local-e2e`: passed with
  run id `mesh-luma-gated-write-coverage-20260528T031719Z-3773c895` and artifact
  `.tmp/mesh-luma-gated-write-coverage/latest/mesh-luma-gated-write-coverage-report.json`.
  The report used the `e2e` LUMA profile, was generated from the current commit, and
  covered forum threads, forum comments, vote/aggregate writes, directory publish,
  and news report/status writes through the LUMA reader path.
- `pnpm check:luma:mvp-production-readiness`: passed with artifact
  `.tmp/luma-mvp-production-readiness/latest/luma-mvp-production-readiness-report.json`.
- `pnpm check:mesh:production-readiness` was rerun with
  `VH_MESH_LUMA_GATED_WRITE_COVERAGE_REPORT=.tmp/mesh-luma-gated-write-coverage/latest/mesh-luma-gated-write-coverage-report.json`.
  It completed with status `review_required`, run id
  `mesh-production-readiness-20260528T034654Z-0dff40a5`, and artifact
  `.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json`.
  All source reports passed, evidence scrub passed, and LUMA-gated write coverage
  passed. The only remaining Mesh release-ready blockers are `canonical-30-minute-soak`
  and `public-wss-deployment-proof`.
- `pnpm check:production-app-canary -- --mesh-report .tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json`
  was rerun with artifact
  `.tmp/production-app-canary/latest/production-app-canary-report.json`.
  It blocked on `mesh_not_release_ready` because the Mesh report still has the two
  blockers above. The canary report was clean for repo dirtiness, current commit, and
  LUMA profile matching.
- `pnpm check:mvp-release-gates` was rerun with the public feed smoke artifact
  directory set to
  `.tmp/analysis-frame-pipeline/20260528T040000Z/mvp-gate-public-feed-smoke-luma-current/`.
  The overall gate failed only because `public_feed_analysis_frame_reliability` failed
  against the undeployed public stack. Source health, StoryCluster correctness, feed
  render, story detail, synthesis correction, point stance, story thread, story thread
  moderation, launch content snapshot, report intake/admin action, operator trust,
  public beta compliance, LUMA MVP production readiness, and public beta launch closeout
  all passed in that run.
- Latest public smoke metrics from the MVP gate run:
  - Latest-index records sampled: 80
  - Story body readback: 73 HTTP 200, 7 HTTP 404
  - Latest synthesis readback: 3 HTTP 200, 70 HTTP 404
  - Readable singleton text stories: 22
  - Readable multi-source text stories: 51
  - Media classification: 73 text stories
  - Source-filter status: 182 unknown source rows
  - Article-text sample status for missing synthesis: 40 `200_text`, 30 `502`
  - Frame-count distribution: 70 stories with 0 rows, 1 story with 2 rows, 2 stories with 3 rows
  - Point IDs for accepted rows: 8 of 8 frame IDs present, 8 of 8 reframe IDs present
  - Gate failure: `public-relay-latest-index-story-404:7/0`
- Fresh StoryCluster headline soak collection was attempted using only the approved
  Mac-mini-local release environment file, sourced without printing secrets:
  `/Users/benjamintucker/Desktop/VHC/VHC-mvp-public-beta-go-no-go-v1/packages/e2e/.env.dev-small.local`.
  Source health passed, but the collector did not produce passing headline soak
  evidence. Artifacts were written under `.tmp/daemon-feed-semantic-soak/1779938344605/`.
  Runs 1 and 2 failed strict semantic audit with `related_topic_only_pair_count: 1`;
  run 3 produced only `run-3.preflight.log`, then stalled and was terminated.

## Remaining Blockers

- Deploy the branch to the public A6/Mac mini topology after SSH access to `humble` is restored.
- Rerun public smoke after deployment and require 0 unbounded story-body 404s in the latest-index top-N window.
- Replay retryable synthesis lifecycle records and confirm every visible readable text story has accepted TopicSynthesisV2 or a durable terminal unavailable reason.
- Regenerate passing StoryCluster headline soak evidence within the freshness window; the latest fresh collection attempt failed/hung.
- Satisfy Mesh canonical 30-minute soak and public WSS deployment proof, then rerun the production app canary with a release-ready Mesh report.

## Explicit Non-Claims

This work does not claim LUMA Silver readiness, verified-human identity, one-human-one-vote,
Sybil resistance, native app readiness, legal readiness, commercial readiness, or public
beta launch readiness. The current evidence proves the code path and gates were hardened;
it does not prove the undeployed public stack is ready.
