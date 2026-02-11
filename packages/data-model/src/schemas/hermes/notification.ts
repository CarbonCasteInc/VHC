import { z } from 'zod';

// ── Shared primitives ──────────────────────────────────────────────

const SocialPlatform = z.enum(['bluesky', 'mastodon', 'nostr']);
const NotificationType = z.enum(['mention', 'reply', 'repost', 'follow']);
const PositiveTimestamp = z.number().int().nonnegative();

// ── Social Notification ────────────────────────────────────────────

export const SocialNotificationSchema = z
  .object({
    id: z.string().min(1),
    schemaVersion: z.literal('hermes-notification-v0'),
    accountId: z.string().min(1),
    platform: SocialPlatform,
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
    platform: SocialPlatform,
    handle: z.string().min(1),
    verified: z.boolean().optional(),
    connectedAt: PositiveTimestamp,
    lastSyncAt: PositiveTimestamp.optional(),
  })
  .strict();

// ── Exported types ─────────────────────────────────────────────────

export type SocialNotification = z.infer<typeof SocialNotificationSchema>;
export type LinkedSocialAccount = z.infer<typeof LinkedSocialAccountSchema>;
