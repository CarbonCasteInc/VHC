# Beta Session Run Sheet

> Status: Operational Runbook
> Owner: VHC Ops
> Last Reviewed: 2026-07-09
> Depends On: docs/README.md, docs/CANON_MAP.md


**Owner:** session operator (single person per session)
**Profiles:** `dev-small` (burn-in), `beta-scale` (burn-in), `public-beta-ramp` (Lou-approved public beta)
**Branch:** `main`

---

## Runtime Profiles

| Setting | `dev-small` | `beta-scale` | `public-beta-ramp` |
|---------|-------------|--------------|--------------------|
| `VITE_ANALYSIS_MODEL` | `gpt-5-nano` | `gpt-5-nano` | `gpt-5-nano` |
| `VITE_VH_ANALYSIS_PIPELINE` | host/stack must expose `true` | host/stack must expose `true` | host/stack must expose `true` |
| `ANALYSIS_RELAY_BUDGET_ANALYSES` | `120` | `600` | operator-set from the release budget; first tranche must support at least 100 testers |
| `ANALYSIS_RELAY_BUDGET_ANALYSES_PER_TOPIC` | `20` | `20` | `20` unless the release evidence packet records a lower tested value |
| `VH_LIVE_MATRIX_TOPICS` | `3` | `8` | `8` minimum; raise only after release evidence stays green |
| `VH_LIVE_MATRIX_STABILITY_RUNS` | `3` | `3` (release: `5`) | `5` minimum before tranche expansion |
| Testers | 1-3 | up to 10 | 100 first tranche, then 500/1000/open only after green evidence and Lou approval |

---

## Daily Gate (must pass before opening session)

### 0. Feed/source readiness review

Review the current feed posture before opening any session that depends on live public headlines:

```
pnpm check:storycluster:production-readiness
pnpm scout:news-sources:candidates
```

Review:

1. `/Users/bldt/Desktop/VHC/VHC/.tmp/storycluster-production-readiness/latest/production-readiness-report.json`
2. `/Users/bldt/Desktop/VHC/VHC/.tmp/daemon-feed-semantic-soak/headline-soak-trend-index.json`
3. `/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/.tmp/news-source-scout/latest/source-candidate-scout-report.json`

Required operator decision:

1. if the latest production-readiness artifact, soak trend, or scout report is stale, refresh it before continuing;
2. if production-readiness is `blocked` because of headline-soak / live-feed reasons, do not present the session as public-feed validation;
3. either pause the session or explicitly scope it to fixture-backed / non-public-feed validation;
4. if the scout reports a promotable candidate, note it in the session log, but do not change the source surface mid-session.

### 0.1 Public beta policy/support and closeout checks

Before any session is described as a public beta session, verify the public
policy, support/contact surface, and launch-readiness closeout map:

```
pnpm check:public-beta-compliance
pnpm check:public-beta-launch-closeout
```

The closeout artifact is `docs/ops/public-beta-launch-readiness-closeout.md`.
It maps every public-beta launch gate to deterministic command/report evidence
and classifies remaining work as `ship_blocker` or `post_beta_follow_up`.

The support path is `/support`, which links to the VHC public beta GitHub Issue
Form. That form is public. Do not ask testers to post private personal data,
legal notices, identity documents, raw proof material, provider secrets,
confidential support correspondence, or full copyrighted articles into support
issues, story replies, or report reasons. If a deletion, copyright, abuse, or
account issue requires private details, record only public-safe context and
arrange an operator handoff outside the public issue body.

Private escalation operator protocol:

1. Classify deletion/correction, copyright/attribution, abuse/safety, and
   account/access requests as sensitive when the next useful fact would require
   private details.
2. Keep the GitHub issue as a public-safe issue stub containing only category,
   public URLs, public story/topic/comment/report ids, and status.
3. Do not ask users to post private details in GitHub. Move private details to
   the pre-existing non-public beta contact channel, or to the counsel path for
   legal/copyright matters, outside the public GitHub issue body.
4. If no private channel exists, mark the public issue as `private handoff
   required` and pause rather than collecting private details publicly.
5. If sensitive details are posted accidentally, do not quote them back; use
   available repository moderation/edit controls when available and continue
   only from public-safe status text.

### 0.2 Account sign-in deployment readiness

