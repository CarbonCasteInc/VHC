import { z } from 'zod';

// ── Shared primitives ──────────────────────────────────────────────

/**
 * Canonical platform set from spec-linked-socials-v0.md §2.
 * The 'other' variant is a catch-all for platforms not yet listed.
 */
const SocialProviderId = z.enum([
  'x',
  'reddit',
  'youtube',
  'tiktok',
  'instagram',
  'other',
]);

const NotificationType = z.enum([
  'mention',
  'reply',
  'repost',
  'quote',
  'message',
  'other',
]);

const PositiveTimestamp = z.number().int().nonnegative();

// ── Social Notification ────────────────────────────────────────────

export const SocialNotificationSchema = z
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

// ── Exported types ─────────────────────────────────────────────────

export type SocialNotification = z.infer<typeof SocialNotificationSchema>;
export type LinkedSocialAccount = z.infer<typeof LinkedSocialAccountSchema>;
