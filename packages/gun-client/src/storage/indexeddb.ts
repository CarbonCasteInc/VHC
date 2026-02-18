import { openDB, type IDBPDatabase } from 'idb';
import { aesDecrypt, aesEncrypt, deriveKey } from '@vh/crypto';
import type { StorageRecord } from './types';
import type { HydrationBarrier } from '../sync/barrier';

const DB_NAME = 'vh_encrypted_graph';
const STORE_NAME = 'vh_graph_nodes';

/**
 * Root encryption secret and salt sourced from environment variables.
 * Falls back to dev defaults ONLY when no env var is set.
 *
 * Production deployments MUST set VITE_IDB_ROOT_SECRET and VITE_IDB_ROOT_SALT.
 * The dev defaults are intentionally weak and unsuitable for real user data.
 */
const ROOT_SECRET: string =
  (import.meta as any).env?.VITE_IDB_ROOT_SECRET
    ?? (typeof process !== 'undefined' ? process.env.VITE_IDB_ROOT_SECRET : undefined)
    ?? 'vh-dev-root-secret';
const ROOT_SALT: string =
  (import.meta as any).env?.VITE_IDB_ROOT_SALT
    ?? (typeof process !== 'undefined' ? process.env.VITE_IDB_ROOT_SALT : undefined)
    ?? 'vh-dev-root-salt';
const textDecoder = new TextDecoder();

type NodePayload = {
  iv: Uint8Array;
  ciphertext: Uint8Array;
  updatedAt: number;
};

type GraphDB = IDBPDatabase;

export function hasIndexedDBSupport(): boolean {
  return typeof indexedDB !== 'undefined';
}

export class EncryptedIndexedDBAdapter {
  readonly backend = 'indexeddb' as const;
  #dbPromise: Promise<GraphDB>;
  #rootKeyPromise: Promise<Uint8Array>;

  constructor(private readonly barrier?: HydrationBarrier) {
    this.#dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      }
    });
    this.#rootKeyPromise = deriveKey(ROOT_SECRET, ROOT_SALT);
  }

  async hydrate(): Promise<void> {
    await this.#dbPromise;
    this.barrier?.markReady();
  }

  async write<T>(record: StorageRecord<T>): Promise<void> {
    const db = await this.#dbPromise;
    const key = await this.#rootKeyPromise;
    const payload = typeof record.value === 'string' ? record.value : JSON.stringify(record.value);
    const { iv, ciphertext } = await aesEncrypt(payload, key);

    await db.put(STORE_NAME, {
      iv,
      ciphertext,
      updatedAt: record.updatedAt ?? Date.now()
    }, record.key);
  }

  async read<T>(key: string): Promise<StorageRecord<T> | null> {
    const db = await this.#dbPromise;
    const entry = (await db.get(STORE_NAME, key)) as NodePayload | undefined;
    if (!entry) {
      return null;
    }

    const rootKey = await this.#rootKeyPromise;
    const decrypted = await aesDecrypt(entry.iv, entry.ciphertext, rootKey);
    const decoded = textDecoder.decode(decrypted);

    let value: T;
    try {
      value = JSON.parse(decoded) as T;
    } catch {
      value = decoded as unknown as T;
    }

    return {
      key,
      value,
      updatedAt: entry.updatedAt
    };
  }

  async close(): Promise<void> {
    const db = await this.#dbPromise;
    db.close();
  }
}

export {
  DB_NAME as ENCRYPTED_DB_NAME,
  STORE_NAME as ENCRYPTED_STORE_NAME,
  ROOT_SECRET as _ROOT_SECRET_FOR_TESTING,
  ROOT_SALT as _ROOT_SALT_FOR_TESTING,
};
