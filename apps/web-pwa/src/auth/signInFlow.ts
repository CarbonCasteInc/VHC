/**
 * Browser sign-in flow (Lane C, Slices C0/C1 client side).
 *
 * Drives the PKCE OAuth/OIDC round-trip against the deployed
 * auth-callback boundary (services/auth-callback). The browser:
 *
 *   1. generates a PKCE `code_verifier` and its S256 `code_challenge`
 *      with WebCrypto;
 *   2. POSTs the challenge to `/auth/:provider/start` and receives an
 *      HMAC-signed `state` plus the provider authorize URL;
 *   3. is redirected back to the PWA with `code` + `state`;
 *   4. POSTs `code` + `state` + `code_verifier` to
 *      `/auth/:provider/callback` and receives the NON-SECRET
 *      `vh-auth-session-v1` payload (provider id, subject, optional
 *      display label, expiry). Raw provider tokens never reach the
 *      browser — that custody lives entirely in the boundary.
 *
 * Real providers are gated behind the deployment profile (a configured
 * `VITE_AUTH_CALLBACK_BASE_URL`). Under `VITE_E2E_MODE` the same
 * `apple`/`google`/`x` provider ids instead run an in-process mock
 * exchange with no network (permitted just like the dev/e2e entries of
 * PROVIDER_PROFILE_ALLOW_LIST), so the whole flow is testable in CI and
 * the account record ids line up with the offered provider tiles.
 *
 * Transient PKCE material (the verifier + provider) is held in
 * `sessionStorage`, never the URL, browser history, or any `vh/*`
 * record. Any failure surfaces as a clean SignInError with no partial
 * session and no secret in state or history.
 */

import type { SignInProviderIdType } from '@vh/data-model';

/** Providers a browser can begin sign-in with. */
export type SignInFlowProvider = SignInProviderIdType;

/** Non-secret session payload the boundary returns (vh-auth-session-v1). */
export interface SignInSessionPayload {
  schemaVersion: 'vh-auth-session-v1';
  providerId: SignInProviderIdType;
  providerSubject: string;
  displayLabel?: string;
  issuedAt: number;
  expiresAt: number | null;
}

/** Result of the /start leg: the URL to open + opaque bound state. */
export interface SignInStartResult {
  provider: SignInFlowProvider;
  authorizeUrl: string;
  state: string;
}

export type SignInErrorReason =
  | 'provider_unsupported'
  | 'boundary_unconfigured'
  | 'crypto_unavailable'
  | 'start_failed'
  | 'callback_failed'
  | 'session_invalid'
  | 'pending_flow_missing'
  | 'state_mismatch'
  | 'network_error';

/** A clean sign-in failure: stable reason code, no secret material. */
export class SignInError extends Error {
  readonly reason: SignInErrorReason;

  constructor(reason: SignInErrorReason, message?: string) {
    super(message ?? reason);
    this.name = 'SignInError';
    this.reason = reason;
  }
}

const REAL_PROVIDERS: readonly SignInProviderIdType[] = ['apple', 'google', 'x'];
const PENDING_STORAGE_KEY = 'vh:sign-in:pending-v1';

interface PendingFlow {
  provider: SignInFlowProvider;
  codeVerifier: string;
  state: string;
}

type SignInFlowEnv = Record<string, string | boolean | undefined>;

function readEnv(): SignInFlowEnv {
  const override = (globalThis as typeof globalThis & {
    __VH_IMPORT_META_ENV__?: SignInFlowEnv;
  }).__VH_IMPORT_META_ENV__;
  // Vite statically inlines `import.meta.env` as a defined object, so no
  // extra nullish fallback is needed here; the override exists purely for
  // deterministic testing.
  return override ?? (import.meta as unknown as { env: SignInFlowEnv }).env;
}

function isE2eMode(env: SignInFlowEnv): boolean {
  return env.VITE_E2E_MODE === 'true';
}

