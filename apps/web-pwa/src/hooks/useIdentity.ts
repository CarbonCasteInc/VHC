import { useCallback, useEffect, useRef, useState } from 'react';
import type { IdentityRecord } from '@vh/types';
import { isSessionExpired, isSessionNearExpiry, migrateSessionFields, DEFAULT_SESSION_TTL_MS } from '@vh/types';
import { TRUST_MINIMUM } from '@vh/data-model';
import { SEA, createSession } from '@vh/gun-client';
import {
  clearLumaTelemetry,
  createBetaLocalAssuranceEnvelope,
  deriveBetaLocalNullifier,
  lumaLog,
  type AssuranceEnvelope,
  type DeploymentProfile
} from '@vh/luma-sdk';
import { authenticateGunUser, publishDirectoryEntry, useAppStore } from '../store';
import { getHandleError, isValidHandle } from '../utils/handle';
import {
  clearIdentity as vaultClear,
  clearWalletBinding,
  delegationSigningKey,
  deviceCredential,
  operatorAuthorizationToken,
  migrateLegacyLocalStorage,
  seaDevicePair
} from '@vh/identity-vault';
import { publishIdentity, clearPublishedIdentity } from '../store/identityProvider';
import { useXpLedger } from '../store/xpLedger';
import { loadIdentityRecord, saveIdentityRecord } from '../utils/vaultTyped';
import { useSentimentState } from './useSentimentState';
import { clearDelegationStorageForPrincipal, useDelegationStore } from '../store/delegation';

type IdentityRuntimeEnv = Record<string, string | boolean | undefined>;

function readIdentityEnv(): IdentityRuntimeEnv {
  const override = (globalThis as typeof globalThis & {
    __VH_IMPORT_META_ENV__?: IdentityRuntimeEnv;
  }).__VH_IMPORT_META_ENV__;
  return override ?? (import.meta as unknown as { env?: IdentityRuntimeEnv }).env ?? {};
}

const IDENTITY_ENV = readIdentityEnv();
const E2E_MODE = IDENTITY_ENV.VITE_E2E_MODE === 'true';
const DEV_MODE = IDENTITY_ENV.DEV === true || IDENTITY_ENV.MODE === 'development';
const LUMA_PROFILE = resolveIdentityDeploymentProfile();
const PUBLIC_BETA_PROFILE = LUMA_PROFILE === 'public-beta';
const LIFECYCLE_ENABLED =
  IDENTITY_ENV.VITE_SESSION_LIFECYCLE_ENABLED === 'true'
  || PUBLIC_BETA_PROFILE
  || LUMA_PROFILE === 'production-attestation';
const CONFIGURED_ATTESTATION_URL = IDENTITY_ENV.VITE_ATTESTATION_URL;
const ATTESTATION_URL =
  (typeof CONFIGURED_ATTESTATION_URL === 'string' ? CONFIGURED_ATTESTATION_URL : undefined)
  ?? (PUBLIC_BETA_PROFILE ? undefined : 'http://localhost:3000/verify');
const DEV_E2E_VERIFIER_TIMEOUT_MS = 2000;
const DEPLOYABLE_VERIFIER_TIMEOUT_MS = 5000;
const DEPLOYABLE_IDENTITY_PROFILE = PUBLIC_BETA_PROFILE || LUMA_PROFILE === 'production-attestation';
const VERIFIER_TIMEOUT_MS = DEPLOYABLE_IDENTITY_PROFILE
  ? DEPLOYABLE_VERIFIER_TIMEOUT_MS
  : Number(IDENTITY_ENV.VITE_ATTESTATION_TIMEOUT_MS) || DEV_E2E_VERIFIER_TIMEOUT_MS;
const DEV_FALLBACK_TRUST_SCORE = 0.95;
const DEV_FALLBACK_ENABLED =
  DEV_MODE
  && !PUBLIC_BETA_PROFILE
  && IDENTITY_ENV.VITE_LUMA_DEV_FALLBACK === 'true';

export type IdentityStatus = 'hydrating' | 'anonymous' | 'creating' | 'ready' | 'expired' | 'error';

/** Result of a session expiry check at an action boundary. */
export type SessionExpiryCheck =
  | { valid: true; warning?: 'near-expiry' }
  | { valid: false; reason: 'expired' };

export const MULTI_DEVICE_LINK_DEFERRED_CODE = 'luma.multidevice.deferred' as const;

