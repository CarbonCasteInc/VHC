# Mesh Readiness State Of Play - 2026-06-12

## Scope

Repository: `CarbonCasteInc/VHC`

Report branch: `coord/mesh-readiness-state-of-play-20260612`

Evidence source commit: `de4fb56edb5a35b8ded1846da9c1c34d78f8c0f3`

Evidence source branch recorded by gates: `coord/mvp-public-news-release-gates-public-runtime-v1`

Current public app under test: `https://venn.carboncaste.io`

Public relay peers under test:

- `wss://gun-a.carboncaste.io/gun`
- `wss://gun-b.carboncaste.io/gun`
- `wss://gun-c.carboncaste.io/gun`

PR context:

- PR #632, "Guard public feed organic composition evidence", is merged.
- The post-merge release evidence below is from `main` at `de4fb56edb5a35b8ded1846da9c1c34d78f8c0f3`, before this docs-only report branch.

This report is a handoff packet for an independent reviewer. It separates what is already proven, what is only partially proven, and what remains blocked before we can call the mesh/full-app release ready.

## Executive Decision

Current decision: `public_news_controlled_beta_usable`, `mesh_release_ready_blocked`.

The public news product path is now usable enough for controlled public-beta interaction: public HTTP routes return JSON, the app can read and render current public stories, accepted syntheses are visible, frame tables are complete for the sampled public window, pagination works without overlap, public stance aggregate write/readback works from a second browser, and live fresh propagation passes with OpenAI preflight.

The mesh packet itself is not release ready. `pnpm check:mesh:production-readiness` exits cleanly but reports `review_required` because the canonical 30-minute soak has not been rerun and promoted on the current evidence head. The production app canary is also correctly `blocked` with `mesh_not_release_ready`, so it must not be used to claim full-app/test-group readiness yet.

## Current Gate State

| Gate or report | Current status | Artifact |
| --- | --- | --- |
| MVP release gates | `pass` | `.tmp/mvp-release-gates/latest/mvp-release-gates-report.json` |
| MVP closeout | `pass` | `.tmp/mvp-closeout/latest/mvp-closeout-report.json` |
| Mesh production readiness | `review_required` | `.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json` |
| Public WSS proof | `pass`, consumed by mesh packet | `.tmp/mesh-production-readiness/latest-public-wss-proof/mesh-production-readiness-report.json` |
| LUMA MVP production readiness | `pass` | `.tmp/luma-mvp-production-readiness/latest/luma-mvp-production-readiness-report.json` |
| LUMA mesh gated write coverage | `pass`, source commit current | `.tmp/mesh-luma-gated-write-coverage/latest/mesh-luma-gated-write-coverage-report.json` |
| Production app canary | `blocked`, expected reason `mesh_not_release_ready` | `.tmp/production-app-canary/latest/production-app-canary-report.json` |
| Public browser smoke | `pass` | `.tmp/release-evidence/public-feed-browser-smoke/1781192698271/public-feed-browser-smoke-summary.json` |
| Public composition freshness | `pass` | `.tmp/release-evidence/public-feed-composition-freshness/1781192607118/public-feed-composition-freshness-summary.json` |
| Public lifecycle accountability | `pass` | `.tmp/release-evidence/public-feed-lifecycle-accountability/1781192615780/public-feed-lifecycle-accountability-summary.json` |
| Public fresh propagation | `pass` | `.tmp/release-evidence/public-feed-fresh-propagation/1781192631852/public-feed-fresh-propagation-summary.json` |

The MVP closeout report explicitly allows only the implemented MVP public-beta scope. Its forbidden claims include mesh release readiness, production app canary success, full app production readiness, test-group readiness, LUMA Silver, verified-human identity, one-human-one-vote, and Sybil resistance.

## Public Runtime State

### Topology

The live public topology currently behaves as intended.

| Surface | Current fact |
| --- | --- |
| App origin | `https://venn.carboncaste.io` |
| Public peer A | `wss://gun-a.carboncaste.io/gun`, HTTP relay routes on `https://gun-a.carboncaste.io` |
| Public peer B | `wss://gun-b.carboncaste.io/gun`, HTTP relay routes on `https://gun-b.carboncaste.io` |
| Public peer C | `wss://gun-c.carboncaste.io/gun`, HTTP relay routes on `https://gun-c.carboncaste.io` |
| Cloudflare tunnel observed during PR #632 repair | `vhc-a6-public-beta`, Healthy, 1 active replica |
| A6 role | Web origin plus `gun-a` and `gun-b` public relays |
| Mac mini role | `gun-c` public relay behind the A6 tunnel route to `192.168.1.56:8767` |

