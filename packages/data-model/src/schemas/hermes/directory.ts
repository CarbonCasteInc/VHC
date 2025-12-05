import { z } from 'zod';

export const DirectoryEntrySchema = z.object({
  schemaVersion: z.literal('hermes-directory-v0'),
  nullifier: z.string().min(1),
  devicePub: z.string().min(1),
  epub: z.string().min(1),
  displayName: z.string().optional(),
  registeredAt: z.number(),
  lastSeenAt: z.number()
});

export type DirectoryEntry = z.infer<typeof DirectoryEntrySchema>;