export class MultiDeviceLinkDeferredError extends Error {
  readonly code = MULTI_DEVICE_LINK_DEFERRED_CODE;
  readonly capability = 'multi-device-link';
  readonly phase = 'Phase 3+';

  constructor(method: 'linkDevice' | 'startLinkSession' | 'completeLinkSession') {
    super(`${method} is deferred until LUMA Phase 3+ multi-device identity linking lands`);
    this.name = 'MultiDeviceLinkDeferredError';
  }
}

/** Module-level migration guard — runs at most once. */
let migrationPromise: Promise<void> | null = null;

async function ensureMigrated(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = migrateLegacyLocalStorage().then(() => undefined);
  }
  return migrationPromise ?? Promise.resolve();
}

async function loadIdentityFromVault(): Promise<IdentityRecord | null> {
  await ensureMigrated();
  return loadIdentityRecord();
}

async function persistIdentity(record: IdentityRecord): Promise<void> {
  await saveIdentityRecord(record);
  // Publish identity for downstream consumers.
  publishIdentity(record);
  useXpLedger.getState().setActiveNullifier(record.session.nullifier);
}

function randomToken(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function rejectMultiDeviceLink(method: 'linkDevice' | 'startLinkSession' | 'completeLinkSession'): never {
  throw new MultiDeviceLinkDeferredError(method);
}

export function useIdentity() {
  const [identity, setIdentity] = useState<IdentityRecord | null>(null);
  const [status, setStatus] = useState<IdentityStatus>('hydrating');
  const [error, setError] = useState<string | undefined>();
  const hydratedRef = useRef(false);
  const handleRef = useRef<string | undefined>(undefined);

  // Keep handleRef in sync for stable createIdentity
  useEffect(() => {
    handleRef.current = identity?.handle;
  }, [identity?.handle]);

  // Hydrate from vault on mount
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    loadIdentityFromVault().then(async (loaded) => {
      if (loaded) {
        // Migrate legacy sessions missing createdAt/expiresAt
        const migratedSession = migrateSessionFields(loaded.session);
        let migrated = migratedSession !== loaded.session
          ? { ...loaded, session: migratedSession }
          : loaded;
        if (PUBLIC_BETA_PROFILE) {
          migrated = await ensurePublicBetaAssurance(migrated);
        }

        // Check expiry when lifecycle feature flag is enabled
        if (LIFECYCLE_ENABLED && isSessionExpired(migrated.session)) {
          setIdentity(migrated);
          setStatus('expired');
          return;
        }

        setIdentity(migrated);
        setStatus('ready');
        publishIdentity(migrated);
        useXpLedger.getState().setActiveNullifier(migrated.session.nullifier);
      } else {
        setStatus('anonymous');
      }
    }).catch(() => {
      setStatus('anonymous');
    });
  }, []);

  const createIdentity = useCallback(async (handle?: string) => {
    try {
      setStatus('creating');
      const deviceCredentialCompartment = await deviceCredential.loadOrCreate();
      const attestation = buildAttestation(deviceCredentialCompartment.material);
      assertRuntimeProfileSafeForIdentityCreation();
      const trimmedHandle = handle?.trim();
      if (trimmedHandle) {
        const validationError = getHandleError(trimmedHandle);
        if (validationError) {
          throw new Error(validationError);
        }
      }

      let session: { token: string; trustScore: number; nullifier: string };
      let assuranceEnvelope: AssuranceEnvelope | undefined;
      const devicePair = await seaDevicePair.loadOrCreate(() => SEA.pair());

      if (PUBLIC_BETA_PROFILE) {
        const betaLocal = await createBetaLocalIdentitySession(deviceCredentialCompartment.material);
        session = betaLocal.session;
        assuranceEnvelope = betaLocal.assuranceEnvelope;
      } else if (E2E_MODE) {
        session = { token: `mock-session-${randomToken()}`, trustScore: 1, nullifier: `mock-nullifier-${randomToken()}` };
      } else {
        try {
          if (!ATTESTATION_URL) {
            throw new Error('Attestation verifier URL is required for non-public-beta identity creation');
          }
          const verifierPromise = createSession(attestation, ATTESTATION_URL);
          const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Verifier timeout')), VERIFIER_TIMEOUT_MS)
          );
          session = await Promise.race([verifierPromise, timeout]);
        } catch (verifierErr) {
          if (DEV_FALLBACK_ENABLED) {
            lumaLog('warn', '[vh:identity] Attestation verifier unavailable, using dev fallback');
            session = {
              token: `dev-session-${randomToken()}`,
              trustScore: DEV_FALLBACK_TRUST_SCORE,
              nullifier: `dev-nullifier-${randomToken()}`
            };
          } else {
            throw verifierErr;
          }
        }
      }

      if (session.trustScore < TRUST_MINIMUM) {
        throw new Error('Security Error: Low Trust Device');
      }

      const scaledTrustScore = clampScaledTrustScore(Math.round(session.trustScore * 10000));
      const nowMs = Date.now();
      const sessionExpiresAt = LIFECYCLE_ENABLED ? nowMs + DEFAULT_SESSION_TTL_MS : 0;

      const fallbackHandle = handleRef.current ?? `user_${randomToken().slice(0, 6)}`;
      const record: IdentityRecord = {
        id: randomToken(),
        createdAt: nowMs,
        attestation,
        ...(assuranceEnvelope ? { assuranceEnvelope } : {}),
        session: {
          token: session.token,
          trustScore: session.trustScore,
          scaledTrustScore,
          nullifier: session.nullifier,
          createdAt: nowMs,
          expiresAt: sessionExpiresAt,
        },
        devicePair: {
          pub: devicePair.pub,
          priv: devicePair.priv,
          epub: devicePair.epub,
          epriv: devicePair.epriv
        },
        handle: trimmedHandle ?? fallbackHandle
      };
      await persistIdentity(record);
      const client = useAppStore.getState().client;
      if (client && record.devicePair) {
        try {
          await authenticateGunUser(client, record.devicePair);
          await publishDirectoryEntry(client, record);
        } catch (err) {
          lumaLog('warn', '[vh:identity] Directory publish failed', { error: err });
        }
      }
      setIdentity(record);
      setStatus('ready');
      setError(undefined);
    } catch (err) {
      setStatus('error');
      setError((err as Error).message);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- handleRef is stable
  }, []);

  useEffect(() => {
    if (status === 'anonymous' && E2E_MODE) {
      void createIdentity();
    }
  }, [status, createIdentity]);

  const linkDevice = useCallback(async () => {
    if (!identity) {
      throw new Error('Identity not ready');
    }
    rejectMultiDeviceLink('linkDevice');
  }, [identity]);

  const startLinkSession = useCallback(async () => {
    if (!identity) {
      throw new Error('Identity not ready');
    }
    rejectMultiDeviceLink('startLinkSession');
  }, [identity]);

  const completeLinkSession = useCallback(
    async (code: string) => {
      void code;
      if (!identity) {
        throw new Error('Identity not ready');
      }
      rejectMultiDeviceLink('completeLinkSession');
    },
    [identity]
  );

  const updateHandle = useCallback(
    async (nextHandle: string) => {
      const validationError = getHandleError(nextHandle);
      if (validationError) {
        throw new Error(validationError);
      }
      if (!identity) throw new Error('Identity not ready');
      const updated: IdentityRecord = { ...identity, handle: nextHandle.trim() };
      await persistIdentity(updated);
      setIdentity(updated);
      return updated;
    },
    [identity]
  );

  const clearActiveIdentityRuntime = useCallback(() => {
    setIdentity(null);
    setStatus('anonymous');
    setError(undefined);
    clearPublishedIdentity();
    useXpLedger.getState().setActiveNullifier(null);
    useDelegationStore.getState().setActivePrincipal(null);
    // Constituency proof is derived from identity, so clearing identity invalidates all proofs.
    useSentimentState.setState({ signals: [] });
  }, []);

  /**
   * End the current session while preserving device-bound identity compartments
   * (LUMA §13 Sign Out).
   */
  const signOut = useCallback(async () => {
    clearActiveIdentityRuntime();
    clearLumaTelemetry({ rotateSalt: true });
    await vaultClear().catch(() => {});
  }, [clearActiveIdentityRuntime]);

  /**
   * Rotate the local device-bound identity and clear old-principal delegation
   * storage (LUMA §13 Reset Identity).
   */
  const resetIdentity = useCallback(async () => {
    const oldPrincipal = identity?.session.nullifier ?? null;
    clearActiveIdentityRuntime();
    clearLumaTelemetry({ rotateSalt: true });
    if (oldPrincipal) {
      clearDelegationStorageForPrincipal(oldPrincipal);
    }

    await vaultClear().catch(() => {});
    await clearWalletBinding().catch(() => {});
    await operatorAuthorizationToken.clear().catch(() => {});
    await deviceCredential.rotate();
    await seaDevicePair.rotate(() => SEA.pair());
    await delegationSigningKey.rotateStored();
  }, [clearActiveIdentityRuntime, identity?.session.nullifier]);

  /**
   * @deprecated Use signOut(). This compatibility shim preserves the pre-M0.D
   * hook surface while the app migrates call sites.
   */
  const revokeSession = useCallback(async () => {
    lumaLog('warn', '[vh:identity] useIdentity.revokeSession() is deprecated; use signOut() instead');
    await signOut();
  }, [signOut]);

  /**
   * Check session validity at action boundaries (spec §2.1.4).
   *
   * Returns { valid: true } when lifecycle is disabled or session is fresh.
   * Consumers should call this before trust-gated actions.
   */
  const checkSessionExpiry = useCallback((): SessionExpiryCheck => {
    if (!LIFECYCLE_ENABLED || E2E_MODE || !identity?.session) {
      return { valid: true };
    }
    if (isSessionExpired(identity.session)) {
      setStatus('expired');
      return { valid: false, reason: 'expired' };
    }
    if (isSessionNearExpiry(identity.session)) {
      return { valid: true, warning: 'near-expiry' };
    }
    return { valid: true };
  }, [identity]);

  return {
    identity,
    status,
    error,
    createIdentity,
    linkDevice,
    startLinkSession,
    completeLinkSession,
    updateHandle,
    signOut,
    resetIdentity,
    revokeSession,
    checkSessionExpiry,
    validateHandle: isValidHandle
  };
}

