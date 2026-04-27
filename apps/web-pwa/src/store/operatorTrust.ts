import { create } from 'zustand';
import {
  TRUSTED_BETA_OPERATOR_CAPABILITIES,
  TrustedOperatorAuthorizationSchema,
  TrustedOperatorCapabilitySchema,
  type TrustedOperatorAuthorization,
  type TrustedOperatorCapability,
} from '@vh/data-model';
import { loadIdentity } from './forum/persistence';

interface OperatorTrustDeps {
  readonly readEnv: (key: string) => string | undefined;
  readonly loadOperatorIdentity: () => { session: { nullifier?: string | null } } | null;
  readonly now: () => number;
}

export interface CreateTrustedOperatorAuthorizationOptions {
  readonly capabilities?: readonly TrustedOperatorCapability[];
  readonly grantedAt?: number;
  readonly expiresAt?: number;
}

export interface OperatorTrustResolution {
  readonly authorization: TrustedOperatorAuthorization | null;
  readonly error: string | null;
}

export interface OperatorTrustState {
  readonly authorization: TrustedOperatorAuthorization | null;
  readonly error: string | null;
  refreshAuthorization(): TrustedOperatorAuthorization | null;
  setAuthorization(authorization: TrustedOperatorAuthorization | null): void;
  isAuthorized(capability: TrustedOperatorCapability): boolean;
  reset(): void;
}

const DEFAULT_OPERATOR_CAPABILITIES = [...TRUSTED_BETA_OPERATOR_CAPABILITIES] as TrustedOperatorCapability[];

function readEnvVar(key: string): string | undefined {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  /* v8 ignore next -- Browser builds may not expose process; Vitest requires process to remain defined. */
  const processEnv = typeof process !== 'undefined' ? process.env : undefined;
  return viteEnv?.[key] ?? processEnv?.[key];
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseCapabilities(raw: string | undefined): TrustedOperatorCapability[] {
  const entries = parseCsv(raw);
  if (entries.length === 0) {
    return DEFAULT_OPERATOR_CAPABILITIES;
  }
  return entries.map((entry) => TrustedOperatorCapabilitySchema.parse(entry));
}

function normalizeOperatorId(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function createTrustedOperatorAuthorization(
  operatorId: string,
  options: CreateTrustedOperatorAuthorizationOptions = {},
): TrustedOperatorAuthorization {
  const payload: Record<string, unknown> = {
    schemaVersion: 'vh-trusted-operator-authorization-v1',
    operator_id: operatorId.trim(),
    role: 'trusted_beta_operator',
    capabilities: options.capabilities ? [...options.capabilities] : DEFAULT_OPERATOR_CAPABILITIES,
  };
  if (options.grantedAt !== undefined) {
    payload.granted_at = options.grantedAt;
  }
  if (options.expiresAt !== undefined) {
    payload.expires_at = options.expiresAt;
  }
  return TrustedOperatorAuthorizationSchema.parse(payload);
}

export function resolveTrustedOperatorAuthorizationFromEnv(
  overrides: Partial<OperatorTrustDeps> = {},
): OperatorTrustResolution {
  const deps: OperatorTrustDeps = {
    readEnv: readEnvVar,
    loadOperatorIdentity: loadIdentity,
    now: () => Date.now(),
    ...overrides,
  };
  const trustedOperatorIds = new Set(parseCsv(deps.readEnv('VITE_VH_TRUSTED_OPERATOR_IDS')));
  if (trustedOperatorIds.size === 0) {
    return {
      authorization: null,
      error: 'Trusted operator allowlist is not configured',
    };
  }

  const explicitOperatorId = normalizeOperatorId(deps.readEnv('VITE_VH_OPERATOR_ID'));
  const identityOperatorId = normalizeOperatorId(deps.loadOperatorIdentity()?.session.nullifier);
  const operatorId = explicitOperatorId ?? identityOperatorId;
  if (!operatorId) {
    return {
      authorization: null,
      error: 'Trusted operator authorization requires an operator id',
    };
  }
  if (!trustedOperatorIds.has(operatorId)) {
    return {
      authorization: null,
      error: 'Current operator is not in the trusted beta operator allowlist',
    };
  }

  try {
    return {
      authorization: createTrustedOperatorAuthorization(operatorId, {
        capabilities: parseCapabilities(deps.readEnv('VITE_VH_TRUSTED_OPERATOR_CAPABILITIES')),
        grantedAt: deps.now(),
      }),
      error: null,
    };
  } catch (error: unknown) {
    return {
      authorization: null,
      error: error instanceof Error ? error.message : 'Trusted operator authorization is invalid',
    };
  }
}

export function createOperatorTrustStore(overrides?: Partial<OperatorTrustDeps>) {
  return create<OperatorTrustState>((set, get) => ({
    authorization: null,
    error: null,

    refreshAuthorization() {
      const resolution = resolveTrustedOperatorAuthorizationFromEnv(overrides);
      set({
        authorization: resolution.authorization,
        error: resolution.error,
      });
      return resolution.authorization;
    },

    setAuthorization(authorization) {
      if (authorization === null) {
        set({ authorization: null, error: null });
        return;
      }
      const parsed = TrustedOperatorAuthorizationSchema.safeParse(authorization);
      if (!parsed.success) {
        set({
          authorization: null,
          error: 'Trusted operator authorization is invalid',
        });
        return;
      }
      set({ authorization: parsed.data, error: null });
    },

    isAuthorized(capability) {
      const authorization = get().authorization;
      return Boolean(authorization?.capabilities.includes(capability));
    },

    reset() {
      set({ authorization: null, error: null });
    },
  }));
}

export const useOperatorTrustStore = createOperatorTrustStore();
