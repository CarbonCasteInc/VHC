# VHC Autonomous Incident Response - Slice Plan (v2, reviewed)

> Status: Reviewed implementation plan (v2 — supersedes the v1 draft in this PR)
> Owner: coordinating agent + VHC Launch Ops
> Last Reviewed: 2026-07-10 (v1/v2 producer compatibility plus availability-total terminology; original six-lens adversarial review: security trust-chain,
> iOS/push platform, external API grounding, repo grounding, operational
> failure modes, scope/sequencing — all findings incorporated below)
> Depends On: docs/ops/public-feed-freshness-monitor.md, docs/ops/news-aggregator-production-service.md, docs/ops/public-beta-operational-state.md

> Operational state notice: dated live-state sections below are historical
> planning evidence. Current public-beta truth and the active gate are in
> `docs/ops/public-beta-operational-state.md`.

The local-only distribution-readiness goal/slices files are preserved outside
this branch and are not tracked dependencies of this plan.

## Target System

```text
A6 alert/watch output (signed)
-> VHC pager outside A6 (durable-persist, then fan out)
-> iPhone Web Push + email fallback
-> GitHub incident issue as the public-safe case file
-> Codex triage worker: read-only evidence, draft PRs, DRAFT operator packets
-> independent review gate (fable/sol, reviewer != proposer by default)
   -> SIGNED review verdict bound to the packet hash
-> Lou approves the plain-English action (identity-gated comment)
-> A6-side PULL executor verifies the full artifact chain locally
   and executes only the exact approved packet
-> readback verifier updates the issue and closes the loop
```

Provider aliases (never hard-code public model strings in source):

- `fable`: Anthropic Messages API path; model alias in operator env
  (`VH_INCIDENT_FABLE_MODEL`), key auth via `ANTHROPIC_API_KEY` per official
  docs.
- `sol`: Codex non-interactive path (`codex exec` / SDK, output schemas,
  explicit sandbox modes) with ChatGPT-managed auth on a trusted private
  runner only. Note: ChatGPT-managed Codex access requires an eligible plan,
  and cached auth can expire silently on an idle headless runner — Slice 7
  must detect and escalate that, not stall.

The reviewer is switchable per incident by identity-gated command, with a
reviewer-independence default (§Security Architecture, rule 5).

## Review Provenance

A v1 of this plan was adversarially reviewed on 2026-07-06. Verdict across all
six lenses: sound_with_required_changes. The blockers were: (1) the
issue-comment control plane had no commenter-identity verification in a PUBLIC
repo; (2) the pager's human endpoints (`/api/ack` etc.) were unauthenticated,
letting an attacker silence repeat-paging; (3) the executor trusted mutable
GitHub state from a push-model runner holding standing production credentials;
(4) iOS Web Push cannot wake a silent/Focus iPhone and the plan did not say
so; (5) nothing watched the pager itself — recreating the silent-failure mode
this system exists to kill; (6) the build put a multi-week tranche in front of
alert enablement, leaving A6 dark meanwhile. All are addressed structurally
below; the remaining highs (HMAC/producer contradiction, incident-key
fragmentation, scheduling primitive, reviewer stalls, restart exit-class
guard, prompt-injection containment, budgets, kill switch) are folded into the
slices they belong to.

## Original Plan Grounding (2026-07-06 Pre-Merge)