The current local workstation for this report is not the host. The public route probes prove the deployed path is responding.

### Public HTTP Route Matrix

Live probe at `2026-06-12T01:38:04.265Z` against known accepted public story:

- Story: `story-e0777f1bdde3`
- Topic: `a87294f5803b00d6938cea50cf23171e8d23778003f3dac10a9168437b969dfd`
- Synthesis: `news-bundle:story-e0777f1bdde3:fe302a2fb1b74cb4`
- Point: `synth-point:news-bundle:story-e0777f1bdde3:fe302a2fb1b74cb4:0:frame`

| Origin | latest-index | hot-index | story | lifecycle | synthesis | aggregate |
| --- | --- | --- | --- | --- | --- | --- |
| `https://venn.carboncaste.io` | 200, count 1 | 200, count 1 | 200, source count 1 | 200, `accepted_available`, `frame_table_ready` | 200, 3 frames | 200, 11 participants |
| `https://gun-a.carboncaste.io` | 200, count 1 | 200, count 1 | 200, source count 1 | 200, `accepted_available`, `frame_table_ready` | 200, 3 frames | 200, 11 participants |
| `https://gun-b.carboncaste.io` | 200, count 1 | 200, count 1 | 200, source count 1 | 200, `accepted_available`, `frame_table_ready` | 200, 3 frames | 200, 11 participants |
| `https://gun-c.carboncaste.io` | 200, count 1 | 200, count 1 | 200, source count 1 | 200, `accepted_available`, `frame_table_ready` | 200, 3 frames | 200, 11 participants |

Route health is clean for the valid public route shapes. A separate negative probe found a parity cleanup item: omitting `topic_id` from `/vh/aggregates/point` returns relay JSON 400 on `gun-a/b/c`, but surfaces as a Cloudflare-shaped 502 through `venn`. That is not the valid aggregate proof route, but it should be normalized before broad beta traffic.

## Public Feed Evidence

### Browser Smoke

Artifact: `.tmp/release-evidence/public-feed-browser-smoke/1781192698271/public-feed-browser-smoke-summary.json`

Status: `pass`

Key facts:

- Base URL: `https://venn.carboncaste.io/`
- Gun peer URL: `wss://gun-a.carboncaste.io/gun`
- Active public relay origins: `gun-a`, `gun-b`, `gun-c`, `venn`
- Active public WSS peers: `gun-a`, `gun-b`, `gun-c`
- Latest-index count: 15
- Story readback count: 15
- Embedded relay story body readback count: 15
- REST diagnostics: 33 HTTP 200, 0 non-OK, 0 network failures, 0 Cloudflare 1033, 0 VHC relay 502
- Visible cards: 15
- Refresh count: 15
- Accepted synthesis stories: 15
- Frame-table-ready stories: 15
- Frame rows: 46
- Frame point IDs present: 46 of 46
- Reframe point IDs present: 46 of 46
- Public stance aggregate after vote: 11 agree, 0 disagree, 11 participants, 11 rows
- Second-browser vote visibility: 11 votes visible
- Deployed system-writer pin source: `deployed-app`
- Active writer: `vh-public-beta-news-system-writer-v4`
- Retired writers: `vh-public-beta-news-system-writer-v1`, `vh-public-beta-news-system-writer-v2`, `vh-public-beta-news-system-writer-v3`

Composition from the public relay:

- Total visible: 15
- Singleton visible: 11
- Multi-source visible: 4
- Organic selected count: 15
- Organic singleton visible: 11
- Organic multi-source visible: 4
- Scan-window selected count: 15
- Scan-window singleton visible: 11
- Scan-window multi-source visible: 4
- Backfill used: false
- Backfill story IDs: none

Pagination:

- Page limit: 6
- First page: 6 records
- Second page: 6 records
- Overlap: 0 story IDs
- First page next cursor: `1781165766000`
- Second page next cursor: `1780195020358`
- First page composition: 6 singleton, 0 multi-source
- Second page composition: 5 singleton, 1 multi-source

This proves the public product path can render current rows, refresh, request older rows by cursor, avoid duplicate pagination overlap, open story detail, render accepted synthesis, and read back public stance aggregate state.

