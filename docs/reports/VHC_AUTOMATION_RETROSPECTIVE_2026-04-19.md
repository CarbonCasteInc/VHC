# VHC Automation Retrospective - 2026-04-19

## Status

The VHC Codex cron automations were torn down on 2026-04-19 by pausing the six local automation definitions under `/Users/bldt/.codex/automations`:

- `spaced-soak` - Publisher Canary
- `consumer-smoke` - Consumer Smoke
- `retained-window-soak` - Retained Uplift
- `corroboration-scout` - Corroboration Scout
- `findings-triage` - Findings Triage
- `findings-executor` - Findings Executor

The TOML and memory files were preserved as an audit trail. The automations were not deleted.

## Executive Conclusion

The automation program produced useful engineering artifacts, but the scheduled public-soak pipe never became a trustworthy production-readiness signal.

The root problem was architectural: the Codex worktree cron environment was not stable enough to run a live-news production-soak wave. It intermittently lost DNS/outbound feed access, failed to pull from GitHub, failed to bind local StoryCluster services, and ran against whatever branch the canonical workspace happened to be on. Those are environmental failures, not product-readiness evidence.

Going forward, Codex automations should not own live public-soak execution. They can still be useful for review, triage, and artifact interpretation after a deterministic host-level runner produces artifacts.

## What Worked

### Source Health And Admission Hardening

The automation failures forced several real improvements:

- global feed-stage outages are detected and preserved instead of poisoning latest source health
- source-health trend semantics handle invalid outage runs more honestly
- recovered retries no longer permanently taint a source after later success
- source-slate changes reset release-evidence comparability
- HTML hub/feed discovery improved for candidate source scouting
- source-health CLI exits cleanly after writing artifacts

Useful examples:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/1776299547500/source-health-report.json`
- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json`

### Source Surface Improved

The scout/admission loop helped promote useful sources and prune bad ones.

Sources promoted during the cycle included:

- `latimes-california`
- `militarytimes-news`
- `fedsmith-news`
- `democracydocket-alerts`
- `bigbendsentinel-border-wall`
- `ap-politics`

The starter surface reached a healthy 29-source slate in manual validation:

- `readinessStatus: "ready"`
- `releaseEvidence.status: "pass"`
- `keep/watch/remove: 29 / 0 / 0`

### Deterministic StoryCluster Coverage Improved

The scout/executor lanes surfaced real regression cases that were turned into checked-in coverage.

Notable wins:

- Nevada voter-list lawsuit vs college-sports executive-order false merge was fixed and gated.
- Scout-backed same-event source-growth fixtures were added for Military Times, Los Angeles Times, FedSmith, Big Bend Sentinel, and Democracy Docket.
- Low-signal canonical overlap handling was hardened around generic `executive_order` / `donald_trump` pressure.

### UI/Data Semantics Improved

The item-level reliability work clarified a product rule:

- extractable articles may enter analysis/framing
- non-extractable but legitimate links may render as `related_links`
- hard-blocked links are excluded entirely

That separation is stronger than the original all-or-nothing source-drop model.

### Corroboration Scout Produced Useful Research Signal

Even after the public-soak pipe failed, the scout lane produced useful insight from existing artifacts.

Recent useful findings included:

- batch-fragmentation cases where pairwise `explainMerge` returned `same_event_match`, but full batch assignment fragmented
- publisher candidates such as The Independent, Anadolu, LBC, Newsmax, Richland Source, Inside Climate News, and News 5 Cleveland
- evidence that some failures belong in regression coverage before any source promotion

## What Failed

### Scheduled Source Health Often Had No Effective External Network

The strongest failure signature was not one source failing. It was all enabled feeds failing at the same stage.

Examples:

- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/1776507104745/source-health-report.json`
- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/1776593496966/source-health-report.json`
- `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-admission/1776597788212/source-health-report.json`

Common result:

- `readinessStatus: "blocked"`
- `globalFeedStageFailure: true`
- `latestPublicationAction: "preserve_previous_latest"`
- `keep/watch/remove: 0 / 29 / 0`
- `feed_links_unavailable: 29`
- `feed_fetch_error: 29`

The same scheduled context also failed to resolve `github.com` during `git pull --ff-only`. That points to runner-level DNS/outbound access instability.

### Scheduled Retained Uplift Could Not Reliably Start Local Services

Retained uplift repeatedly failed before semantic-soak execution because the scheduled runner could not reliably bind or find a StoryCluster port.

Observed failure shape:

