import { z } from 'zod';

export const DelegationSigningPublicKeySchema = z.object({
  signatureSuite: z.literal('jcs-ed25519-sha256-v1'),
  publicKey: z.object({
    encoding: z.literal('base64url'),
    material: z.string().min(1)
  }).strict(),
  createdAt: z.number().int().nonnegative()
}).strict();

export const DirectoryEntrySchema = z.object({
  schemaVersion: z.literal('hermes-directory-v0'),
  nullifier: z.string().min(1),
  devicePub: z.string().min(1),
  epub: z.string().min(1),
  displayName: z.string().optional(),
  delegationSigningPublicKey: DelegationSigningPublicKeySchema.optional(),
  registeredAt: z.number(),
  lastSeenAt: z.number()
});

export type DelegationSigningPublicKey = z.infer<typeof DelegationSigningPublicKeySchema>;
export type DirectoryEntry = z.infer<typeof DirectoryEntrySchema>;
