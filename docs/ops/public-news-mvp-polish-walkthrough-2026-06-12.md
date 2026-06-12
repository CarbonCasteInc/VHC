# Public News MVP Polish Walkthrough - 2026-06-12

## Scope

Target: `https://venn.carboncaste.io/`

Method: automated Playwright browser walkthrough from this workstation after PR
#635 was merged into `main`. This is not a substitute for a real-phone human QA
pass; it covers mobile-sized Chromium (`390x844`), desktop Chromium
(`1440x1200`), bad-route handling, offline reload, and online recovery.

Local screenshot artifacts:

- `output/playwright/vhc-mobile-empty-feed.png`
- `output/playwright/vhc-mobile-loaded-feed.png`
- `output/playwright/vhc-mobile-story-expanded.png`
- `output/playwright/vhc-desktop-feed.png`
- `output/playwright/vhc-desktop-after-refresh.png`
- `output/playwright/vhc-bad-route.png`
- `output/playwright/vhc-offline-feed.png`
- `output/playwright/vhc-reconnected-feed.png`

## Checklist

| Area | Status | Evidence |
| --- | --- | --- |
| Mobile cold load | Pass with caveat | Initial snapshot briefly showed `0 live · 0 news · 0 topics` and `No items to show`; after relay reads completed, mobile populated to `15 live · 15 news · 0 topics`. |
| Mobile feed scan | Pass | Populated feed rendered singleton and multi-source news cards, source labels, timestamps, engagement counts, and `Scroll for more`. |
| Mobile story detail | Pass with caveat | Expanded story rendered synthesis summary, generated timestamp, frame/reframe table, report controls, conversation section, and identity-unavailable stance messaging. The frame/reframe table is usable but dense on `390px` wide screens. |
| Desktop feed | Pass | Desktop rendered 15 news cards with filters, sort controls, hotness, source badges, images, and load-more state. |
| Refresh | Pass | Refresh updated hotness values and kept the feed populated. |
| Online recovery after offline | Pass | After returning online and reloading, peers recovered from `0` to `3` and the feed repopulated. |
| Bad route | Fixed locally, pending deploy | Live `/stories/not-a-real-story` rendered only bare `Not Found`. This branch replaces it with a public-beta not-found state and feed/support exits. |
| Offline reload | Fixed locally, pending deploy | Live offline reload rendered an empty feed with `Peers: 0` and `No items to show`. This branch adds an explicit offline empty state and keeps public-relay cold start in loading instead of flashing empty content. |
| Console health | Fail - pre-beta cleanup | Live browser emitted repeated `system-writer-validation-failed` warnings for raw `vh/news/index/latest/*` children with `unknown-signer-id`. This matches the raw latest-root hygiene gap and is user-filtered, but it pollutes console/error telemetry. |
| Analysis config route | Fail - canary risk | Browser requests to `/api/analyze/config` returned 502 during the walkthrough. The production app canary includes an `api_analyze` downstream surface, so this must be green before canary pass can be claimed. |
| Real phone | Not run | Requires owner/operator device pass on cellular or throttled network. |
| Second-device vote convergence | Not run | Requires two real sessions or the existing second-browser canary lane with release credentials. |

## Beta Triage

Blocks polished MVP before public beta:

- Deploy this branch's bad-route and offline empty-state fixes, then repeat the
  browser walkthrough against `https://venn.carboncaste.io/`.
- Restore `/api/analyze/config` health or document why the production app canary
  can still observe the required `api_analyze` surface.

Pre-beta cleanup unless owner accepts console noise:

- Run the raw latest-root hygiene dry run, then owner-approved scrub if the
  invalid children are confirmed stale telemetry.

Post-beta acceptable:

- Mobile frame/reframe density improvements.
- Real-device UX refinements discovered by the owner/operator phone pass.
