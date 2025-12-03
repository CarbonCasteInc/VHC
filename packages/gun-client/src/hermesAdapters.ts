import type { HermesMessage } from '@vh/types';
import { createGuardedChain, type ChainWithGet } from './chain';
import type { VennClient } from './index';

function inboxPath(identityKey: string): string {
  return `~${identityKey}/hermes/inbox/`;
}

function outboxPath(identityKey: string): string {
  return `~${identityKey}/hermes/outbox/`;
}

function chatPath(identityKey: string, channelId: string): string {
  return `~${identityKey}/hermes/chats/${channelId}/`;
}

export function getHermesInboxChain(client: VennClient, identityKey: string): ChainWithGet<HermesMessage> {
  const chain = client.gun
    .get(`~${identityKey}`)
    .get('hermes')
    .get('inbox') as unknown as ChainWithGet<HermesMessage>;

  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, inboxPath(identityKey));
}

export function getHermesOutboxChain(client: VennClient, identityKey: string): ChainWithGet<HermesMessage> {
  const chain = client.gun
    .get(`~${identityKey}`)
    .get('hermes')
    .get('outbox') as unknown as ChainWithGet<HermesMessage>;

  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, outboxPath(identityKey));
}

export function getHermesChatChain(
  client: VennClient,
  identityKey: string,
  channelId: string
): ChainWithGet<HermesMessage> {
  const chain = client.gun
    .get(`~${identityKey}`)
    .get('hermes')
    .get('chats')
    .get(channelId) as unknown as ChainWithGet<HermesMessage>;

  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, chatPath(identityKey, channelId));
}
