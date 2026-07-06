# VHC Pager iPhone Setup

> Status: Draft
> Owner: VHC Launch Ops
> Last Reviewed: 2026-07-06
> Depends On: docs/ops/vhc-incident-response.md, docs/specs/spec-vhc-incident-response.md

## What The iPhone Pager Does

The iPhone pager is a Home Screen web app. When the pager receives an A6 alert,
it can wake the phone with a safe notification that says to open the case file.
The notification does not contain secrets or private production data.

This is not the only alert path. Email fallback and the pager dead-man stay on
because iOS notification delivery can be affected by Focus, silent mode, user
notification settings, network state, and Apple delivery behavior.

## Setup Steps

1. Open the pager URL on the iPhone in Safari.
2. Share -> Add to Home Screen.
3. Open the new Home Screen app.
4. Paste the device token and enrollment secret from the operator packet.
5. Tap Enable Notifications.
6. Allow notifications when iOS asks.
7. Tap Check Pager Health.

The setup is only complete when:

- the app reports `notifications_enabled`;
- the pager health check is not `missing`;
- a real Block-A test-fire reaches both email and the iPhone;
- the operator confirms receipt on the actual phone they carry.

## What To Do When A Page Arrives

1. Open the notification.
2. Confirm the GitHub incident issue exists.
3. If the page says `critical`, do not wait for a later digest.
4. Ask Codex to investigate the incident issue and draft the repo-side fix or
   operator packet.
5. Do not paste tokens, webhook URLs, private env values, raw payloads, or heap
   files into the issue or Codex prompt.

The human does not need to diagnose the technical failure. The human needs to
notice the page, keep secrets out of public text, and decide whether to approve
a packet after the automated checks and reviewer verdict are present.

## Practical iPhone Settings

- Keep the Home Screen app installed; browser tabs alone are not enough.
- Leave notifications enabled for the web app.
- Do not rely on the PWA as the only overnight page path.
- Keep email notifications enabled on the same phone or another reachable
  device.

## Troubleshooting

If Enable Notifications fails:

- confirm the app was opened from the Home Screen, not only Safari;
- confirm the enrollment secret was typed correctly;
- confirm the pager has `VH_PAGER_VAPID_PUBLIC_KEY` configured;
- delete and re-add the Home Screen app if iOS keeps an old subscription.

If notifications were enabled but no page arrived:

- check email first;
- check whether the pager dead-man workflow opened an issue;
- re-run Check Pager Health;
- run a new Block-A test-fire only after the operator has authorized live A6
  alert-watch commands.