function callbackBaseUrl(env: SignInFlowEnv): string | null {
  const raw = env.VITE_AUTH_CALLBACK_BASE_URL;
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim().replace(/\/+$/u, '');
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Whether a provider can begin a sign-in flow in the current build.
 * Under VITE_E2E_MODE every real provider id runs the in-process mock
 * exchange; otherwise a provider requires a configured boundary base URL.
 */
export function isSignInProviderAvailable(
  provider: SignInFlowProvider,
  env: SignInFlowEnv = readEnv()
): boolean {
  if (!REAL_PROVIDERS.includes(provider)) {
    return false;
  }
  return isE2eMode(env) || typeof callbackBaseUrl(env) === 'string';
}

/** The list of providers offered to the user in the current build. */
export function availableSignInProviders(env: SignInFlowEnv = readEnv()): SignInFlowProvider[] {
  return REAL_PROVIDERS.filter((provider) => isSignInProviderAvailable(provider, env));
}

function sessionStore(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

// ── PKCE primitives (WebCrypto) ────────────────────────────────────

function subtle(): SubtleCrypto {
  const provided = globalThis.crypto?.subtle;
  if (!provided) {
    throw new SignInError('crypto_unavailable', 'WebCrypto subtle API is required');
  }
  return provided;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

/** Generate a PKCE code_verifier (43-char base64url, matches the boundary regex). */
export function generateCodeVerifier(): string {
  const random = globalThis.crypto?.getRandomValues?.bind(globalThis.crypto);
  if (!random) {
    throw new SignInError('crypto_unavailable', 'crypto.getRandomValues is required');
  }
  return bytesToBase64Url(random(new Uint8Array(32)));
}

/** Compute the S256 code_challenge for a verifier. */
export async function computeCodeChallenge(codeVerifier: string): Promise<string> {
  const digest = await subtle().digest('SHA-256', new TextEncoder().encode(codeVerifier));
  return bytesToBase64Url(new Uint8Array(digest));
}

// ── Pending-flow custody (sessionStorage, never the URL) ───────────

function persistPendingFlow(flow: PendingFlow): void {
  const store = sessionStore();
  if (!store) {
    return;
  }
  store.setItem(PENDING_STORAGE_KEY, JSON.stringify(flow));
}

function readPendingFlow(): PendingFlow | null {
  const store = sessionStore();
  if (!store) {
    return null;
  }
  const raw = store.getItem(PENDING_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PendingFlow>;
    if (
      typeof parsed?.provider !== 'string'
      || !REAL_PROVIDERS.includes(parsed.provider as SignInProviderIdType)
      || typeof parsed.codeVerifier !== 'string'
      || parsed.codeVerifier.length === 0
      || typeof parsed.state !== 'string'
      || parsed.state.length === 0
    ) {
      return null;
    }
    return { provider: parsed.provider, codeVerifier: parsed.codeVerifier, state: parsed.state };
  } catch {
    return null;
  }
}

/** Clear transient PKCE material after a completed or abandoned flow. */
export function clearPendingSignIn(): void {
  sessionStore()?.removeItem(PENDING_STORAGE_KEY);
}

// ── Network helpers ────────────────────────────────────────────────

async function postJson(url: string, body: unknown): Promise<{ status: number; json: unknown }> {
  let response: Response;
  try {
    // No `credentials`: the boundary is authenticated by the signed state +
    // PKCE verifier in the body, not cookies. Do NOT add credentials:'include'
    // — it would widen the CSRF surface the state/PKCE binding closes.
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new SignInError('network_error', 'sign-in boundary unreachable');
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, json };
}

function isOkObject(json: unknown): json is Record<string, unknown> {
  return typeof json === 'object' && json !== null && (json as { status?: unknown }).status === 'ok';
}

// ── Mock provider (E2E only, no network) ───────────────────────────

/**
 * In-process mock exchange used only under VITE_E2E_MODE. It produces a
 * deterministic non-secret session shaped exactly like the boundary's
 * vh-auth-session-v1 payload, so the client wiring is exercised end to
 * end without a network provider.
 */
function mockSessionFor(
  provider: SignInProviderIdType,
  state: string,
  nowMs: number
): SignInSessionPayload {
  return {
    schemaVersion: 'vh-auth-session-v1',
    providerId: provider,
    providerSubject: `mock-subject-${provider}-${state.slice(0, 8)}`,
    displayLabel: `mock-${provider}@example.com`,
    issuedAt: nowMs,
    expiresAt: nowMs + 3600_000,
  };
}

// ── Session validation ─────────────────────────────────────────────

function toSessionPayload(json: unknown): SignInSessionPayload {
  if (!isOkObject(json)) {
    throw new SignInError('callback_failed', 'sign-in callback rejected');
  }
  const session = (json as { session?: unknown }).session;
  if (typeof session !== 'object' || session === null) {
    throw new SignInError('session_invalid', 'sign-in session missing');
  }
  const record = session as Record<string, unknown>;
  if (
    record.schemaVersion !== 'vh-auth-session-v1'
    || typeof record.providerId !== 'string'
    || !REAL_PROVIDERS.includes(record.providerId as SignInProviderIdType)
    || typeof record.providerSubject !== 'string'
    || record.providerSubject.length === 0
    || (record.displayLabel !== undefined && typeof record.displayLabel !== 'string')
    || typeof record.issuedAt !== 'number'
    || (record.expiresAt !== null && typeof record.expiresAt !== 'number')
  ) {
    throw new SignInError('session_invalid', 'sign-in session malformed');
  }
  return {
    schemaVersion: 'vh-auth-session-v1',
    providerId: record.providerId as SignInProviderIdType,
    providerSubject: record.providerSubject,
    ...(typeof record.displayLabel === 'string' ? { displayLabel: record.displayLabel } : {}),
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt as number | null,
  };
}

// ── Public flow API ────────────────────────────────────────────────

/**
 * Begin a sign-in: generate PKCE material, ask the boundary for a bound
 * `state` + authorize URL, and stash the verifier transiently. The
 * caller opens `authorizeUrl`. Under VITE_E2E_MODE the round-trip is
 * local; a synthetic authorize URL routes straight to the PWA callback.
 */
export async function startSignIn(
  provider: SignInFlowProvider,
  env: SignInFlowEnv = readEnv()
): Promise<SignInStartResult> {
  if (!isSignInProviderAvailable(provider, env)) {
    throw new SignInError('provider_unsupported', `sign-in provider ${provider} is not available`);
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await computeCodeChallenge(codeVerifier);

  if (isE2eMode(env)) {
    const state = `mock-state-${provider}-${codeChallenge.slice(0, 16)}`;
    persistPendingFlow({ provider, codeVerifier, state });
    const callbackPath = env.VITE_AUTH_CALLBACK_ROUTE ?? '/auth/callback';
    const authorizeUrl = `${callbackPath}?provider=${provider}&code=mock-code&state=${encodeURIComponent(state)}`;
    return { provider, authorizeUrl, state };
  }

  const base = callbackBaseUrl(env);
  if (!base) {
    throw new SignInError('boundary_unconfigured', 'sign-in boundary base URL is not configured');
  }

  const { status, json } = await postJson(`${base}/auth/${provider}/start`, { codeChallenge });
  if (status !== 200 || !isOkObject(json)) {
    throw new SignInError('start_failed', 'sign-in start rejected');
  }
  const authorizeUrl = (json as { authorizeUrl?: unknown }).authorizeUrl;
  const parameters = (json as { parameters?: { state?: unknown } }).parameters;
  const state = parameters?.state;
  if (typeof authorizeUrl !== 'string' || typeof state !== 'string' || state.length === 0) {
    throw new SignInError('start_failed', 'sign-in start response malformed');
  }

  persistPendingFlow({ provider, codeVerifier, state });
  return { provider, authorizeUrl, state };
}

/**
 * Complete a sign-in after the provider redirect. Verifies the returned
 * `state` matches the stashed pending flow, then exchanges
 * code + verifier at the boundary and returns the non-secret session.
 * Always clears the pending material — success or failure — so no
 * partial session lingers.
 */
export async function completeSignIn(
  params: { code: string; state: string; nowMs?: number },
  env: SignInFlowEnv = readEnv()
): Promise<SignInSessionPayload> {
  const pending = readPendingFlow();
  try {
    if (!pending) {
      throw new SignInError('pending_flow_missing', 'no pending sign-in flow');
    }
    if (typeof params.state !== 'string' || params.state !== pending.state) {
      throw new SignInError('state_mismatch', 'sign-in state mismatch');
    }
    if (typeof params.code !== 'string' || params.code.length === 0) {
      throw new SignInError('callback_failed', 'sign-in code missing');
    }

    if (isE2eMode(env)) {
      return mockSessionFor(pending.provider, pending.state, params.nowMs ?? Date.now());
    }

    const base = callbackBaseUrl(env);
    if (!base) {
      throw new SignInError('boundary_unconfigured', 'sign-in boundary base URL is not configured');
    }

    const { status, json } = await postJson(`${base}/auth/${pending.provider}/callback`, {
      code: params.code,
      state: params.state,
      codeVerifier: pending.codeVerifier,
    });
    if (status !== 200) {
      throw new SignInError('callback_failed', 'sign-in callback rejected');
    }
    return toSessionPayload(json);
  } finally {
    clearPendingSignIn();
  }
}
