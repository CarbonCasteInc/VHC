# Automation Stack Execution Plan

Status: Execution plan
Owner: Core Engineering
Last Updated: 2026-04-01
Branch Baseline: `main` @ `80686e3`

Depends On:
- `/Users/bldt/Desktop/VHC/VHC/docs/CANON_MAP.md`
- `/Users/bldt/Desktop/VHC/VHC/docs/foundational/trinity_project_brief.md`
- `/Users/bldt/Desktop/VHC/VHC/docs/foundational/STATUS.md`
- `/Users/bldt/Desktop/VHC/VHC/docs/specs/spec-news-aggregator-v0.md`
- `/Users/bldt/Desktop/VHC/VHC/docs/ops/NEWS_UI_SOAK_LANE_SEPARATION.md`
- `/Users/bldt/Desktop/VHC/VHC/docs/ops/STORY_BUNDLER_PRODUCTION_READINESS_CHECKLIST.md`
- `/Users/bldt/Desktop/VHC/VHC/docs/ops/LOCAL_LIVE_STACK_RUNBOOK.md`

## 1. Mission

Make the recurring automation stack operationally reliable across Codex app restarts, worktree/session boundaries, and time-separated runs without weakening the existing bundler evidence contract.

This plan is successful only if both of these stay true:

1. automation lanes stop failing on local listener/bootstrap noise such as `listen EPERM`;
2. publisher-canary and retained-uplift evidence remain fresh, run-scoped, and valid for the release/readiness contract.

## 2. Canonical Constraints

These constraints come directly from the current foundational/spec/ops docs and must not be violated during implementation.

### 2.1 Product constraint

From `/Users/bldt/Desktop/VHC/VHC/docs/foundational/trinity_project_brief.md`:

- the product is a unified VENN/HERMES/AGORA civic app;
- the news lane is a trustworthy input into the broader product, not a standalone infrastructure demo;
- automation must serve product reliability, not become the product.

### 2.2 Bundler correctness constraint

From `/Users/bldt/Desktop/VHC/VHC/docs/specs/spec-news-aggregator-v0.md` and `/Users/bldt/Desktop/VHC/VHC/docs/foundational/STATUS.md`:

- primary correctness proof remains the deterministic corpus/replay gate plus the daemon-first semantic gate;
- source-health and headline-soak release evidence remain explicit production-readiness inputs;
- singleton-first publication is valid;
- later same-incident growth must preserve stable identity.

### 2.3 Lane-separation constraint

From `/Users/bldt/Desktop/VHC/VHC/docs/ops/NEWS_UI_SOAK_LANE_SEPARATION.md`:

- UI / UX work must remain separate from soak/release evidence collection;
- publisher canary validates the live publisher path;
- consumer smoke validates app consumption of published output;
- headline soak and retained uplift remain the heavier readiness/telemetry lanes.

### 2.4 Readiness constraint

From `/Users/bldt/Desktop/VHC/VHC/docs/ops/STORY_BUNDLER_PRODUCTION_READINESS_CHECKLIST.md`:

- operational canaries are not themselves release proof;
- retained-window conclusions must come from valid complete run artifacts;
- invalid or incomplete runs must be excluded from trend interpretation.

## 3. Architecture Decision

### 3.1 What becomes persistent

A user-scoped `launchd` service will own the long-lived local infrastructure required by the scheduled automations.

Persistent stack ownership is limited to:

1. StoryCluster listener
2. validated snapshot server
3. stable web preview server
4. Gun relay only if a remaining automation lane still requires it after runner refactors

### 3.2 What stays run-scoped

The following evidence lanes must remain bounded per execution and continue writing fresh run-specific artifact directories:

1. `Publisher Canary`
2. `Retained Uplift`
3. any headline-soak / semantic-soak execution used for readiness or continuity interpretation

These lanes may consume shared infrastructure, but they must not degrade into passive background observation of a continuously running daemon.

### 3.3 What becomes a pure consumer

`Consumer Smoke` becomes a pure consumer lane.

