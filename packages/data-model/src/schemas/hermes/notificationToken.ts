/**
 * OAuth Token Record schema (vault-only).
 *
 * SECURITY: This file is intentionally NOT exported from the
 * data-model barrel (index.ts). Import directly from this path
 * only in vault-access code.
 *
 * Named notificationToken.ts to sit under the notification* ownership
 * glob while keeping a distinct module boundary from the public
 * notification schema.
 *
 * See spec-linked-socials-v0.md §2 storage rule.
 */

import { z } from 'zod';
import { SocialProviderId } from './notification';

export const OAuthTokenRecordSchema = z
  .object({
    providerId: SocialProviderId,
    accountId: z.string().min(1),
    accessToken: z.string().min(1),
    refreshToken: z.string().optional(),
    expiresAt: z.number().int().nonnegative().optional(),
    scopes: z.array(z.string()),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

export type OAuthTokenRecord = z.infer<typeof OAuthTokenRecordSchema>;