Run this gate before any tester-facing session that advertises Apple, Google,
or X sign-in, account continuity, or account recovery. Account sign-in is a
continuity/recovery feature only. It is not LUMA Silver, verified-human,
one-human-one-vote, Sybil resistance, residency proof, or cross-device identity
merge.

Required deployment facts:

1. The PWA build must have `VITE_AUTH_CALLBACK_BASE_URL` set to the deployed
   auth-callback boundary outside A6.
2. The PWA build must have `VITE_AUTH_CALLBACK_PROVIDERS` set to the exact
   providers advertised for the session, or to `none` when sign-in is disabled.
   Leaving it blank offers all three supported providers once the boundary URL
   is set.
3. The auth-callback boundary must be reachable at:

   ```
   curl -sf https://<AUTH_CALLBACK_BASE_URL>/api/health
   ```

4. The health response may expose only booleans and reason codes. It must not
   expose provider client secrets, tokens, provider subjects, private keys,
   state HMAC keys, or raw provider error bodies.
5. Every provider visible in tester copy or UI must be configured in health:
   `providersConfigured.apple`, `providersConfigured.google`, and/or
   `providersConfigured.x`.
6. If a provider is not configured, remove it from
   `VITE_AUTH_CALLBACK_PROVIDERS`, hide it from tester copy, and do not count it
   as rehearsed. A narrowed beta may proceed only if the release envelope
   explicitly does not advertise the missing provider.

Required local sanity commands before live provider rehearsal:

```
corepack pnpm@9.7.1 --filter @vh/auth-callback build
corepack pnpm@9.7.1 --filter @vh/auth-callback test
corepack pnpm@9.7.1 check:auth-callback
corepack pnpm@9.7.1 check:account-identity-controls
corepack pnpm@9.7.1 check:luma-forbidden-claims
corepack pnpm@9.7.1 check:luma-telemetry-redaction
```

If any of these fail, do not open a sign-in rehearsal. Fix the repo or
deployment first.

### 1. Infrastructure health

```
curl -sf https://<BASE_URL>/          # expect 200
curl -sf https://<BASE_URL>/gun       # expect 200
curl -sf https://<BASE_URL>/api/analyze/config  # expect configured:true, correct model+budgets
```

All three must return expected responses. If any fail, do not proceed.

### 2. Headless strict gate

```
VH_RUN_LIVE_MATRIX=true \
VH_LIVE_MATRIX_REQUIRE_FULL=true \
pnpm --filter @vh/e2e test:live:matrix:strict:stability
```

**Required:** `strictStabilityAchieved: true`, `passCount: 3`, `scarcityCount: 0`.

If `scarcityCount > 0`: setup-scarcity problem (insufficient vote-capable inventory / synthesis-ready topics). Triage feed inventory and prewarm; analysis-relay misconfiguration is a separate strict-gate failure mode and does not increment `scarcityCount`.

### 3. Manual 3-browser persistence check (release-rehearsal requirement)

This procedure is a **release-rehearsal requirement**. Slice F2 of the
Functioning MVP lane plan
(`docs/plans/FUNCTIONING_MVP_LANE_SLICE_PLAN_2026-07-06.md`) executes this exact
procedure to produce the release-packet evidence; Slice B4 owns its definition.
The steps below are the canonical definition F2 references — keep them in sync.

Open 3 browser windows (A, B, C) to `<BASE_URL>`. Each gets its own identity
(distinct beta-local LUMA principal per browser — do not reuse one identity
across windows). All three must open the **same accepted-current story**.

| Step | Action | Expected |
|------|--------|----------|
| 1 | A: click headline, wait for bias table | Vote cells (+/-) appear within 10s |
| 2 | B: click same headline | Same analysis from mesh (no re-analysis), vote cells present |
| 3 | C: click same headline | Same analysis from mesh, vote cells present |
| 4 | A: vote +1 on a point | A sees agree count increment |
| 5 | B: check same point (wait up to 5s) | B sees A's vote in aggregate |
| 6 | C: check same point | C sees A's vote in aggregate |
| 7 | B: vote +1 on same point | B sees count increment; A and C see updated aggregate |
| 8 | C: vote -1 on same point | C sees disagree count; A and B see updated aggregate |
| 9 | A: change vote from +1 to -1 | Aggregate corrects: agree decrements, disagree increments across all clients |
| 10 | All: reload pages | Analysis, vote cells, and aggregate state survive reload |

