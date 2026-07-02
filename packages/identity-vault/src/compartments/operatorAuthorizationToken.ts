import type { OperatorAuthorizationTokenCompartment } from '../types';
import { loadVaultV2, saveVaultV2 } from '../vault';
import { VaultCompartmentError } from './encoding';

export interface OperatorAuthorizationTokenInput {
  token: string;
  boundPrincipalNullifier: string;
  issuedAt: number;
  expiresAt?: number;
}

const OPERATOR_AUTHORIZATION_TOKEN_KEYS = new Set([
  'schemaVersion',
  'token',
  'boundPrincipalNullifier',
  'issuedAt',
  'expiresAt'
]);

export async function loadOperatorAuthorizationToken(): Promise<OperatorAuthorizationTokenCompartment | null> {
  const vault = await loadVaultV2();
  if (!vault?.operatorAuthorizationToken) return null;
  return validateOperatorAuthorizationToken(vault.operatorAuthorizationToken);
}

export async function saveOperatorAuthorizationToken(
  input: OperatorAuthorizationTokenInput
): Promise<OperatorAuthorizationTokenCompartment> {
  const vault = await loadVaultV2();
  const candidate = buildOperatorAuthorizationToken(input);
  await saveVaultV2({
    ...(vault ?? {}),
    schemaVersion: 2,
    operatorAuthorizationToken: candidate
  });
  return candidate;
}

export async function clearOperatorAuthorizationToken(): Promise<void> {
  const vault = await loadVaultV2();
  if (!vault?.operatorAuthorizationToken) return;

  const { operatorAuthorizationToken: _operatorAuthorizationToken, ...remaining } = vault;
  await saveVaultV2({
    ...remaining,
    schemaVersion: 2
  });
}

export function validateOperatorAuthorizationToken(value: unknown): OperatorAuthorizationTokenCompartment {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new VaultCompartmentError('Invalid operatorAuthorizationToken compartment');
  }

  for (const key of Object.keys(value)) {
    if (!OPERATOR_AUTHORIZATION_TOKEN_KEYS.has(key)) {
      throw new VaultCompartmentError('Invalid operatorAuthorizationToken compartment');
    }
  }

  const record = value as OperatorAuthorizationTokenCompartment;
  if (
    record.schemaVersion !== 1
    || typeof record.token !== 'string'
    || record.token.length === 0
    || typeof record.boundPrincipalNullifier !== 'string'
    || record.boundPrincipalNullifier.length === 0
    || record.issuedAt !== normalizeTimestamp(record.issuedAt, 'operatorAuthorizationToken issuedAt')
    || (
      record.expiresAt !== undefined
      && (
        record.expiresAt !== normalizeTimestamp(record.expiresAt, 'operatorAuthorizationToken expiresAt')
        || record.expiresAt < record.issuedAt
      )
    )
  ) {
    throw new VaultCompartmentError('Invalid operatorAuthorizationToken compartment');
  }

  return record;
}

function buildOperatorAuthorizationToken(
  input: OperatorAuthorizationTokenInput
): OperatorAuthorizationTokenCompartment {
  return validateOperatorAuthorizationToken({
    schemaVersion: 1,
    token: input.token,
    boundPrincipalNullifier: input.boundPrincipalNullifier,
    issuedAt: input.issuedAt,
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {})
  });
}

function normalizeTimestamp(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new VaultCompartmentError(`Invalid ${label}`);
  }
  return value;
}

export const operatorAuthorizationToken = Object.freeze({
  load: loadOperatorAuthorizationToken,
  save: saveOperatorAuthorizationToken,
  clear: clearOperatorAuthorizationToken,
  validate: validateOperatorAuthorizationToken
});
