import { describe, expect, it } from 'vitest';
import {
  LinkedSocialAccountSchema,
  SocialNotificationSchema,
  LegacySocialNotificationSchema,
  migrateLegacyNotification,
  parseNotificationCompat,
} from './notification';

const now = Date.now();

// ── Fixtures ───────────────────────────────────────────────────────

const validNotification = {
  id: 'notif-1',
  schemaVersion: 'social-notification-v0' as const,
  topic_id: 'topic-123',
  accountId: 'acct-abc',
  providerId: 'x' as const,
  type: 'mention' as const,
  title: 'You were mentioned in a thread',
  createdAt: now,
};

const validLegacyNotification = {
  id: 'notif-legacy-1',
  schemaVersion: 'hermes-notification-v0' as const,
  accountId: 'acct-abc',
  providerId: 'x' as const,
  type: 'mention' as const,
  message: 'You were mentioned in a thread',
  createdAt: now,
};

const validAccount = {
  id: 'link-1',
  schemaVersion: 'hermes-linked-social-v0' as const,
  providerId: 'reddit' as const,
  accountId: 'acct-def',
  connectedAt: now,
};

// ── SocialNotificationSchema (social-notification-v0) ──────────────

describe('SocialNotificationSchema', () => {
  describe('valid inputs', () => {
    it('accepts minimal valid notification', () => {
      const parsed = SocialNotificationSchema.parse(validNotification);
      expect(parsed.id).toBe('notif-1');
      expect(parsed.schemaVersion).toBe('social-notification-v0');
      expect(parsed.topic_id).toBe('topic-123');
      expect(parsed.providerId).toBe('x');
      expect(parsed.type).toBe('mention');
      expect(parsed.title).toBe('You were mentioned in a thread');
      expect(parsed.seenAt).toBeUndefined();
      expect(parsed.dismissedAt).toBeUndefined();
    });

    it('accepts notification with all optional fields', () => {
      const parsed = SocialNotificationSchema.parse({
        ...validNotification,
        previewText: 'Preview of the mention',
        linkUrl: 'https://x.com/user/status/123',
        seenAt: now + 1000,
        dismissedAt: now + 2000,
      });
      expect(parsed.previewText).toBe('Preview of the mention');
      expect(parsed.linkUrl).toBe('https://x.com/user/status/123');
      expect(parsed.seenAt).toBe(now + 1000);
      expect(parsed.dismissedAt).toBe(now + 2000);
    });

    it.each([
      'x',
      'reddit',
      'youtube',
      'tiktok',
      'instagram',
      'other',
    ] as const)('accepts providerId "%s"', (providerId) => {
      const parsed = SocialNotificationSchema.parse({
        ...validNotification,
        providerId,
      });
      expect(parsed.providerId).toBe(providerId);
    });

    it.each([
      'mention',
      'reply',
      'repost',
      'quote',
      'message',
      'other',
    ] as const)('accepts type "%s"', (type) => {
      const parsed = SocialNotificationSchema.parse({
        ...validNotification,
        type,
      });
      expect(parsed.type).toBe(type);
    });

    it('accepts createdAt of zero', () => {
      const parsed = SocialNotificationSchema.parse({
        ...validNotification,
        createdAt: 0,
      });
      expect(parsed.createdAt).toBe(0);
    });

    it('accepts seenAt of zero', () => {
      const parsed = SocialNotificationSchema.parse({
        ...validNotification,
        seenAt: 0,
      });
      expect(parsed.seenAt).toBe(0);
    });

    it('accepts dismissedAt of zero', () => {
      const parsed = SocialNotificationSchema.parse({
        ...validNotification,
        dismissedAt: 0,
      });
      expect(parsed.dismissedAt).toBe(0);
    });
  });

  describe('spec field alignment — regression', () => {
    it('has schemaVersion social-notification-v0', () => {
      const parsed = SocialNotificationSchema.parse(validNotification);
      expect(parsed.schemaVersion).toBe('social-notification-v0');
    });

    it('requires topic_id', () => {
      const result = SocialNotificationSchema.safeParse({
        ...validNotification,
        topic_id: undefined,
      });
      expect(result.success).toBe(false);
    });

    it('uses title (not message)', () => {
      const parsed = SocialNotificationSchema.parse(validNotification);
      expect(parsed.title).toBe('You were mentioned in a thread');
      expect('message' in parsed).toBe(false);
    });

    it('uses linkUrl (not url)', () => {
      const parsed = SocialNotificationSchema.parse({
        ...validNotification,
        linkUrl: 'https://example.com',
      });
      expect(parsed.linkUrl).toBe('https://example.com');
      expect('url' in parsed).toBe(false);
    });

    it('uses seenAt number (not read boolean)', () => {
      const parsed = SocialNotificationSchema.parse({
        ...validNotification,
        seenAt: now,
      });
      expect(parsed.seenAt).toBe(now);
      expect('read' in parsed).toBe(false);
    });

    it('supports optional previewText', () => {
      const parsed = SocialNotificationSchema.parse({
        ...validNotification,
        previewText: 'Some preview',
      });
      expect(parsed.previewText).toBe('Some preview');
    });

    it('supports optional dismissedAt', () => {
      const parsed = SocialNotificationSchema.parse({
        ...validNotification,
        dismissedAt: now,
      });
      expect(parsed.dismissedAt).toBe(now);
    });
  });

  describe('strict mode — rejects unknown keys', () => {
    it('rejects extra unknown properties', () => {
      const result = SocialNotificationSchema.safeParse({
        ...validNotification,
        extraField: 'should-fail',
      });
      expect(result.success).toBe(false);
    });

    it('rejects legacy "message" field', () => {
      const result = SocialNotificationSchema.safeParse({
        ...validNotification,
        message: 'legacy field',
      });
      expect(result.success).toBe(false);
    });

    it('rejects legacy "url" field', () => {
      const result = SocialNotificationSchema.safeParse({
        ...validNotification,
        url: 'https://example.com',
      });
      expect(result.success).toBe(false);
    });

    it('rejects legacy "read" field', () => {
      const result = SocialNotificationSchema.safeParse({
        ...validNotification,
        read: true,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('required field validation', () => {
    it.each([
      'id',
      'schemaVersion',
      'topic_id',
      'accountId',
      'providerId',
      'type',
      'title',
      'createdAt',
    ] as const)('rejects missing "%s"', (field) => {
      const input = { ...validNotification };
      delete (input as Record<string, unknown>)[field];
      const result = SocialNotificationSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('schemaVersion enforcement', () => {
    it('rejects wrong schemaVersion literal', () => {
      const result = SocialNotificationSchema.safeParse({
        ...validNotification,
        schemaVersion: 'hermes-notification-v0',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty schemaVersion', () => {
      const result = SocialNotificationSchema.safeParse({
        ...validNotification,
        schemaVersion: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('enum validation', () => {
    it('rejects invalid providerId', () => {
      const result = SocialNotificationSchema.safeParse({
        ...validNotification,
        providerId: 'twitter',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid type', () => {
      const result = SocialNotificationSchema.safeParse({
        ...validNotification,
        type: 'like',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('field type validation', () => {
    it('rejects numeric id', () => {
      const result = SocialNotificationSchema.safeParse({
        ...validNotification,
        id: 123,
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty id', () => {
      const result = SocialNotificationSchema.safeParse({
        ...validNotification,
        id: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty accountId', () => {
      const result = SocialNotificationSchema.safeParse({
        ...validNotification,
        accountId: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty title', () => {
      const result = SocialNotificationSchema.safeParse({
        ...validNotification,
        title: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty topic_id', () => {
      const result = SocialNotificationSchema.safeParse({
        ...validNotification,
        topic_id: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-integer createdAt', () => {
      const result = SocialNotificationSchema.safeParse({
        ...validNotification,
        createdAt: 1.5,
      });
      expect(result.success).toBe(false);
    });

    it('rejects negative createdAt', () => {
      const result = SocialNotificationSchema.safeParse({
        ...validNotification,
        createdAt: -1,
      });
      expect(result.success).toBe(false);
    });

    it('rejects string createdAt', () => {
      const result = SocialNotificationSchema.safeParse({
        ...validNotification,
        createdAt: 'not-a-number',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid linkUrl format', () => {
      const result = SocialNotificationSchema.safeParse({
        ...validNotification,
        linkUrl: 'not-a-url',
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-integer seenAt', () => {
      const result = SocialNotificationSchema.safeParse({
        ...validNotification,
        seenAt: 1.5,
      });
      expect(result.success).toBe(false);
    });

    it('rejects negative seenAt', () => {
      const result = SocialNotificationSchema.safeParse({
        ...validNotification,
        seenAt: -1,
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-integer dismissedAt', () => {
      const result = SocialNotificationSchema.safeParse({
        ...validNotification,
        dismissedAt: 1.5,
      });
      expect(result.success).toBe(false);
    });

    it('rejects negative dismissedAt', () => {
      const result = SocialNotificationSchema.safeParse({
        ...validNotification,
        dismissedAt: -1,
      });
      expect(result.success).toBe(false);
    });
  });
});

// ── LegacySocialNotificationSchema ─────────────────────────────────

describe('LegacySocialNotificationSchema', () => {
  it('accepts valid legacy notification', () => {
    const parsed = LegacySocialNotificationSchema.parse(validLegacyNotification);
    expect(parsed.id).toBe('notif-legacy-1');
    expect(parsed.schemaVersion).toBe('hermes-notification-v0');
    expect(parsed.message).toBe('You were mentioned in a thread');
    expect(parsed.read).toBe(false);
  });

  it('accepts legacy notification with all optional fields', () => {
    const parsed = LegacySocialNotificationSchema.parse({
      ...validLegacyNotification,
      url: 'https://x.com/user/status/123',
      read: true,
    });
    expect(parsed.url).toBe('https://x.com/user/status/123');
    expect(parsed.read).toBe(true);
  });

  it('rejects current-schema data', () => {
    const result = LegacySocialNotificationSchema.safeParse(validNotification);
    expect(result.success).toBe(false);
  });

  it('rejects extra unknown properties', () => {
    const result = LegacySocialNotificationSchema.safeParse({
      ...validLegacyNotification,
      extraField: 'should-fail',
    });
    expect(result.success).toBe(false);
  });

  it.each([
    'id',
    'schemaVersion',
    'accountId',
    'providerId',
    'type',
    'message',
    'createdAt',
  ] as const)('rejects missing "%s"', (field) => {
    const input = { ...validLegacyNotification };
    delete (input as Record<string, unknown>)[field];
    const result = LegacySocialNotificationSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

// ── migrateLegacyNotification ──────────────────────────────────────

describe('migrateLegacyNotification', () => {
  it('migrates legacy to current schema with field mapping', () => {
    const legacy = LegacySocialNotificationSchema.parse(validLegacyNotification);
    const migrated = migrateLegacyNotification(legacy, 'topic-456');

    expect(migrated.schemaVersion).toBe('social-notification-v0');
    expect(migrated.topic_id).toBe('topic-456');
    expect(migrated.title).toBe(legacy.message);
    expect(migrated.linkUrl).toBeUndefined();
    expect(migrated.seenAt).toBeUndefined();
    expect(migrated.dismissedAt).toBeUndefined();
    expect(migrated.previewText).toBeUndefined();
  });

  it('maps legacy url to linkUrl', () => {
    const legacy = LegacySocialNotificationSchema.parse({
      ...validLegacyNotification,
      url: 'https://x.com/user/status/123',
    });
    const migrated = migrateLegacyNotification(legacy, 'topic-456');
    expect(migrated.linkUrl).toBe('https://x.com/user/status/123');
  });

  it('maps legacy read=true to seenAt=createdAt', () => {
    const legacy = LegacySocialNotificationSchema.parse({
      ...validLegacyNotification,
      read: true,
    });
    const migrated = migrateLegacyNotification(legacy, 'topic-456');
    expect(migrated.seenAt).toBe(legacy.createdAt);
  });

  it('maps legacy read=false to seenAt=undefined', () => {
    const legacy = LegacySocialNotificationSchema.parse({
      ...validLegacyNotification,
      read: false,
    });
    const migrated = migrateLegacyNotification(legacy, 'topic-456');
    expect(migrated.seenAt).toBeUndefined();
  });

  it('produces valid current-schema output', () => {
    const legacy = LegacySocialNotificationSchema.parse({
      ...validLegacyNotification,
      url: 'https://x.com/user/status/123',
      read: true,
    });
    const migrated = migrateLegacyNotification(legacy, 'topic-789');
    // Must parse cleanly under the current schema
    const result = SocialNotificationSchema.safeParse(migrated);
    expect(result.success).toBe(true);
  });

  it('preserves id, accountId, providerId, type, createdAt', () => {
    const legacy = LegacySocialNotificationSchema.parse(validLegacyNotification);
    const migrated = migrateLegacyNotification(legacy, 'topic-x');
    expect(migrated.id).toBe(legacy.id);
    expect(migrated.accountId).toBe(legacy.accountId);
    expect(migrated.providerId).toBe(legacy.providerId);
    expect(migrated.type).toBe(legacy.type);
    expect(migrated.createdAt).toBe(legacy.createdAt);
  });
});

// ── parseNotificationCompat ────────────────────────────────────────

describe('parseNotificationCompat', () => {
  it('parses current-schema data directly', () => {
    const result = parseNotificationCompat(validNotification, 'fallback');
    expect(result).not.toBeNull();
    expect(result!.schemaVersion).toBe('social-notification-v0');
    expect(result!.topic_id).toBe('topic-123');
  });

  it('parses legacy-schema data via migration', () => {
    const result = parseNotificationCompat(validLegacyNotification, 'fallback-topic');
    expect(result).not.toBeNull();
    expect(result!.schemaVersion).toBe('social-notification-v0');
    expect(result!.topic_id).toBe('fallback-topic');
    expect(result!.title).toBe(validLegacyNotification.message);
  });

  it('returns null for completely invalid data', () => {
    const result = parseNotificationCompat({ garbage: true }, 'fallback');
    expect(result).toBeNull();
  });

  it('returns null for null input', () => {
    const result = parseNotificationCompat(null, 'fallback');
    expect(result).toBeNull();
  });

  it('returns null for undefined input', () => {
    const result = parseNotificationCompat(undefined, 'fallback');
    expect(result).toBeNull();
  });

  it('prefers current schema over legacy', () => {
    const result = parseNotificationCompat(validNotification, 'should-not-use');
    expect(result!.topic_id).toBe('topic-123'); // from current, not fallback
  });
});

// ── LinkedSocialAccountSchema ──────────────────────────────────────

describe('LinkedSocialAccountSchema', () => {
  describe('valid inputs', () => {
    it('accepts minimal valid account', () => {
      const parsed = LinkedSocialAccountSchema.parse(validAccount);
      expect(parsed.id).toBe('link-1');
      expect(parsed.schemaVersion).toBe('hermes-linked-social-v0');
      expect(parsed.providerId).toBe('reddit');
      expect(parsed.accountId).toBe('acct-def');
      expect(parsed.status).toBe('connected'); // default
    });

    it('accepts account with all optional fields', () => {
      const parsed = LinkedSocialAccountSchema.parse({
        ...validAccount,
        displayName: 'u/testuser',
        status: 'revoked',
      });
      expect(parsed.displayName).toBe('u/testuser');
      expect(parsed.status).toBe('revoked');
    });

    it.each([
      'x',
      'reddit',
      'youtube',
      'tiktok',
      'instagram',
      'other',
    ] as const)('accepts providerId "%s"', (providerId) => {
      const parsed = LinkedSocialAccountSchema.parse({
        ...validAccount,
        providerId,
      });
      expect(parsed.providerId).toBe(providerId);
    });

    it.each(['connected', 'revoked', 'expired'] as const)(
      'accepts status "%s"',
      (status) => {
        const parsed = LinkedSocialAccountSchema.parse({
          ...validAccount,
          status,
        });
        expect(parsed.status).toBe(status);
      },
    );

    it('accepts connectedAt of zero', () => {
      const parsed = LinkedSocialAccountSchema.parse({
        ...validAccount,
        connectedAt: 0,
      });
      expect(parsed.connectedAt).toBe(0);
    });

    it('defaults status to connected when omitted', () => {
      const parsed = LinkedSocialAccountSchema.parse(validAccount);
      expect(parsed.status).toBe('connected');
    });
  });

  describe('strict mode — rejects unknown keys', () => {
    it('rejects extra unknown properties', () => {
      const result = LinkedSocialAccountSchema.safeParse({
        ...validAccount,
        secret: 'oauth-token',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('required field validation', () => {
    it.each([
      'id',
      'schemaVersion',
      'providerId',
      'accountId',
      'connectedAt',
    ] as const)('rejects missing "%s"', (field) => {
      const input = { ...validAccount };
      delete (input as Record<string, unknown>)[field];
      const result = LinkedSocialAccountSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('schemaVersion enforcement', () => {
    it('rejects wrong schemaVersion literal', () => {
      const result = LinkedSocialAccountSchema.safeParse({
        ...validAccount,
        schemaVersion: 'hermes-linked-social-v1',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('enum validation', () => {
    it('rejects invalid providerId', () => {
      const result = LinkedSocialAccountSchema.safeParse({
        ...validAccount,
        providerId: 'facebook',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid status', () => {
      const result = LinkedSocialAccountSchema.safeParse({
        ...validAccount,
        status: 'deleted',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('field type validation', () => {
    it('rejects empty id', () => {
      const result = LinkedSocialAccountSchema.safeParse({
        ...validAccount,
        id: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty accountId', () => {
      const result = LinkedSocialAccountSchema.safeParse({
        ...validAccount,
        accountId: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-integer connectedAt', () => {
      const result = LinkedSocialAccountSchema.safeParse({
        ...validAccount,
        connectedAt: 1.5,
      });
      expect(result.success).toBe(false);
    });

    it('rejects negative connectedAt', () => {
      const result = LinkedSocialAccountSchema.safeParse({
        ...validAccount,
        connectedAt: -1,
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-boolean verified (not a valid field)', () => {
      const result = LinkedSocialAccountSchema.safeParse({
        ...validAccount,
        verified: true,
      });
      // strict mode rejects unknown fields
      expect(result.success).toBe(false);
    });
  });
});