**Cross-client (not local-echo) verification.** Steps 5, 6, and the cross-client
checks in 7-9 are only valid if the count moves on a browser that did **not**
cast the vote. A local optimistic echo on the voting browser does not count as
convergence. For each cross-client assertion, confirm the change is visible on a
browser whose own vote did not produce it (e.g. step 5/6 must show A's vote on B
and C, which are still neutral on that point). If only the voting browser
updates, that is a local-only aggregate illusion, not mesh convergence — treat
it as a FAIL, not a pass.

| Step | Action | Expected |
|------|--------|----------|
| 11 | Privacy-leak spot-check: on B, open devtools and inspect the public aggregate paths and network payloads exercised by the vote (`vh/aggregates/**`, topic-engagement summary reads/writes, `[vh:aggregate:voter-write]` / `[vh:vote:mesh-write]` telemetry) | No `nullifier`, `district_hash`, `merkle_root`, raw `constituency_proof`, address/wallet, or provider token appears in any public path or its telemetry; aggregate nodes carry only the topic/epoch-scoped `voterId` |

**Required:** all 11 steps pass, with cross-client convergence proven (not
local echo) and no privacy leak observed. Any failure is a session blocker and,
for a release rehearsal, blocks the Slice F2 evidence packet.

### 4. Account sign-in and account-to-LUMA binding rehearsal

This procedure is required for any release rehearsal that advertises sign-in or
registration. Run it after the daily gates and before tester invites. Use one
clean browser profile per tester identity; do not use incognito for release
evidence because identity persistence is part of the claim.

For each advertised provider (`apple`, `google`, `x`). For the first public
beta ramp, the advertised providers are `apple` and `google`; `x` is hidden and
does not count until a later packet registers and rehearses it:

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open `<BASE_URL>/account/identity` in a clean browser profile. | The `Identity` panel loads. If no identity exists, `Create identity` is visible. |
| 2 | Click `Create identity` if needed. | The page shows `Beta-local identity on this device`; it does not render a raw nullifier, session token, numeric trust score, provider subject, or provider token. |
| 3 | In `Sign-in accounts`, confirm the provider row is visible only if the provider is advertised for this session. | `signin-provider-<provider>` exists; the status starts as `Not connected`, `Signed out`, or `Session expired — reconnect`. Missing providers are removed from tester copy. |
| 4 | Click the provider's `Connect` control and complete the provider authorization. | Browser returns through `/auth/callback` to the account page without exposing the PKCE verifier in the URL. |
| 5 | Check the provider row. | `signin-status-<provider>` shows `Connected`; no raw provider token, provider subject, client secret, or nullifier is visible in page text. |
| 6 | Confirm the copy boundary in the sign-in panel. | The panel describes sign-in as account continuity/profile recovery and includes the negative uniqueness boundary (`not a proof of a unique person` or equivalent). It does not claim verified-human, one-human-one-vote, Silver, Sybil resistance, residency, anonymity, or same-human continuity. |
| 7 | Reload the page. | The provider remains connected and the beta-local identity remains present on this device. |
| 8 | Click the provider `Disconnect` control. | The provider status changes to `Signed out`; the page does not claim network deletion or deletion of public activity. |
| 9 | Reconnect the same provider in the same browser profile. | The provider returns to `Connected`; the local beta-LUMA identity is preserved unless the operator explicitly uses `Reset identity`. |
| 10 | Click `Reset identity`, type `reset`, and confirm only in a rehearsal browser/profile. | The identity rotates; the reset dialog states previous public history remains under the old pseudonym and connected sign-in accounts must be re-bound. |
| 11 | After reset, inspect `Sign-in accounts`. | No provider row remains silently connected to the pre-reset identity; the provider must require re-bind before further account-continuity claims. |

**Cross-device boundary check.** Repeat steps 1-7 for the same provider in a
second clean browser profile. The second profile must get its own beta-local
identity. Do not claim that sign-in merges votes, proves the same human, or
transfers the old browser's LUMA principal. If copy or telemetry implies that
cross-device sign-in proves same-human continuity, the rehearsal fails.

**Secret and privacy spot-check.** During one provider run, inspect the browser
URL, network requests, console, local telemetry, and public mesh paths touched
by the session. Record only booleans in the evidence packet. Do not paste raw
provider subjects, email addresses, nullifiers, PKCE verifiers, state values,
client secrets, access/refresh/id tokens, or provider error bodies into issue
comments, PRs, session notes, or release artifacts.

