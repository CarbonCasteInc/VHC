export interface CryptoProvider {
  subtle: SubtleCrypto;
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

let cachedProvider: CryptoProvider | null = null;

export async function getWebCrypto(): Promise<CryptoProvider> {
  if (cachedProvider) {
    return cachedProvider;
  }

  const globalCrypto = (globalThis as typeof globalThis & { crypto?: Crypto }).crypto;

  if (
    globalCrypto &&
    typeof (globalCrypto as CryptoProvider).getRandomValues === 'function' &&
    typeof (globalCrypto as CryptoProvider).subtle !== 'undefined'
  ) {
    cachedProvider = globalCrypto as CryptoProvider;
    return cachedProvider;
  }

  const isNode =
    typeof process !== 'undefined' &&
    typeof process.versions === 'object' &&
    typeof (process.versions as Record<string, unknown>).node === 'string';

  if (isNode) {
    const moduleId = 'node:crypto';
    const nodeCrypto = await import(/* @vite-ignore */ moduleId);
    cachedProvider = nodeCrypto.webcrypto as unknown as CryptoProvider;
    return cachedProvider;
  }

  throw new Error('WebCrypto is not available in this environment');
}
