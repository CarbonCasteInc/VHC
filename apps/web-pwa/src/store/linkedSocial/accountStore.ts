/**
 * Linked social account connection state + notification ingestion.
 *
 * - Account records stored locally (no vault needed for non-secret data).
 * - Notification ingestion caches to local store.
 * - Public projections to vh/social/cards/* are sanitized (no tokens/secrets).
 */

import type {
  SocialNotification,
  LinkedSocialAccount,
  SocialProviderIdType,
} from '@vh/data-model';
import {
  SocialNotificationSchema,
  LinkedSocialAccountSchema,
} from '@vh/data-model';
import { storeToken, revokeToken, type OAuthTokenRecord } from './tokenVault';

// ── Feature flag ───────────────────────────────────────────────────

let _featureFlagOverride: boolean | null = null;

/** Override the feature flag for testing. Pass null to restore default. */
export function _setFeatureFlagForTesting(value: boolean | null): void {
  _featureFlagOverride = value;
}

function isLinkedSocialEnabled(): boolean {
  if (_featureFlagOverride !== null) return _featureFlagOverride;
  try {
    return (
      typeof import.meta !== 'undefined' &&
      (import.meta as unknown as Record<string, Record<string, unknown>>).env?.VITE_LINKED_SOCIAL_ENABLED === 'true'
    );
  /* v8 ignore next 3 -- defensive catch for import.meta unavailable */
  } catch {
    return false;
  }
}

// ── In-memory stores (local cache, authoritative on-device) ────────

const accounts = new Map<string, LinkedSocialAccount>();
const notifications = new Map<string, SocialNotification>();

// ── Account lifecycle ──────────────────────────────────────────────

/**
 * Connect a social account. Stores account record + token in vault.
 * Zero-trust: validates all inputs before storing.
 */
export async function connectAccount(
  account: LinkedSocialAccount,
  token: OAuthTokenRecord,
): Promise<boolean> {
  if (!isLinkedSocialEnabled()) return false;

  const parsedAccount = LinkedSocialAccountSchema.safeParse(account);
  if (!parsedAccount.success) return false;

  const stored = await storeToken(token);
  if (!stored) return false;

  accounts.set(parsedAccount.data.accountId, parsedAccount.data);
  return true;
}

/**
 * Disconnect (revoke) a social account. Removes token from vault
 * and updates account status.
 */
export async function disconnectAccount(
  providerId: SocialProviderIdType,
  accountId: string,
): Promise<boolean> {
  if (!isLinkedSocialEnabled()) return false;

  const existing = accounts.get(accountId);
  if (!existing || existing.providerId !== providerId) return false;

  await revokeToken(providerId, accountId);

  const revoked: LinkedSocialAccount = {
    ...existing,
    status: 'revoked',
  };
  accounts.set(accountId, revoked);
  return true;
}

/** Get a specific account by ID. */
export function getAccount(accountId: string): LinkedSocialAccount | undefined {
  return accounts.get(accountId);
}

/** Get all linked accounts. */
export function getAllAccounts(): LinkedSocialAccount[] {
  return Array.from(accounts.values());
}

/** Get accounts filtered by provider. */
export function getAccountsByProvider(
  providerId: SocialProviderIdType,
): LinkedSocialAccount[] {
  return Array.from(accounts.values()).filter(
    (a) => a.providerId === providerId,
  );
}

// ── Notification ingestion ─────────────────────────────────────────

/**
 * Ingest a notification. Validates with Zod (zero-trust).
 * Returns the parsed notification or null if invalid.
 */
export function ingestNotification(
  data: unknown,
): SocialNotification | null {
  const parsed = SocialNotificationSchema.safeParse(data);
  if (!parsed.success) return null;

  notifications.set(parsed.data.id, parsed.data);
  return parsed.data;
}

/** Get a notification by ID. */
export function getNotification(id: string): SocialNotification | undefined {
  return notifications.get(id);
}

/** Get all notifications. */
export function getAllNotifications(): SocialNotification[] {
  return Array.from(notifications.values());
}

/** Get notifications filtered by account. */
export function getNotificationsByAccount(
  accountId: string,
): SocialNotification[] {
  return Array.from(notifications.values()).filter(
    (n) => n.accountId === accountId,
  );
}

/** Mark a notification as seen. Returns updated notification or null. */
export function markSeen(id: string): SocialNotification | null {
  const existing = notifications.get(id);
  if (!existing) return null;

  const updated: SocialNotification = {
    ...existing,
    seenAt: Date.now(),
  };
  notifications.set(id, updated);
  return updated;
}

/** Dismiss a notification. Returns updated notification or null. */
export function dismissNotification(id: string): SocialNotification | null {
  const existing = notifications.get(id);
  if (!existing) return null;

  const updated: SocialNotification = {
    ...existing,
    dismissedAt: Date.now(),
  };
  notifications.set(id, updated);
  return updated;
}

// ── Public card projection (sanitized) ─────────────────────────────

/** Fields allowed in public card projections. */
export interface SanitizedSocialCard {
  id: string;
  topic_id: string;
  providerId: SocialProviderIdType;
  type: SocialNotification['type'];
  title: string;
  previewText?: string;
  linkUrl?: string;
  createdAt: number;
  seenAt?: number;
  dismissedAt?: number;
}

/**
 * Forbidden field names that must never appear in public projections.
 * Used for recursive sanitization checks.
 */
export const FORBIDDEN_PUBLIC_FIELDS = [
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'bearer',
  'bearerToken',
  'bearer_token',
  'providerSecret',
  'provider_secret',
  'secret',
  'privateMessageBody',
  'private_message_body',
  'token',
] as const;

/**
 * Recursively check if an object contains any forbidden fields.
 * Returns the first forbidden field name found, or null if clean.
 */
export function findForbiddenField(
  obj: unknown,
  visited = new WeakSet<object>(),
): string | null {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') return null;

  const target = obj as Record<string, unknown>;
  if (visited.has(target)) return null;
  visited.add(target);

  for (const key of Object.keys(target)) {
    const lowerKey = key.toLowerCase();
    for (const forbidden of FORBIDDEN_PUBLIC_FIELDS) {
      if (lowerKey === forbidden.toLowerCase()) {
        return key;
      }
    }
    // Recurse into nested objects/arrays
    const value = target[key];
    if (typeof value === 'object' && value !== null) {
      const found = findForbiddenField(value, visited);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Project a notification to a sanitized public card.
 * Strips accountId and any other sensitive fields.
 * Returns null if forbidden fields are detected (zero-trust).
 */
export function toSanitizedCard(
  notification: SocialNotification,
): SanitizedSocialCard | null {
  const card: SanitizedSocialCard = {
    id: notification.id,
    topic_id: notification.topic_id,
    providerId: notification.providerId,
    type: notification.type,
    title: notification.title,
    previewText: notification.previewText,
    linkUrl: notification.linkUrl,
    createdAt: notification.createdAt,
    seenAt: notification.seenAt,
    dismissedAt: notification.dismissedAt,
  };

  // Zero-trust: verify no forbidden fields leaked in
  /* v8 ignore next -- defensive guard; card shape is statically clean */
  if (findForbiddenField(card) !== null) return null;

  return card;
}

// ── Test utilities (reset state for testing) ───────────────────────

/** Clear all in-memory state. For testing only. */
export function _resetStoreForTesting(): void {
  accounts.clear();
  notifications.clear();
}
