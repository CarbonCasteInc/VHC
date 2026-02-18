/**
 * Tests for EncryptedIndexedDBAdapter and root secret configuration.
 *
 * B7 Beta Readiness fix: verifies that the root encryption secret and salt
 * are sourced from environment variables, with dev defaults only as fallback.
 */
import { describe, expect, it } from 'vitest';
import {
  hasIndexedDBSupport,
  _ROOT_SECRET_FOR_TESTING,
  _ROOT_SALT_FOR_TESTING,
  ENCRYPTED_DB_NAME,
  ENCRYPTED_STORE_NAME,
} from './indexeddb';

describe('indexeddb storage config', () => {
  it('hasIndexedDBSupport returns boolean', () => {
    const result = hasIndexedDBSupport();
    expect(typeof result).toBe('boolean');
  });

  it('DB_NAME and STORE_NAME are non-empty strings', () => {
    expect(ENCRYPTED_DB_NAME).toBe('vh_encrypted_graph');
    expect(ENCRYPTED_STORE_NAME).toBe('vh_graph_nodes');
  });
});

describe('B7: root secret environment sourcing', () => {
  it('ROOT_SECRET is a non-empty string', () => {
    expect(typeof _ROOT_SECRET_FOR_TESTING).toBe('string');
    expect(_ROOT_SECRET_FOR_TESTING.length).toBeGreaterThan(0);
  });

  it('ROOT_SALT is a non-empty string', () => {
    expect(typeof _ROOT_SALT_FOR_TESTING).toBe('string');
    expect(_ROOT_SALT_FOR_TESTING.length).toBeGreaterThan(0);
  });

  it('falls back to dev defaults when env vars are not set', () => {
    // In test environment, VITE_IDB_ROOT_SECRET is not set,
    // so the fallback dev defaults should be used
    expect(_ROOT_SECRET_FOR_TESTING).toBe('vh-dev-root-secret');
    expect(_ROOT_SALT_FOR_TESTING).toBe('vh-dev-root-salt');
  });

  it('dev defaults are clearly identifiable as non-production values', () => {
    // Dev defaults contain 'dev' to signal they are not production-grade
    expect(_ROOT_SECRET_FOR_TESTING).toContain('dev');
    expect(_ROOT_SALT_FOR_TESTING).toContain('dev');
  });
});
