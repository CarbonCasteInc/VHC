import { z } from 'zod';

// Wave 0 contract stub. Team C will tighten schema details in C-1.
export const FeedKindSchema = z.enum(['news', 'topic', 'social']);

// Wave 0 contract stub. Team C will tighten schema details in C-1.
export const FeedItemSchema = z
  .object({
    id: z.string().min(1),
    kind: FeedKindSchema,
    title: z.string().min(1),
    score: z.number().default(0),
    timestamp: z.number().int().nonnegative(),
    payload: z.record(z.unknown()).optional()
  })
  .passthrough();

export type FeedKind = z.infer<typeof FeedKindSchema>;
export type FeedItem = z.infer<typeof FeedItemSchema>;
