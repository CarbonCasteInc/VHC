import { z } from 'zod';

// Wave 0 contract stub. Team B will tighten schema details in B-1.
export const RawFeedItemSchema = z.object({}).passthrough();

// Wave 0 contract stub. Team B will tighten schema details in B-1.
export const FeedSourceSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    url: z.string().url().optional()
  })
  .passthrough();

// Wave 0 contract stub. Team B will tighten schema details in B-1.
export const StoryBundleSchema = z
  .object({
    story_id: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().optional(),
    links: z.array(z.string().url()).default([]),
    sources: z.array(FeedSourceSchema).default([]),
    items: z.array(RawFeedItemSchema).default([]),
    published_at: z.number().int().nonnegative().optional()
  })
  .passthrough();

export type RawFeedItem = z.infer<typeof RawFeedItemSchema>;
export type FeedSource = z.infer<typeof FeedSourceSchema>;
export type StoryBundle = z.infer<typeof StoryBundleSchema>;
