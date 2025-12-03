import type { HermesComment, HermesThread } from '@vh/types';
import { createGuardedChain, type ChainWithGet } from './chain';
import type { VennClient } from './index';

function threadPath(threadId: string): string {
  return `vh/forum/threads/${threadId}/`;
}

function commentsPath(threadId: string): string {
  return `vh/forum/threads/${threadId}/comments/`;
}

function dateIndexPath(): string {
  return 'vh/forum/indexes/date/';
}

function tagIndexPath(tag: string): string {
  return `vh/forum/indexes/tags/${tag}/`;
}

export function getForumThreadChain(client: VennClient, threadId: string): ChainWithGet<HermesThread> {
  const chain = client.mesh.get('forum').get('threads').get(threadId) as unknown as ChainWithGet<HermesThread>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, threadPath(threadId));
}

export function getForumCommentsChain(client: VennClient, threadId: string): ChainWithGet<HermesComment> {
  const chain = client.mesh
    .get('forum')
    .get('threads')
    .get(threadId)
    .get('comments') as unknown as ChainWithGet<HermesComment>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, commentsPath(threadId));
}

export function getForumDateIndexChain(client: VennClient): ChainWithGet<Record<string, string>> {
  const chain = client.mesh.get('forum').get('indexes').get('date') as unknown as ChainWithGet<Record<string, string>>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, dateIndexPath());
}

export function getForumTagIndexChain(client: VennClient, tag: string): ChainWithGet<Record<string, string>> {
  const chain = client.mesh
    .get('forum')
    .get('indexes')
    .get('tags')
    .get(tag) as unknown as ChainWithGet<Record<string, string>>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, tagIndexPath(tag));
}
