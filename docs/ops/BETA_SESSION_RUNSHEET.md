# Beta Session Run Sheet

**Owner:** session operator (single person per session)
**Profiles:** `dev-small` (current), `beta-scale` (after flip-switch)
**Branch:** `main` (post-PR #345 merge)

---

## Runtime Profiles

| Setting | `dev-small` | `beta-scale` |
|---------|-------------|--------------|
| `VITE_ANALYSIS_MODEL` | `gpt-5-nano` | `gpt-5-nano` |
| `VITE_VH_ANALYSIS_PIPELINE` | `true` | `true` |
| `ANALYSIS_RELAY_BUDGET_ANALYSES` | `120` | `600` |
| `ANALYSIS_RELAY_BUDGET_ANALYSES_PER_TOPIC` | `20` | `20` |
| `VH_LIVE_MATRIX_TOPICS` | `3` | `8` |
| `VH_LIVE_MATRIX_STABILITY_RUNS` | `3` | `3` (release: `5`) |
| Testers | 1-3 | up to 10 |

---

## Daily Gate (must pass before opening session)

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

If `scarcityCount > 0`: environment problem (analysis relay, feed, or vote-capable inventory). Triage environment, do not open session.

### 3. Manual 3-browser persistence check

Open 3 browser windows (A, B, C) to `<BASE_URL>`. Each gets its own identity.

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

**Required:** all 10 steps pass. Any failure is a session blocker.

---

## Flip-Switch Criteria (dev-small -> beta-scale)

All of the following, in order:

1. Daily gate passes for 2 consecutive days on `dev-small`.
2. Manual 3-browser check passes both days.
3. No sustained 429 or ack-timeout degradation observed during either session.
4. Change only profile values (budget, topic count). No flow or code changes.

---

## Mid-Session Monitoring

Watch these during active tester sessions:

| Signal | Source | Threshold |
|--------|--------|-----------|
| Analysis 429 rate | server logs / relay metrics | >3% for 10 min **or** >5% for 5 min => pause sessions |
| Mesh write-ack timeout rate | console telemetry `[vh:aggregate:voter-write]` | >5% for 10 min => pause voting |
| Convergence p95 | strict gate telemetry or manual spot-check | >10s for 15 min => pause new tester intake |
| Vote-capable inventory | preflight `voteCapableFound` | <8 for 10 min => stop session start, run prewarm |
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
Profile:        dev-small | beta-scale
Strict gate:    PASS N/N | FAIL (reason)
3-browser:      PASS | FAIL at step N (reason)
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
2. **Vote mutation:** last-write-wins per user. You can change your vote; aggregate updates accordingly.
3. **Degradation:** if the bias table doesn't load within ~10s after clicking a headline, reload once. If it still doesn't load, report to operator. Do not repeatedly click — it burns analysis budget.
4. **Feedback:** report issues immediately to operator with: what you clicked, what you expected, what you saw, browser console screenshot if possible.
