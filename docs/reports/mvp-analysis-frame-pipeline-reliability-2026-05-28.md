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

## Pre-Deploy Public Evidence After Implementation

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

## Post-Review Fix

The review blocker was a product-visibility race: public latest/hot rows could be
written before accepted topic synthesis existed. The repair splits durable story
publication from product-visible publication:

- `services/news-aggregator/src/daemon.ts` now writes raw story bundles with
  `writeNewsStory`, not `writeStoryBundle`, during daemon ingestion.
- `services/news-aggregator/src/bundleSynthesisWorker.ts` publishes product-visible
  latest/hot rows only after `writeAcceptedSynthesis` succeeds.
- `services/news-aggregator/src/bundleSynthesisDaemonConfig.ts` writes
  `news_latest_index` and `news_hot_index` from the synthesis-ready callback.
- `infra/relay/server.js` filters latest-index REST rows unless the story body is
  readable and the topic has accepted synthesis with non-empty `facts_summary` and
  frame/reframe rows.

The second blocker was live Web PWA hydration accepting protocol-shaped latest-index
objects without the adapter validation used by refresh/REST paths. The repair makes
live subscription hydration validate those objects through
`parseNewsLatestIndexEntryRecord`, which enforces the same system-writer pin,
signature, path, and story-id semantics as `packages/gun-client/src/newsAdapters.ts`.
Per-story event versions prevent a slower validation result from reintroducing stale
subscription data after a newer event.

## Deployment Evidence

The public stack was refreshed on 2026-05-30 without committing or printing release
secrets.

Deployed public topology:

- Web PWA/public origin on A6 port `8080`
- Relay/Gun peer A on A6 port `8765`
- Relay/Gun peer B on A6 port `8766`
- Relay/Gun peer C on the Mac mini public WSS path
- Public origin image:
  `vhc-public-beta-origin:20260530-pr631-readiness-fresh-peer-config-v1-amd64`
- Public relay image:
  `vhc-public-beta-relay:20260530-pr631-readiness-fence-v1`

The public origin was rebuilt with strict signed remote peer-config boot enabled:

- `VITE_VH_STRICT_PEER_CONFIG=true`
- `VITE_GUN_PEER_CONFIG_URL=https://venn.carboncaste.io/mesh-peer-config.json`
- `VITE_GUN_PEER_CONFIG_PUBLIC_KEY` set to the public peer-config signer
- `VITE_VH_EXPOSE_PEER_TOPOLOGY=true`
- CSP `connect-src` includes only the public app origin plus the HTTPS/WSS public
  relay hosts for `gun-a`, `gun-b`, and `gun-c`

The signed peer config served at
`https://venn.carboncaste.io/mesh-peer-config.json` remains
`public-beta-fallback-wss-v1`, issued `2026-05-30T13:03:34.909Z`, expiring
`2026-06-06T13:03:34.909Z`, with peers exactly:

- `wss://gun-a.carboncaste.io/gun`
- `wss://gun-b.carboncaste.io/gun`
- `wss://gun-c.carboncaste.io/gun`

Post-deploy public health checks all returned HTTP 200:

- `https://venn.carboncaste.io/`
- `https://venn.carboncaste.io/api/analyze/health`
- `https://gun-a.carboncaste.io/health`
- `https://gun-b.carboncaste.io/health`
- `https://gun-c.carboncaste.io/health`

## Public Analysis/Frame Readback Evidence

Fresh public browser smoke passed against the redeployed stack:

`.tmp/release-evidence/public-feed-browser-smoke/1780160374505/public-feed-browser-smoke-summary.json`

Smoke result:

- Status: `pass`
- Public relay latest-index sample: 9
- Story body readback: 9 HTTP 200, 0 HTTP 404
- Latest synthesis readback: 9 HTTP 200, 0 HTTP 404
- Missing accepted synthesis or terminal unavailable state for readable text stories: 0
- Readable singleton text stories: 9
- Multi-source text stories: 0
- Visible current headlines: 8
- Frame-count distribution in the smoke sample: 4 stories with 3 rows, 5 stories
  with 4 rows
- Point IDs for accepted voting rows in the smoke sample: 32 of 32 frame IDs and
  32 of 32 reframe IDs present
- Public point-vote readback: pass; the selected frame point read back from the
  public aggregate path with `afterAgree: 7`
- Blocking CSP/network errors affecting story reads, synthesis, peers, or app
  function: none

The origin REST fanout was also audited across the full visible latest-index window
after deployment:

- `https://venn.carboncaste.io/vh/news/latest-index?limit=80`: 9 visible rows,
  0 latest-index exclusions, 1 repaired legacy-shaped row
