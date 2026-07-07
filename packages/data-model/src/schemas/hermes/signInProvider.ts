/**
 * Sign-in provider schemas (Lane C, Slice C1).
 *
 * SignInProviderId is deliberately a NEW closed enum, distinct from
 * spec-linked-socials-v0's SocialProviderId (`x | reddit | youtube |
 * tiktok | instagram | other`, see ./notification). The linked-social
 * enum has no `apple`/`google` and is scoped to the flag-gated
 * notification-card feature; sign-in records and sign-in session
 * material must never route through the linked-social schemas or
 * token vault.
 *
 * This module carries NON-SECRET display/account metadata only and is
 * exported from the data-model barrel. Sign-in session/token material
 * (provider subject, access/refresh tokens) is vault-only: it lives in
 * the dedicated identity-vault compartment
 * (packages/identity-vault/src/compartments/signInSession.ts). Any
 * future zod schema for that material must NOT be barrel-exported —
 * follow the ./notificationToken pattern (barrel exclusion + a
 * `signInProvider*` filename so it stays inside this module's
 * ownership glob family).
 *
 * Provider subjects and display labels are personal profile data
 * (spec-data-topology-privacy-v0 §3: vault/local-only). They are shown
 * only in local account UI and are never written to `vh/*` public
 * records nor published joined with any LUMA public id.
 */

import { z } from 'zod';

/** Closed sign-in provider set for the initial release. */
export const SignInProviderId = z.enum(['apple', 'google', 'x']);

export const SignInAccountStatus = z.enum(['signed-in', 'signed-out', 'expired']);

const PositiveTimestamp = z.number().int().nonnegative();

/**
 * Non-secret sign-in account record for the local account shell.
 * Strict: unknown keys (and any token-shaped material) are rejected.
 */
export const SignInAccountRecordSchema = z
  .object({
    schemaVersion: z.literal('sign-in-account-v1'),
    providerId: SignInProviderId,
    displayLabel: z.string().min(1).max(120).optional(),
    status: SignInAccountStatus,
    createdAt: PositiveTimestamp,
    updatedAt: PositiveTimestamp,
  })
  .strict();

export type SignInProviderIdType = z.infer<typeof SignInProviderId>;
export type SignInAccountStatusType = z.infer<typeof SignInAccountStatus>;
export type SignInAccountRecord = z.infer<typeof SignInAccountRecordSchema>;
