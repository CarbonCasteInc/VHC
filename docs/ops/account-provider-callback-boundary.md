# Account Provider Callback Boundary — Decision Record

> Status: Accepted Decision / Repo Capability (deployment pending)
> Owner: VHC Core Engineering + VHC Launch Ops
> Last Reviewed: 2026-07-09
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
     basic-auth token endpoint) and future maintenance; we run a small
     state store (KV) as a best-effort state-replay ledger (see the
     replay-backstop note below).
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
  with a KV-style namespace bound as `VH_AUTH_KV` for the best-effort
  state-replay ledger. This is the same platform family as the pager's
  deployment plan and is intentionally **not** A6.
- **A6 non-touch rule:** standing up, configuring, testing, or rotating
  this service must not touch the A6 publisher/relay host during the
  watch window. No A6 env edit, timer change, restart, or deploy is
  part of this boundary's lifecycle. The hard operational boundaries in
  `docs/plans/FUNCTIONING_MVP_LANE_SLICE_PLAN_2026-07-06.md` and
  `docs/ops/vhc-incident-response.md` apply unchanged.
- Rollback: the service holds no durable state beyond best-effort
  replay-ledger nonces; rollback is a host-side redeploy/disable and
  never involves A6.

### State-replay backstop (not strictly atomic)

The KV nonce ledger is defense-in-depth, not a strict single-use
guarantee: the `hasNonce`+`rememberNonce` check-then-set is two steps
and KV get/put is not a compare-and-set, so a tight race is
theoretically possible. Achieving strict single-use would require a
compare-and-set store (e.g. a Durable Object), which is out of scope for
these foundations. The **authoritative** single-use guarantee is the
provider's authorization code — any second exchange of the same code
returns `provider_exchange_failed`. Signed, expiring state (verified
with a constant-time HMAC compare) plus PKCE binding are the primary
defenses.

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

## Client (PWA) configuration

The Web PWA reaches this boundary through a single **public** env var —
no secret is involved:

- `VITE_AUTH_CALLBACK_BASE_URL` — base URL of the deployed
  auth-callback host (e.g. `https://auth.example.com`). When set, the
  account page offers Apple/Google/X sign-in and the browser runs the
  PKCE round-trip (`/auth/:provider/start` then `/auth/:provider/callback`)
  against it. Unset hides real sign-in; beta-local identity creation
  still works.
- `VITE_AUTH_CALLBACK_ROUTE` — optional override of the in-app OAuth
  redirect route (default `/auth/callback`); Google and X provider redirect
  URIs point at this PWA route, while Apple's form-post provider redirect points
  at the worker receiver that 303-redirects back to this route.
- `VITE_AUTH_CALLBACK_PROVIDERS` — optional comma/space-separated
  allowlist of visible provider ids (`apple`, `google`, `x`). When unset,
  a real build with `VITE_AUTH_CALLBACK_BASE_URL` offers all three
  providers. Set this for staged releases so the PWA hides providers that
  have not passed live registration/rehearsal yet. Set it to `none`, `off`, or
  `false` to hide every provider in a rollback build while leaving the boundary
  URL present.
- Under `VITE_E2E_MODE`, the same provider ids run an in-process mock
  exchange (no network, no boundary URL) so the full browser flow —
  PKCE, callback, account-to-LUMA binding, reset re-bind — is CI-testable
  (`packages/e2e/src/luma/account-identity-controls.spec.ts`,
  `check:account-identity-controls`).

Provider redirect URI shape:

- Apple, with the default non-empty scope set, uses `form_post`: register
  and set `VH_AUTH_APPLE_REDIRECT_URI` to the worker receiver
  `https://<auth-boundary>/auth/apple/return`. The receiver 303-redirects
  to the PWA route after verify-only state inspection.
- Google and X use query redirects to the PWA: register and set
  `VH_AUTH_GOOGLE_REDIRECT_URI` / `VH_AUTH_X_REDIRECT_URI` to
  `https://<pwa-origin>/auth/callback` unless the PWA route is deliberately
  changed. The browser then posts `code`, `state`, and the stored PKCE
  verifier to `https://<auth-boundary>/auth/:provider/callback`.

Do not register Google or X directly to the worker callback endpoint for
this release path: the worker never receives the browser-held PKCE verifier
on a provider navigation GET, so that route intentionally fails PKCE and
steers clients back to the PWA POST flow.

The browser holds only the non-secret `vh-auth-session-v1` payload; the
provider subject/label live in the identity-vault `signInSession`
compartment (vault/local-only), and the account-to-LUMA binding
(`boundPrincipalNullifier`) is local continuity/recovery only.

## Apple form_post return leg

Apple uses `response_mode=form_post` when scopes are requested. The boundary
therefore exposes `POST /auth/apple/return` as an Apple-only browser navigation
receiver. It reads only `state` and either `code` or a sanitized provider
`error`, then issues a `303` redirect to the PWA callback route with the same
query semantics as the ordinary GET callback leg.

Routing is origin-bound:

- `handleStart` binds the initiating PWA origin into the signed state after
  validating it against `VH_AUTH_ALLOWED_ORIGINS`.
- The form_post receiver verifies the state without consuming the nonce, so the
  PWA can still complete the normal PKCE exchange exactly once through
  `POST /auth/apple/callback`.
- In a multi-origin deployment, the receiver redirects to the origin carried in
  the state; if the state lacks a usable origin, it may fall back to
  `VH_AUTH_PWA_ORIGIN` or to the sole allowed origin. Multi-origin deployments
  with no resolvable target fail closed.
- User-cancel and provider-error returns are forwarded to the PWA as sanitized
  errors rather than dead-ending on the service.

The verifier never travels this leg and the browser never sends a
`code_verifier` through it.

## Relationship to the plan

- This record is the named PR D deliverable from Slice C0 ("decide and
  record the boundary approach").
- Slice C1 consumes this boundary: the closed sign-in provider schema
  (`packages/data-model/src/schemas/hermes/signInProvider.ts`) and the
  vault compartment for session material are already repo capabilities.
- Slice C1/C2/C3 client wiring lands in the PWA: the PKCE browser flow
  (`apps/web-pwa/src/auth/signInFlow.ts`), the account-to-LUMA binding
  (`apps/web-pwa/src/auth/signInBinding.ts`), the non-secret account
  store (`apps/web-pwa/src/store/signInAccount.ts`), the callback route
  (`apps/web-pwa/src/routes/AuthCallbackPage.tsx`), and the account
  provider UI (`apps/web-pwa/src/components/account/SignInProviderSection.tsx`).
- Live PKCE round-trip evidence against the deployed boundary, the
  browser-bundle secret scan, and rehearsal evidence are Lane C/Lane F
  gates and remain open until deployment.
- Claim boundary: sign-in through this service is **account continuity
  and profile recovery**. It is not proof of human uniqueness, and no
  copy, telemetry, or release evidence may present it as such (see the
  plan's "Account And LUMA Semantics").