- `main` is `e665dd71`; this plan lives on `coord/incident-response-slices-2026-07-06`
  (draft PR #722, the only open PR).
- Distribution readiness is blocked ONLY on (a) an alert delivery channel +
  test-fire receipt, and (b) heap captures accruing. Slice 0 exists so this
  build never blocks (a).
- Alert producer: `tools/scripts/public-feed-alert-watch.mjs` emits
  `vh-public-feed-alert-watch-v1` JSON to ONE webhook URL
  (`VH_PUBLIC_FEED_ALERT_WEBHOOK_URL`) plus optional sendmail email; it
  fingerprint-dedupes (state_changed / recovery / heartbeat via
  `VH_PUBLIC_FEED_ALERT_HEARTBEAT_MS`), classifies exit 69 restarting vs
  parked, exit 75, exit 78, and marks `delivery.status='sent'` on ANY 2xx —
  after which that fingerprint is not resent except by heartbeat. It sends NO
  signature header today, and it has no separate heartbeat/test-fire URLs:
  everything arrives on the one URL, distinguished by payload `alertReason`.
  Two consequences this plan must honor: the pager may 2xx ONLY after durable
  persistence, and A6-call authentication requires a small, explicit
  producer-side change (Slice 5) — the v1 claim "without changing the
  producer" was self-contradictory and is withdrawn.
- Watch-closure verdict: written where
  `VH_PHASE5_SCOPE_A_WATCH_VERDICT_FILE` points (the installer unit sets the
  canonical `~/.local/state/vhc/phase5-scope-a-watch-closure/verdict.json`;
  the script has no built-in default).
- Heap analyzer `analyze-early-heap-captures.mjs` refuses `.heapsnapshot`
  inputs; release pipeline `regenerate-mvp-release-evidence.mjs` supports
  `--commit` + per-artifact sha256; systemd installer verifies units with
  `systemd-analyze verify --user` when available.
- `.github/ISSUE_TEMPLATE/public-beta-support.yml` exists; there is no
  incident template, label contract, pager, or responder workflow yet.
- The repo is PUBLIC. Every security decision below assumes hostile readers
  and hostile commenters on every issue.

The bullets above are retained as the pre-merge snapshot. The current producer
contract is `vh-public-feed-alert-watch-v2` with v3 dedupe state; the pager
continues to ingest historical v1 and current v2 payloads and preserves the
same incident-family key across that transition.

## Historical Post-Merge State (2026-07-06)

- PR #722 is merged on `main`. The pager service, GitHub incident bridge,
  iPhone PWA shell, Codex triage worker, reviewer worker, packet verifier,
  pull-executor implementation, readback verifier, and pager dead-man workflow
  exist in repo.
- PR #723 is merged on `main@47ba218d`. It fixed the StoryCluster production
  timeout path that caused the first real stale-feed incident after Slice 0.
- Slice 0 is complete on A6: the interim email channel is configured in
  host-private env, a test-fire reached the operator device, and both
  `vh-public-feed-alert-watch.timer` and
  `vh-phase5-scope-a-watch-closure.timer` are enabled and active.
- The active live alert path is still interim email. The custom pager/PWA is a
  later deployment step outside A6; email fallback remains on permanently.
- Codex execution/autonomy remains disabled. Codex may investigate, write
  tests, open PRs, and draft packets, but the A6 executor stays dry-run through
  the current proof window.
- The Scope A clean window starts at `2026-07-06T22:44:08.567Z`; the 48-hour
  target is `2026-07-08T22:44:08Z`, and the 14-day unattended target is
  `2026-07-20T22:44:08Z` if no operator touch or anomaly resets the window.
- The next engineering trigger is a new alert or the first post-recovery
  500 MB -> 700 MB heap-summary pair, not pager deployment or live execution.

## Security Architecture (non-negotiable, applies to every slice)

1. **Identity gating.** Every `/vhc` command (approve, reviewer switch, pause,
   reopen) is honored only when the comment author's GitHub login is in the
   operator-owned allowlist (`VH_INCIDENT_APPROVER_LOGINS`,
   `VH_INCIDENT_OPERATOR_LOGINS`) AND the comment is unedited
   (`updated_at == created_at` via the API). Comments from all other users
   are quarantined: never parsed as commands, never fed to model context.
2. **Immutable/signed artifact chain.** The executor trusts only:
   (a) the packet FILE at a pinned git commit SHA (immutable by construction);
   (b) a review verdict SIGNED by the reviewer runner's private key, where the
   signature covers the packet sha256 + verdict fields (public key
   pre-provisioned on A6);
   (c) an approval comment fetched live from the GitHub API and verified for
   author allowlist + unedited + exact packet sha256 reference.
   Issue BODIES and unsigned comments are display surface only — nothing
   trusts them. This makes the pager's issues-write token unable to forge an
   execution, even if fully compromised.
3. **Pull-model executor.** No standing inbound production credential exists
   anywhere. An A6-local agent (systemd timer) polls for candidate packets,
   performs ALL chain verification from rule 2 locally, checks the kill
   switch, enforces the action allowlist for its current trust phase, and
   executes on the host it already lives on. Compromising the pager, the
   triage runner, or the reviewer runner yields no path to A6 execution
   without also breaking the signature chain and the GitHub identity checks.
4. **Untrusted-content quarantine.** Model context (triage AND review) is
   assembled ONLY from: the sanitized alert payloads the pager itself wrote,
   allowlisted-author comments, repo files, and collector outputs. Non-
   allowlisted comments are excluded wholesale (not sanitized — excluded).
   Prompt-injection tests exist in BOTH Slice 6 and Slice 7, but the control
   is the exclusion, not the tests.
5. **Reviewer independence.** Default: the reviewer provider must differ from
   the proposer provider (Codex-drafted packets are reviewed by `fable`).
   Overriding to same-provider review requires an identity-gated command and
   stamps a visible `same-provider-review` label on the issue.
6. **Kill switch, first-class.** A single repo-level control
   (`automation: paused` repo variable, mirrored as a pager flag) is checked
   by the pager's issue-writing, the triage worker, the reviewer, and the
   executor before every action. Paused = paging continues (never pause
   paging), automation halts. Any allowlisted operator can set it with one
   command; the drill in Slice 10 exercises it.
7. **Budgets and rate bounds.** Triage worker: max Codex invocations per
   issue, max draft PRs per day. Pager: max pushes per incident per hour
   (repeat-until-ack has a floor interval), max timeline comments per
   incident per hour (coalesce). GitHub writes go through an outbox with
   retry, not fire-and-forget.
8. **Layered notification honesty.** iOS Web Push (from a Home-Screen PWA,
   iOS 16.4+, permission via user gesture) does NOT override silent/Focus
   mode and offers no critical-alert entitlement — a silent iPhone at 3am
   does not wake. Therefore: push is the primary channel, the producer's
   existing EMAIL channel stays enabled in parallel indefinitely, repeat-
   until-ack keeps re-paging, and the operator doc tells Lou to allow the
   pager PWA notifications with sound and to consider scheduled Focus
   breakthrough for it. Anything stronger (phone call, native app critical
   alerts) is explicitly out of scope and listed as a future upgrade.
9. **Secret discipline (unchanged from the first plan revision).** Issues are
   public-safe: hashes, counts, classes, timestamps, links only. No tokens,
   webhook URLs, env values, payload bodies, or heap paths in issues or model
   context. The A6 read-only collector emits secret-safe summaries only.
10. **Standing A6 invariants (unchanged).** No live mutation without an
    approved packet; 2-of-3 quorum never weakened; exit 78 stays a
    non-restarting write-safety park — see the exit-class guard in Slice 8;
    exit 69 stays the compatibility-labelled availability-total restartable
    class; no memory remediation until heap evidence names the retainer.

## Slice 0 - Interim Alert Channel (do this FIRST, independent of the build)

Goal: A6 must not run dark while this plan is built. Three prior outages were
silent multi-hour/day events; the build below is weeks-scale.

Completion note, 2026-07-06: Slice 0 is done. Keep the interim email path live
while Tranche A is built and deployed. Do not disable or replace it when the
custom pager comes online; use the pager as an additional signed incident and
push path with email fallback still enabled.

Implement (operator session, existing tooling only — no new code):

- Enable the existing alert watch TODAY using the already-hardened #710
  Block A/Block B runbook with the EMAIL channel
  (`VH_PUBLIC_FEED_ALERT_EMAIL_TO` to an address that pages Lou's phone via
  mail VIP/alert settings), plus any simple webhook if desired.
- Test-fire, confirm receipt on the phone, enable the timer.
- Record in the runbook that the webhook URL will later be repointed to the
  VHC pager (Slice 5) with zero producer redeploy beyond env + one signing
  addition.

Done when: a real A6 alert reaches a human device within one timer interval,
starting now — not after Slice 5.

## Tranche A — Paging MVP (Slices 1-5)

Tranche exit gate: pager live for 14 days, weekly test-fires received on
iPhone, at least one synthetic end-to-end incident (alert → push → issue →
ack → recovery), pager dead-man proven by a deliberate pager outage drill.
Tranche B components may merge earlier but must not touch live incidents
until this gate passes.

### Slice 1 - Incident Contract And Case-File Template

As v1, plus the review deltas:

- `.github/ISSUE_TEMPLATE/a6-incident.yml` (public-safe warnings; no secret
  prompts) and `docs/specs` contract `vhc-incident-v1` with required fields:
  severity, alert class, source fingerprint, first/last seen, affected
  service, status, safe evidence, runbook links, reviewer, approval state,
  packet hash, readback state.
- **Incident correlation key (revised):** the open-incident key is
  `a6:<source>:<alert_class_family>` — severity and volatile fingerprint are
  ATTRIBUTES, not key parts. Escalation (warning→critical) and recovery
  correlate to the SAME open issue; the fingerprint history is a timeline.
  (v1's `a6:<source>:<severity>:<fingerprint>` fragmented one incident across
  issues on every transition.)
- **Flap/reopen rule:** a recurrence within `VH_INCIDENT_REOPEN_WINDOW`
  (default 24h) of a `resolved` issue REOPENS it; later recurrences open a new
  issue that links the prior one.
- **Label contract:** as v1 (`incident`, `a6`, `public-feed`,
  `severity:*`, `needs-codex-triage`, `reviewer:*`,
  `operator-action-needed`, `waiting-for-readback`, `resolved`) plus
  `codex-investigating` (defined as a LEASE: carries an expiry timestamp in a
  marker comment; expired leases are reclaimable so a crashed worker cannot
  orphan an issue), `same-provider-review`, `needs-more-evidence`,
  `automation-paused` awareness.
- **Identity config contract:** the spec defines
  `VH_INCIDENT_APPROVER_LOGINS` / `VH_INCIDENT_OPERATOR_LOGINS` and the
  unedited-comment rule (§Security 1) so every later component implements the
  same gate.
- `tools/scripts/check-vhc-incident-response.mjs` + package script
  `check:vhc-incident-response` validating template, labels, redaction
  warnings, key/lease/reopen rules present in the spec; fixtures under
  `tools/fixtures/incidents/` (critical, warning, escalation, recovered,
  test-fire, reopen).

Tests: `check:vhc-incident-response`, `docs:check`, `git diff --check`.
Done when: automation has one schema + one identity/lease/key contract to
validate against before any issue is written.

### Slice 2 - VHC Pager Receiver Outside A6

As v1, plus the review deltas:

- Platform reference design named: Cloudflare Worker + **Durable Objects with
  Alarms** for per-incident repeat-until-ack timers and the missing-heartbeat
  dead-man; a Cron Trigger as the coarse backstop sweep. In-memory state is
  test-only; production state lives in the DO. (A request-driven worker
  without alarms cannot wake itself — v1's "storage adapter" alone was
  unimplementable for the heartbeat dead-man.)
- **Ingestion contract:** single endpoint `POST /api/a6-alert` accepting
  today's producer payload; heartbeat and test-fire are demuxed from payload
  `alertReason` (the producer only ever calls one URL). The separate
  `/api/a6-heartbeat` endpoint is dropped.
- **Durable-persist-before-2xx:** the handler persists the sanitized summary
  + request hash in the DO BEFORE returning 200; push/issue fan-out is async
  afterward via an outbox. (The producer marks `delivery.status='sent'` on
  any 2xx and will not resend that fingerprint — a respond-then-process pager
  silently loses criticals.)
- **A6-call auth:** HMAC over raw body with `VH_PAGER_A6_WEBHOOK_SECRET`,
  PLUS timestamp + nonce fields with a freshness window (replay defense).
  This REQUIRES the small producer-side signing change delivered in Slice 5 —
  acknowledged producer change, no longer denied. Until Slice 5 deploys, the
  pager runs in `ingest-unsigned` bootstrap mode behind an unguessable path
  secret, and refuses unsigned ingest once signing is enabled (one-way
  latch).
- **Human/device endpoint auth (new, closes a blocker):** `/api/ack`,
  `/api/test-fire`: require a per-device bearer token issued at enrollment;
  `/api/push/subscribe`: requires a one-time enrollment secret handed to Lou
  out-of-band; `DELETE /api/push/subscribe/:id` requires the device token.
  Unauthenticated ack is how an attacker silences a live critical.
- Dedupe/repeat rules as v1 (first-critical immediate; unchanged critical
  repeats until ack at configured floor interval; warning once + digest;
  recovery push; missing A6 heartbeat within
  `max(2 × VH_PUBLIC_FEED_ALERT_HEARTBEAT_MS, 35min)` → critical). Enablement
  fails closed if the producer heartbeat env is unset.
- **Pager dead-man (new, closes a blocker):** a scheduled GitHub Action
  (outside both A6 and the pager) curls `GET /healthz` every 15 minutes and
  on failure opens/updates a `pager-down` issue AND sends the fallback email
  directly. The pager watching A6 is itself watched.

Tests: HMAC + replay-window, unsigned-bootstrap latch, durable-persist-
before-200 (fault-injected crash between persist and fan-out), ack auth,
enrollment auth, dedupe/repeat/ack/recovery/missing-heartbeat via DO-alarm
simulation, producer-fixture replay for historical
`vh-public-feed-alert-watch-v1` and current
`vh-public-feed-alert-watch-v2` shapes including `alertReason` demux and stable
incident-family keys across the schema transition.

Done when: the pager ingests today's producer JSON durably, repeats unacked
criticals, alarms on A6 silence, and is itself covered by an external
dead-man.

### Slice 3 - iPhone Web Push PWA

As v1, plus the review deltas:

- Constraints documented in the PWA onboarding AND the ops doc: iOS 16.4+,
  push only from a Home-Screen-installed PWA, permission requires a user
  gesture, and **no silent/Focus override** (§Security 8). The acceptance
  test includes the honest statement of what this pager can and cannot do.
- **Workers-compatible Web Push:** VAPID JWT (ES256) built with WebCrypto in
  the worker — the standard `web-push` npm package does not run on Cloudflare
  Workers. Keys live as platform secrets; never in source.
- **Subscription lifecycle (new):** handle 404/410 on push send by marking the
  subscription dead; when live subscriptions reach ZERO, the pager raises its
  own alert through the fallback email + `pager-down` issue path and the PWA
  shows re-onboarding. iOS evicts subscriptions more aggressively than
  desktop; assume it will happen.
- Push content stays short/safe (`[VHC A6] critical: publisher
  exit_78_fail_closed` + issue link); if issue creation failed, the push
  links to the pager's own incident view instead of a dead GitHub link.
- Ack lives in the PWA (correct for iOS; do not migrate ack onto notification
  action buttons later).
- **Enablement is NOT hard-gated on the PWA:** Tranche A's gate accepts
  iPhone receipt via PWA push; if the PWA slips, GitHub mobile notifications
  on the incident issue + email are an accepted bootstrap receipt path so
  Slice 5 enablement is never blocked by PWA polish.

Tests: payload construction/redaction, mocked-Push subscription UI smoke,
dead-subscription (410) handling, zero-subscription alarm, manual iPhone
acceptance recorded in docs (install, permission, test-fire receipt, ack).

### Slice 4 - GitHub Incident Bridge

As v1, plus the review deltas:

- Issue create/update keyed by the REVISED incident key (Slice 1); escalation
  and recovery update the same open issue; reopen-window honored; timeline
  comments coalesced under the comment budget (§Security 7) with an outbox +
  retry for GitHub API failures after the pager already 200'd A6.
- Token: FINE-GRAINED PAT, single repository, Issues read/write ONLY, stored
  as a platform secret, with a documented rotation + revocation runbook and a
  90-day expiry calendar note. The bridge never holds code-write. Nothing the
  executor trusts is forgeable with this token (§Security 2).
- Redaction tests as v1 (no URLs/tokens/env names/payloads/heap paths), plus
  a test that non-allowlisted-author comments are never echoed into
  bridge-authored issue content.

Done when: one alert stream = one open issue with an escalation-safe
timeline, no spam under flapping, and a token whose theft cannot authorize
execution.

### Slice 5 - Alert Egress, Producer Signing, Heartbeat Runbook

As v1, plus the review deltas:

- **Producer change is explicit now:** a small PR to
  `public-feed-alert-watch.mjs` adding optional
  `VH_PUBLIC_FEED_ALERT_WEBHOOK_HMAC_SECRET` (signature + timestamp + nonce
  headers on the existing single-URL POST). Default-off; without the env the
  producer behaves byte-identically. This is the only producer change and it
  is on the critical path deliberately — unauthenticated ingest was a
  contradiction v1 papered over.
- **Extend, do not rewrite, the #710 Block A/Block B runbook** (it was
  verified and hardened two days ago): add the pager-specific env lines
  (webhook URL → pager, heartbeat ms, HMAC secret) and one additional gate to
  Block B: pager push receipt AND GitHub issue creation confirmed, alongside
  the existing `delivery.status === "sent"` + receipt gate. Keep the EMAIL
  channel configured in parallel permanently (§Security 8).
