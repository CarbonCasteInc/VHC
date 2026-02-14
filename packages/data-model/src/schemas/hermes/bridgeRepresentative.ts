import { z } from 'zod';

/**
 * Representative schema — elected officials and contacts for civic outreach.
 * Spec: spec-civic-action-kit-v0.md §2.2
 */
export const RepresentativeSchema = z
  .object({
    id: z.string().min(1),

    // identity
    name: z.string().min(1),
    title: z.string().min(1),
    party: z.string().optional(),

    // jurisdiction
    office: z.enum(['senate', 'house', 'state', 'local']),
    country: z.string().min(2).max(3),
    state: z.string().min(2).max(2).optional(),
    district: z.string().optional(),
    districtHash: z.string().min(1),

    // contact
    contactMethod: z.enum(['email', 'phone', 'both', 'manual']),
    contactUrl: z.string().url().optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    website: z.string().url().optional(),

    // metadata
    photoUrl: z.string().url().optional(),
    socialHandles: z.record(z.string(), z.string()).optional(),
    lastVerified: z.number().int().nonnegative(),
  })
  .strict();

/**
 * Representative directory — bundled snapshot for offline startup.
 * Spec: spec-civic-action-kit-v0.md §3.1
 */
export const RepresentativeDirectorySchema = z
  .object({
    version: z.string().min(1),
    lastUpdated: z.number().int().nonnegative(),
    updateSource: z.string().min(1),

    representatives: z.array(RepresentativeSchema),

    byState: z.record(z.string(), z.array(z.string())),
    byDistrictHash: z.record(z.string(), z.array(z.string())),
  })
  .strict();

export type Representative = z.infer<typeof RepresentativeSchema>;
export type RepresentativeDirectory = z.infer<typeof RepresentativeDirectorySchema>;
