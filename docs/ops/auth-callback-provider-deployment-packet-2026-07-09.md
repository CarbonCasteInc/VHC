# Auth Callback Deployment And Provider Rehearsal Packet - 2026-07-09

> Status: `operator_packet_pending`
> Owner: VHC Launch Ops
> Last Reviewed: 2026-07-09
> Depends On: `docs/ops/account-provider-callback-boundary.md`,
> `services/auth-callback/README.md`,
> `docs/ops/public-beta-image-deploy.md`,
> `docs/ops/BETA_SESSION_RUNSHEET.md`,
> `docs/ops/public-beta-launch-control-2026-07-09.md`,
> `docs/plans/RELEASE_READINESS_SPRINT_OUTLINE_2026-07-08.md`

This packet turns the repo auth-callback capability into a live
tester-rehearsal surface. It covers the external auth boundary deployment,
provider app registration, PWA build-time env/CSP wiring, live provider
rehearsal, secret-safe evidence capture, and rollback.

It is not a release approval and does not authorize A6 mutation by itself. The
auth-callback service must run outside A6. Any PWA origin image rebuild or A6
origin redeploy required to bake `VITE_*` values must use
`docs/ops/public-beta-image-deploy.md` or a dedicated A6 operator packet.

## Current Blocker

The repo has:

- `services/auth-callback`, a Workers-style module worker with
  `default.fetch`;
- Apple/Google/X PKCE/OIDC callback handling;
- Apple `form_post` return handling;
- the Web PWA sign-in shell, account-to-LUMA binding, and identity-vault
  persistence;
- a build-time provider allowlist,
  `VITE_AUTH_CALLBACK_PROVIDERS`, so unregistered providers can be hidden.

The release is still blocked until:

1. an auth boundary host is deployed outside A6;
2. at least one provider is registered, configured, and rehearsed live;
3. the PWA origin image is rebuilt with the boundary URL, provider allowlist,
   callback route, and CSP connect-src update;
4. every provider visible in tester copy/UI passes the live rehearsal matrix;
5. secret-safe evidence is recorded for the release packet.

## Non-Goals

This packet does not approve:

- publisher restart;
- relay restart;
- accepted-synthesis canary;
- source-surface changes;
- StoryCluster credential repair;
- pager cutover;
- Codex live execution/autonomy;
- LUMA Silver, verified-human, one-human-one-vote, Sybil-resistance, or
  residency claims;
- provider-token custody in the browser;
- direct public publication of provider subjects, labels, tokens, or raw
  profile material.

## Required Operator Decisions

Fill these before running any live deployment or provider registration:

| Decision | Value | Status |
| --- | --- | --- |
| Auth boundary host URL | `TBD(auth-boundary-owner)` | release blocker |
| Edge host/project/account | `TBD(auth-boundary-owner)` | release blocker |
| Durable nonce store binding | `TBD(auth-boundary-owner)` | release blocker |
| PWA origin | `https://venn.carboncaste.io` unless changed in launch control | release blocker |
| PWA callback route | `/auth/callback` unless changed deliberately | release blocker |
| Providers advertised for `dev-small` | `TBD(provider-owners)` | release blocker |
| Apple registration owner | `TBD(operator)` | required if Apple is advertised |
| Google registration owner | `TBD(operator)` | required if Google is advertised |
| X registration owner | `TBD(operator)` | required if X is advertised |
| Origin image rebuild owner | `TBD(A6-operator)` | required if sign-in is advertised |
| Evidence owner | `TBD(release-evidence-owner)` | release blocker |
| Rollback owner | `TBD(incident-owner)` | release blocker |

At least one provider must be rehearsed before tester copy claims sign-in. If a
provider is not rehearsed, remove it from tester copy and from
`VITE_AUTH_CALLBACK_PROVIDERS` before rebuilding the PWA origin image.

## URL And Redirect Matrix

Use exact origins. Do not include trailing slashes in origin values.