It should:

1. consume a latest passing publisher-canary snapshot;
2. consume a shared stable web endpoint;
3. never bind a local listener;
4. never be responsible for bootstrapping the app stack.

### 3.4 What stays independent

The following lanes should not depend on the shared stack to do useful work:

1. `Corroboration Scout`
2. `Findings Triage`
3. `Findings Executor`

They should continue to reason from artifacts and repo state even if the shared stack is temporarily degraded.

## 4. Non-Goals

This plan does not:

1. change the production-readiness thresholds in `/Users/bldt/Desktop/VHC/VHC/docs/specs/spec-news-aggregator-v0.md`;
2. make headline-soak proof less strict;
3. replace deterministic corpus/replay proof with automation telemetry;
4. introduce new product semantics for retained publication;
5. make the scheduled automations themselves authoritative over source-promotion policy.

## 5. Target Operating Model

### 5.1 Shared automation infrastructure

A persistent user-scoped stack lives under:

- service label: `com.vhc.automation-stack`
- installed agent path: `~/Library/LaunchAgents/com.vhc.automation-stack.plist`
- runtime state root: `/Users/bldt/Desktop/VHC/VHC/.tmp/automation-stack`

Stable outputs:

- `/Users/bldt/Desktop/VHC/VHC/.tmp/automation-stack/state.json`
- `/Users/bldt/Desktop/VHC/VHC/.tmp/automation-stack/health.json`
- `/Users/bldt/Desktop/VHC/VHC/.tmp/automation-stack/lock`
- `/Users/bldt/Desktop/VHC/VHC/.tmp/automation-stack/logs/*.log`

### 5.2 Shared-stack consumers

Every affected scheduled run starts with:

1. `pnpm automation:ensure-stack`
2. `pnpm automation:stack:health`

Then:

- `Publisher Canary` runs a bounded publisher cycle against the shared infra
- `Consumer Smoke` opens the shared web against the latest passing publisher snapshot
- `Retained Uplift` runs a bounded semantic/retained measurement cycle against the shared infra

### 5.3 Validity envelope metadata

Every run that produces evidence must record, at minimum:

1. git SHA
2. source-health artifact path
3. whether source health was fresh or fallback-derived
4. shared-stack state/version reference
5. run mode (`shared_stack` vs manual/self-managed)
6. artifact directory path
7. failure classification

Trend consumers must continue excluding invalid runs.

## 6. File-by-File Implementation Checklist

## Phase 1: Shared Stack Infrastructure

### Deliverable

A persistent `launchd`-managed local automation stack with idempotent ensure/health commands.

### Files

- [ ] Create `/Users/bldt/Desktop/VHC/VHC/tools/scripts/local-stack-lib.sh`
- [ ] Update `/Users/bldt/Desktop/VHC/VHC/tools/scripts/live-local-stack.sh`
- [ ] Create `/Users/bldt/Desktop/VHC/VHC/tools/scripts/automation-stack.sh`
- [ ] Create `/Users/bldt/Desktop/VHC/VHC/tools/scripts/automation-stack-health.mjs`
- [ ] Create `/Users/bldt/Desktop/VHC/VHC/tools/scripts/install-automation-stack-launchd.sh`
- [ ] Create `/Users/bldt/Desktop/VHC/VHC/tools/launchd/com.vhc.automation-stack.plist`
- [ ] Update `/Users/bldt/Desktop/VHC/VHC/package.json`
- [ ] Create `/Users/bldt/Desktop/VHC/VHC/docs/ops/AUTOMATION_STACK_RUNBOOK.md`
- [ ] Update `/Users/bldt/Desktop/VHC/VHC/docs/ops/LOCAL_LIVE_STACK_RUNBOOK.md`

### Exact work

