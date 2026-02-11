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

// ── SocialNotificationSchema ───────────────────────────────────────

describe('SocialNotificationSchema', () => {
  describe('valid inputs', () => {
    it('accepts minimal valid notification', () => {
      const parsed = SocialNotificationSchema.parse(validNotification);
      expect(parsed.id).toBe('notif-1');
      expect(parsed.schemaVersion).toBe('hermes-notification-v0');
      expect(parsed.providerId).toBe('x');
      expect(parsed.type).toBe('mention');
      expect(parsed.read).toBe(false); // default
    });

    it('accepts notification with all optional fields', () => {
      const parsed = SocialNotificationSchema.parse({
        ...validNotification,
        url: 'https://x.com/user/status/123',
        read: true,
      });
      expect(parsed.url).toBe('https://x.com/user/status/123');
      expect(parsed.read).toBe(true);
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
      'providerId',
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