**Required:** every advertised provider passes the provider matrix above; the
same-browser sign-out/sign-in path preserves the local beta-LUMA identity; Reset
Identity clears account binding and requires re-bind; a second browser profile
does not get or claim the first browser's LUMA principal; no forbidden claim or
secret leak is observed. Any failure blocks sign-in claims and, if sign-in is
required by the release envelope, blocks the release rehearsal.

---

## Flip-Switch Criteria (dev-small -> beta-scale -> public-beta-ramp)

All of the following, in order:

1. Daily gate passes for 2 consecutive days on `dev-small`.
2. Manual 3-browser check passes both days.
3. No sustained 429 or ack-timeout degradation observed during either session.
4. Change only profile values (budget, topic count). No flow or code changes.
5. Move from `beta-scale` to `public-beta-ramp` only after the release evidence
   packet is green on the intended release commit, Apple and Google both pass
   provider rehearsal, the failure-mailbox automation is active, and Lou gives
   explicit tranche approval.

---

## Mid-Session Monitoring

Watch these during active tester sessions:

| Signal | Source | Threshold |
|--------|--------|-----------|
| Analysis 429 rate | server logs / relay metrics | >3% for 10 min **or** >5% for 5 min => pause sessions |
| Mesh write-ack timeout rate | console telemetry `[vh:aggregate:voter-write]` | >5% for 10 min => pause voting |
| Convergence p95 | strict gate telemetry or manual spot-check | >10s for 15 min => pause new tester intake |
| Vote-capable inventory | preflight `voteCapableFound` | below active profile target (`3` in `dev-small`, `8` in `beta-scale`, `8+` in `public-beta-ramp`) for 10 min => stop session start, run prewarm |
| Gun peer connectivity | browser console / relay health | disconnect >60s sustained => session degraded; >5 min => stop |

---

## Rollback / Session Stop

When a threshold is crossed:

1. Notify active testers: "Session paused for environment issue. Your data is preserved."
2. Capture current state: run strict gate once to get a diagnostic summary artifact.
3. Triage: check relay logs, Gun health, analysis budget remaining.
4. Resume only after re-running the full daily gate (all 3 checks).

**Incident owner:** the session operator. One person, pre-assigned, per session.

---

## Evidence Capture

After each session, record one entry:

```
Date:           2026-MM-DD
Profile:        dev-small | beta-scale | public-beta-ramp
Production readiness: release_ready | review_required | blocked (reason)
Headline soak:  pass | warn | fail (reason)
Source scout:   top promotable candidate | none | blocked (reason)
Auth callback:  PASS | FAIL (reason) | not in envelope
Advertised providers: apple PASS/FAIL/hidden, google PASS/FAIL/hidden, x PASS/FAIL/hidden
Account/LUMA:   PASS (same-browser preserved, reset cleared, cross-browser distinct) | FAIL (reason)
Strict gate:    PASS N/N | FAIL (reason)
3-browser:      PASS | FAIL at step N (reason)
Cross-client:   PASS (convergence proven, not local echo) | FAIL (reason)
Privacy leak:   NONE | LEAK (path + field)
Testers:        count
Duration:       Xh
429 rate peak:  X%
Ack-timeout:    X%
Vote-capable:   min observed / target
Incidents:      none | description
Flip-switch:    eligible (day N of 2) | not eligible (reason)
```

---

## Beta Policy (communicate to testers)

1. **Identity:** single browser profile per tester. No incognito, no storage clears, no device switching. Clearing browser data = new identity; prior votes become orphaned.
2. **Account sign-in:** Apple/Google/X sign-in, when enabled, is for account continuity and profile recovery on this beta surface. It does not verify a unique person, merge LUMA identities across browsers/devices, prove residency, or make votes one-human-one-vote.
3. **Vote mutation:** last-write-wins per user. You can change your vote; aggregate updates accordingly.
4. **Degradation:** if the bias table doesn't load within ~10s after clicking a headline, reload once. If it still doesn't load, report to operator. Do not repeatedly click — it burns analysis budget.
5. **Feedback:** report live-session issues immediately to the operator with: what you clicked, what you expected, what you saw, browser console screenshot if possible. Out-of-session public beta support uses `/support`; do not post private details into public GitHub issues.
