import { createGuardedChain, type ChainWithGet } from './chain';
import type { VennClient } from './types';

/**
 * Gun adapters for HERMES Docs paths (spec-hermes-docs-v0 §5.1).
 *
 * Topology:
 *   ~<devicePub>/hermes/docs             — user's document list
 *   ~<devicePub>/hermes/docs/<docId>      — document metadata + encrypted content
 *   ~<devicePub>/docs/<docId>/ops/<opId>  — encrypted CRDT operations
 *   ~<devicePub>/hermes/docKeys/<docId>   — received document keys
 *   vh/topics/<topicId>/articles/<articleId> — published article (public)
 */

function userDocsPath(client: VennClient): string {
  const pub = (client.gun.user() as any)?.is?.pub ?? 'unknown';
  return `~${pub}/hermes/docs/`;
}

function docPath(client: VennClient, docId: string): string {
  const pub = (client.gun.user() as any)?.is?.pub ?? 'unknown';
  return `~${pub}/hermes/docs/${docId}/`;
}

function docOpsPath(client: VennClient, docId: string): string {
  const pub = (client.gun.user() as any)?.is?.pub ?? 'unknown';
  return `~${pub}/docs/${docId}/ops/`;
}

function docKeysPath(client: VennClient, docId: string): string {
  const pub = (client.gun.user() as any)?.is?.pub ?? 'unknown';
  return `~${pub}/hermes/docKeys/${docId}/`;
}

function articlePath(topicId: string, articleId: string): string {
  return `vh/topics/${topicId}/articles/${articleId}/`;
}

/**
 * Chain for user's document list: `~<devicePub>/hermes/docs`.
 * Used to enumerate all documents belonging to the current user.
 */
export function getUserDocsChain<T = Record<string, unknown>>(client: VennClient): ChainWithGet<T> {
  const chain = (client.gun.user() as any)
    .get('hermes')
    .get('docs') as unknown as ChainWithGet<T>;

  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, userDocsPath(client));
}

/**
 * Chain for a single document: `~<devicePub>/hermes/docs/<docId>`.
 * Stores document metadata and encrypted content.
 */
export function getDocsChain<T = Record<string, unknown>>(client: VennClient, docId: string): ChainWithGet<T> {
  const chain = (client.gun.user() as any)
    .get('hermes')
    .get('docs')
    .get(docId) as unknown as ChainWithGet<T>;

  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, docPath(client, docId));
}

/**
 * Chain for CRDT operations: `~<devicePub>/docs/<docId>/ops`.
 * Stores encrypted Yjs deltas keyed by operation ID.
 */
export function getDocsOpsChain<T = Record<string, unknown>>(client: VennClient, docId: string): ChainWithGet<T> {
  const chain = (client.gun.user() as any)
    .get('docs')
    .get(docId)
    .get('ops') as unknown as ChainWithGet<T>;

  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, docOpsPath(client, docId));
}

/**
 * Chain for document key shares: `~<devicePub>/hermes/docKeys/<docId>`.
 * Stores received encrypted document keys per collaborator.
 */
export function getDocKeysChain<T = Record<string, unknown>>(client: VennClient, docId: string): ChainWithGet<T> {
  const chain = (client.gun.user() as any)
    .get('hermes')
    .get('docKeys')
    .get(docId) as unknown as ChainWithGet<T>;

  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, docKeysPath(client, docId));
}

/**
 * Chain for a published article: `vh/topics/<topicId>/articles/<articleId>`.
 * Public path for articles published from docs.
 */
export function getArticleChain<T = Record<string, unknown>>(
  client: VennClient,
  topicId: string,
  articleId: string
): ChainWithGet<T> {
  const chain = client.mesh
    .get('topics')
    .get(topicId)
    .get('articles')
    .get(articleId) as unknown as ChainWithGet<T>;

  return createGuardedChain(
    chain,
    client.hydrationBarrier,
    client.topologyGuard,
    articlePath(topicId, articleId)
  );
}
