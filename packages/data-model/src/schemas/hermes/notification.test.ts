import { describe, expect, it } from 'vitest';
import {
  LinkedSocialAccountSchema,
  SocialNotificationSchema,
} from './notification';

const now = Date.now();

// ── Fixtures ───────────────────────────────────────────────────────

const validNotification = {
  id: 'notif-1',
  schemaVersion: 'hermes-notification-v0' as const,
  accountId: 'acct-abc',
  platform: 'bluesky' as const,
  type: 'mention' as const,
  message: 'You were mentioned in a thread',
  createdAt: now,
};

const validAccount = {
  id: 'link-1',
  schemaVersion: 'hermes-linked-social-v0' as const,
  platform: 'mastodon' as const,
  handle: '@user@instance.social',
  connectedAt: now,
};

// ── SocialNotificationSchema ───────────────────────────────────────

describe('SocialNotificationSchema', () => {
  describe('valid inputs', () => {
    it('accepts minimal valid notification', () => {
      const parsed = SocialNotificationSchema.parse(validNotification);
      expect(parsed.id).toBe('notif-1');
      expect(parsed.schemaVersion).toBe('hermes-notification-v0');
      expect(parsed.platform).toBe('bluesky');
      expect(parsed.type).toBe('mention');
      expect(parsed.read).toBe(false); // default
    });

    it('accepts notification with all optional fields', () => {
      const parsed = SocialNotificationSchema.parse({
        ...validNotification,
        url: 'https://bsky.app/profile/user/post/123',
        read: true,
      });
      expect(parsed.url).toBe('https://bsky.app/profile/user/post/123');
      expect(parsed.read).toBe(true);
    });

    it.each(['bluesky', 'mastodon', 'nostr'] as const)(
      'accepts platform "%s"',
      (platform) => {
        const parsed = SocialNotificationSchema.parse({
          ...validNotification,
          platform,
        });
        expect(parsed.platform).toBe(platform);
      },
    );

    it.each(['mention', 'reply', 'repost', 'follow'] as const)(
      'accepts type "%s"',
      (type) => {
        const parsed = SocialNotificationSchema.parse({
          ...validNotification,
          type,
        });
        expect(parsed.type).toBe(type);
      },
    );

    it('defaults read to false when omitted', () => {
      const parsed = SocialNotificationSchema.parse(validNotification);
      expect(parsed.read).toBe(false);
    });

    it('accepts createdAt of zero', () => {
      const parsed = SocialNotificationSchema.parse({
        ...validNotification,
        createdAt: 0,
      });
      expect(parsed.createdAt).toBe(0);
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
  });

  describe('required field validation', () => {
    it.each([
      'id',
      'schemaVersion',
      'accountId',
      'platform',
      'type',
      'message',
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
        schemaVersion: 'hermes-notification-v1',
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
    it('rejects invalid platform', () => {
      const result = SocialNotificationSchema.safeParse({
        ...validNotification,
        platform: 'twitter',
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

    it('rejects empty message', () => {
      const result = SocialNotificationSchema.safeParse({
        ...validNotification,
        message: '',
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

    it('rejects invalid url format', () => {
      const result = SocialNotificationSchema.safeParse({
        ...validNotification,
        url: 'not-a-url',
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-boolean read', () => {
      const result = SocialNotificationSchema.safeParse({
        ...validNotification,
        read: 'yes',
      });
      expect(result.success).toBe(false);
    });
  });
});

// ── LinkedSocialAccountSchema ──────────────────────────────────────

describe('LinkedSocialAccountSchema', () => {
  describe('valid inputs', () => {
    it('accepts minimal valid account', () => {
      const parsed = LinkedSocialAccountSchema.parse(validAccount);
      expect(parsed.id).toBe('link-1');
      expect(parsed.schemaVersion).toBe('hermes-linked-social-v0');
      expect(parsed.platform).toBe('mastodon');
      expect(parsed.handle).toBe('@user@instance.social');
    });

    it('accepts account with all optional fields', () => {
      const parsed = LinkedSocialAccountSchema.parse({
        ...validAccount,
        verified: true,
        lastSyncAt: now - 60_000,
      });
      expect(parsed.verified).toBe(true);
      expect(parsed.lastSyncAt).toBe(now - 60_000);
    });

    it.each(['bluesky', 'mastodon', 'nostr'] as const)(
      'accepts platform "%s"',
      (platform) => {
        const parsed = LinkedSocialAccountSchema.parse({
          ...validAccount,
          platform,
        });
        expect(parsed.platform).toBe(platform);
      },
    );

    it('accepts connectedAt of zero', () => {
      const parsed = LinkedSocialAccountSchema.parse({
        ...validAccount,
        connectedAt: 0,
      });
      expect(parsed.connectedAt).toBe(0);
    });

    it('accepts verified as false', () => {
      const parsed = LinkedSocialAccountSchema.parse({
        ...validAccount,
        verified: false,
      });
      expect(parsed.verified).toBe(false);
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
      'platform',
      'handle',
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
    it('rejects invalid platform', () => {
      const result = LinkedSocialAccountSchema.safeParse({
        ...validAccount,
        platform: 'facebook',
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

    it('rejects empty handle', () => {
      const result = LinkedSocialAccountSchema.safeParse({
        ...validAccount,
        handle: '',
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

    it('rejects non-integer lastSyncAt', () => {
      const result = LinkedSocialAccountSchema.safeParse({
        ...validAccount,
        lastSyncAt: 99.9,
      });
      expect(result.success).toBe(false);
    });

    it('rejects negative lastSyncAt', () => {
      const result = LinkedSocialAccountSchema.safeParse({
        ...validAccount,
        lastSyncAt: -100,
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-boolean verified', () => {
      const result = LinkedSocialAccountSchema.safeParse({
        ...validAccount,
        verified: 'yes',
      });
      expect(result.success).toBe(false);
    });
  });
});
