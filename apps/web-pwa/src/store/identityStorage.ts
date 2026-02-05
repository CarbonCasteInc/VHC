export type IdentityStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'clear'>;

function createMemoryStorage(): IdentityStorage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    }
  };
}

const fallbackStorage = createMemoryStorage();

export function getIdentityStorage(): IdentityStorage {
  const candidate = (globalThis as any).localStorage as IdentityStorage | undefined;
  if (candidate && typeof candidate.getItem === 'function') {
    return candidate;
  }
  return fallbackStorage;
}
