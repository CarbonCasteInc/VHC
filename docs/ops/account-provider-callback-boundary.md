# Account Provider Callback Boundary — Decision Record

> Status: Accepted Decision / Repo Capability (deployment pending)
> Owner: VHC Core Engineering + VHC Launch Ops
> Last Reviewed: 2026-07-07
> Depends On: docs/plans/FUNCTIONING_MVP_LANE_SLICE_PLAN_2026-07-06.md, docs/specs/spec-linked-socials-v0.md, docs/specs/spec-data-topology-privacy-v0.md, docs/specs/secure-storage-policy.md, docs/ops/vhc-incident-response.md

## Decision

The OAuth callback/token-exchange boundary for the Apple/Google/X
sign-in shell (Lane C, Slice C0 of
`docs/plans/FUNCTIONING_MVP_LANE_SLICE_PLAN_2026-07-06.md`) is a
**dedicated minimal service in the repo: `services/auth-callback`**,
deployable to a Workers-family edge host **outside A6** — the same
platform family and operational treatment as `services/vhc-pager`.

The browser completes OAuth/OIDC with PKCE against this boundary only.
Provider client secrets exist solely in the boundary host's private
env/secret store. The service exchanges the authorization code
server-side and returns a non-secret session payload (provider id,
provider subject, optional display label, expiry) to the PWA; raw
provider tokens do not go to the browser by default.

## Why this shape (trade-offs)

Considered options:

1. **Dedicated minimal service in `services/` (CHOSEN).**
   - Pros: full custody of secrets and redaction discipline in repo
     code; testable with `node --test` and stubbed provider endpoints;
     mirrors the proven `vhc-pager` service template (Worker-style
     fetch handler, env-held secrets, body-size limits, fail-closed
     durable store); deploys outside A6 with zero coupling to the
     publisher/relay host; no new vendor dependency; the exact
     token-custody behavior (drop provider tokens server-side) is our
     code, not a vendor default.
   - Cons: we own provider quirks (Apple's signed client secret, X's
     basic-auth token endpoint) and future maintenance; we must run a
     small state store (KV) for single-use state enforcement.
2. **Hosted auth (Auth0/Firebase Auth/Supabase Auth or similar).**
   - Pros: provider registration/rotation UX, prebuilt flows.
   - Cons: introduces a third-party processor for personal profile
     data (provider subjects/labels are vault/local-only classes under
     `docs/specs/spec-data-topology-privacy-v0.md` §3); vendor session
     tokens and SDKs land in the browser bundle by default, which
     conflicts with the "no provider tokens in the browser" custody
     rule; adds an account-system dependency the MVP release claims do
     not need; harder to prove redaction in release evidence.
3. **Serverless function co-located with the PWA hosting target.**
   - Pros: one deployment surface; same-origin callback.
   - Cons: couples secret custody and rotation to the static-site
     deploy pipeline; PWA redeploys would churn the auth boundary;
     bundler/edge-runtime constraints are less predictable than the
     Workers runtime the pager already targets; secrets would live in
     the web-hosting project scope, widening exposure.

Option 1 keeps the boundary small, auditable, and aligned with the
repo's existing service discipline, at the cost of owning ~600 lines of
well-tested exchange logic.

## Deployment target and A6 non-touch boundary

- Target: a Workers-family edge host (Cloudflare Workers or equivalent)
  with a KV-style namespace bound as `VH_AUTH_KV` for single-use state
  enforcement. This is the same platform family as the pager's
  deployment plan and is intentionally **not** A6.
- **A6 non-touch rule:** standing up, configuring, testing, or rotating
  this service must not touch the A6 publisher/relay host during the
  watch window. No A6 env edit, timer change, restart, or deploy is
  part of this boundary's lifecycle. The hard operational boundaries in
  `docs/plans/FUNCTIONING_MVP_LANE_SLICE_PLAN_2026-07-06.md` and
  `docs/ops/vhc-incident-response.md` apply unchanged.
