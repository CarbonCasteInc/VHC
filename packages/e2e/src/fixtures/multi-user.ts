/**
 * Multi-User Test Fixture
 * 
 * Creates isolated browser contexts for each "user" to simulate
 * real multi-device scenarios where users have separate:
 * - localStorage
 * - sessionStorage  
 * - cookies
 * - IndexedDB
 * 
 * The shared mesh store allows cross-context "sync" for testing
 * without a real Gun relay.
 * 
 * Usage:
 *   test('Alice and Bob can message', async ({ alice, bob, sharedMesh }) => {
 *     await alice.page.goto('/');
 *     await bob.page.goto('/');
 *     // Both users share the same mesh state
 *   });
 */

import { test as base, type Page, type BrowserContext } from '@playwright/test';

/**
 * Shared mesh store that simulates Gun relay sync between contexts.
 * Data written by Alice is immediately visible to Bob.
 */
export class SharedMeshStore {
  private data: Map<string, any> = new Map();
  private subscribers: Map<string, Set<(data: any) => void>> = new Map();
  
  write(path: string, value: any): void {
    this.data.set(path, value);
    // Notify subscribers
    const subs = this.subscribers.get(path);
    if (subs) {
      subs.forEach(cb => cb(value));
    }
  }
  
  read(path: string): any {
    return this.data.get(path) ?? null;
  }
  
  list(prefix: string): Array<{ path: string; value: any }> {
    const results: Array<{ path: string; value: any }> = [];
    for (const [path, value] of this.data.entries()) {
      if (path.startsWith(prefix)) {
        results.push({ path, value });
      }
    }
    return results;
  }
  
  subscribe(path: string, callback: (data: any) => void): () => void {
    if (!this.subscribers.has(path)) {
      this.subscribers.set(path, new Set());
    }
    this.subscribers.get(path)!.add(callback);
    return () => {
      this.subscribers.get(path)?.delete(callback);
    };
  }
  
  clear(): void {
    this.data.clear();
    this.subscribers.clear();
  }
}

export interface UserFixture {
  context: BrowserContext;
  page: Page;
  name: string;
  /** Clean up localStorage for this user */
  clearState: () => Promise<void>;
}

export interface MultiUserFixtures {
  alice: UserFixture;
  bob: UserFixture;
  sharedMesh: SharedMeshStore;
}

async function createUser(
  browser: any,
  name: string,
  sharedMesh: SharedMeshStore
): Promise<UserFixture> {
  // Create isolated context - separate storage from other users
  const context = await browser.newContext({
    storageState: undefined,
  });
  
  const page = await context.newPage();
  
  // Add console logging for debugging
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' || text.includes('[vh:')) {
      console.log(`[${name}] ${text}`);
    }
  });
  
  page.on('pageerror', (err) => {
    console.error(`[${name}] PAGE ERROR: ${err.message}`);
  });

  // Expose shared mesh functions to the page
  // These will be used by the mock client when VITE_E2E_MULTI_USER=true
  await page.exposeFunction('__vhMeshWrite', (path: string, value: any) => {
    sharedMesh.write(path, value);
    return true;
  });
  
  await page.exposeFunction('__vhMeshRead', (path: string) => {
    return sharedMesh.read(path);
  });
  
  await page.exposeFunction('__vhMeshList', (prefix: string) => {
    return sharedMesh.list(prefix);
  });

  // Inject flag to tell the app to use shared mesh functions
  await page.addInitScript(() => {
    (window as any).__VH_USE_SHARED_MESH__ = true;
  });

  const clearState = async () => {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  };

  return { context, page, name, clearState };
}

export const test = base.extend<MultiUserFixtures>({
  sharedMesh: async ({}, use) => {
    const mesh = new SharedMeshStore();
    await use(mesh);
    mesh.clear();
  },
  
  alice: async ({ browser, sharedMesh }, use) => {
    const alice = await createUser(browser, 'Alice', sharedMesh);
    await use(alice);
    await alice.context.close();
  },
  
  bob: async ({ browser, sharedMesh }, use) => {
    const bob = await createUser(browser, 'Bob', sharedMesh);
    await use(bob);
    await bob.context.close();
  },
});

export { expect } from '@playwright/test';

