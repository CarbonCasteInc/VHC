# Linked Socials Spec (v0)

Version: 0.2
Status: Canonical for Season 0
Context: Optional linked-social account connection and notification cards.
Updated: 2026-02-13 — added `id` and `schemaVersion` fields to `LinkedSocialAccount` (implementation superset reconciliation).

## 1. Scope

Provide optional linked-social notifications in the unified feed while keeping OAuth tokens private.

## 2. Connection and auth contract

```ts
type SocialProviderId = 'x' | 'reddit' | 'youtube' | 'tiktok' | 'instagram' | 'other';

interface LinkedSocialAccount {
  id: string;                // unique identifier for this linked account record
  schemaVersion: 'linked-social-v0';
  providerId: SocialProviderId;
  accountId: string;
  displayName?: string;
  connectedAt: number;
  status: 'connected' | 'revoked' | 'expired';
}

interface OAuthTokenRecord {
  providerId: SocialProviderId;
  accountId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes: string[];
  updatedAt: number;
}
```

Storage rule:

- `OAuthTokenRecord` is vault-only and must never appear on public mesh paths.

## 3. Notification object contract

```ts
interface SocialNotification {
  id: string;
  schemaVersion: 'social-notification-v0';
  topic_id: string;
  providerId: SocialProviderId;
  accountId: string;
  type: 'mention' | 'reply' | 'repost' | 'quote' | 'message' | 'other';
  title: string;
  previewText?: string;
  linkUrl?: string;
  createdAt: number;
  seenAt?: number;
  dismissedAt?: number;
}
```

Feed card behavior:

1. render platform badge and summary
2. allow embedded context view when supported
3. allow dismiss action that returns user to feed context

## 4. Unified feed integration

- Notifications appear under `Social` surface and optionally `All`.
- Ranking in `All` is delegated to topic discovery/ranking spec.

## 5. Storage and paths

On-device (authoritative):

- vault: OAuth tokens
- local cache: notification objects and dismiss state

Optional public projection (sanitized only):

- `vh/social/cards/<cardId>` containing no tokens/account secrets

## 6. Privacy and telemetry

Forbidden in logs/telemetry:

- access tokens
- refresh tokens
- provider secrets
- private message body content

Allowed telemetry:

- provider ID
- event type
- seen/dismiss timings

## 7. Tests

1. Vault-only token placement checks.
2. Notification card render and dismiss flow.
3. Embedded-view open/close behavior.
4. Sanitization tests for any public card projection.