### Composition Freshness

Artifact: `.tmp/release-evidence/public-feed-composition-freshness/1781192607118/public-feed-composition-freshness-summary.json`

Status: `pass`

Counts:

- Latest-index count: 15
- Story readback count: 15
- Singleton readable count: 11
- Multi-source readable count: 4
- Accepted synthesis story count: 15
- Missing accepted synthesis story count: 0

### Lifecycle Accountability

Artifact: `.tmp/release-evidence/public-feed-lifecycle-accountability/1781192615780/public-feed-lifecycle-accountability-summary.json`

Status: `pass`

Counts:

- Total sampled: 15
- Raw story readable: 15
- Singleton raw: 11
- Multi-source raw: 4
- Product visible: 15
- Accepted available: 15
- Frame table ready: 15
- Lifecycle ledger complete: 15
- Pending, in-progress, retryable failure, terminal unavailable: all 0
- Lifecycle ledger missing/invalid/source-set mismatch: all 0

### Fresh Propagation

Artifact: `.tmp/release-evidence/public-feed-fresh-propagation/1781192631852/public-feed-fresh-propagation-summary.json`

Status: `pass`

Publisher stage counts:

- Raw RSS items: 15
- Normalized items: 13
- Topic cluster items: 13
- Cluster bundles: 8
- Published stories: 8

Story counts:

- Raw stories: 8
- Readable story bodies: 8
- Latest-index rows: 8
- Hot-index rows: 8
- Singleton count: 8
- Multi-source count: 0

OpenAI preflight:

- Status: `pass`
- Provider: `openai-storycluster`
- Text model: `gpt-4o-mini`
- Embedding model: `text-embedding-3-small`
- Effective base URL: `https://api.openai.com/v1`
- API key present: true
- Text model auth: pass
- Embedding model auth: pass

Consumer:

- Browser validation mode: `browser`
- Render count: 8
- Public browser smoke was required and passed

Important nuance: this fresh-propagation run proves live RSS to StoryCluster to public consumer for singleton stories. It does not, by itself, prove a fresh multi-source bundle in that specific run. The public browser, composition, and lifecycle windows prove existing multi-source public stories are readable, accepted, and frame-table-ready.

## Mesh Readiness Evidence

Artifact: `.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json`

Status: `review_required`

Reason: `implemented mesh proof commands produced a complete aggregate packet, but release-ready blockers remain`

Release readiness blocker:

| Blocker | Required command | Reason |
| --- | --- | --- |
| `canonical-30-minute-soak` | `VH_MESH_SOAK_DURATION_MS=1800000 pnpm test:mesh:soak` | Latest soak evidence is bounded/shortened and does not satisfy the canonical 30-minute soak claim. |

Source gates from the aggregate packet:

| Gate | Command | Exit | Status | Result status |
| --- | --- | --- | --- | --- |
| Local production topology | `pnpm test:mesh:topology-drills` | 0 | pass | review_required |
| Signed peer-config browser boot | `pnpm test:mesh:signed-peer-config-canary` | 0 | pass | review_required |
| Deployed WSS local TLS profile | `pnpm test:mesh:deployed-wss-peer-config` | 0 | pass | review_required |
| State-resolution matrix | `pnpm test:mesh:state-resolution-drills` | 0 | pass | review_required |
| Disconnect duplicate-write drills | `pnpm test:mesh:disconnect-drills` | 0 | pass | review_required |
| Partition/heal topology | `pnpm test:mesh:partition-drills` | 0 | pass | review_required |
| Explicit read-repair strategy | `pnpm test:mesh:read-repair-drills` | 0 | pass | review_required |
| Bounded rolling restart soak | `pnpm test:mesh:soak` | 0 | pass | review_required |
| Peer-config rollback drill | `pnpm test:mesh:peer-config-rollback-drill` | 0 | pass | review_required |
| Clock-skew/auth-window matrix | `pnpm test:mesh:clock-skew-drills` | 0 | pass | review_required |
| Conflict/protocol fixtures | `pnpm test:mesh:conflict-drills` | 0 | pass | review_required |
| Evidence scrub promotion | `pnpm check:mesh-evidence-scrub -- --source-dir ...` | 0 | pass | pass |
| Canonical 30-minute soak | `VH_MESH_SOAK_DURATION_MS=1800000 pnpm test:mesh:soak` | skipped | skipped | review_required |

