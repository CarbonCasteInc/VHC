/**
 * IndexedDB helpers for the identity vault.
 * Handles open/get/put/delete with lazy database creation.
 */

import { DB_NAME, VAULT_STORE, KEYS_STORE } from './types';

/** Open (or create) the vault database. */
export function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VAULT_STORE)) {
        db.createObjectStore(VAULT_STORE);
      }
      if (!db.objectStoreNames.contains(KEYS_STORE)) {
        db.createObjectStore(KEYS_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    /* v8 ignore next */
    request.onerror = () => reject(request.error);
  });
}

/** Get a value from an object store by key. */
export function idbGet<T>(db: IDBDatabase, storeName: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    /* v8 ignore next */
    request.onerror = () => reject(request.error);
  });
}

/** Put a value into an object store. */
export function idbPut(db: IDBDatabase, storeName: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.put(value, key);
    request.onsuccess = () => resolve();
    /* v8 ignore next */
    request.onerror = () => reject(request.error);
  });
}

/** Delete a value from an object store. */
export function idbDelete(db: IDBDatabase, storeName: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    /* v8 ignore next */
    request.onerror = () => reject(request.error);
  });
}