| Surface | Required value |
| --- | --- |
| PWA origin | `https://venn.carboncaste.io` |
| PWA callback route | `/auth/callback` |
| Auth boundary base URL | `https://<auth-boundary>` |
| `VH_AUTH_ALLOWED_ORIGINS` | `https://venn.carboncaste.io` |
| `VH_AUTH_PWA_CALLBACK_ROUTE` | `/auth/callback` |
| `VITE_AUTH_CALLBACK_BASE_URL` | `https://<auth-boundary>` |
| `VITE_AUTH_CALLBACK_ROUTE` | `/auth/callback` |
| `VITE_AUTH_CALLBACK_PROVIDERS` | space/comma list of rehearsed providers, for example `google`, `apple google`, or `none` |
| Apple provider redirect URI | `https://<auth-boundary>/auth/apple/return` |
| Google provider redirect URI | `https://venn.carboncaste.io/auth/callback` |
| X provider redirect URI | `https://venn.carboncaste.io/auth/callback` |

Why the redirect URIs differ:

- Apple posts `code`/`state` to the worker through
  `POST /auth/apple/return` when scopes are requested. The worker then
  303-redirects the browser to the PWA callback route.
- Google and X redirect with query parameters directly to the PWA callback
  route. The PWA holds the PKCE verifier in `sessionStorage` and then POSTs
  `code`, `state`, and `codeVerifier` to
  `https://<auth-boundary>/auth/:provider/callback`.
- Do not register Google or X directly to the worker callback endpoint. The
  worker intentionally does not accept the browser-held PKCE verifier from a
  navigation GET.

## Secret Handling

Never paste these values into terminal transcripts, docs, PRs, issues, release
artifacts, support tickets, browser bundles, or logs:

- `VH_AUTH_STATE_SECRET`;
- `VH_AUTH_GOOGLE_CLIENT_SECRET`;
- `VH_AUTH_X_CLIENT_SECRET`;
- `VH_AUTH_APPLE_PRIVATE_KEY`;
- `VH_AUTH_APPLE_TEAM_ID`;
- `VH_AUTH_APPLE_KEY_ID`;
- bearer headers;
- provider access tokens;
- provider refresh tokens;
- provider `id_token`;
- provider subjects;
- PKCE verifier;
- signed `state` values;
- provider error bodies;
- email/profile labels unless deliberately redacted.

Allowed evidence:

- env variable names only;
- presence booleans;
- host/project names when they are not secret;
- health endpoint booleans;
- provider ids;
- redirect URI strings;
- file mode/owner/hash for private local env files;
- pass/fail status and stable reason codes.

## Repo Preflight

Run from a clean repo checkout before deploying or rehearsing:

```bash
git fetch origin --prune
git switch main
git pull --ff-only
git status --short
git rev-parse HEAD

corepack pnpm@9.7.1 --filter @vh/auth-callback build
corepack pnpm@9.7.1 --filter @vh/auth-callback test
corepack pnpm@9.7.1 check:auth-callback
corepack pnpm@9.7.1 --filter @vh/web-pwa exec vitest run src/auth/signInFlow.test.ts --config vite.config.ts
corepack pnpm@9.7.1 check:account-identity-controls
corepack pnpm@9.7.1 check:luma-forbidden-claims
corepack pnpm@9.7.1 check:luma-telemetry-redaction
```

Stop if any command fails. These checks prove the local provider flow, the
provider allowlist, the account-to-LUMA binding shell, forbidden-claim guard,
and telemetry redaction before secrets or live providers enter the loop.

## Provider Registration

Register only the providers that will be advertised for the first tester wave.
Start Apple first if all three are intended, because Apple usually has the
longest external lead time.

### Apple

Required:

- Apple Developer Program access;
- App ID and Services ID;
- Sign in with Apple key id;
- team id;
- `.p8` private key;
- redirect URI:
  `https://<auth-boundary>/auth/apple/return`;
- domain/redirect verification complete for the boundary host and PWA origin as
  required by the Apple console.

Boundary env names:

```bash
VH_AUTH_APPLE_CLIENT_ID
VH_AUTH_APPLE_TEAM_ID
VH_AUTH_APPLE_KEY_ID
VH_AUTH_APPLE_PRIVATE_KEY
VH_AUTH_APPLE_REDIRECT_URI
VH_AUTH_APPLE_SCOPES
```

