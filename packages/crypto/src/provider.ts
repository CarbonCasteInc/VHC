export interface CryptoProvider {
  subtle: SubtleCrypto;
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

let cachedProvider: CryptoProvider | null = null;

function hasBrowserCrypto(candidate: unknown): candidate is CryptoProvider {
  if (!candidate) return false;
  if (typeof candidate !== 'object') return false;
  return (
    typeof (candidate as CryptoProvider).getRandomValues === 'function' &&
    typeof (candidate as CryptoProvider).subtle !== 'undefined'
  );
}

export async function getWebCrypto(): Promise<CryptoProvider> {
  if (cachedProvider) {
    return cachedProvider;
  }

  const globalCrypto =
    typeof globalThis !== 'undefined'
      ? (globalThis as typeof globalThis & { crypto?: Crypto }).crypto
      : undefined;

  if (globalCrypto && hasBrowserCrypto(globalCrypto)) {
    cachedProvider = globalCrypto as CryptoProvider;
    return cachedProvider;
  }

  const nodeCrypto = await import('node:crypto');
  cachedProvider = nodeCrypto.webcrypto as unknown as CryptoProvider;
  return cachedProvider;
}