The important distinction is that implementation gates are passing, but the aggregate readiness claim remains blocked because the canonical soak was not performed.

### Public WSS Proof

Artifact: `.tmp/mesh-production-readiness/latest-public-wss-proof/mesh-production-readiness-report.json`

Status: public WSS proof `pass`; aggregate public WSS proof source consumed by mesh readiness.

Verified public WSS proof scope:

- Config ID: `public-beta-fallback-wss-v2`
- Expected public peers: 3
- Quorum required: 2
- Browser boot opened all expected public WSS hosts
- Relay health, readiness, and metrics endpoints responded for each public peer
- CSP connect-src covered app origin, relay HTTP origins, and WSS peers

This proves the public WSS deployment shape. It does not prove public conflict, partition/heal, rollback, clock-skew, or 30-minute soak behavior. Those remain governed by the mesh readiness packet.

### Production App Canary

Artifact: `.tmp/production-app-canary/latest/production-app-canary-report.json`

Status: `blocked`

Reason: `mesh_not_release_ready`

This is correct fail-closed behavior. It verifies the canary sees the current mesh report, sees the current commit, sees a clean source report, then blocks because the mesh status is `review_required`.

## Story And Frame Pipeline Assessment

### Is the singleton story and story-bundle analysis/frame-table pipeline working?

For the public window sampled by the release gates: yes.

Evidence:

- 15 of 15 sampled public stories have accepted synthesis.
- 15 of 15 have lifecycle status `accepted_available`.
- 15 of 15 have `frame_table_ready`.
- 46 of 46 frame rows have persisted frame point IDs.
- 46 of 46 frame rows have persisted reframe point IDs.
- Public stance voting targets the persisted synthesis point ID, not a text-derived fallback point.

Implementation path:

- StoryCluster creates document features and story bundles through `services/storycluster-engine/src/stageHandlers.ts`.
- Bundle synthesis reads the selected story bundle in `services/news-aggregator/src/bundleSynthesisWorker.ts`.
- `services/news-aggregator/src/bundleSynthesisFullText.ts` extracts readable full text per source, analyzes each readable source individually, and stores source-analysis audit data.
- `services/news-aggregator/src/prompts.ts` builds a second bundle-level synthesis prompt from those per-article analyses.
- `services/news-aggregator/src/bundleSynthesisPayloads.ts` writes `topic-synthesis-v2`, attaches persisted frame/reframe point IDs, and records `inputs.story_bundle_ids`.
- The relay and app render the accepted synthesis only when lifecycle/source-revision checks say it is current.

Nuance:

- If a story has only one readable source, the pipeline still creates accepted synthesis and frame rows, with single-source warnings.
- If sources are unreadable, the worker records lifecycle failure instead of faking synthesis.
- The latest fresh-propagation run had 8 singletons and 0 multi-source bundles; multi-source readiness is proven by the sampled public window, not by that one fresh run.

### Is each article analyzed before bundle meta-analysis?

For readable analysis-eligible sources: yes.

The worker resolves the bundle's analysis sources, extracts article text, runs `generateArticleAnalysisPrompt` for each readable source, parses the strict article-analysis JSON, then passes the per-source analysis objects into `generateBundleSynthesisPrompt`. The bundle prompt explicitly receives publisher, title, key facts, summary, biases, counterpoints, and perspectives for each analyzed article.

The final accepted synthesis is therefore a meta-analysis over article-level analyses, not a direct one-shot summary over a bundle label. It is designed to cross-synthesize agreements, conflicts, and frame/reframe differences across sources when more than one source is present.

### Is the mesh functioning as a DB for a continuous public feed?

For the public-news feed path: yes, with bounded evidence.

Implementation evidence:

- The app news store reads `readNewsLatestIndexPageWithRelayRestFallback`.
- Cursor requests pass `before` into `/vh/news/latest-index`.
- Cursor-window refresh merges newly fetched older stories into the existing store instead of replacing the feed.
- The relay filters visible rows, reads story bodies, joins lifecycle/synthesis state, returns `next_cursor`, and enforces exclusive older windows.
- The feed UI uses the store's cursor and requests `refreshLatest({ limit, before })` when loading more public news.

Live evidence:

- Public smoke first page: 6 stories.
- Public smoke second page: 6 older stories.
- Overlap: 0 stories.
- `scrollWorks` issued `refreshLatest({ limit: 15, before: 1780178400000 })`.
- Latest-index source key count in the smoke: 245.

