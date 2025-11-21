import type { StorageAdapter } from './storage/adapter';

export interface VennClientConfig {
  peers?: string[];
  storage?: StorageAdapter;
}

export interface Namespace<T = unknown> {
  read(): Promise<T | null>;
  write(value: T): Promise<void>;
}

export interface VennClientScopes {
  user: Namespace<Record<string, unknown>>;
  chat: Namespace<Record<string, unknown>>;
  outbox: Namespace<Record<string, unknown>>;
}