### Google

Required:

- Google Cloud project;
- OAuth consent screen suitable for the tester group;
- OAuth 2.0 web client;
- redirect URI:
  `https://venn.carboncaste.io/auth/callback`;
- client secret in the edge host secret store.

Boundary env names:

```bash
VH_AUTH_GOOGLE_CLIENT_ID
VH_AUTH_GOOGLE_CLIENT_SECRET
VH_AUTH_GOOGLE_REDIRECT_URI
VH_AUTH_GOOGLE_SCOPES
```

### X

Required:

- X developer app;
- OAuth 2.0 confidential client;
- scopes `users.read tweet.read` unless deliberately narrowed;
- redirect URI:
  `https://venn.carboncaste.io/auth/callback`;
- client secret in the edge host secret store.

Boundary env names:

```bash
VH_AUTH_X_CLIENT_ID
VH_AUTH_X_CLIENT_SECRET
VH_AUTH_X_REDIRECT_URI
VH_AUTH_X_SCOPES
```

## Auth Boundary Deployment

Deploy `services/auth-callback/src/worker.mjs` as a module worker outside A6.
The worker exports `default.fetch`.

Required non-provider env/bindings:

```bash
VH_AUTH_STATE_SECRET
VH_AUTH_ALLOWED_ORIGINS
VH_AUTH_KV
VH_AUTH_STATE_TTL_MS
VH_AUTH_MAX_BODY_BYTES
VH_AUTH_PWA_CALLBACK_ROUTE
VH_AUTH_PWA_ORIGIN
```

Rules:

1. Use a durable nonce store bound as `VH_AUTH_KV` for release. Do not set
   `VH_AUTH_ALLOW_VOLATILE_STORE=1` outside local/dev testing.
2. Set `VH_AUTH_ALLOWED_ORIGINS` to the exact tester PWA origin. For the
   current A6-hosted target, this is `https://venn.carboncaste.io`.
3. Keep provider secrets in the host secret store only.
4. Do not put secret values in a committed `wrangler.toml`, dotenv file, PR,
   issue, evidence packet, or shell transcript.
5. If using Cloudflare Workers, use secret/binding mechanisms for all
   secret-bearing names and bind KV as `VH_AUTH_KV`. Keep any deploy config
   that names actual secret values outside git.

Secret-safe local env metadata, if using a private env file:

```bash
stat -f '%Lp %Su %Sg %N' ~/.config/vhc/auth-callback.env
shasum -a 256 ~/.config/vhc/auth-callback.env
awk -F= '/^[A-Z0-9_]+=/ {print $1}' ~/.config/vhc/auth-callback.env | sort
```

Do not `cat` the private env file in a shareable terminal.

## Health Readback

After deployment, read the health endpoint without printing configuration
values:

```bash
AUTH_BASE="https://<auth-boundary>"
curl -fsS "${AUTH_BASE}/api/health" \
  | jq '{
      status,
      schemaVersion,
      durableStore,
      providersConfigured
    }'
```

Required:

- `status` is `ok`;
- `schemaVersion` is `vh-auth-callback-health-v1`;
- `durableStore` is `true`;
- every advertised provider has `providersConfigured.<provider> == true`;
- every unadvertised provider may be `false`, but must not appear in tester
  copy or `VITE_AUTH_CALLBACK_PROVIDERS`.

Stop if health returns any raw provider value, token, private key, state secret,
subject, email, or error body.

## Start-Leg Smoke

Before a human provider rehearsal, prove the boundary returns safe authorize
parameters for each advertised provider without completing OAuth. This checks
CORS, state issuance, redirect URI shape, provider allowlist assumptions, and
absence of client-secret leakage.