This supports a continuous shared feed for all users over the public mesh/relay. The evidence proves at least the current and next older page. It does not prove infinite archive depth, long-term archival retention policy, or a 30-minute mesh soak under traffic.

### Are currently served mesh articles preserved as new articles arrive?

Mechanically, yes for the public latest-index/story-body path.

The latest-index is timestamp ordered. New stories enter the top window; older stories remain addressable by story ID and by older cursor windows while retained in the mesh/relay snapshot. The app merges cursor windows, so new stories can push older analyzed stories down the feed without deleting them from the client-visible dataset.

The remaining reviewer question is operational retention, not basic mechanics: decide how long public story bodies, syntheses, lifecycle rows, and aggregates must remain retained, and add a release gate or operational monitor if the product promise is "historical feed continuity beyond the current public window."

## Known Risks And Blockers

1. Mesh release readiness is blocked on the canonical 30-minute soak.

   This is the only explicit release-readiness blocker in the current mesh packet.

2. Production app canary remains blocked by mesh readiness.

   This is expected and correct. Do not claim full-app/test-group readiness until the canary is rerun and passes after the mesh report says `release_ready`.

3. Valid public route shapes are healthy, but malformed aggregate parity is uneven.

   Valid aggregate queries with `topic_id`, `story_id`, `point_id`, and `synthesis_id` return 200 JSON on all origins. Omitting `topic_id` returns a clean JSON 400 on gun origins but a Cloudflare-shaped 502 through `venn`. Normalize this before wider external traffic.

4. Raw Gun latest-root hygiene is not perfect.

   A strict direct WSS read with the repo system-writer pin found signed current rows but also stale/invalid raw child telemetry. The relay-visible public rows are filtered cleanly and gates pass. If the shippability bar includes "zero invalid raw latest-root child telemetry", add a repair/tombstone task and keep validation strict.

5. Fresh multi-source propagation is not proven by the latest fresh-propagation run.

   The public feed currently proves multi-source accepted synthesis in the served window. The fresh-propagation run proves live RSS to public consumer for singletons. A reviewer should run or wait for a fresh multi-source event if launch copy promises live cross-source corroboration for newly arriving stories.

6. Local runner Node version is outside repo engine bounds.

   The local environment used Node `v23.10.0`; repo engines expect `>=20 <23`. Commands passed except the intentionally blocked canary, but the next reviewer should use Node 20/22 for final CI parity.

## Handoff Commands For Independent Review

Use a current clone and keep secrets out of logs.

```bash
git fetch origin
git checkout coord/mesh-readiness-state-of-play-20260612
git status --short --branch
git rev-parse HEAD
```

Reproduce the green MVP/public-news gates:

```bash
git diff --check
node --check infra/relay/server.js
pnpm --filter @vh/e2e typecheck
pnpm --filter @vh/gun-client typecheck
pnpm --filter @vh/web-pwa typecheck
pnpm --filter @vh/news-aggregator typecheck
pnpm --filter @vh/storycluster-engine typecheck
pnpm check:news-sources:health
pnpm check:storycluster:correctness
```

Public-feed env:

```bash
export VH_PUBLIC_FEED_APP_URL=https://venn.carboncaste.io
export VH_PUBLIC_FEED_GUN_PEER_URL=wss://gun-a.carboncaste.io/gun
export VH_PUBLIC_FEED_PUBLIC_RELAY_ORIGINS='["https://venn.carboncaste.io","https://gun-a.carboncaste.io","https://gun-b.carboncaste.io","https://gun-c.carboncaste.io"]'
export VH_PUBLIC_FEED_PUBLIC_WSS_PEERS='["wss://gun-a.carboncaste.io/gun","wss://gun-b.carboncaste.io/gun","wss://gun-c.carboncaste.io/gun"]'
```

Public-feed gates:

```bash
pnpm test:public-feed:browser-smoke
pnpm check:public-feed:composition-freshness
pnpm check:public-feed:lifecycle-accountability
VH_PUBLIC_FEED_FRESH_PROPAGATION_REQUIRE_PUBLIC_BROWSER_SMOKE=true pnpm check:public-feed:fresh-propagation
pnpm check:public-feed:stance-aggregate-decay
```

Public WSS proof env:

