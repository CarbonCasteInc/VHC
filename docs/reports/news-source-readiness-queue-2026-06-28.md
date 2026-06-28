# News Source Readiness Queue - 2026-06-28

Status: queue built, promotion blocked until fresh evidence.

Evidence JSON: `/Users/bldt/Desktop/VHC/VHC/docs/reports/evidence/news-source-readiness-queue-2026-06-28.json`

This packet uses only existing local scout/admission/health and fixture-intake
artifacts. It does not fetch feeds, change source config, run live soak, or write
to the public mesh.

## Decision

Source-surface work can proceed as review and fixture/replay preparation, but
no source promotion claim should be made from this packet alone.

Blocking reasons:

- `source_scout_stale_or_missing`
- `source_admission_stale_or_missing`
- `source_health_stale_or_missing`
- `source_health_release_evidence:fail`

The latest source-health artifact reports `readinessStatus=blocked`,
`releaseEvidence.status=fail`, and release-evidence reasons
`blocked_run_within_release_window`, `non_ready_runs_exceed_threshold`, and
`latest_run_not_ready`.

## Artifact Inputs

| Input | Generated | Age at 2026-06-28 14:30Z | Status |
| --- | ---: | ---: | --- |
| Scout | 2026-04-09T02:44:55.639Z | 1931.75h | stale |
| Admission | 2026-06-15T01:53:15.272Z | 324.61h | stale |
| Source health | 2026-06-15T01:53:18.084Z | 324.61h | stale, release fail |
| Fixture intake | 2026-04-14T12:26:32.641Z | 1802.06h | stale, still useful as intake backlog |

## Candidate Queue

| Rank | Source | Lane | Current action | Evidence state |
| ---: | --- | --- | --- | --- |
| 1 | `bigbendsentinel-border-wall` | promotion candidate | `prepare_promotion_pr` | scout-promotable, but current health has it in `removeSourceIds`; requires fresh re-run before promotion |
| 2 | `ap-politics` | promotion candidate | `prepare_promotion_pr` | scout-promotable and already in keep set; candidate for refreshed breadth validation |
| 3 | `cnn-politics` | blocked candidate | `hold_for_feed_access` | `candidate_inconclusive`, `feed_links_unavailable`, `feed_fetch_error` |
| 4 | `nyt-us` | blocked candidate | `skip_candidate` | `candidate_rejected`, `access-denied` |
| 5 | `reuters-topnews` | blocked candidate | `hold_for_feed_access` | `candidate_inconclusive`, `feed_links_unavailable`, `feed_fetch_error` |
| 6 | `sky-world` | blocked candidate | `skip_candidate` | `candidate_rejected`, `access-denied` |
| 7 | `thehill-news` | blocked candidate | `skip_candidate` | `candidate_rejected`, `access-denied` |
| 8 | `washingtonpost-politics` | blocked candidate | `hold_for_feed_access` | `candidate_inconclusive`, `feed_links_unavailable`, `feed_non_xml_payload` |
| 9 | `wsfa-state` | blocked candidate | `hold_for_feed_access` | `candidate_inconclusive`, `feed_links_unavailable`, `feed_non_xml_payload` |

## Fixture / Replay Intake

Top intake items to review from the existing formal queue:

| Rank | Candidate | Target | Headline |
| ---: | --- | --- | --- |
| 1 | `offline_replay_remote_mismatch:story-60d40bd8bd28` | benchmark or replay corpus | Oil prices ease on hopes of new US-Iran peace talks |
| 2 | `offline_replay_remote_mismatch:story-1806711e133d` | benchmark or replay corpus | Rep. Gonzales says he will 'retire' tomorrow after sexual misconduct accusations |
| 3 | `offline_replay_offline_mismatch:story-3a440151` | fixture or validated snapshot | Burkina Faso: Moving forward without democracy |
| 4 | `offline_replay_offline_mismatch:story-7c02eb61` | fixture or validated snapshot | Data centers are on the ballot in 2026 - and just failed the first test |
| 5 | `offline_replay_offline_mismatch:story-fa0f900f` | fixture or validated snapshot | Trump facing backlash for posting AI-generated image depicting him as Jesus Christ |

## Next Evidence Needed

1. Refresh `pnpm scout:news-sources:candidates`, `pnpm report:news-sources:admission`, and `pnpm report:news-sources:health`.
2. Promote only candidates that remain scout-promotable and health-green after the refresh.
3. Convert true fixture/replay misses only when expected membership is specific and reviewable.
4. Run `pnpm check:storycluster:production-readiness` before any source-surface release claim.
