import type { HermesMessage } from '@vh/types';
import { createGuardedChain, type ChainWithGet } from './chain';
import type { VennClient } from './types';

function inboxPath(devicePub: string): string {
  return `vh/hermes/inbox/${devicePub}/`;
}

function outboxPath(client: VennClient): string {
  const pub = (client.gun.user() as any)?.is?.pub ?? 'unknown';
  return `~${pub}/hermes/outbox/`;
}

function chatPath(client: VennClient, channelId: string): string {
  const pub = (client.gun.user() as any)?.is?.pub ?? 'unknown';
  return `~${pub}/hermes/chats/${channelId}/`;
}

export function getHermesInboxChain(client: VennClient, devicePub: string): ChainWithGet<HermesMessage> {
  const chain = client.gun
    .get('vh')
    .get('hermes')
    .get('inbox')
    .get(devicePub) as unknown as ChainWithGet<HermesMessage>;

  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, inboxPath(devicePub));
}

export function getHermesOutboxChain(client: VennClient): ChainWithGet<HermesMessage> {
  const chain = (client.gun.user() as any)
    .get('hermes')
    .get('outbox') as unknown as ChainWithGet<HermesMessage>;

  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, outboxPath(client));
}

export function getHermesChatChain(client: VennClient, channelId: string): ChainWithGet<HermesMessage> {
  const chain = (client.gun.user() as any)
    .get('hermes')
    .get('chats')
    .get(channelId) as unknown as ChainWithGet<HermesMessage>;

  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, chatPath(client, channelId));
}
