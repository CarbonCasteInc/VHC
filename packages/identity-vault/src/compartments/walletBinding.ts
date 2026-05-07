import type {
  WalletBindingCompartment,
  WalletProviderKind
} from '../types';
import { loadVaultV2, saveVaultV2 } from '../vault';
import { VaultCompartmentError } from './encoding';

export interface WalletBindingInput {
  address: string;
  chainId: string | number | bigint;
  providerKind: WalletProviderKind;
  boundPrincipalNullifier: string;
  now?: number;
}

const WALLET_BINDING_KEYS = new Set([
  'schemaVersion',
  'address',
  'chainId',
  'providerKind',
  'boundPrincipalNullifier',
  'boundAt',
  'updatedAt'
]);

const PROVIDER_KINDS = new Set<WalletProviderKind>([
  'browser-injected',
  'e2e-mock'
]);

export async function loadWalletBinding(): Promise<WalletBindingCompartment | null> {
  const vault = await loadVaultV2();
  if (!vault?.walletBinding) return null;
  return validateWalletBinding(vault.walletBinding);
}

export async function saveWalletBinding(
  input: WalletBindingInput
): Promise<WalletBindingCompartment> {
  const vault = await loadVaultV2();
  const existing = vault?.walletBinding ? validateWalletBinding(vault.walletBinding) : null;
  const now = normalizeTimestamp(input.now ?? Date.now(), 'walletBinding timestamp');
  const candidate = buildWalletBinding(input, now, existing);

  await saveVaultV2({
    ...(vault ?? {}),
    schemaVersion: 2,
    walletBinding: candidate
  });

  return candidate;
}

export async function clearWalletBinding(): Promise<void> {
  const vault = await loadVaultV2();
  if (!vault?.walletBinding) return;

  const { walletBinding: _walletBinding, ...remaining } = vault;
  await saveVaultV2({
    ...remaining,
    schemaVersion: 2
  });
}

export function walletBindingMatchesPrincipal(
  binding: WalletBindingCompartment | null | undefined,
  principalNullifier: string | null | undefined
): boolean {
  if (!binding || typeof principalNullifier !== 'string' || principalNullifier.length === 0) {
    return false;
  }
  return validateWalletBinding(binding).boundPrincipalNullifier === principalNullifier;
}

export function validateWalletBinding(value: unknown): WalletBindingCompartment {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new VaultCompartmentError('Invalid walletBinding compartment');
  }

  for (const key of Object.keys(value)) {
    if (!WALLET_BINDING_KEYS.has(key)) {
      throw new VaultCompartmentError('Invalid walletBinding compartment');
    }
  }

  const record = value as WalletBindingCompartment;
  if (
    record.schemaVersion !== 1
    || record.address !== normalizeWalletAddress(record.address)
    || record.chainId !== normalizeChainId(record.chainId)
    || !PROVIDER_KINDS.has(record.providerKind)
    || typeof record.boundPrincipalNullifier !== 'string'
    || record.boundPrincipalNullifier.length === 0
    || record.boundAt !== normalizeTimestamp(record.boundAt, 'walletBinding boundAt')
    || record.updatedAt !== normalizeTimestamp(record.updatedAt, 'walletBinding updatedAt')
    || record.updatedAt < record.boundAt
  ) {
    throw new VaultCompartmentError('Invalid walletBinding compartment');
  }

  return record;
}

export function normalizeWalletAddress(address: unknown): string {
  if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new VaultCompartmentError('Invalid wallet address');
  }
  return address.toLowerCase();
}

export function normalizeWalletChainId(chainId: unknown): string {
  return normalizeChainId(chainId);
}

function buildWalletBinding(
  input: WalletBindingInput,
  now: number,
  existing: WalletBindingCompartment | null
): WalletBindingCompartment {
  const address = normalizeWalletAddress(input.address);
  const chainId = normalizeChainId(input.chainId);
  if (!PROVIDER_KINDS.has(input.providerKind)) {
    throw new VaultCompartmentError('Unsupported wallet provider kind');
  }
  if (typeof input.boundPrincipalNullifier !== 'string' || input.boundPrincipalNullifier.length === 0) {
    throw new VaultCompartmentError('Invalid wallet binding principal');
  }

  const sameBinding = existing
    && existing.address === address
    && existing.chainId === chainId
    && existing.providerKind === input.providerKind
    && existing.boundPrincipalNullifier === input.boundPrincipalNullifier;

  return {
    schemaVersion: 1,
    address,
    chainId,
    providerKind: input.providerKind,
    boundPrincipalNullifier: input.boundPrincipalNullifier,
    boundAt: sameBinding ? existing.boundAt : now,
    updatedAt: now
  };
}

function normalizeChainId(chainId: unknown): string {
  if (typeof chainId === 'bigint') {
    if (chainId < 0n) {
      throw new VaultCompartmentError('Invalid wallet chain id');
    }
    return chainId.toString(10);
  }

  if (typeof chainId === 'number') {
    if (!Number.isSafeInteger(chainId) || chainId < 0) {
      throw new VaultCompartmentError('Invalid wallet chain id');
    }
    return String(chainId);
  }

  if (typeof chainId === 'string' && /^(0|[1-9][0-9]*)$/.test(chainId)) {
    return chainId;
  }

  throw new VaultCompartmentError('Invalid wallet chain id');
}

function normalizeTimestamp(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new VaultCompartmentError(`Invalid ${label}`);
  }
  return value;
}

export const walletBinding = Object.freeze({
  load: loadWalletBinding,
  save: saveWalletBinding,
  clear: clearWalletBinding,
  matchesPrincipal: walletBindingMatchesPrincipal,
  normalizeAddress: normalizeWalletAddress,
  normalizeChainId: normalizeWalletChainId,
  validate: validateWalletBinding
});
