import type { VennClient } from '@vh/gun-client';

type ClientResolver = () => VennClient | null;

let clientResolver: ClientResolver = () => null;

export function setClientResolver(nextResolver: ClientResolver): void {
  clientResolver = nextResolver;
}

export function resolveClientFromAppStore(): VennClient | null {
  return clientResolver();
}
