import type { DirectoryEntry } from '@vh/data-model';
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

export function publishToDirectory(client: VennClient, entry: DirectoryEntry): Promise<void> {
  return new Promise((resolve, reject) => {
    getDirectoryChain(client, entry.nullifier).put(entry, (ack?: { err?: string }) => {
      if (ack?.err) {
        reject(new Error(ack.err));
      } else {
        resolve();
      }
    });
  });
}
