/**
 * Mock factories for linked-social schemas.
 *
 * Produces valid test data for SocialNotification, LinkedSocialAccount,
 * and OAuthTokenRecord. Used by downstream consumers and tests.
 */

import type {
  SocialNotification,
  LinkedSocialAccount,
  SocialProviderIdType,
} from '@vh/data-model';
import type { OAuthTokenRecord } from './tokenVault';

let counter = 0;

function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

/** Reset the mock counter. For testing only. */
export function _resetMockCounter(): void {
  counter = 0;
}

// ── Notification factory ───────────────────────────────────────────

export interface MockNotificationOverrides {
  id?: string;
  topic_id?: string;
  accountId?: string;
  providerId?: SocialProviderIdType;
  type?: SocialNotification['type'];
  title?: string;
  previewText?: string;
  linkUrl?: string;
  createdAt?: number;
  seenAt?: number;
  dismissedAt?: number;
}

export function createMockNotification(
  overrides: MockNotificationOverrides = {},
): SocialNotification {
  return {
    id: overrides.id ?? nextId('notif'),
    schemaVersion: 'social-notification-v0',
    topic_id: overrides.topic_id ?? nextId('topic'),
    accountId: overrides.accountId ?? 'mock-account-1',
    providerId: overrides.providerId ?? 'x',
    type: overrides.type ?? 'mention',
    title: overrides.title ?? 'Mock notification title',
    previewText: overrides.previewText,
    linkUrl: overrides.linkUrl,
    createdAt: overrides.createdAt ?? Date.now(),
    seenAt: overrides.seenAt,
    dismissedAt: overrides.dismissedAt,
  };
}

// ── Account factory ────────────────────────────────────────────────

export interface MockAccountOverrides {
  id?: string;
  providerId?: SocialProviderIdType;
  accountId?: string;
  displayName?: string;
  connectedAt?: number;
  status?: LinkedSocialAccount['status'];
}

export function createMockAccount(
  overrides: MockAccountOverrides = {},
): LinkedSocialAccount {
  return {
    id: overrides.id ?? nextId('link'),
    schemaVersion: 'hermes-linked-social-v0',
    providerId: overrides.providerId ?? 'x',
    accountId: overrides.accountId ?? nextId('acct'),
    displayName: overrides.displayName,
    connectedAt: overrides.connectedAt ?? Date.now(),
    status: overrides.status ?? 'connected',
  };
}

// ── Token factory (for testing only — never use in production) ─────

export interface MockTokenOverrides {
  providerId?: SocialProviderIdType;
  accountId?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
  updatedAt?: number;
}

export function createMockToken(
  overrides: MockTokenOverrides = {},
): OAuthTokenRecord {
  return {
    providerId: overrides.providerId ?? 'x',
    accountId: overrides.accountId ?? 'mock-account-1',
    accessToken: overrides.accessToken ?? `mock-access-${nextId('tok')}`,
    refreshToken: overrides.refreshToken,
    expiresAt: overrides.expiresAt,
    scopes: overrides.scopes ?? ['read'],
    updatedAt: overrides.updatedAt ?? Date.now(),
  };
}
