import { z } from 'zod';
import { StoryBundleSourceSchema } from './storyBundle';

export const STORYLINE_GROUP_VERSION = 'storyline-group-v0' as const;

export const StorylineGroupSchema = z.object({
  schemaVersion: z.literal(STORYLINE_GROUP_VERSION),
  storyline_id: z.string().min(1),
  topic_id: z.string().min(1),
  canonical_story_id: z.string().min(1),
  story_ids: z.array(z.string().min(1)).min(1),
  headline: z.string().min(1),
  summary_hint: z.string().optional(),
  related_coverage: z.array(StoryBundleSourceSchema),
  entity_keys: z.array(z.string().min(1)),
  time_bucket: z.string().min(1),
  created_at: z.number(),
  updated_at: z.number(),
});
export type StorylineGroup = z.infer<typeof StorylineGroupSchema>;
