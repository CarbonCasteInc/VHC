import { readNewsStoryline, type VennClient } from '@vh/gun-client';
import type { StoryBundle, StorylineGroup } from '@vh/data-model';

function storylineIdsForStories(
  stories: ReadonlyArray<StoryBundle>,
): string[] {
  return [...new Set(
    stories
      .map((story) => story.storyline_id?.trim())
      .filter((storylineId): storylineId is string => Boolean(storylineId)),
  )].sort();
}

export async function loadStorylinesForStories(
  client: VennClient,
  stories: ReadonlyArray<StoryBundle>,
): Promise<StorylineGroup[]> {
  const storylineIds = storylineIdsForStories(stories);
  if (storylineIds.length === 0) {
    return [];
  }

  const storylines = await Promise.all(
    storylineIds.map((storylineId) => readNewsStoryline(client, storylineId)),
  );

  return storylines.filter((storyline): storyline is StorylineGroup => storyline !== null);
}

export const newsStorylineInternal = {
  storylineIdsForStories,
};