```bash
export VH_MESH_PUBLIC_PEER_CONFIG_URL=https://venn.carboncaste.io/mesh-peer-config.json
export VH_MESH_PUBLIC_PEER_CONFIG_PUBLIC_KEY='YJiBPKmsoq9_IZkBWOG8rMZJdFKTtUKiAkphraZsRnc.MQ19LAvrVK3a3Cv-9bEQs0SuoThSpWiGvmYM4haP62w'
export VH_MESH_PUBLIC_CONFIG_ID=public-beta-fallback-wss-v2
export VH_MESH_PUBLIC_APP_URL=https://venn.carboncaste.io
export VH_MESH_PUBLIC_WSS_PEERS='["wss://gun-a.carboncaste.io/gun","wss://gun-b.carboncaste.io/gun","wss://gun-c.carboncaste.io/gun"]'
export VH_MESH_PUBLIC_CSP_CONNECT_SRC="'self' https://venn.carboncaste.io https://gun-a.carboncaste.io https://gun-b.carboncaste.io https://gun-c.carboncaste.io wss://gun-a.carboncaste.io wss://gun-b.carboncaste.io wss://gun-c.carboncaste.io"
export VH_MESH_PUBLIC_MINIMUM_PEER_COUNT=3
export VH_MESH_PUBLIC_QUORUM_REQUIRED=2
```

Mesh closeout path:

```bash
pnpm test:mesh:deployed-wss-peer-config:public
pnpm test:mesh:luma-gated-write-coverage -- --local-e2e
VH_MESH_SOAK_DURATION_MS=1800000 pnpm test:mesh:soak
VH_MESH_PUBLIC_WSS_PROOF_REPORT=.tmp/mesh-production-readiness/latest-public-wss-proof/mesh-production-readiness-report.json \
VH_MESH_LUMA_GATED_WRITE_COVERAGE_REPORT=.tmp/mesh-luma-gated-write-coverage/latest/mesh-luma-gated-write-coverage-report.json \
pnpm check:mesh:production-readiness
pnpm check:production-app-canary -- --mesh-report .tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json
pnpm check:luma:mvp-production-readiness
pnpm check:mvp-release-gates
pnpm check:mvp-closeout
```

Expected next-review outcome:

- If the 30-minute soak passes and `check:mesh:production-readiness` reports `release_ready`, rerun production app canary. The canary must pass before any full-app/test-group readiness claim.
- If the soak fails, fix the actual mesh failure. Do not dilute thresholds, shorten the soak, fake public WSS proof, or relabel `review_required` as ready.

## Reviewer Questions To Answer Before Launch Expansion

1. Does a canonical 30-minute soak pass on current head with public WSS proof and LUMA coverage wired into the canonical mesh packet?
2. After mesh reports `release_ready`, does production app canary pass with downstream observations for production WSS relay config, app boot, analysis, news synthesis publication, point stance write/readback, and story thread/comment surfaces?
3. Should malformed aggregate queries through `venn` return relay JSON 400 instead of Cloudflare-shaped 502?
4. Should raw Gun latest-root stale/invalid child telemetry be repaired before broader beta, even though public visible rows are filtered cleanly?
5. Do we need a separate fresh multi-source propagation proof before claiming live cross-source corroboration for newly arriving stories?
6. What is the product retention promise for older public feed items, and should that become a gate?
7. Does the app feel like a real product in a fresh-user walkthrough: load, refresh, older-page scroll, story detail, synthesis, stance vote, second-browser readback, and error states?

## Claim Boundaries

Allowed today:

- MVP public-beta release gates passed for the implemented public-news scope.
- Public HTTP routes for valid latest, hot, story, lifecycle, synthesis, and aggregate reads return JSON on `venn` and `gun-a/b/c`.
- Public browser smoke, composition freshness, lifecycle accountability, fresh propagation, and stance aggregate decay gates are green on the evidence head.
- The public WSS deployment proof passed and is consumed by the mesh readiness packet.
- The public feed can render current stories, refresh, paginate to older stories, show accepted synthesis/frame tables, and read back stance aggregate state.

Forbidden today:

- Mesh is `release_ready`.
- Production app canary passed.
- The full app is production ready.
- The app is test-group ready.
- Public WSS conflict, partition/heal, clock-skew, rollback, or canonical soak behavior is production-proven by the public WSS proof alone.
- LUMA Silver, verified-human identity, one-human-one-vote, or Sybil resistance is ready.
- Fresh multi-source propagation is proven by the latest fresh-propagation run.
- Raw Gun latest-root telemetry is perfectly clean.
