import { z } from 'zod';

// Wave 0 contract stub. Wave 2 will tighten schema details.
export const SocialNotificationSchema = z
  .object({
    id: z.string().min(1),
    accountId: z.string().min(1),
    platform: z.string().min(1),
    message: z.string().min(1),
    url: z.string().url().optional(),
    createdAt: z.number().int().nonnegative()
  })
  .passthrough();

// Wave 0 contract stub. Wave 2 will tighten schema details.
export const LinkedSocialAccountSchema = z
  .object({
    id: z.string().min(1),
    platform: z.string().min(1),
    handle: z.string().min(1),
    connectedAt: z.number().int().nonnegative()
  })
  .passthrough();

export type SocialNotification = z.infer<typeof SocialNotificationSchema>;
export type LinkedSocialAccount = z.infer<typeof LinkedSocialAccountSchema>;