- Add `tools/scripts/validate-public-feed-alert-pager-output.mjs` checking
  local alert output + pager issue/readback summary consistency.
- Migration note from Slice 0: repoint the webhook env from the interim
  channel to the pager; the interim email stays as the fallback channel.

Tests: existing `check:public-feed:alert-watch` (producer signing covered by
new unit tests, default-off proven byte-identical), validation helper against
mocked pager/GitHub, `docs:check`.

Done when: A6 sends signed alerts to the pager; enablement fails closed
unless push receipt AND issue creation are proven; email fallback remains.

## Tranche B — Autonomy (Slices 6-10; live enablement gated on Tranche A exit)

### Slice 6 - Codex Incident Triage Worker

As v1, plus the review deltas:

- Polls issues labeled `incident`+`a6`+`needs-codex-triage`, honoring the
  `codex-investigating` LEASE (reclaim on expiry) and the kill switch.
- **Context assembly per §Security 4:** pager-authored body/comments +
  allowlisted-author comments + repo files + collector outputs ONLY.
  Non-allowlisted comments are structurally excluded. Prompt-injection tests
  assert exclusion, not sanitization.
- Read-only evidence phase, then Codex via Sol path (`codex exec`/SDK,
  `read_only` sandbox for diagnosis, `workspace_write` only for repo-side
  fixes, output schemas). Draft PRs on `coord/incident-<n>-<slug>`. May draft
  operator packets as FILES committed on the incident branch (this pins the
  packet at a commit SHA for the §Security 2 chain); never executes.