- [ ] Extract shared constants/helpers from `live-local-stack.sh` into `local-stack-lib.sh`
- [ ] Keep destructive port-kill logic only in the manual local-stack script
- [ ] Implement `automation-stack.sh ensure|restart|stop|status|write-state`
- [ ] Use `.tmp/automation-stack/lock` for serialization
- [ ] Write `state.json` and `health.json` under `.tmp/automation-stack`
- [ ] Make the automation web use `vite preview` on `127.0.0.1:2048`
- [ ] Add package scripts:
  - [ ] `automation:ensure-stack`
  - [ ] `automation:stack:health`
  - [ ] `automation:stack:restart`
  - [ ] `automation:stack:stop`
  - [ ] `automation:stack:install-launchd`
- [ ] Add a user-scoped LaunchAgent installer using `launchctl bootstrap|enable|kickstart`
- [ ] Document install/uninstall, health checks, and state-file contract

### Required state contract

`state.json` must include:

- [ ] `schemaVersion`
- [ ] `repoRoot`
- [ ] `gitHead`
- [ ] `startedAt`
- [ ] `updatedAt`
- [ ] `services`
- [ ] `ports`
- [ ] `pids`
- [ ] `snapshotPath`
- [ ] `webBaseUrl`
- [ ] `storyclusterReadyUrl`
- [ ] `relayUrl` when present
- [ ] `healthStatus`

### Acceptance checkpoint

- [ ] `pnpm automation:ensure-stack` is idempotent
- [ ] `pnpm automation:stack:health` exits `0` only when the stack is actually usable
- [ ] `launchctl print gui/$UID/com.vhc.automation-stack` shows the agent loaded
- [ ] a Codex app restart does not require manual stack repair

## Phase 2: Consumer Smoke Migration

### Deliverable

`Consumer Smoke` becomes a pure consumer of shared stack state and latest passing publisher-canary output.

### Files

- [ ] Update `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemon-feed-canary-shared.mjs`
- [ ] Update `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemon-feed-canary-shared.vitest.mjs`
- [ ] Update `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemon-feed-consumer-smoke.mjs`
- [ ] Update `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemon-feed-consumer-smoke.vitest.mjs`
- [ ] Update `/Users/bldt/Desktop/VHC/VHC/docs/ops/NEWS_UI_SOAK_LANE_SEPARATION.md`

### Exact work

- [ ] Add helpers to read shared stack `state.json`
- [ ] Remove random port probing from `daemon-feed-consumer-smoke.mjs`
- [ ] Remove local spawned web server startup from `daemon-feed-consumer-smoke.mjs`
- [ ] Read `webBaseUrl` from shared stack state
- [ ] Read snapshot input from shared stack state and/or latest passing publisher-canary artifact
- [ ] Add explicit stale-snapshot classification
- [ ] Keep run-scoped smoke summary and logs
- [ ] Update docs to state that consumer smoke is a stack client, not a bootstrapper

### Acceptance checkpoint

- [ ] `pnpm automation:ensure-stack`
- [ ] `pnpm --filter @vh/e2e test:live:daemon-feed:consumer-smoke` passes twice in a row
- [ ] no local port binding occurs in the runner
- [ ] no `listen EPERM` occurs in the lane

## Phase 3: Publisher Canary Shared-Infra Bounded Run

### Deliverable

`Publisher Canary` uses shared infrastructure but still performs a fresh bounded publish cycle and emits fresh run-scoped evidence.

### Files

- [ ] Update `/Users/bldt/Desktop/VHC/VHC/packages/ai-engine/src/newsRuntime.ts`
- [ ] Update `/Users/bldt/Desktop/VHC/VHC/packages/ai-engine/src/newsRuntime.test.ts`
- [ ] Update `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/daemon.ts`
- [ ] Update `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/daemon.test.ts`
- [ ] Update `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/daemon.coverage.test.ts`
- [ ] Update `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemon-feed-canary-shared.mjs`
- [ ] Update `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemon-feed-canary-shared.vitest.mjs`
- [ ] Update `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemon-feed-publisher-canary.mjs`
- [ ] Update `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemon-feed-publisher-canary.vitest.mjs`

### Exact work

