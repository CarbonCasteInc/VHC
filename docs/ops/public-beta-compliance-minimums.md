# Public Beta Compliance Minimums

> Status: Accepted Draft for Web PWA public beta minimums
> Owner: VHC Launch Ops
> Last Reviewed: 2026-04-27
> Depends On: docs/plans/VENN_NEWS_MVP_ROADMAP_2026-04-20.md, docs/specs/spec-data-topology-privacy-v0.md, docs/specs/spec-hermes-forum-v0.md

Version: 0.4
Scope: Web PWA public beta policy surfaces, private support escalation protocol, and release evidence.

## 1. Purpose

Privacy, terms, UGC/moderation, support/contact, data deletion, telemetry/remote AI consent, and content/copyright boundaries must be visible before a public beta claim is made.

This is not legal approval. It is the minimum product and documentation surface that keeps the beta honest about what is implemented, what remains limited, and what users should not put into public mesh records.

## 2. Implemented User-Facing Routes

| Route | Page | Minimum user-facing claim |
| --- | --- | --- |
| `/compliance` | Public beta policy surfaces | Index page for the public beta policy routes and their implemented boundaries. |
| `/beta` | VHC Public Beta Scope | Web PWA beta scope, beta-local identity/proof limits, no native release claim, and no verified-human or one-human-one-vote assurance. |
| `/privacy` | Privacy Notice | Public workflow/audit records are public; sensitive identity/proof/contact data must not be submitted into reports, replies, or public support requests. |
| `/terms` | Beta Terms | Informational beta use only; no legal, medical, financial, election, emergency, or safety-critical reliance. |
| `/moderation` | UGC and Moderation Policy | Report intake, audited remediation actions, and minimum trusted beta operator authorization exist; user blocking, appeals, notifications, escalation, and broader case management remain out of scope. |
| `/support` | Beta Support and Contact | The reachable public beta support channel is the VHC GitHub Issue Form; public reports are not a private support inbox. |
| `/data-deletion` | Data Deletion and Local State | Local browser state can be cleared locally; public audit records require operator review and may remain as placeholders. |
| `/telemetry` | Telemetry and Remote AI Consent | Remote AI fallback is opt-in when configured and can send article text to a remote AI server. |
| `/copyright` | Content and Copyright Boundaries | VHC links and summarizes sources; users must not paste full copyrighted articles into public replies or report reasons. |

The `/compliance` index and individual policy routes are linked from the global Web PWA footer. Remote-AI consent copy links to `/telemetry`; synthesis and comment report controls link to `/moderation`.

The provisioned support/contact path is:

- User-facing page: `/support`
- Support channel: [Open VHC public beta support request](https://github.com/CarbonCasteInc/VHC/issues/new?template=public-beta-support.yml)
- Issue template: `.github/ISSUE_TEMPLATE/public-beta-support.yml`

The support request form creates a public GitHub issue. Users must not include private personal data, legal notices, identity documents, raw proof material, provider secrets, confidential support correspondence, abuse evidence that exposes private people, or full copyrighted articles. For deletion, copyright, abuse, or account concerns that require private details, users should submit only a public-safe issue stub and wait for operator private handoff outside the public GitHub issue body.

## 3. Private Escalation Protocol

This is the minimum private escalation protocol for public beta support. It is
an operator process, not a private support desk product surface.

Sensitive support categories:

- Account or access
- Data deletion or correction
- Abuse, safety, or moderation escalation
- Copyright or attribution concern

Operator handling rules:

1. Treat a support issue as sensitive when it is in one of the categories above
   or when the next useful fact would require private personal data, legal
   notices, identity/proof material, provider secrets, confidential
   correspondence, private abuse evidence, or full copyrighted material.
2. Keep the GitHub issue as a public-safe issue stub only. The public record may
   contain the request type, public URLs, public story/topic/comment/report ids,
   a short public-safe summary, and handoff status.
3. Operators must not ask users to post private details in GitHub issues,
   story-thread replies, report reasons, or public audit records.
4. Move private details to the pre-existing non-public beta contact channel or,
   for copyright/legal matters, the appropriate counsel path outside the public
   GitHub issue body. If no private channel exists for the requester, pause the
   case publicly as `private handoff required` rather than collecting details in
   GitHub.
5. Do not quote, duplicate, or summarize private details back into the public
   issue. If sensitive material is accidentally posted, do not echo it; use the
   available repository moderation/edit controls when available and continue only
   from a public-safe status update.
6. Close or update the public issue with only public-safe disposition text:
   `private handoff started`, `public-safe follow-up requested`, `dismissed as
   not enough public-safe context`, or `resolved outside public issue`.

## 4. Release Checklist

| Requirement | Status | Evidence |
| --- | --- | --- |
| Public beta scope page exists | Implemented | `/beta` route and `PublicBetaCompliancePageView`. |
| Privacy notice exists | Implemented | `/privacy` route and public mesh boundary copy. |
| Terms page exists | Implemented | `/terms` route and beta reliance limits. |
| UGC/moderation policy exists | Implemented | `/moderation` route, report-control policy links, and report/admin action docs. |
| Support/contact page exists | Implemented with provisioned public channel and private escalation protocol | `/support` route links to the VHC GitHub Issue Form and the repository includes `.github/ISSUE_TEMPLATE/public-beta-support.yml` with public-record warnings, deletion/copyright/moderation/account categories, public-safe issue stub language, and operator private handoff rules. |
| Data deletion instructions exist | Implemented | `/data-deletion` route distinguishes local browser data from public audit records. |
| Telemetry/remote AI consent exists | Implemented | `/telemetry` route and Engine Settings policy link. |
| Content/copyright boundaries exist | Implemented | `/copyright` route and user copy restrictions. |
| Minimum trusted operator gate exists | Implemented | `TrustedOperatorAuthorizationSchema`, `useOperatorTrustStore`, `/admin/reports`, Gun adapter authorization checks, and the `operator_trust_gate` MVP release gate require trusted beta operator capability records before reviewed reports, synthesis corrections, or comment moderation records are written. |
| Deterministic release check exists | Implemented | `pnpm check:public-beta-compliance` verifies route wiring, support-channel wiring, operator trust-gate wiring, no-overclaim language, and private escalation protocol coverage. |

## 5. Boundaries That Remain Open

- This minimum does not create production legal signoff.
- A minimum trusted beta operator authorization gate is implemented for current report dismissal, synthesis correction, and comment moderation actions in the first-party Web PWA/operator helpers.
- The trusted beta operator gate is not cryptographic server-side RBAC or complete admin membership management.
- User blocking, appeals, notifications, automated escalation workflow, SLA handling, and broader case management remain outside this minimum.
- Public reports are workflow records, not a private support inbox.
- Support requests are public workflow records, not private correspondence.
- The private escalation protocol is an operator handoff rule, not a private support desk, user account system, full RBAC system, or trust-and-safety operations console.
- The validated snapshot does not prove live-feed freshness.
- Native App Store or TestFlight readiness remains out of scope because no native shell is present.
- Remote model cost governance and broader launch operations visibility remain separate from these policy pages.

## 6. Required Commands

Before public beta claims are made from a release branch, run:

```bash
pnpm check:public-beta-compliance
pnpm docs:check
pnpm check:mvp-release-gates
```

For code changes touching these surfaces, also run the relevant Web PWA tests and typecheck.