- Budgets: `VH_INCIDENT_TRIAGE_MAX_RUNS_PER_ISSUE`,
  `VH_INCIDENT_TRIAGE_MAX_PRS_PER_DAY`; on budget exhaustion, label
  `needs-more-evidence` and stop.
- Runner: trusted private runner (not A6, not a public GH runner) for
  ChatGPT-managed auth; **auth-expiry detection**: on auth failure the worker
  posts a `triage-stalled` comment through the bridge and the pager raises a
  warning — stalls must page, not rot (see also Slice 7 stall escalation).
  Fallback: API-key Codex GitHub Action, recorded as the non-Sol path.

### Slice 7 - Switchable Fable/Sol Review Gate

As v1, plus the review deltas:

- Provider adapters as v1 (`fable-anthropic` via `ANTHROPIC_API_KEY` +
  `VH_INCIDENT_FABLE_MODEL`, structured verdict via forced tool/schema
  output; `sol-codex` via Codex on the trusted runner +
  `VH_INCIDENT_SOL_MODEL`).
- **Reviewer independence default (§Security 5):** packets proposed by the
  Codex triage worker default to `fable` review; selecting `sol` for a
  Codex-proposed packet requires an identity-gated override command and
  stamps `same-provider-review`.
- Reviewer switching (`/vhc reviewer fable|sol`) is identity-gated
  (§Security 1).
