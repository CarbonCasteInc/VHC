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

## Deployment Evidence After A6 Access Restored

After Tailscale access was restored, `ssh humble` reached A6 (`ccibootstrap`) and
Docker was available. The public stack was updated without printing host-local secrets.

Deployed public topology:

- Web PWA/public origin on A6 port `8080`
- Relay/Gun peer A on A6 port `8765`
- Relay/Gun peer B on A6 port `8766`
- Relay/Gun peer C on the Mac mini public WSS path
- Public origin image:
  `vhc-public-beta-origin:20260528-pr631-analysis-frame-reliability-v10-amd64`
- Public relay image:
  `vhc-public-beta-relay:20260528-pr631-analysis-frame-reliability-v5`

The public origin was rebuilt with strict signed remote peer-config boot enabled and
the deployed public system-writer pin embedded in the app bundle:

- `VITE_VH_STRICT_PEER_CONFIG=true`
- `VITE_GUN_PEER_CONFIG_URL=https://venn.carboncaste.io/mesh-peer-config.json`
- `VITE_VH_EXPOSE_PEER_TOPOLOGY=true`
- CSP connect-src includes the public app origin plus the HTTPS and WSS public relay
  hosts for `gun-a`, `gun-b`, and `gun-c`

The live signed peer config was refreshed and served at
`https://venn.carboncaste.io/mesh-peer-config.json` with config id
`public-beta-fallback-wss-v1`, issued `2026-05-28T10:31:28.700Z`, expiring
`2026-06-04T10:31:28.700Z`, and peers exactly:

- `wss://gun-a.carboncaste.io/gun`
- `wss://gun-b.carboncaste.io/gun`
- `wss://gun-c.carboncaste.io/gun`

Post-deploy public health checks:

- `https://venn.carboncaste.io/`: HTTP 200
- `https://venn.carboncaste.io/api/analyze/health`: HTTP 200 with upstream reachable
- `https://gun-a.carboncaste.io/health`: HTTP 200 relay-alive
- `https://gun-b.carboncaste.io/health`: HTTP 200 relay-alive
- `https://gun-c.carboncaste.io/health`: HTTP 200 relay-alive

## Public Analysis/Frame Readback Evidence

Accepted public rows were reseeded from signed public data only. The filtered seed
artifact rejected four rows before writing public state:

- Seed source:
  `.tmp/analysis-frame-pipeline/20260528T111908Z/public-peer-accepted-seed-from-b-valid-signed-story.json`
- Seed filter report:
  `.tmp/analysis-frame-pipeline/20260528T111908Z/public-peer-accepted-seed-from-b-valid-signed-story-report.json`
- Result: 13 input rows, 9 accepted rows, 4 excluded for signed story validation or
  record-shape failures

The public relay stores were stopped, moved aside, restarted, and reseeded with the
9 signed accepted rows:

`.tmp/analysis-frame-pipeline/20260528T111908Z/seed-public-peers-clean-reset-20260528T201854Z.json`

Seed result:

- `gun-a`: 9 stories, 9 syntheses, 9 latest-index rows, 0 failures
- `gun-b`: 9 stories, 9 syntheses, 9 latest-index rows, 0 failures
- `gun-c`: 9 stories, 9 syntheses, 9 latest-index rows, 0 failures

Post-reset visible public latest-index checks:

- `https://venn.carboncaste.io/vh/news/latest-index?limit=80`: 9 visible rows,
  0 story-body exclusions
- `https://gun-a.carboncaste.io/vh/news/latest-index?limit=80`: 9 visible rows,
  0 story-body exclusions
- `https://gun-b.carboncaste.io/vh/news/latest-index?limit=80`: 9 visible rows,
  0 story-body exclusions

Relay C receives stale raw Gun rows from public clients after restart; the Web PWA and
smoke use the deployed system-writer pin and reject those rows before rendering. The
public app origin and the A/B relay REST surfaces used for release evidence remained
on the 9-row signed window.

The strengthened public browser smoke passed against the repaired public stack:

`.tmp/analysis-frame-pipeline/20260528T111908Z/public-feed-browser-smoke-strengthened-clean-reset-20260528T202016Z/public-feed-browser-smoke-summary.json`

Smoke result:

