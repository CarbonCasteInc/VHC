import { z } from 'zod';

// ── Shared primitives ──────────────────────────────────────────────

/**
 * Canonical platform set from spec-linked-socials-v0.md §2.
 * The 'other' variant is a catch-all for platforms not yet listed.
 */
export const SocialProviderId = z.enum([
  'x',
  'reddit',
  'youtube',
  'tiktok',
  'instagram',
  'other',
]);

export const NotificationType = z.enum([
  'mention',
  'reply',
  'repost',
  'quote',
  'message',
  'other',
]);

const PositiveTimestamp = z.number().int().nonnegative();

// ── Social Notification (spec-linked-socials-v0 §3) ───────────────

export const SocialNotificationSchema = z
  .object({
    id: z.string().min(1),
    schemaVersion: z.literal('social-notification-v0'),
    topic_id: z.string().min(1),
    accountId: z.string().min(1),
    providerId: SocialProviderId,
    type: NotificationType,
    title: z.string().min(1),
    previewText: z.string().optional(),
    linkUrl: z.string().url().optional(),
    createdAt: PositiveTimestamp,
    seenAt: PositiveTimestamp.optional(),
    dismissedAt: PositiveTimestamp.optional(),
  })
  .strict();

// ── Legacy schema (hermes-notification-v0) for migration ──────────

export const LegacySocialNotificationSchema = z
  .object({
    id: z.string().min(1),
    schemaVersion: z.literal('hermes-notification-v0'),
    accountId: z.string().min(1),
    providerId: SocialProviderId,
    type: NotificationType,
    message: z.string().min(1),
    url: z.string().url().optional(),
    read: z.boolean().default(false),
    createdAt: PositiveTimestamp,
  })
  .strict();

// ── Linked Social Account ──────────────────────────────────────────

export const LinkedSocialAccountSchema = z
  .object({
    id: z.string().min(1),
    schemaVersion: z.literal('hermes-linked-social-v0'),
    providerId: SocialProviderId,
    accountId: z.string().min(1),
    displayName: z.string().optional(),
    connectedAt: PositiveTimestamp,
    status: z.enum(['connected', 'revoked', 'expired']).default('connected'),
  })
  .strict();

// ── Migration adapter ──────────────────────────────────────────────

export type LegacySocialNotification = z.infer<typeof LegacySocialNotificationSchema>;

/**
 * Migrate a legacy hermes-notification-v0 record to social-notification-v0.
 * Requires a topic_id since the legacy schema did not include one.
 */
export function migrateLegacyNotification(
  legacy: LegacySocialNotification,
  topicId: string,
): SocialNotification {
  return {
    id: legacy.id,
    schemaVersion: 'social-notification-v0',
    topic_id: topicId,
    accountId: legacy.accountId,
    providerId: legacy.providerId,
    type: legacy.type,
    title: legacy.message,
    previewText: undefined,
    linkUrl: legacy.url,
    createdAt: legacy.createdAt,
    seenAt: legacy.read ? legacy.createdAt : undefined,
    dismissedAt: undefined,
  };
}

/**
 * Parse either legacy or current notification format.
 * Returns a current-format SocialNotification or null if both fail.
 */
export function parseNotificationCompat(
  data: unknown,
  fallbackTopicId: string,
): SocialNotification | null {
  const current = SocialNotificationSchema.safeParse(data);
  if (current.success) return current.data;

  const legacy = LegacySocialNotificationSchema.safeParse(data);
  if (legacy.success) return migrateLegacyNotification(legacy.data, fallbackTopicId);

  return null;
}

// ── Exported types ─────────────────────────────────────────────────

export type SocialNotification = z.infer<typeof SocialNotificationSchema>;
export type LinkedSocialAccount = z.infer<typeof LinkedSocialAccountSchema>;
export type SocialProviderIdType = z.infer<typeof SocialProviderId>;
