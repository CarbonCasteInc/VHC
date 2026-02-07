import { z } from 'zod';

/**
 * Delegation tier — controls what class of actions a familiar may perform.
 * Ordered by privilege: suggest < act < high-impact.
 */
export type DelegationTier = 'suggest' | 'act' | 'high-impact';

/**
 * Canonical scope strings from spec §6 tier definitions.
 * Each scope belongs to exactly one tier.
 */
export type DelegationScope =
  | 'draft'
  | 'triage'
  | 'analyze'
  | 'post'
  | 'comment'
  | 'share'
  | 'moderate'
  | 'vote'
  | 'fund'
  | 'civic_action';

export const DelegationTierSchema = z.enum(['suggest', 'act', 'high-impact']);
export const DelegationScopeSchema = z.enum([
  'draft',
  'triage',
  'analyze',
  'post',
  'comment',
  'share',
  'moderate',
  'vote',
  'fund',
  'civic_action'
]);

/**
 * Exhaustive mapping of each tier to its canonical scopes.
 * Every DelegationScope appears in exactly one tier.
 */
export const TIER_SCOPES: Record<DelegationTier, readonly DelegationScope[]> = {
  suggest: ['draft', 'triage'],
  act: ['analyze', 'post', 'comment', 'share'],
  'high-impact': ['moderate', 'vote', 'fund', 'civic_action']
} as const;

/** A registered familiar (delegated sub-process of a verified human). */
export interface FamiliarRecord {
  id: string;
  label: string;
  createdAt: number;
  revokedAt?: number;
  capabilityPreset: DelegationTier;
}

export const FamiliarRecordSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(256),
  createdAt: z.number().int().nonnegative(),
  revokedAt: z.number().int().nonnegative().optional(),
  capabilityPreset: DelegationTierSchema
});

/** A scoped delegation grant from a principal to a familiar. */
export interface DelegationGrant {
  grantId: string;
  principalNullifier: string;
  familiarId: string;
  scopes: DelegationScope[];
  issuedAt: number;
  expiresAt: number;
  signature: string;
}

export const DelegationGrantSchema = z.object({
  grantId: z.string().min(1),
  principalNullifier: z.string().min(1),
  familiarId: z.string().min(1),
  scopes: z.array(DelegationScopeSchema).min(1),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
  signature: z.string().min(1)
});

/** Assertion that an action is performed on behalf of a principal. */
export interface OnBehalfOfAssertion {
  principalNullifier: string;
  familiarId: string;
  grantId: string;
  issuedAt: number;
  signature: string;
}

export const OnBehalfOfAssertionSchema = z.object({
  principalNullifier: z.string().min(1),
  familiarId: z.string().min(1),
  grantId: z.string().min(1),
  issuedAt: z.number().int().nonnegative(),
  signature: z.string().min(1)
});