- **Signed verdicts (§Security 2):** the reviewer runner signs
  `{packet_sha256, verdict, risk, approved_action_ids, blocked_action_ids,
  required_readbacks, expires_at}` with its provisioned key; the signature —
  not the issue text — is what the executor verifies. Verdicts expire
  (`expires_at`, default 24h) so a stale pass cannot authorize a later
  changed context.
- Fail-closed as v1 (malformed JSON, missing fields, timeout, provider
  mismatch, stale packet hash), plus **stall escalation**: any incident
  sitting in `needs-review` (or `needs-codex-triage`, or
  `waiting-for-readback`) beyond `VH_INCIDENT_STAGE_STALL_HOURS` (default 4h
  critical / 24h warning) triggers a pager warning. Reviewer-unavailable must
  page, not silently stall.
- Prompt-injection tests HERE too (v1 had them only in Slice 6): the review
  packet assembly obeys §Security 4.

### Slice 8 - Identity-Gated Approval And A6 Pull Executor

Rewritten around the pull model (§Security 2-3):

- Packet schema `vhc-operator-packet-v1`: action IDs from the allowlist,
  exact commands, target commit (for deploys), expected readbacks, stop
  conditions. Packets are FILES committed on the incident branch; the packet
  hash is the sha256 of the file bytes at a pinned commit SHA.
