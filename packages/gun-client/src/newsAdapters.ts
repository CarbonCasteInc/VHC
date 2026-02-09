import type { StoryBundle } from '@vh/data-model';
import { createGuardedChain, type ChainWithGet } from './chain';
import type { VennClient } from './types';

function storyPath(storyId: string): string {
  return `vh/news/stories/${storyId}/`;
}

function latestIndexPath(): string {
  return 'vh/news/index/latest/';
}

// Wave 0 adapter stub. Team B will extend this API in B-4.
export function getNewsStoryChain(client: VennClient, storyId: string): ChainWithGet<StoryBundle> {
  const chain = client.mesh.get('news').get('stories').get(storyId) as unknown as ChainWithGet<StoryBundle>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, storyPath(storyId));
}

// Wave 0 adapter stub. Team B will extend this API in B-4.
export function getNewsLatestIndexChain(client: VennClient): ChainWithGet<Record<string, string>> {
  const chain = client.mesh.get('news').get('index').get('latest') as unknown as ChainWithGet<Record<string, string>>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, latestIndexPath());
}