- preferred StoryCluster `tcp:4310` not bindable
- fallback probing found no bindable StoryCluster port
- no new semantic-soak artifact was produced

This makes the scheduled runner unsuitable for a multi-service local stack.

### Consumer Smoke Passed Against Stale Data

Consumer smoke often passed, but only by selecting the last passing publisher-canary artifact instead of validating the current day's failed canary output.

Example:

- current canary failed at `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-publisher-canary/1776593576593/publisher-canary-summary.json`
- consumer reused `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-publisher-canary/1776299610247`

That is useful as a static contract check, but not as proof that the current public-soak wave is healthy.

### The Runner Was Not Pinned To Main

Recent scheduled runs executed while the canonical workspace was on:

- `coord/bundle-synthesis-spine`

That branch contained `main` plus active feature work. A production-readiness automation cannot depend on the mutable state of the developer's current workspace branch.

### Prompt Logic Became A State Machine

The TOML prompts accumulated operational policy:

- when to use preserved latest
- when to skip
- when to classify failures
- which artifacts to prefer
- when to run follow-up commands

That logic belongs in deterministic scripts, not in LLM automation prompts.

## Lessons Learned

### 1. Codex Cron Is Not A Production Runner

Codex cron is useful for reading artifacts, summarizing outcomes, and doing bounded code work. It is not a reliable executor for a live-news soak that depends on:

- stable DNS
- outbound HTTPS access
- clean GitHub access
- local port binding
- long-running multi-process services
- branch pinning
- release-readiness semantics

### 2. Environment Failures Must Be First-Class

The system needs a distinct `environment_unhealthy` result before any product gate runs.

Minimum preflight:

- resolve `github.com`
- resolve representative feed hosts
- fetch representative feed URLs over HTTPS
- bind or reuse required local service ports
- verify branch is `main`
- verify `HEAD == origin/main`
- verify worktree is clean
- verify Node version matches the repo range

If preflight fails, the wave should stop and write an environment artifact. It should not write product-looking canary or retained results.

### 3. One Wave Needs One Deterministic Entrypoint

The public-soak wave should be a single script, not six independent LLM prompts:

```bash
pnpm automation:public-soak:wave
```

That script should produce one summary with:

- environment status
- source-health status
- publisher-canary status
- consumer-smoke status
- retained-uplift status
- production-readiness status
- exact artifact paths

### 4. Stale Fallbacks Must Not Count As Fresh Success

Using preserved latest or a previous passing canary is valid for continuity. It is not valid as current-wave production evidence.

Suggested status names:

- `consumer_contract_pass_stale_snapshot`
- `source_health_preserved_latest_due_environment_outage`
- `canary_skipped_environment_unhealthy`
- `retained_skipped_environment_unhealthy`

### 5. Scout And Triage Are Better Uses Of Codex Automation

The best Codex automation outputs were interpretive:

- scout found likely corroboration opportunities
- triage identified the highest-priority blocker
- executor sometimes prepared bounded patches

Those are LLM-shaped tasks. Running a live multi-service soak is not.

## Replacement Architecture

### Keep Codex For Review Lanes Only

Potential future Codex automations:

- read latest public-soak artifacts
- summarize production-readiness status
- identify candidate regression fixtures
- review scout output
- propose bounded engineering follow-ups

These should not fetch live feeds or start local listener services.

### Move Public Soak To A Stable Host Runner

Public soak should run from one of:

- launchd with a known host environment
- cron on a stable host
- a self-hosted CI runner
- GitHub Actions only if network, secrets, ports, and runtime duration are explicitly supported

Required guarantees:

- pinned checkout of `main`
- clean worktree
- Node version within repo range
- deterministic environment variables
- stable outbound HTTPS
- stable local service binding
- explicit artifact directory

### Add A Wave Report Artifact

Suggested path:

- `/Users/bldt/Desktop/VHC/VHC/.tmp/public-soak-wave/<timestamp>/public-soak-wave-summary.json`

The wave summary should be the only artifact used for production-readiness gating.

### Codify Production Readiness Separately

Production readiness should not be inferred from individual lane memories.

It should require:

- environment preflight pass
- fresh source-health `ready/pass`
- fresh publisher canary pass
- fresh consumer smoke pass against that publisher snapshot
- retained uplift completed
- retained evidence maturity thresholds met over genuinely spaced executions
- no stale fallback counted as fresh evidence

## Final Decision

The VHC Codex cron automation set is paused.

Do not restart the public-soak execution lanes in their current form. Rebuild the wave as deterministic host-level automation, then optionally add Codex review automations that read and summarize the resulting artifacts.