function buildAttestation(deviceKey: string): IdentityRecord['attestation'] {
  if (E2E_MODE) {
    return {
      platform: 'web',
      integrityToken: 'test-token',
      deviceKey,
      nonce: 'mock-nonce'
    };
  }

  return {
    platform: 'web',
    integrityToken: randomToken(),
    deviceKey,
    nonce: randomToken()
  };
}

function resolveIdentityDeploymentProfile(): DeploymentProfile {
  const viteEnv = readIdentityEnv();
  const configured = viteEnv?.VITE_LUMA_PROFILE;
  if (
    configured === 'dev'
    || configured === 'public-beta'
    || configured === 'production-attestation'
  ) {
    return configured;
  }
  if (E2E_MODE) return 'e2e';
  if (
    viteEnv?.DEV === true
    || viteEnv?.MODE === 'development'
    || viteEnv?.MODE === 'test'
    || viteEnv?.VITEST === 'true'
    || viteEnv?.MODE === undefined
  ) {
    return 'dev';
  }
  return 'public-beta';
}

function assertRuntimeProfileSafeForIdentityCreation(): void {
  if (!PUBLIC_BETA_PROFILE) return;
  if (E2E_MODE) {
    throw new Error('public-beta identity creation requires VITE_E2E_MODE=false');
  }
  if (DEV_MODE) {
    throw new Error('public-beta identity creation is not allowed from a dev-mode build');
  }
  if (IDENTITY_ENV.VITE_LUMA_DEV_FALLBACK === 'true') {
    throw new Error('public-beta identity creation forbids VITE_LUMA_DEV_FALLBACK');
  }
  if (typeof ATTESTATION_URL === 'string' && /localhost:3000\/verify/.test(ATTESTATION_URL)) {
    throw new Error('public-beta identity creation must not use localhost verifier defaults');
  }
}