- Rollback: the service is stateless apart from consumed-state nonces;
  rollback is a host-side redeploy/disable and never involves A6.

## Env and secret custody

Canonical env template lives in `services/auth-callback/README.md`
(all `VH_AUTH_*` variables). Custody rules:

- Provider client secrets (`VH_AUTH_GOOGLE_CLIENT_SECRET`,
  `VH_AUTH_X_CLIENT_SECRET`) and the Apple signing key
  (`VH_AUTH_APPLE_PRIVATE_KEY` + team/key/client ids) are provisioned
  host-private (env/secret store) only.
- They never enter the repo, the browser bundle, logs, error messages,
  responses, support issues, or release evidence. Release evidence may
  cite configuration booleans (the `/api/health` shape) only.
- The Apple client secret is a short-TTL ES256-signed JWT built
  server-side per exchange; it is never persisted or returned.
- The PWA receives only the non-secret session payload
  (`vh-auth-session-v1`). Provider subjects and display labels are
  personal profile data: vault/local-only on the client
  (`docs/specs/spec-data-topology-privacy-v0.md` §3), shown only in
  local account UI, never written to `vh/*` public records, and never
  published joined with `forumAuthorId`, `identityDirectoryKey`,
  `voterId`, or any envelope-bearing record. A future public
  profile-label surface requires a topology classification plus a
  Protocol RFC.
- Sign-in session material on the device lives in the dedicated
  identity-vault compartment
  (`packages/identity-vault/src/compartments/signInSession.ts`), not in
  the flag-gated linked-social token vault
  (`docs/specs/spec-linked-socials-v0.md` keeps its own separate
  `SocialProviderId` enum and storage rules).

## Provider app registration checklist (external dependency)

Registration lead time is an external dependency on the release path.
Each item needs a named owner before Slice C0 is declared done; the
placeholders below must be filled by the operator, not by repo
automation.

| Provider | App/config to register | Redirect URIs | Secret material | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| Apple | Apple Developer Program team; App ID + **Services ID** (client id); Sign in with Apple key (`.p8`) | per-env `VH_AUTH_APPLE_REDIRECT_URI` (staging + production) | `.p8` private key + key id + team id -> host secret store; client secret is server-built ES256 JWT | `TODO(owner)` | not started |
| Google | Google Cloud project; OAuth consent screen; OAuth 2.0 Web client | per-env `VH_AUTH_GOOGLE_REDIRECT_URI` | client secret -> host secret store | `TODO(owner)` | not started |
| X | X developer app with OAuth 2.0 (confidential client), `users.read tweet.read` scopes | per-env `VH_AUTH_X_REDIRECT_URI` | client secret -> host secret store | `TODO(owner)` | not started |

Notes:

- **Apple has the longest lead time**: developer-program membership
  verification, Services ID + domain/redirect verification, and the
  server-held signed client secret (the `.p8` key) are all
  prerequisites to the first successful exchange. Start Apple first.
- Redirect URIs are registered per environment; localhost/dev origins
  are listed in `VH_AUTH_ALLOWED_ORIGINS` only for dev deployments.
- Consent-screen/app-review requirements (Google unverified-app limits,
  X app review) are tracked by the same owner as the registration row.

## Relationship to the plan

- This record is the named PR D deliverable from Slice C0 ("decide and
  record the boundary approach").
- Slice C1 consumes this boundary: the closed sign-in provider schema
  (`packages/data-model/src/schemas/hermes/signInProvider.ts`) and the
  vault compartment for session material are already repo capabilities.
- Live PKCE round-trip evidence against the deployed boundary, the
  browser-bundle secret scan, and rehearsal evidence are Lane C/Lane F
  gates and remain open until deployment.
- Claim boundary: sign-in through this service is **account continuity
  and profile recovery**. It is not proof of human uniqueness, and no
  copy, telemetry, or release evidence may present it as such (see the
  plan's "Account And LUMA Semantics").
