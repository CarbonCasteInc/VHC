import type { DirectoryEntry } from '@vh/data-model';
import { putWithAckTimeout, type ChainWithGet } from './chain';
import type { VennClient } from './types';

export function getDirectoryChain(client: VennClient, nullifier: string) {
  return client.gun.get('vh').get('directory').get(nullifier);
}

export async function lookupByNullifier(client: VennClient, nullifier: string): Promise<DirectoryEntry | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 3000);
    getDirectoryChain(client, nullifier).once((data) => {
      clearTimeout(timeout);
      if (data && typeof data === 'object' && 'devicePub' in data) {
        resolve(data as DirectoryEntry);
      } else {
        resolve(null);
      }
    });
  });
}

const DIRECTORY_PUT_ACK_TIMEOUT_MS = 1000;

export function publishToDirectory(client: VennClient, entry: DirectoryEntry): Promise<void> {
  return putWithAckTimeout(
    getDirectoryChain(client, entry.nullifier) as unknown as ChainWithGet<DirectoryEntry>,
    entry,
    {
      timeoutMs: DIRECTORY_PUT_ACK_TIMEOUT_MS,
      onTimeout: () => console.warn('[vh:directory] publish ack timed out, proceeding without ack'),
    },
  ).then(() => undefined);
}