- Approval: `/vhc approve packet <packet-id> <sha256>` — honored only from
  `VH_INCIDENT_APPROVER_LOGINS`, unedited comments, exact-hash match
  (§Security 1). The plain-English summary Lou approves is the reviewer's
  signed `summary_for_operator` field, quoted by the bridge next to the
  approval instructions.
- **Executor = `vhc-packet-executor` ON A6** (systemd timer, local user):
  polls the GitHub API read-only (public repo; no token needed) for
  candidate approvals; verifies locally: packet file at pinned SHA hashes to
  the approved sha256 → reviewer signature valid, verdict `pass`, not
  expired, same hash → approval comment author allowlisted + unedited + same
  hash → action IDs within the CURRENT TRUST PHASE allowlist → kill switch
  not set → executes locally, streams a secret-safe transcript summary to a
  host-private log, posts result hashes/statuses via the bridge. No inbound
  credential to A6 exists anywhere in the system.
- **Progressive trust phases (new):**
  - Phase 1: read-only A6 collector; alert/watch timer enablement after
    test-fire proof.
  - Phase 2 (after ≥2 clean Phase-1 executions + one drill): publisher
    restart WITH EXIT-CLASS GUARD — the packet executor independently reads
    `ExecMainStatus`/`Result` and refuses restart when the park is exit 78 or
    exit 75 (write-safety and wrapper-refusal parks are operator-terrain;
    only exit-69-class transport parks and clean starts are automatable).
    This guard is executor-side and cannot be waived by packet content,
    review, or approval.
  - Phase 3 (after ≥2 clean Phase-2 executions + one drill): deploy of a
    named already-merged commit via the emitted deploy packet.
  - Phase transitions are operator-owned config changes on A6, not GitHub
    state.
