/**
 * Invite token system for closed beta gating.
 * Tokens are opaque strings stored in localStorage.
 */
import { safeGetItem, safeSetItem } from '../../utils/safeStorage';

const INVITE_STORE_KEY = 'vh_invite_tokens';

export interface InviteToken {
  readonly token: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly redeemedAt: number | null;
  readonly redeemedBy: string | null;
  readonly createdBy: string;
  readonly maxRedemptions: number;
  readonly redemptionCount: number;
}

export interface InviteTokenStore {
  tokens: InviteToken[];
}

/** Default token expiry: 7 days. */
export const DEFAULT_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

function randomToken(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return (crypto as any).randomUUID() as string;
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function loadTokenStore(): InviteTokenStore {
  try {
    const raw = safeGetItem(INVITE_STORE_KEY);
    if (!raw) return { tokens: [] };
    const parsed = JSON.parse(raw) as InviteTokenStore;
    if (!parsed || !Array.isArray(parsed.tokens)) return { tokens: [] };
    return parsed;
  } catch {
    return { tokens: [] };
  }
}

export function persistTokenStore(store: InviteTokenStore): void {
  safeSetItem(INVITE_STORE_KEY, JSON.stringify(store));
}

export function generateInviteToken(
  createdBy: string,
  now?: number,
): InviteToken {
  const timestamp = now ?? Date.now();
  return {
    token: `inv_${randomToken()}`,
    createdAt: timestamp,
    expiresAt: timestamp + DEFAULT_TOKEN_EXPIRY_MS,
    redeemedAt: null,
    redeemedBy: null,
    createdBy,
    maxRedemptions: 1,
    redemptionCount: 0,
  };
}

export function createInviteToken(
  createdBy: string,
  now?: number,
): InviteToken {
  const store = loadTokenStore();
  const token = generateInviteToken(createdBy, now);
  store.tokens.push(token);
  persistTokenStore(store);
  return token;
}

export type TokenValidationResult =
  | { valid: true; token: InviteToken }
  | { valid: false; reason: string };

export function validateInviteToken(
  tokenStr: string,
  now?: number,
): TokenValidationResult {
  const timestamp = now ?? Date.now();
  const store = loadTokenStore();
  const token = store.tokens.find((t) => t.token === tokenStr);

  if (!token) return { valid: false, reason: 'Token not found' };
  if (timestamp >= token.expiresAt) {
    return { valid: false, reason: 'Token expired' };
  }
  if (token.redemptionCount >= token.maxRedemptions) {
    return { valid: false, reason: 'Token already redeemed' };
  }
  return { valid: true, token };
}

export function redeemInviteToken(
  tokenStr: string,
  nullifier: string,
  now?: number,
): TokenValidationResult {
  const timestamp = now ?? Date.now();
  const validation = validateInviteToken(tokenStr, timestamp);
  if (!validation.valid) return validation;

  const store = loadTokenStore();
  const idx = store.tokens.findIndex((t) => t.token === tokenStr);
  /* v8 ignore next -- defensive: validateInviteToken above rejects missing tokens */
  if (idx === -1) return { valid: false, reason: 'Token not found' };

  const updated: InviteToken = {
    ...store.tokens[idx]!,
    redeemedAt: timestamp,
    redeemedBy: nullifier,
    redemptionCount: store.tokens[idx]!.redemptionCount + 1,
  };
  store.tokens[idx] = updated;
  persistTokenStore(store);
  return { valid: true, token: updated };
}

export function listTokens(): InviteToken[] {
  return loadTokenStore().tokens;
}

export function revokeToken(tokenStr: string): boolean {
  const store = loadTokenStore();
  const idx = store.tokens.findIndex((t) => t.token === tokenStr);
  if (idx === -1) return false;
  store.tokens[idx] = { ...store.tokens[idx]!, expiresAt: 0 };
  persistTokenStore(store);
  return true;
}
