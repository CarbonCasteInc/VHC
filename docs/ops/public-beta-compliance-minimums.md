# Public Beta Compliance Minimums

> Status: Accepted Draft for Web PWA public beta minimums
> Owner: VHC Launch Ops
> Last Reviewed: 2026-04-26
> Depends On: docs/plans/VENN_NEWS_MVP_ROADMAP_2026-04-20.md, docs/specs/spec-data-topology-privacy-v0.md, docs/specs/spec-hermes-forum-v0.md

Version: 0.1
Scope: Web PWA public beta policy surfaces and release evidence.

## 1. Purpose

Privacy, terms, UGC/moderation, support/contact, data deletion, telemetry/remote AI consent, and content/copyright boundaries must be visible before a public beta claim is made.

This is not legal approval. It is the minimum product and documentation surface that keeps the beta honest about what is implemented, what remains limited, and what users should not put into public mesh records.

## 2. Implemented User-Facing Routes

| Route | Page | Minimum user-facing claim |
| --- | --- | --- |
| `/compliance` | Public beta policy surfaces | Index page for the public beta policy routes and their implemented boundaries. |
| `/beta` | VHC Public Beta Scope | Web PWA beta scope, beta-local identity/proof limits, no native release claim, and no verified-human or one-human-one-vote assurance. |
| `/privacy` | Privacy Notice | Public workflow/audit records are public; sensitive identity/proof/contact data must not be submitted into reports or replies. |
| `/terms` | Beta Terms | Informational beta use only; no legal, medical, financial, election, emergency, or safety-critical reliance. |
| `/moderation` | UGC and Moderation Policy | Report intake and audited remediation actions exist; user blocking, appeals, notifications, escalation, and broader case management remain out of scope. |
| `/support` | Beta Support and Contact | Beta users must have an operator-provided contact channel; public reports are not a private support inbox. |
| `/data-deletion` | Data Deletion and Local State | Local browser state can be cleared locally; public audit records require operator review and may remain as placeholders. |
| `/telemetry` | Telemetry and Remote AI Consent | Remote AI fallback is opt-in when configured and can send article text to a remote AI server. |
| `/copyright` | Content and Copyright Boundaries | VHC links and summarizes sources; users must not paste full copyrighted articles into public replies or report reasons. |

The `/compliance` index and individual policy routes are linked from the global Web PWA footer. Remote-AI consent copy links to `/telemetry`; synthesis and comment report controls link to `/moderation`.

## 3. Release Checklist

| Requirement | Status | Evidence |
| --- | --- | --- |
| Public beta scope page exists | Implemented | `/beta` route and `PublicBetaCompliancePageView`. |
| Privacy notice exists | Implemented | `/privacy` route and public mesh boundary copy. |
| Terms page exists | Implemented | `/terms` route and beta reliance limits. |
| UGC/moderation policy exists | Implemented | `/moderation` route, report-control policy links, and report/admin action docs. |
| Support/contact page exists | Implemented with beta-cohort constraint | `/support` route tells users to use the operator-provided beta contact channel. Public beta remains blocked if an operator cannot provide a reachable support/contact channel. |
| Data deletion instructions exist | Implemented | `/data-deletion` route distinguishes local browser data from public audit records. |
| Telemetry/remote AI consent exists | Implemented | `/telemetry` route and Engine Settings policy link. |
| Content/copyright boundaries exist | Implemented | `/copyright` route and user copy restrictions. |
| Deterministic release check exists | Implemented | `pnpm check:public-beta-compliance`. |

## 4. Boundaries That Remain Open

- This minimum does not create production legal signoff.
- trust-gated operator roles remain outside this minimum.
- User blocking, appeals, notifications, escalation policy, and broader case management remain outside this minimum.
- Public reports are workflow records, not a private support inbox.
- The validated snapshot does not prove live-feed freshness.
- Native App Store or TestFlight readiness remains out of scope because no native shell is present.
- Remote model cost governance and broader launch operations visibility remain separate from these policy pages.

## 5. Required Commands

Before public beta claims are made from a release branch, run:

```bash
pnpm check:public-beta-compliance
pnpm docs:check
pnpm check:mvp-release-gates
```

For code changes touching these surfaces, also run the relevant Web PWA tests and typecheck.