- Forbidden list as v1 (retention, compaction, eviction, publisher clear,
  quorum reduction, fail-close weakening, raw heap export, mesh write) —
  enforced executor-side, cannot be allowlisted by any packet/review.

Tests: approval parser + identity/unedited gates; hash mismatch; missing/
expired/wrong-hash signature; forbidden action; exit-class guard (78/75
refused, 69 allowed); phase gating; kill switch; dry-run no-op end to end.

### Slice 9 - Readback Verifier And Incident Closure

As v1, plus: readbacks REUSE existing watch outputs (publisher liveness,
freshness monitor, watch-closure verdict, alert output) rather than
re-deriving checks; per-action required readbacks as v1; labels
`operator-action-needed` → `waiting-for-readback` → `resolved` only on
passing readbacks; `needs-more-evidence` on inconclusive; never auto-close
while pager state is critical or the watch-closure verdict fails; closure
comments include result hashes only.

### Slice 10 - End-To-End Drill And Operating Docs

As v1 (synthetic critical → push → issue → triage → fable pass → switch →
sol pass → approval → no-op packet → readback → resolve), plus:

- **Kill-switch drill** and **pager-outage drill** (dead-man page proven).
- **Approval-spoof drill:** a non-allowlisted account posts a well-formed
  approval; the executor must refuse and the issue must show the quarantine.
