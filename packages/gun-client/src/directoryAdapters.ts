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

const DIRECTORY_PUT_ACK_TIMEOUT_MS = 1000;

export function publishToDirectory(client: VennClient, entry: DirectoryEntry): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn('[vh:directory] publish ack timed out, proceeding without ack');
      resolve();
    }, DIRECTORY_PUT_ACK_TIMEOUT_MS);

    // Gun's put callback type is complex; cast to any for compatibility
    getDirectoryChain(client, entry.nullifier).put(entry as any, ((ack: { err?: string } | undefined) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (ack?.err) {
        reject(new Error(ack.err));
      } else {
        resolve();
      }
    }) as any);
  });
}
