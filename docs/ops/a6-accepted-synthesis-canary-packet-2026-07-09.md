# A6 Accepted-Synthesis Canary Packet - 2026-07-09

> Status: `draft_do_not_run_until_preconditions_pass`
> Owner: VHC Ops
> Last Reviewed: 2026-07-09
> Depends On: `docs/ops/news-aggregator-production-service.md`,
> `docs/ops/public-feed-freshness-monitor.md`,
> `docs/ops/public-beta-image-deploy.md`,
> `docs/ops/storycluster-headline-soak-credential-repair-2026-07-09.md`,
> `docs/plans/RELEASE_READINESS_SPRINT_OUTLINE_2026-07-08.md`,
> `docs/ops/public-beta-launch-control-2026-07-09.md`

This is the dedicated A6 canary packet for proving at least one live public
story reaches accepted-current synthesis and frame-table readiness. It is a
draft packet only. Do not run it until the preconditions below are verified in
the same operator session.

The canary shape is intentionally **one-shot public synthesis catch-up**, not a
live publisher Scope B flip. `VH_NEWS_SCOPE_B_ENRICHMENT_ENABLED` stays `0` for
the running publisher, and `vh-news-aggregator.service` is not restarted by this
packet. The packet runs `pnpm catchup:public-synthesis` with a sample limit of
one against current public pending lifecycle rows, then proves the resulting
accepted synthesis through public readbacks and browser evidence.

## Non-Goals

This packet does not approve:

- publisher restart;
- relay restart;
- changing relay daemon tokens;
- enabling `VH_NEWS_SCOPE_B_ENRICHMENT_ENABLED=1` on the live publisher;
- product-feed retention, compaction, or memory remediation;
- source-surface changes;
- auth-callback/provider deployment;
- pager cutover;
- Codex live execution/autonomy;
- broad accepted-synthesis rollout beyond a one-story canary.

If any of those becomes necessary, stop and draft a separate packet.

## Required Preconditions

All must be true before the operator runs the canary:

1. Lane 0 launch-control owners/signoffs are filled or explicitly assigned for
   the session.
2. Source-health release evidence is passing on the intended source surface.
3. StoryCluster production-readiness is no longer blocked by
   `storycluster_openai_invalid_api_key`; use
   `docs/ops/storycluster-headline-soak-credential-repair-2026-07-09.md` first.
4. Email alerting remains active and reaches the release owner.
5. A fresh read-only A6 readback shows:
   - `vh-news-aggregator.service` active with `ExecMainStatus=0`;
   - `vh-storycluster-engine.service` active with `ExecMainStatus=0`;
   - `vh-public-feed-alert-watch.timer` active;
   - `vh-phase5-scope-a-watch-closure.timer` active;
   - public-feed freshness monitor passing;
   - relay liveness, relay snapshot freshness, and watch-closure passing.
6. The operator records whether this canary intentionally ends or interrupts the
   unattended Scope A watch window. Do not later count the window as untouched.
7. If the release claim depends on post-A6-current repo code or Web PWA assets,
   the A6 checkout/origin image update packet has already run and passed. This
   canary does not rebuild or redeploy the PWA origin image.

## Read-Only Readback

Run on A6 before any write-capable command:

```bash
ssh humble@ccibootstrap
cd /home/humble/VHC
git rev-parse --short=12 HEAD
git status --short
systemctl --user show vh-news-aggregator.service \
  -p ActiveState -p SubState -p ExecMainStatus -p NRestarts --no-pager
systemctl --user show vh-storycluster-engine.service \
  -p ActiveState -p SubState -p ExecMainStatus -p NRestarts --no-pager
systemctl --user status vh-public-feed-alert-watch.timer --no-pager
systemctl --user status vh-phase5-scope-a-watch-closure.timer --no-pager
corepack pnpm@9.7.1 check:public-feed:freshness-monitor
exit
```

Print env metadata and names only:

```bash
ssh humble@ccibootstrap
stat -c '%a %U %G %n' ~/.config/vhc/news-aggregator.env ~/.config/vhc/storycluster.env
sha256sum ~/.config/vhc/news-aggregator.env ~/.config/vhc/storycluster.env
awk -F= '/^[A-Z0-9_]+=/ {print FILENAME ":" $1}' \
  ~/.config/vhc/news-aggregator.env ~/.config/vhc/storycluster.env | sort
exit
```

Do not print env values, relay daemon tokens, OpenAI keys, system-writer
private keys, or bearer headers.

## Canary Command

Run the one-shot catch-up with a single candidate and 2-of-3 relay write quorum.
The command sources the existing A6 env files into the operator shell, then
overrides only canary scope and quorum for this process. It does not edit env
files and does not restart services.

```bash
ssh humble@ccibootstrap
cd /home/humble/VHC
set -a
. ~/.config/vhc/storycluster.env
. ~/.config/vhc/news-aggregator.env
set +a

export VH_NEWS_SCOPE_B_ENRICHMENT_ENABLED=0
export VH_PUBLIC_SYNTHESIS_CATCHUP_LIMIT=1
export VH_BUNDLE_SYNTHESIS_ENABLED=true
export VH_BUNDLE_SYNTHESIS_WRITE_RELAY_REST=true
export VH_BUNDLE_SYNTHESIS_RELAY_WRITE_MIN_SUCCESS=2
export VH_BUNDLE_SYNTHESIS_RELAY_WRITE_REQUIRE_ALL=false
export VH_PUBLIC_SYNTHESIS_CATCHUP_GUN_RADISK=false

corepack pnpm@9.7.1 catchup:public-synthesis
exit
```

Expected artifact:

```text
.tmp/release-evidence/public-synthesis-catchup/latest/public-synthesis-catchup-summary.json
```

Acceptable canary command outcomes:

- `status: "pass"` with exactly one written candidate;
- `status: "partial"` only if at least one candidate was written and the
  operator immediately treats non-written rows as a follow-up blocker.

Non-success outcomes:

- `no_candidates`: stop; there is no canary proof. Do not widen the sample until
  freshness/source/story lifecycle evidence explains why no pending row exists.
- `fail`: stop; inspect `results[].error` and do not retry blindly.

## Secret-Safe Artifact Summary

After the command, summarize the artifact without printing secrets:

```bash
ssh humble@ccibootstrap
cd /home/humble/VHC
jq '{
  status,
  commit_sha,
  configured_peer_count,
  scan,
  results: [.results[] | {
    story_id,
    topic_id,
    source_count,
    canonical_source_count,
    previous_lifecycle_status,
    worker_status,
    synthesis_id,
    latest_status,
    reason,
    error_present: ((error // "") | length > 0)
  }]
}' .tmp/release-evidence/public-synthesis-catchup/latest/public-synthesis-catchup-summary.json
exit
```

Record the first written `story_id` and `topic_id` as the canary target.

## Public Readback

Use the written story/topic ids from the artifact:

```bash
story_id="<written-story-id>"
topic_id="<written-topic-id>"

curl -fsS \
  "https://venn.carboncaste.io/vh/news/synthesis-lifecycle?story_id=${story_id}" \
  | jq '{status, frame_table_state, synthesis_id, frame_point_id, reframe_point_id}'

curl -fsS \
  "https://venn.carboncaste.io/vh/topics/synthesis?topic_id=${topic_id}" \
  | jq '(.record.__topic_synthesis_json | fromjson) as $synthesis | {
    ok,
    topic_id,
    synthesis_id,
    synthesis_status: ($synthesis.status // null),
    accepted_at: ($synthesis.accepted_at // null),
    facts_summary_present: (($synthesis.facts_summary // "") | length > 0),
    frame_count: (($synthesis.frames // []) | length),
    frame_point_ids_present: ([$synthesis.frames[]? | select((.frame_point_id // "") | length > 0)] | length),
    reframe_point_ids_present: ([$synthesis.frames[]? | select((.reframe_point_id // "") | length > 0)] | length)
  }'
```

