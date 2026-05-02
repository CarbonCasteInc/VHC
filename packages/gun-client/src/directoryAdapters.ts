import type { DirectoryEntry } from '@vh/data-model';
import { createGuardedChain, type ChainWithGet } from './chain';
import { writeWithDurability } from './durableWrite';
import type { VennClient } from './types';

function directoryPath(nullifier: string): string {
  return `vh/directory/${nullifier}/`;
}

export function getDirectoryChain(client: VennClient, nullifier: string) {
  const chain = client.gun.get('vh').get('directory').get(nullifier) as unknown as ChainWithGet<DirectoryEntry>;
  return createGuardedChain(
    chain,
    client.hydrationBarrier,
    client.topologyGuard,
    directoryPath(nullifier),
  );
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
  return writeWithDurability({
      chain: getDirectoryChain(client, entry.nullifier) as unknown as ChainWithGet<DirectoryEntry>,
      value: entry,
      writeClass: 'directory',
      timeoutMs: DIRECTORY_PUT_ACK_TIMEOUT_MS,
      timeoutError: 'directory publish timed out and readback did not confirm persistence',
      onAckTimeout: () => console.warn('[vh:directory] publish ack timed out, requiring readback confirmation'),
      readback: () => lookupByNullifier(client, entry.nullifier),
      readbackPredicate: (observed) => {
        const candidate = observed as DirectoryEntry | null;
        return Boolean(
          candidate
          && candidate.nullifier === entry.nullifier
          && candidate.devicePub === entry.devicePub
          && candidate.epub === entry.epub
        );
      },
    })
    .then(() => undefined);
}