```bash
AUTH_BASE="https://<auth-boundary>"
PWA_ORIGIN="https://venn.carboncaste.io"
PWA_CALLBACK_ROUTE="/auth/callback"
PROVIDERS="google" # space-separated advertised providers
export AUTH_BASE PWA_ORIGIN PWA_CALLBACK_ROUTE PROVIDERS

node --input-type=module <<'NODE'
import { webcrypto } from 'node:crypto';

const authBase = process.env.AUTH_BASE?.replace(/\/+$/u, '');
const pwaOrigin = process.env.PWA_ORIGIN?.replace(/\/+$/u, '');
const pwaRoute = process.env.PWA_CALLBACK_ROUTE || '/auth/callback';
const providers = String(process.env.PROVIDERS || '')
  .split(/\s+/u)
  .map((entry) => entry.trim())
  .filter(Boolean);

if (!authBase || !pwaOrigin || providers.length === 0) {
  throw new Error('AUTH_BASE, PWA_ORIGIN, and PROVIDERS are required');
}

function base64Url(bytes) {
  return Buffer.from(bytes)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

async function challenge() {
  const verifier = base64Url(webcrypto.getRandomValues(new Uint8Array(32)));
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

for (const provider of providers) {
  const response = await fetch(`${authBase}/auth/${provider}/start`, {
    method: 'POST',
    headers: {
      origin: pwaOrigin,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ codeChallenge: await challenge() }),
  });
  const body = await response.json().catch(() => null);
  if (response.status !== 200 || body?.status !== 'ok') {
    console.log(JSON.stringify({ provider, status: response.status, reason: body?.reason ?? 'non_json' }, null, 2));
    process.exit(1);
  }
  const params = body.parameters ?? {};
  const expectedRedirectUri = provider === 'apple'
    ? `${authBase}/auth/apple/return`
    : `${pwaOrigin}${pwaRoute}`;
  const serialized = JSON.stringify(body);
  const secretLike = /client_secret|private_key|access_token|refresh_token|id_token/i.test(serialized);
  const result = {
    provider,
    authorizeEndpoint: body.authorizeEndpoint,
    redirectUri: params.redirect_uri,
    redirectUriOk: params.redirect_uri === expectedRedirectUri,
    statePresent: typeof params.state === 'string' && params.state.length > 20,
    codeChallengePresent: typeof params.code_challenge === 'string' && params.code_challenge.length === 43,
    responseMode: params.response_mode ?? null,
    secretLike,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.redirectUriOk || !result.statePresent || !result.codeChallengePresent || secretLike) {
    process.exit(1);
  }
  if (provider === 'apple' && result.responseMode !== 'form_post') {
    process.exit(1);
  }
}
NODE
```

Record only the JSON booleans and provider ids. Do not record the `state`
itself.

## PWA Origin Build Wiring

The browser bundle must be rebuilt to enable sign-in. Runtime env on the
auth-callback worker cannot update an already-built PWA.

In the private origin provenance env from
`docs/ops/public-beta-image-deploy.md`, set:

```bash
VITE_AUTH_CALLBACK_BASE_URL=https://<auth-boundary>
VITE_AUTH_CALLBACK_ROUTE=/auth/callback
VITE_AUTH_CALLBACK_PROVIDERS="google" # or the exact advertised provider set
```

If sign-in is disabled or rolled back:

```bash
VITE_AUTH_CALLBACK_BASE_URL=
VITE_AUTH_CALLBACK_ROUTE=/auth/callback
VITE_AUTH_CALLBACK_PROVIDERS=none
```

When sign-in is enabled, append the auth boundary origin to both:

```bash
VITE_VH_CSP_CONNECT_SRC
VH_PUBLIC_ORIGIN_CSP_CONNECT_SRC
```

Then use `docs/ops/public-beta-image-deploy.md` to build and deploy the origin
image. That action touches A6 and must be approved in an A6 operator packet or
the public-beta image deploy runbook. Preserve relay data mounts and snapshots.
Do not restart publisher or relays from this auth packet.

## Deployed PWA Readback

After the origin image deploy is separately approved and completed, verify the
deployed PWA contains the intended auth/CSP values without exposing secrets:

```bash
PWA_ORIGIN="https://venn.carboncaste.io"
AUTH_ORIGIN="https://<auth-boundary>"
export PWA_ORIGIN AUTH_ORIGIN

node --input-type=module <<'NODE'
const pwaOrigin = process.env.PWA_ORIGIN;
const authOrigin = process.env.AUTH_ORIGIN;
const html = await fetch(pwaOrigin).then((response) => response.text());
const cspHasAuth = html.includes(authOrigin);
const hasAuthCallbackRoute = html.includes('/auth/callback');
console.log(JSON.stringify({
  pwaOrigin,
  authOrigin,
  cspHasAuth,
  hasAuthCallbackRoute,
}, null, 2));
if (!cspHasAuth || !hasAuthCallbackRoute) process.exit(1);
NODE
```