Required:

- lifecycle `status` is `accepted_available`;
- lifecycle `frame_table_state` is `frame_table_ready`;
- lifecycle has non-empty `synthesis_id`, `frame_point_id`, and
  `reframe_point_id`;
- synthesis has non-empty `facts_summary`;
- synthesis has at least one frame;
- every votable frame row used for the canary has stable `frame_point_id` and
  `reframe_point_id`.

## Browser Canary

Run a browser proof against the public PWA after the public readback passes:

```bash
VH_PUBLIC_FEED_SMOKE_REQUIRE_ACCEPTED_SYNTHESIS=true \
VH_PUBLIC_FEED_SMOKE_REQUIRE_SECOND_BROWSER_VOTE=false \
corepack pnpm@9.7.1 test:public-feed:browser-smoke
```

The canary proof requires the browser artifact to show:

- public app opens successfully;
- the canary story can be opened from the public feed or direct detail route;
- accepted summary renders;
- bias/framing table renders from accepted-current synthesis;
- point ids are present for frame/reframe rows;
- vote controls do not appear for pending, invalid, stale, or suppressed rows;
- no CSP/network failures affect latest-index, story, lifecycle, synthesis, or
  aggregate read paths.

Do not use this browser canary as the final three-browser stance persistence
proof. That remains Lane 7.

## Post-Canary Health Readback

Immediately after the canary:

```bash
ssh humble@ccibootstrap
cd /home/humble/VHC
systemctl --user show vh-news-aggregator.service \
  -p ActiveState -p SubState -p ExecMainStatus -p NRestarts --no-pager
systemctl --user show vh-storycluster-engine.service \
  -p ActiveState -p SubState -p ExecMainStatus -p NRestarts --no-pager
corepack pnpm@9.7.1 check:public-feed:freshness-monitor
exit
```

The canary passes only if raw feed freshness and the two services remain green
after the accepted-synthesis write.

## Exit Criteria

- One public story has accepted-current lifecycle and synthesis readback.
- The accepted synthesis contains non-empty `facts_summary`.
- The accepted frame table has stable `frame_point_id` and `reframe_point_id`.
- The public browser can open and render the accepted summary/table.
- Raw public-feed freshness remains green after the write.
- `vh-news-aggregator.service` was not restarted.
- `vh-news-aggregator.service` and `vh-storycluster-engine.service` remain
  active with `ExecMainStatus=0`.
- No alert email fires during or after the canary window.
- The artifact path and public readback ids are recorded in the release notes.

## Stop Rules

Stop immediately and do not widen the canary if:

1. source-health or StoryCluster production-readiness is red before the canary;
2. public-feed freshness, relay liveness, relay snapshot freshness, or
   watch-closure is red before the canary;
3. `catchup:public-synthesis` returns `fail` or `no_candidates`;
4. any relay returns auth failure for `/vh/topics/synthesis`,
   `/vh/topics/synthesis-candidate`, or `/vh/news/synthesis-lifecycle`;
5. the artifact shows `latest_write_failed`, `worker_error`, or a worker error
   indicating write fanout below the configured 2-of-3 quorum;
6. public lifecycle readback is not `accepted_available` and
   `frame_table_ready`;
7. public synthesis readback lacks `facts_summary`, frame rows, or point ids;
8. browser evidence cannot render the accepted-current summary/table;
9. either service restarts, fail-closes, or reports nonzero `ExecMainStatus`;
10. an alert email fires;
11. the operator discovers that fixing the failure requires publisher restart,
    relay restart, relay token change, source change, or broader Scope B
    enablement.

Rollback is claim-first: stop the canary, keep alerting live, preserve artifacts,
and remove accepted-synthesis claims from tester copy. Do not attempt destructive
mesh rollback from this packet.