- [ ] Add explicit tick lifecycle callback support in `newsRuntime.ts`
- [ ] Persist a publisher heartbeat / bounded-run status artifact under `.tmp/automation-stack` from `daemon.ts`
- [ ] Ensure the heartbeat/status artifact is metadata only and contains no secrets
- [ ] Remove local StoryCluster bootstrap from `daemon-feed-publisher-canary.mjs`
- [ ] Remove local daemon/runtime bootstrap from `daemon-feed-publisher-canary.mjs`
- [ ] Make publisher canary validate a fresh bounded publish cycle against shared infra
- [ ] Keep fresh run-scoped `publisher-canary-summary.json`
- [ ] Keep fresh run-scoped `published-store-snapshot.json`
- [ ] Classify stale heartbeat vs fresh success vs fresh failure explicitly

### Acceptance checkpoint

- [ ] `pnpm automation:ensure-stack`
- [ ] `pnpm test:storycluster:publisher-canary` passes three times without binding a local listener
- [ ] fresh canary artifacts are emitted per run
- [ ] the lane still proves first-tick/publish health rather than passively reading an always-on daemon state

## Phase 4: Retained Uplift Shared-Infra Bounded Run

### Deliverable

`Retained Uplift` uses shared infra but still produces isolated semantic-soak and retained-window artifacts per execution.

### Files

- [ ] Update `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemon-feed-semantic-soak-core.mjs`
- [ ] Update `/Users/bldt/Desktop/VHC/VHC/packages/e2e/playwright.daemon-first-feed.config.ts`
- [ ] Update `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemonFirstFeedHarness.ts`
- [ ] Update `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemonFirstFeedSemanticAudit.ts`
- [ ] Update `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemon-feed-semantic-soak-core.helpers.vitest.mjs`
- [ ] Update `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemon-feed-semantic-soak-core.run.vitest.mjs`
- [ ] Update `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemon-feed-semantic-soak-core.error.vitest.mjs`
- [ ] Update `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/playwright.daemon-first-feed.config.vitest.mjs`
- [ ] Update `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemonFirstFeedHarness.vitest.mjs`
- [ ] Update `/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemonFirstFeedSemanticAudit.run.vitest.mjs`
- [ ] Update `/Users/bldt/Desktop/VHC/VHC/docs/ops/NEWS_UI_SOAK_LANE_SEPARATION.md`
- [ ] Update `/Users/bldt/Desktop/VHC/VHC/docs/ops/STORY_BUNDLER_PRODUCTION_READINESS_CHECKLIST.md`

### Exact work

- [ ] Add `shared_stack` mode to semantic-soak core
- [ ] Skip local port-plan generation in shared-stack mode
- [ ] Skip managed relay startup in shared-stack mode
- [ ] Skip Playwright-owned local listener bootstrap in shared-stack mode
- [ ] Source shared base URL / shared endpoints from stack state
- [ ] Preserve isolated artifact directories for every retained/headline execution
- [ ] Preserve validity-envelope tagging for shared-stack runs
- [ ] Update docs so scheduled retained uplift is a shared-infra client, not a self-bootstrapping stack owner

### Acceptance checkpoint

- [ ] `pnpm automation:ensure-stack`
- [ ] `VH_DAEMON_FEED_USE_SHARED_STACK=true VH_DAEMON_FEED_SOAK_RUNS=1 VH_DAEMON_FEED_SOAK_SAMPLE_COUNT=1 pnpm --filter @vh/e2e test:live:daemon-feed:semantic-soak`
- [ ] no `webserver-relay.log` or equivalent self-owned listener artifact appears in scheduled mode
- [ ] no `listen EPERM` remains in the retained lane
- [ ] two valid runs inside the retained window are comparable for continuity/uplift analysis

## Phase 5: Automation Prompt Migration

### Deliverable

The three affected automations consume the shared stack and no longer imply per-run listener ownership.

### Files

- [ ] Update `/Users/bldt/.codex/automations/spaced-soak/automation.toml`
- [ ] Update `/Users/bldt/.codex/automations/consumer-smoke/automation.toml`
- [ ] Update `/Users/bldt/.codex/automations/retained-window-soak/automation.toml`