- Lay one-pager for Lou: what the phone alert means, the one approval command
  format, what is always forbidden, how to switch reviewers, how to pause
  everything (the kill switch), and the honest note about silent/Focus mode.

Tests: full check suite (`check:vhc-incident-response`,
`check:public-feed:alert-watch`, `check:scope-a-watch-closure`,
`check:early-heap-captures`, `docs:check`, `git diff --check`).

## Dependency Order

```text
Slice 0 (interim channel, operator, NOW — independent of everything)

Tranche A: 1 -> 2 -> {3, 4} -> 5 -> [14-day operating gate + drills]
Tranche B: 6 -> 7 -> 8 -> 9 -> 10
  (6/7 may develop against Slice-1 fixtures in parallel with Tranche A,
   but must not touch live incidents until the Tranche A gate passes;
   8's live phases additionally gate on drills as specified.)
```

## First Physical PR

Implemented by PR #722 on `coord/incident-response-slices-2026-07-06`, with
`check:vhc-incident-response`, `check:public-feed:alert-watch`,
`check:scope-a-watch-closure`, `check:early-heap-captures`, `docs:check`, and
`git diff --check` passing before merge. This merge did not enable the A6
executor or deploy the custom pager.

## Sources Checked

- Repo primitives (verified at `e665dd71`): `tools/scripts/public-feed-alert-watch.mjs`
  (single-URL webhook, no signature today, 2xx⇒sent semantics, fingerprint
  dedupe, heartbeat), `tools/scripts/phase5-scope-a-watch-closure-packet.mjs`
  (+ installer-unit verdict path), `tools/scripts/analyze-early-heap-captures.mjs`,
  `tools/scripts/regenerate-mvp-release-evidence.mjs`,
  `tools/scripts/install-news-aggregator-production-service.sh`,
  `.github/ISSUE_TEMPLATE/public-beta-support.yml`.
- Codex docs (non-interactive exec, output schemas, sandbox modes, GitHub
  Action, ChatGPT-managed auth + plan eligibility):
  https://developers.openai.com/codex/
- Anthropic API docs (SDKs, Messages API, `ANTHROPIC_API_KEY` auth):
  https://platform.claude.com/docs/en/manage-claude/authentication ,
  https://platform.claude.com/docs/en/cli-sdks-libraries/overview
- iOS Web Push constraints (Home-Screen PWA requirement, no Focus override)
  and Cloudflare Durable Object Alarms / Cron Triggers: platform
  documentation reviewed 2026-07-06; the silent/Focus limitation is treated
  as a hard product constraint, not an implementation detail.
