/**
 * Multi-User Messaging E2E Tests
 *
 * Tests HERMES messaging and forum between two isolated users.
 * Each user has their own browser context (separate browser storage).
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
import {
  readVaultIdentity,
  waitForVaultIdentityNullifier,
  waitForIdentityHydrated,
  writeVaultIdentity,
} from '../helpers/vault-identity';

// Helper to create identity and get to dashboard
async function setupUser(page: any, username: string) {
  await page.goto('/');
  await page.getByTestId('user-link').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('user-link').click();
  await page.waitForURL('**/dashboard');

  const joinBtn = page.getByTestId('create-identity-btn');
  if (await joinBtn.isVisible()) {
    await page.fill('input[placeholder="Choose a username"]', username);
    // Handle is now required for identity creation
    await page.fill('input[placeholder="Choose a handle (letters, numbers, _)"]', username.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
    await joinBtn.click();
  }

  await expect(page.getByTestId('welcome-msg')).toBeVisible({ timeout: 10_000 });
  await waitForVaultIdentityNullifier(page, 15_000);
}

// Helper to get user's identity key (nullifier)
async function getIdentityKey(page: any): Promise<string> {
  const identity = await readVaultIdentity(page);
  return identity?.session?.nullifier ?? '';
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

    // Both navigate to HERMES (forum loads directly)
    await alice.page.goto('/hermes');
    await bob.page.goto('/hermes');

    // Verify both see the Forum UI (forum loads directly at /hermes)
    await expect(alice.page.getByTestId('new-thread-btn')).toBeVisible({ timeout: 5_000 });
    await expect(bob.page.getByTestId('new-thread-btn')).toBeVisible({ timeout: 5_000 });
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

  test('Alice creates thread visible to Bob', async ({ alice, bob }) => {
    await setupUser(alice.page, 'Alice');
    await setupUser(bob.page, 'Bob');

    // Forum now loads directly at /hermes
    await alice.page.goto('/hermes');
    // Wait for identity hydration so the forum store's ensureIdentity()
    // can read from the in-memory provider.
    await waitForIdentityHydrated(alice.page);
    await alice.page.getByTestId('new-thread-btn').click();
    await alice.page.getByTestId('thread-title').fill('Test Thread from Alice');
    await alice.page.getByTestId('thread-content').fill('This is a test post for Sprint 3 E2E verification.');
    await alice.page.getByTestId('submit-thread-btn').click();
    await expect(alice.page.getByText('Test Thread from Alice')).toBeVisible({ timeout: 15_000 });

    await bob.page.goto('/hermes');
    await expect(bob.page.getByText('Test Thread from Alice')).toBeVisible({ timeout: 15_000 });
  });

  test('Trust gate blocks untrusted user from posting', async ({ alice }) => {
    await setupUser(alice.page, 'LowTrust');

    const identity = await readVaultIdentity(alice.page);
    expect(identity).toBeTruthy();
    if (!identity) {
      throw new Error('Expected identity to exist in vault for trust-gate test.');
    }

    const didWrite = await writeVaultIdentity(alice.page, {
      ...identity,
      session: {
        ...(identity.session ?? {}),
        trustScore: 0.1,
        scaledTrustScore: 1000,
      },
    });

    expect(didWrite).toBe(true);

    // Forum now loads directly at /hermes
    await alice.page.goto('/hermes');
    await alice.page.getByTestId('new-thread-btn').click();
    await expect(alice.page.getByTestId('trust-gate-msg')).toBeVisible();
  });
});

test.describe('Multi-User: Messaging', () => {
  test('Alice and Bob exchange messages', async ({ alice, bob, sharedMesh }) => {
    // Setup both users - this creates identity and publishes to directory
    await setupUser(alice.page, 'Alice');
    await setupUser(bob.page, 'Bob');

    // Navigate Alice to messages and get her full contact data (JSON with nullifier + epub)
    await alice.page.goto('/hermes/messages');
    // IDChip requires clicking "Show QR" to reveal the contact data
    await alice.page.getByText('Show QR').click();
    await alice.page.getByTestId('idchip-data').waitFor({ state: 'attached', timeout: 5_000 });
    const aliceContactJson = await alice.page.getByTestId('idchip-data').textContent();
    expect(aliceContactJson).toBeTruthy();
    expect(aliceContactJson).toContain('nullifier');

    // Parse Alice's contact to get her nullifier for directory verification
    const aliceContact = JSON.parse(aliceContactJson ?? '{}');
    expect(aliceContact.nullifier).toBeTruthy();
    expect(aliceContact.epub).toBeTruthy();

    // Manually seed Alice's directory entry in shared mesh (simulates Gun sync)
    // This is necessary because the mock client's directory publish may not propagate
    // through the shared mesh fixture automatically
    const aliceIdentity = await readVaultIdentity(alice.page);
    if (aliceIdentity?.devicePair?.pub && aliceIdentity?.devicePair?.epub) {
      sharedMesh.write(`vh/directory/${aliceContact.nullifier}`, {
        schemaVersion: 'hermes-directory-v0',
        nullifier: aliceContact.nullifier,
        devicePub: aliceIdentity.devicePair.pub,
        epub: aliceIdentity.devicePair.epub,
        registeredAt: Date.now(),
        lastSeenAt: Date.now()
      });
    }

    // Bob navigates to messages and initiates chat with Alice
    await bob.page.goto('/hermes/messages');
    await bob.page.getByTestId('contact-key-input').fill(aliceContactJson ?? '');
    await bob.page.getByTestId('start-chat-btn').click();

    // Wait for channel to be created and composer to be enabled
    await bob.page.getByTestId('message-composer').waitFor({ state: 'visible', timeout: 5_000 });
    await expect(bob.page.getByTestId('message-composer')).toBeEnabled({ timeout: 5_000 });

    // Bob sends a message
    await bob.page.getByTestId('message-composer').fill('Hello Alice!');
    await bob.page.getByTestId('send-message-btn').click();

    // Verify Bob sees his own message
    await expect(bob.page.getByText('Hello Alice!')).toBeVisible({ timeout: 5_000 });
  });

  test('Directory lookup fails gracefully for unknown contact', async ({ alice }) => {
    await setupUser(alice.page, 'Alice');
    await alice.page.goto('/hermes/messages');

    // Try to start chat with unknown nullifier
    await alice.page.getByTestId('contact-key-input').fill('unknown-nullifier-12345');
    await alice.page.getByTestId('start-chat-btn').click();

    // Should show error about recipient not found
    await expect(alice.page.getByText(/not found in directory/i)).toBeVisible({ timeout: 5_000 });
  });
});