Then open `/account/identity` in the deployed PWA and confirm:

- provider rows exist only for `VITE_AUTH_CALLBACK_PROVIDERS`;
- `VITE_AUTH_CALLBACK_PROVIDERS=none` renders no provider rows;
- the copy says sign-in is account continuity/profile recovery;
- the copy does not claim verified-human, one-human-one-vote, Silver,
  Sybil-resistance, residency, anonymity, or same-human continuity.

## Live Provider Rehearsal

Use `docs/ops/BETA_SESSION_RUNSHEET.md` section
"Account sign-in and account-to-LUMA binding rehearsal" as the canonical
manual procedure. For every advertised provider:

1. start sign-in from the deployed PWA;
2. complete provider authorization;
3. return through `/auth/callback`;
4. verify the PWA POSTs to `/auth/:provider/callback`;
5. verify `vh-auth-session-v1` arrives without provider tokens;
6. verify the session binds to the current beta-local LUMA principal;
7. reload and confirm local account continuity;
8. sign out and confirm the provider vault compartment clears for that
   provider only;
9. reconnect and confirm same-browser continuity;
10. reset identity in a rehearsal browser and confirm the account must re-bind;
11. repeat in a second browser profile and confirm it gets a distinct
   beta-local LUMA identity.

The rehearsal fails if any provider subject, token, state value, PKCE verifier,
private key, nullifier, raw proof material, address, wallet material, or
provider error body appears in UI text, network payloads that leave the browser
for public mesh paths, telemetry, logs, screenshots, issue comments, or release
artifacts.

## Secret-Safe Artifact Capture

Create a local artifact directory for the release evidence owner:

```bash
ARTIFACT_DIR=".tmp/release-evidence/auth-callback-provider-rehearsal/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "${ARTIFACT_DIR}"
chmod 700 "${ARTIFACT_DIR}"
```

Write a summary with booleans and stable identifiers only:

```json
{
  "schemaVersion": "auth-callback-provider-rehearsal-v1",
  "status": "pass",
  "releaseCommit": "<git-sha>",
  "authBoundaryHost": "https://<auth-boundary>",
  "pwaOrigin": "https://venn.carboncaste.io",
  "pwaBuildRevision": "<origin-healthz-build-revision>",
  "providersAdvertised": ["google"],
  "providersRehearsed": {
    "google": {
      "healthConfigured": true,
      "startLegSmoke": "pass",
      "providerRedirect": "pass",
      "pkceCallback": "pass",
      "sessionSchema": "vh-auth-session-v1",
      "accountToLumaBinding": "pass",
      "sameBrowserReloadContinuity": "pass",
      "sameProviderReconnect": "pass",
      "resetRequiresRebind": "pass",
      "secondBrowserDistinctPrincipal": "pass",
      "secretLeakCheck": "pass"
    }
  },
  "forbiddenClaimsObserved": false,
  "providerSecretsInBrowserBundle": false,
  "providerSecretsInBoundaryResponses": false,
  "providerSubjectsOnPublicMesh": false,
  "notes": []
}
```

Do not include provider subject strings, emails, tokens, state values, PKCE
verifiers, nullifiers, raw screenshots containing private profile data, or raw
provider response bodies.

## Secret Scan

After building the PWA and auth boundary artifact, scan local build outputs
against the private secret env without printing secret values:

```bash
AUTH_ENV="$HOME/.config/vhc/auth-callback.env"
SCAN_ROOTS="apps/web-pwa/dist .tmp/auth-callback-deploy"
export AUTH_ENV SCAN_ROOTS

node --input-type=module <<'NODE'
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const envPath = process.env.AUTH_ENV;
const roots = String(process.env.SCAN_ROOTS || '')
  .split(/\s+/u)
  .filter(Boolean);
const names = [
  'VH_AUTH_STATE_SECRET',
  'VH_AUTH_GOOGLE_CLIENT_SECRET',
  'VH_AUTH_X_CLIENT_SECRET',
  'VH_AUTH_APPLE_PRIVATE_KEY',
  'VH_AUTH_APPLE_TEAM_ID',
  'VH_AUTH_APPLE_KEY_ID',
];

function parseEnv(text) {
  const out = new Map();
  for (const line of text.split(/\n/u)) {
    if (!/^[A-Z0-9_]+=/.test(line)) continue;
    const index = line.indexOf('=');
    const name = line.slice(0, index);
    let value = line.slice(index + 1).trim();
    value = value.replace(/^['"]|['"]$/g, '');
    if (value.length >= 8) out.set(name, value);
  }
  return out;
}

function walk(root, out = []) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (statSync(path).size <= 8_000_000) out.push(path);
  }
  return out;
}

const env = parseEnv(readFileSync(envPath, 'utf8'));
const files = roots.flatMap((root) => walk(root));
const leaks = [];
for (const name of names) {
  const value = env.get(name);
  if (!value) continue;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (text.includes(value)) leaks.push({ name, file });
  }
}
console.log(JSON.stringify({ scannedFiles: files.length, leakedSecretNames: leaks }, null, 2));
if (leaks.length > 0) process.exit(1);
NODE
```

The script prints secret names and file paths only if a leak is found, never the
secret values. If it reports a leak, delete the artifact, rotate the leaked
secret, and stop the release.

## Exit Criteria

This packet is complete when all are true:

- auth boundary is deployed outside A6;
- `/api/health` is secret-safe and reports durable store `true`;
- every advertised provider reports configured in health;
- start-leg smoke passes for every advertised provider;
- the PWA origin image has been rebuilt with the intended
  `VITE_AUTH_CALLBACK_BASE_URL`, `VITE_AUTH_CALLBACK_ROUTE`,
  `VITE_AUTH_CALLBACK_PROVIDERS`, and CSP connect-src values;
- deployed PWA provider rows match the provider allowlist;
- every advertised provider passes the live run-sheet rehearsal;
- secret scan finds no provider secret in browser bundle or auth artifacts;
- release evidence records only booleans, provider ids, host URLs, artifact
  paths, and stable reason codes;
- tester copy claims only account continuity/profile recovery, not human
  uniqueness or identity assurance.

## Stop Rules

Stop immediately if:

1. the auth boundary is deployed on A6;
2. `VH_AUTH_ALLOW_VOLATILE_STORE=1` is used for a release host;
3. `/api/health` exposes a secret, token, subject, state, provider error body,
   or private key;
4. any advertised provider has `providersConfigured.<provider> != true`;
5. Google or X is registered to the worker callback endpoint instead of the
   PWA callback route;
6. Apple `form_post` does not return through `/auth/apple/return`;
7. CSP blocks PWA fetches to the auth boundary;
8. the PWA shows a provider not in `VITE_AUTH_CALLBACK_PROVIDERS`;
9. provider token, subject, PKCE verifier, state value, nullifier, raw proof
   material, address, wallet material, or provider error body appears in a
   public path, UI copy, telemetry, log, screenshot, PR, issue, or artifact;
10. sign-in copy implies verified-human, one-human-one-vote, Silver,
    Sybil-resistance, residency, anonymity, or cross-device same-human
    continuity.

## Rollback

Fastest non-A6 mitigations:

1. disable the affected provider at the auth boundary host;
2. remove provider secret/config from the edge host secret store;
3. block `POST /auth/:provider/start` for the affected provider;
4. pause tester invites and remove provider claims from tester copy.

UI-hiding rollback requires a PWA origin rebuild:

```bash
VITE_AUTH_CALLBACK_PROVIDERS=none
```

or remove:

```bash
VITE_AUTH_CALLBACK_BASE_URL=
```

That rebuild/deploy touches the A6 origin image and must use
`docs/ops/public-beta-image-deploy.md` or a dedicated A6 packet. Preserve
evidence before rollback, keep email alerting live, and do not restart publisher
or relays from this auth packet.