### Exact work

- [ ] Keep `execution_environment = "worktree"`
- [ ] Prepend `pnpm automation:ensure-stack`
- [ ] Prepend `pnpm automation:stack:health`
- [ ] Remove prompt wording that implies starting servers or binding ports
- [ ] Make `Publisher Canary` describe shared-stack consumption plus bounded publisher validation
- [ ] Make `Consumer Smoke` describe shared web + latest passing publisher snapshot consumption only
- [ ] Make `Retained Uplift` describe shared-stack semantic-soak mode only

### Acceptance checkpoint

- [ ] force one full wave manually in the correct order
- [ ] confirm memory entries use fresh artifacts from the shared-stack model
- [ ] let one scheduled wave run successfully without manual intervention

## 7. Forced Validation Sequence

Use this exact order after Phase 5 lands:

1. `pnpm automation:ensure-stack`
2. `pnpm automation:stack:health`
3. `pnpm report:news-sources:health`
4. `pnpm test:storycluster:publisher-canary`
5. `pnpm test:storycluster:consumer-smoke`
6. `VH_DAEMON_FEED_USE_SHARED_STACK=true VH_DAEMON_FEED_SOAK_RUNS=1 VH_DAEMON_FEED_SOAK_SAMPLE_COUNT=1 pnpm --filter @vh/e2e test:live:daemon-feed:semantic-soak`
7. `pnpm scout:news-sources:candidates`
8. `pnpm report:storycluster:fixture-candidate-intake`

Then let the next scheduled wave run and compare its artifacts to the forced baseline.

## 8. Rollout Checkpoints

### Checkpoint A: Infra lives across sessions

- [ ] launchd agent installed
- [ ] stack remains healthy across Codex app restart
- [ ] stack remains healthy across a new automation worktree/session

### Checkpoint B: Consumer lane stabilized

- [ ] `Consumer Smoke` uses no local listener
- [ ] consumer lane artifacts refresh on schedule

### Checkpoint C: Publisher lane stabilized

- [ ] `Publisher Canary` uses shared infra only
- [ ] publisher lane emits fresh run-scoped evidence
- [ ] no port-bind failures remain

### Checkpoint D: Retained lane stabilized

- [ ] retained lane uses shared infra only
- [ ] retained lane still emits isolated comparable artifacts
- [ ] two successive valid runs exist inside the same retained window

### Checkpoint E: Scheduled recurrence proven

- [ ] five scheduled waves complete with no `listen EPERM`
- [ ] memory files update from fresh artifacts rather than stale historical runs
- [ ] source-health outages remain the only legitimate skip for retained measurement

## 9. Risks and Guardrails

### Main technical risk

The highest-risk slice is Phase 4.

`/Users/bldt/Desktop/VHC/VHC/packages/e2e/src/live/daemon-feed-semantic-soak-core.mjs` currently owns substantial port-plan and listener lifecycle logic. Converting it to a shared-infra client without weakening artifact quality is the hardest part of the program.

### Guardrails

- [ ] do not weaken release/readiness thresholds
- [ ] do not make publisher canary a passive observer only
- [ ] do not make retained-window interpretation depend on continuously mutating daemon state
- [ ] do not centralize scout/triage/executor behind stack health
- [ ] do not store secrets in `.tmp/automation-stack/state.json`

## 10. Definition of Done

This program is complete only when all are true:

- [ ] the shared automation stack survives Codex restarts without manual repair
- [ ] `Publisher Canary`, `Consumer Smoke`, and `Retained Uplift` never bind their own listeners during scheduled runs
- [ ] five scheduled waves complete without `listen EPERM`
- [ ] fresh publisher, consumer, and retained artifacts are produced by schedule
- [ ] retained-window interpretation uses only valid complete runs
- [ ] the automation structure now serves the greater goal:
  - [ ] UI/UX work can continue independently
  - [ ] bundler validation remains honest
  - [ ] source and replay backlog work can continue from fresh artifacts