- Story-body readback: 9 HTTP 200, 0 HTTP 404
- Latest synthesis readback: 9 HTTP 200, 0 HTTP 404
- Readable singleton text stories: 9
- Multi-source text stories: 0
- Missing accepted synthesis or terminal unavailable state: 0
- Frame-count distribution: 4 stories with 3 rows, 5 stories with 4 rows
- Frame/reframe rows: 32

Direct relay REST state after the relay restart:

- `https://gun-a.carboncaste.io/vh/news/latest-index?limit=80`: 9 visible rows
- `https://gun-b.carboncaste.io/vh/news/latest-index?limit=80`: 9 visible rows
- `https://gun-c.carboncaste.io/vh/news/latest-index?limit=80`: 0 visible rows
  after restart, so stale relay-C raw rows are not part of the product-visible REST
  window

## Commit-Head Release Evidence

The following paths are the post-fix, clean-commit release evidence for PR #631.
Do not use the stale 2026-05-28 Mesh/canary/status claims as current release
evidence.

- StoryCluster production readiness:
  `.tmp/storycluster-production-readiness/latest/production-readiness-report.json`
  with `status: release_ready`.
- LUMA mesh reader-path coverage:
  `.tmp/mesh-luma-gated-write-coverage/latest/mesh-luma-gated-write-coverage-report.json`
  with `status: pass`.
- Public WSS peer-config proof:
  `.tmp/mesh-production-readiness/mesh-production-readiness-20260530T155607Z-4b08de91/source-reports/deployed_wss/mesh-production-readiness-report.json`
  with `failures: []`; the aggregate Mesh report below is the release-ready
  decision.
- Mesh production readiness:
  `.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json`
  with `run_id: mesh-production-readiness-20260530T155607Z-4b08de91`,
  `status: release_ready`, `release_ready_blockers: []`, and
  `VH_MESH_DEPLOYED_WSS_PUBLIC_PROOF=true`.
- Production app canary:
  `.tmp/production-app-canary/latest/production-app-canary-report.json` with
  `run_id: production-app-canary-20260530T164447Z-30c70493`, `status: pass`,
  `reason: all_required_surfaces_observed`, and all required downstream surfaces
  observed.
- MVP release gates:
  `.tmp/mvp-release-gates/latest/mvp-release-gates-report.json` with
  passing public smoke artifact
  `.tmp/release-evidence/public-feed-browser-smoke/1780159960742/public-feed-browser-smoke-summary.json`
  and all gates passing.
- Public beta launch closeout:
  `pnpm check:public-beta-launch-closeout` passes against the same clean commit.

## Verification

Targeted tests passed before the final clean-commit gate run:

- `pnpm --filter @vh/gun-client test -- newsAdapters.test.ts`
- `pnpm --filter @vh/web-pwa exec vitest run src/store/news/hydration.test.ts`
- `pnpm --filter @vh/news-aggregator test -- bundleSynthesisWorker.test.ts daemon.production.test.ts`
- `pnpm --filter @vh/news-aggregator exec vitest run --config ./vitest.config.ts src/bundleSynthesisDaemonConfig.test.ts src/bundleSynthesisWorker.test.ts src/daemon.production.test.ts`
- `node --check infra/relay/server.js`
- `VH_PUBLIC_FEED_APP_URL=https://venn.carboncaste.io VH_PUBLIC_FEED_GUN_PEER_URL=wss://gun-a.carboncaste.io/gun VH_PUBLIC_FEED_PUBLIC_WSS_PEERS='["wss://gun-a.carboncaste.io/gun","wss://gun-b.carboncaste.io/gun","wss://gun-c.carboncaste.io/gun"]' pnpm test:public-feed:browser-smoke`

Final clean-commit verification:

- `pnpm --filter @vh/gun-client test`
- `pnpm --filter @vh/news-aggregator test`
- `pnpm --filter @vh/web-pwa test`
- `pnpm test:public-feed:browser-smoke`
- `pnpm check:storycluster:production-readiness`
- `pnpm check:mesh:production-readiness`
- `pnpm check:production-app-canary -- --mesh-report .tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json`
- `pnpm check:mvp-release-gates`
- `pnpm check:public-beta-launch-closeout`
- `pnpm docs:check`
- `git diff --check origin/main...HEAD`
- `node tools/scripts/check-diff-coverage.mjs`
- `pnpm check:public-namespace-leaks`

## Remaining Blockers

No public feed analysis/frame product-path blocker remains in the post-fix public
smoke evidence above. PR #631 remains draft and is not marked ready or merged here;
mergeability still depends on the pushed branch head, GitHub checks, and reviewer
approval.

## Explicit Non-Claims

This work does not claim LUMA Silver readiness, verified-human identity,
one-human-one-vote, Sybil resistance, native app readiness, legal readiness,
commercial readiness, or public beta launch readiness. The evidence is scoped to the
deployed public feed analysis/frame-table path, StoryCluster/Mesh/canary gates, and
the explicit MVP release checks named in the PR packet.
