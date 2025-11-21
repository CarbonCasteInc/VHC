export interface StorageRecord<T = unknown> {
  key: string;
  value: T;
  updatedAt: number;
}

export interface StorageAdapter {
  backend: 'localStorage' | 'memory';
  hydrate(): Promise<void>;
  write<T>(record: StorageRecord<T>): Promise<void>;
  read<T>(key: string): Promise<StorageRecord<T> | null>;
  close(): Promise<void>;
}

type PersistedRecord<T> = {
  value: T;
  updatedAt: number;
};

class LocalStorageAdapter implements StorageAdapter {
  readonly backend = 'localStorage' as const;

  constructor(private readonly storage: Storage) {}

  async hydrate(): Promise<void> {
    // localStorage is synchronous but we retain a Promise for interface symmetry.
  }

  async write<T>(record: StorageRecord<T>): Promise<void> {
    const payload: PersistedRecord<T> = {
      value: record.value,
      updatedAt: record.updatedAt
    };
    this.storage.setItem(record.key, JSON.stringify(payload));
  }

  async read<T>(key: string): Promise<StorageRecord<T> | null> {
    const raw = this.storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedRecord<T>>;
    return {
      key,
      value: parsed.value as T,
      updatedAt: parsed.updatedAt ?? Date.now()
    };
  }

  async close(): Promise<void> {
    // Nothing to tear down for localStorage.
  }
}

class MemoryStorageAdapter implements StorageAdapter {
  readonly backend = 'memory' as const;
  private readonly store = new Map<string, StorageRecord>();

  async hydrate(): Promise<void> {
    // Memory store is empty until writes occur.
  }

  async write<T>(record: StorageRecord<T>): Promise<void> {
    this.store.set(record.key, {
      key: record.key,
      value: record.value,
      updatedAt: record.updatedAt
    });
  }

  async read<T>(key: string): Promise<StorageRecord<T> | null> {
    const value = this.store.get(key);
    return (value as StorageRecord<T>) ?? null;
  }

  async close(): Promise<void> {
    this.store.clear();
  }
}

function getBrowserStorage(): Storage | null {
  if (typeof globalThis === 'undefined') return null;
  const candidate = (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage;
  if (!candidate) return null;
  try {
    const probeKey = '__vh_probe__';
    candidate.setItem(probeKey, '1');
    candidate.removeItem(probeKey);
    return candidate;
  } catch {
    return null;
  }
}

export function createStorageAdapter(): StorageAdapter {
  const browserStorage = getBrowserStorage();
  if (browserStorage) {
    return new LocalStorageAdapter(browserStorage);
  }

  // Node/Radisk fallback: rely on Gun's in-process storage until IndexedDB encryption lands.
  return new MemoryStorageAdapter();
}
