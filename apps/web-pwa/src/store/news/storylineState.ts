import type { StoryBundle, StorylineGroup } from '@vh/data-model';

export function createStorylineRecord(
  storylines: ReadonlyArray<StorylineGroup>,
): Readonly<Record<string, StorylineGroup>> {
  return Object.fromEntries(
    storylines.map((storyline) => [storyline.storyline_id, storyline]),
  );
}

export function removeOrphanedStoryline(
  storylinesById: Readonly<Record<string, StorylineGroup>>,
  stories: ReadonlyArray<StoryBundle>,
  storylineId: string | undefined,
): Readonly<Record<string, StorylineGroup>> {
  const normalizedId = storylineId?.trim();
  if (!normalizedId || stories.some((story) => story.storyline_id === normalizedId)) {
    return storylinesById;
  }

  if (!(normalizedId in storylinesById)) {
    return storylinesById;
  }

  const nextStorylines = { ...storylinesById };
  delete nextStorylines[normalizedId];
  return nextStorylines;
}