async function createBetaLocalIdentitySession(deviceKey: string): Promise<{
  session: { token: string; trustScore: number; nullifier: string };
  assuranceEnvelope: AssuranceEnvelope;
}> {
  const issuedAt = Date.now();
  return {
    session: {
      token: `beta-local-session-${randomToken()}`,
      trustScore: TRUST_MINIMUM,
      nullifier: await deriveBetaLocalNullifier(deviceKey)
    },
    assuranceEnvelope: await createBetaLocalAssuranceEnvelope({
      deviceCredential: deviceKey,
      issuedAt,
      ttlSeconds: DEFAULT_SESSION_TTL_MS / 1000
    })
  };
}

async function ensurePublicBetaAssurance(record: IdentityRecord): Promise<IdentityRecord> {
  if (record.assuranceEnvelope) return record;
  const deviceKey = record.attestation?.deviceKey;
  if (!deviceKey) return record;
  const assuranceEnvelope = await createBetaLocalAssuranceEnvelope({
    deviceCredential: deviceKey,
    ttlSeconds: DEFAULT_SESSION_TTL_MS / 1000
  });
  const migrated = { ...record, assuranceEnvelope };
  await saveIdentityRecord(migrated);
  return migrated;
}

function clampScaledTrustScore(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 10000) return 10000;
  return value;
}
