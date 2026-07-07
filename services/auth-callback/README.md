# @vh/auth-callback — OAuth Callback / Token-Exchange Boundary (Slice C0)

Minimal Worker-style service that owns the server side of the Apple /
Google / X sign-in flow for the Venn News Web PWA. It is the only place
provider client secrets exist. The browser completes OAuth/OIDC with
PKCE against this boundary; raw provider tokens never reach the browser.

Sign-in through this boundary is **account continuity and profile
recovery**. It is not proof of human uniqueness and must never be
described that way (see
`docs/plans/FUNCTIONING_MVP_LANE_SLICE_PLAN_2026-07-06.md`, "Account And
LUMA Semantics").

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/auth/:provider/start` | Validate origin + provider config, issue a single-use expiring HMAC-signed `state` bound to the browser's PKCE S256 `codeChallenge`, and return the provider authorize URL parameters. |
| `GET`/`POST` | `/auth/:provider/callback` | Validate + consume `state`, verify `codeVerifier` against the challenge bound at `/start`, exchange the authorization code at the provider token endpoint (server-side, injecting the client secret), and return a **non-secret** session payload. |
| `OPTIONS` | `/auth/:provider/start\|callback` | CORS preflight for allow-listed origins. |
| `GET` | `/api/health` | Configuration booleans only — never values. |

`:provider` is a closed set: `apple`, `google`, `x`. Anything else is
`404 unknown_provider`.

### What the PWA receives

```json
{
  "status": "ok",
  "session": {
    "schemaVersion": "vh-auth-session-v1",
    "providerId": "google",
    "providerSubject": "…provider sub…",
    "displayLabel": "person@example.com",
    "issuedAt": 1750000000000,
    "expiresAt": 1750003600000
  }
}
```

No access token, refresh token, id_token, or client secret is ever part
of a response. Provider errors are reduced to stable reason codes plus a
sanitized `providerError` code (`[a-z0-9_]`, truncated) — provider error
bodies are never propagated.

### Flow

1. Browser generates a PKCE `code_verifier`, computes the S256
   `code_challenge`, and `POST /auth/:provider/start` with it.
2. Service issues `state` (HMAC-signed, expiring, single-use; binds the
   challenge) and returns the authorize URL parameters.
3. Browser navigates to the provider, authorizes, and is redirected to
   the PWA redirect URI with `code` + `state`.
4. PWA calls `/auth/:provider/callback` with `code`, `state`, and its
   `code_verifier`. The service consumes the state (replay-proof),
   verifies `S256(code_verifier) == bound challenge`, exchanges the code
   server-side, and returns the sanitized session payload.

## Environment

All configuration is env-injected. **No secret may ever enter the repo,
the browser bundle, logs, error messages, responses, or release
evidence.**

```bash
# Shared
VH_AUTH_STATE_SECRET=                 # >=16 chars; HMAC key for state signing
VH_AUTH_ALLOWED_ORIGINS=              # comma/space-separated exact origins (PWA origins)
VH_AUTH_STATE_TTL_MS=600000           # optional; state lifetime
VH_AUTH_MAX_BODY_BYTES=65536          # optional; request body cap

# Store for single-use state enforcement (pick one)
# VH_AUTH_KV=<KV namespace binding>   # durable store (Workers KV)
# VH_AUTH_ALLOW_VOLATILE_STORE=1      # explicit opt-in for dev only

# Apple (Sign in with Apple — client secret is a server-built ES256 JWT)
VH_AUTH_APPLE_CLIENT_ID=              # Services ID
VH_AUTH_APPLE_TEAM_ID=
VH_AUTH_APPLE_KEY_ID=
VH_AUTH_APPLE_PRIVATE_KEY=            # PKCS#8 PEM (.p8 contents)
VH_AUTH_APPLE_REDIRECT_URI=           # per-env
VH_AUTH_APPLE_SCOPES=email            # optional override

# Google
VH_AUTH_GOOGLE_CLIENT_ID=
VH_AUTH_GOOGLE_CLIENT_SECRET=
VH_AUTH_GOOGLE_REDIRECT_URI=          # per-env
VH_AUTH_GOOGLE_SCOPES="openid email"  # optional override

# X (OAuth 2.0 confidential client)
VH_AUTH_X_CLIENT_ID=
VH_AUTH_X_CLIENT_SECRET=
VH_AUTH_X_REDIRECT_URI=               # per-env
VH_AUTH_X_SCOPES="users.read tweet.read"  # optional override
```

Test-only injection points (never set in deployment): `__TEST_STORE`,
`__TEST_FETCH`, `__TEST_NOW_MS`.

## Deployment target

This service deploys to a Workers-family edge host **outside A6** — the
same platform family and treatment as `services/vhc-pager`. Standing it
up, configuring it, or rotating its secrets must not touch the A6
publisher/relay host during the watch window. See
`docs/ops/account-provider-callback-boundary.md` for the decision
record, trade-offs, and the provider app registration checklist.

## Secret custody rules

- Provider client secrets and the Apple signing key live only in the
  deployment host's private env/secret store.
- Never commit them to the repo, embed them in the PWA bundle, print
  them in logs, paste them into issues/PRs, or attach them to release
  evidence.
- The Apple client secret JWT is built per exchange with a short TTL and
  is never persisted or returned.
- Rotation: rotate at the provider console + host secret store; no repo
  change is involved.

## Develop / test

```bash
corepack pnpm@9.7.1 --filter @vh/auth-callback build   # syntax guards
corepack pnpm@9.7.1 --filter @vh/auth-callback test    # node --test, stubbed providers, no network
```