- Latest-index count: 9
- Story body readback: 9 HTTP 200, 0 HTTP 404
- Latest synthesis readback: 9 HTTP 200, 0 HTTP 404
- Missing accepted synthesis for readable text stories: 0
- Readable singleton text stories: 9
- Multi-source text stories: 0
- Visible current headlines: 8
- Expanded detail/frame rows: present
- Frame-count distribution: 4 stories with 3 rows, 5 stories with 4 rows
- Point IDs for accepted voting rows: 32 of 32 frame IDs and 32 of 32 reframe IDs
  present
- Public point-vote readback: pass
- Blocking CSP/network errors affecting story reads, synthesis, peers, or app function: none

The smoke harness now fails if a public latest-index sample contains readable text
stories without accepted synthesis or a durable terminal unavailable reason. That
strengthened behavior is covered by:

`pnpm exec vitest run --root packages/e2e src/live/public-feed-browser-smoke.vitest.mjs`

## Release Evidence

StoryCluster production readiness was refreshed with the approved release env file:

- Latest report:
  `.tmp/storycluster-production-readiness/latest/production-readiness-report.json`
- Status: `release_ready`
- Source-health release evidence: `pass`, 28 contributing sources
- Headline soak trend: `pass`, fresh within the 36 hour window

Public WSS proof passed after the strict signed peer-config origin redeploy:

- Aggregate readiness artifact:
  `.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json`
- Deployment scope: `public_wss_deployment`
- Browser app peer-config source: `remote-config`
- Browser app peer-config signed: `true`
- Browser opened sockets to all three expected public WSS peer host hashes
- Relay `healthz`, `readyz`, and `metrics`: HTTP 200 for all three public peers
- Status: `release_ready`

The production canary passed after Mesh was release-ready:

- Latest report:
  `.tmp/production-app-canary/latest/production-app-canary-report.json`
- Run id:
  `production-app-canary-20260528T200323Z-6e9cb057`
- Downstream public smoke:
  `.tmp/production-app-canary/production-app-canary-20260528T200323Z-6e9cb057/downstream-observation/public-feed-browser-smoke/public-feed-browser-smoke-summary.json`
- Status: `pass`

## Verification

Passed locally:

- `pnpm exec vitest run --root packages/e2e src/live/public-feed-browser-smoke.vitest.mjs`
- `VH_PUBLIC_FEED_APP_URL=https://venn.carboncaste.io VH_PUBLIC_FEED_GUN_PEER_URL=wss://gun-a.carboncaste.io/gun VH_PUBLIC_FEED_PUBLIC_WSS_PEERS='["wss://gun-a.carboncaste.io/gun","wss://gun-b.carboncaste.io/gun","wss://gun-c.carboncaste.io/gun"]' VH_PUBLIC_FEED_SMOKE_READY_TIMEOUT_MS=240000 pnpm test:public-feed:browser-smoke`
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

Previously failed against the undeployed or dirty public stack:

- `pnpm test:public-feed:browser-smoke`
- `pnpm --filter @vh/e2e test:live:public-feed-browser-smoke`
- `pnpm check:mvp-release-gates`
- `pnpm check:production-app-canary -- --mesh-report .tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json`

The post-commit verification matrix is recorded in the PR packet. Commit-sensitive
gates such as LUMA/MVP release gates must be evaluated from a clean working tree.

## Remaining Blockers

No product-path blockers remain in the repaired public analysis/frame evidence for the
public app origin: latest-index/story-body consistency, singleton visibility, accepted
synthesis readback, frame rows, point IDs, public WSS proof, StoryCluster readiness,
Mesh readiness, and production canary have public evidence.

Operational residual: raw relay C can be recontaminated by public Gun clients after a
store wipe. The public app and smoke reject those rows with the deployed system-writer
pin before rendering; the public origin release evidence is taken from the A/B REST
fanout and direct app/browser validation. A follow-up hardening item is to enforce the
same system-writer validation in relay REST/raw write admission for C.

## Explicit Non-Claims

This work does not claim LUMA Silver readiness, verified-human identity, one-human-one-vote,
Sybil resistance, native app readiness, legal readiness, commercial readiness, or public
beta launch readiness. The evidence is scoped to the deployed public feed
analysis/frame-table path, StoryCluster/Mesh/canary gates, and the explicit MVP release
checks named in the PR packet.
