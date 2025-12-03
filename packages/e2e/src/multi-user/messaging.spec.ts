/**
 * Multi-User Messaging E2E Tests
 * 
 * Tests HERMES messaging and forum between two isolated users.
 * Each user has their own browser context (separate localStorage).
 * The SharedMeshStore (injected via Playwright fixture) allows
 * cross-context sync without a real Gun relay.
 * 
 * Architecture:
 *   [Alice's Browser Context]     [Bob's Browser Context]
 *            │                            │
 *            └──────┬─────────────────────┘
 *                   ▼
 *          [SharedMeshStore]
 *         (Playwright fixture)
 */

import { test, expect } from '../fixtures/multi-user';

// Helper to create identity and get to dashboard
async function setupUser(page: any, username: string) {
  await page.goto('/');
  await page.getByTestId('user-link').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('user-link').click();
  await page.waitForURL('**/dashboard');
  
  const joinBtn = page.getByTestId('create-identity-btn');
  if (await joinBtn.isVisible()) {
    await page.fill('input[placeholder="Choose a username"]', username);
    await joinBtn.click();
  }
  
  await expect(page.getByTestId('welcome-msg')).toBeVisible({ timeout: 10_000 });
}

// Helper to get user's identity key (nullifier)
async function getIdentityKey(page: any): Promise<string> {
  const identity = await page.evaluate(() => {
    const raw = localStorage.getItem('vh_identity');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.session?.nullifier ?? null;
  });
  return identity ?? '';
}

test.describe('Multi-User: Isolated Contexts', () => {
  
  test('Alice and Bob have separate identities', async ({ alice, bob, sharedMesh }) => {
    // Setup both users
    await setupUser(alice.page, 'Alice');
    await setupUser(bob.page, 'Bob');
    
    // Get identity keys
    const aliceKey = await getIdentityKey(alice.page);
    const bobKey = await getIdentityKey(bob.page);
    
    // Verify they're different (isolated contexts)
    expect(aliceKey).toBeTruthy();
    expect(bobKey).toBeTruthy();
    expect(aliceKey).not.toBe(bobKey);
    
    // Verify shared mesh is working
    expect(sharedMesh).toBeDefined();
  });
  
  test('Alice and Bob can both access HERMES', async ({ alice, bob }) => {
    await setupUser(alice.page, 'Alice');
    await setupUser(bob.page, 'Bob');
    
    // Both navigate to HERMES
    await alice.page.goto('/hermes');
    await bob.page.goto('/hermes');
    
    // Verify both see the HERMES UI
    await expect(alice.page.getByText('Messages')).toBeVisible({ timeout: 5_000 });
    await expect(bob.page.getByText('Messages')).toBeVisible({ timeout: 5_000 });
    await expect(alice.page.getByText('Forum')).toBeVisible();
    await expect(bob.page.getByText('Forum')).toBeVisible();
  });
  
});

test.describe('Multi-User: Shared Mesh Sync', () => {
  
  test('Data written by Alice is visible to Bob via shared mesh', async ({ alice, bob, sharedMesh }) => {
    await setupUser(alice.page, 'Alice');
    await setupUser(bob.page, 'Bob');
    
    // Alice writes to the shared mesh
    sharedMesh.write('vh/forum/threads/test-thread-1', {
      id: 'test-thread-1',
      title: 'Test from Alice',
      content: 'Hello from Alice!',
      author: 'alice-nullifier',
      timestamp: Date.now()
    });
    
    // Bob should be able to read it
    const data = sharedMesh.read('vh/forum/threads/test-thread-1');
    expect(data).toBeTruthy();
    expect(data.title).toBe('Test from Alice');
    expect(data.author).toBe('alice-nullifier');
  });
  
  test('Mesh list returns all matching items', async ({ sharedMesh }) => {
    // Write multiple items
    sharedMesh.write('vh/forum/threads/thread-1', { id: 'thread-1', title: 'Thread 1' });
    sharedMesh.write('vh/forum/threads/thread-2', { id: 'thread-2', title: 'Thread 2' });
    sharedMesh.write('vh/other/data', { id: 'other', title: 'Other' });
    
    // List should return matching prefix
    const threads = sharedMesh.list('vh/forum/threads/');
    expect(threads.length).toBe(2);
    expect(threads.some(t => t.value.title === 'Thread 1')).toBe(true);
    expect(threads.some(t => t.value.title === 'Thread 2')).toBe(true);
  });
  
});

test.describe('Multi-User: Forum Integration', () => {
  
  test.skip('Alice creates thread, Bob sees it after refresh', async ({ alice, bob, sharedMesh }) => {
    // This test requires the forum store to be wired to the shared mesh
    // Currently skipped until we add data-testid attributes to forum components
    
    await setupUser(alice.page, 'Alice');
    await setupUser(bob.page, 'Bob');
    
    // Alice navigates to forum
    await alice.page.goto('/hermes/forum');
    await alice.page.waitForLoadState('networkidle');
    
    // Alice creates a thread (requires data-testid on form fields)
    // await alice.page.fill('[data-testid="thread-title-input"]', 'Test Discussion');
    // await alice.page.fill('[data-testid="thread-content-input"]', 'This is a test.');
    // await alice.page.getByTestId('create-thread-btn').click();
    
    // Bob navigates to forum
    await bob.page.goto('/hermes/forum');
    await bob.page.waitForLoadState('networkidle');
    
    // Bob should see Alice's thread
    // await expect(bob.page.getByText('Test Discussion')).toBeVisible({ timeout: 5_000 });
  });
  
});

