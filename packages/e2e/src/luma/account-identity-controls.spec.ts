import { test, expect, type Page } from '@playwright/test';
import { readVaultIdentity, waitForVaultIdentityNullifier } from '../helpers/vault-identity';

const FORBIDDEN_RENDERED_COPY = [
  'verified human',
  'one-human-one-vote',
  'Sybil-resistant',
  'cryptographic residency',
  'permanently delete',
  'anonymous',
  'untraceable',
  'Reset Identity deletes your activity',
  'Sign Out removes your data from the network',
  'permanently deleted from the network',
  'fully anonymous',
  'untraceable across devices',
  // Sign-in is continuity/recovery, never a same-human/uniqueness claim.
  'same human',
  'same person',
  'proves you are',
  'proof of a unique person is',
  'verified identity across devices',
  'linked to the same human',
];

async function clearBrowserState(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('vh-vault');
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });
}

async function gotoIdentityControls(page: Page): Promise<void> {
  await page.goto('/account/identity');
  await expect(page.getByTestId('identity-panel')).toBeVisible({ timeout: 15_000 });
}

async function ensureReadyIdentity(page: Page): Promise<string> {
  await gotoIdentityControls(page);
  const createButton = page.getByTestId('identity-create');
  if (
    await createButton.isVisible().catch(() => false)
    && await createButton.isEnabled().catch(() => false)
  ) {
    await createButton.click();
  }
  await expect(page.getByTestId('identity-sign-out')).toBeVisible({ timeout: 15_000 });
  return waitForVaultIdentityNullifier(page);
}

async function waitForNullifier(page: Page, predicate: (value: string) => boolean): Promise<string> {
  let latest = '';
  await expect.poll(async () => {
    latest = (await readVaultIdentity(page))?.session?.nullifier ?? '';
    return latest && predicate(latest);
  }, { timeout: 15_000 }).toBeTruthy();
  return latest;
}

async function renderedText(page: Page): Promise<string> {
  return page.locator('body').innerText();
}

/**
 * Decrypt the full vault and return the signInSession compartment's bound
 * principal nullifier (or null). Used to prove the account-to-LUMA binding
 * is written on sign-in and gone after Reset Identity.
 */
async function readSignInBoundNullifier(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const openDb = () => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('vh-vault', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('vault')) db.createObjectStore('vault');
        if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('open failed'));
    });
    const idbGet = (db: IDBDatabase, store: string, key: string) =>
      new Promise<unknown>((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('get failed'));
      });
    const db = await openDb();
    try {
      const record = (await idbGet(db, 'vault', 'identity')) as { iv?: unknown; ciphertext?: unknown } | undefined;
      const key = await idbGet(db, 'keys', 'master');
      if (!record || !(key instanceof CryptoKey) || !record.iv || !record.ciphertext) return null;
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: record.iv as BufferSource },
        key,
        record.ciphertext as ArrayBuffer,
      );
      const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as {
        signInSession?: { boundPrincipalNullifier?: string };
      };
      return parsed?.signInSession?.boundPrincipalNullifier ?? null;
    } catch {
      return null;
    } finally {
      db.close();
    }
  });
}

async function connectFirstProvider(page: Page): Promise<void> {
  const connect = page.locator('[data-testid^="signin-connect-"]').first();
  await expect(connect).toBeVisible({ timeout: 15_000 });
  await connect.click();
  // The mock authorize URL routes to /auth/callback, which completes the
  // exchange, binds, and redirects back to the account page.
  await expect(page.getByTestId('signin-providers')).toBeVisible({ timeout: 15_000 });
}

async function deriveForumAuthorId(principalNullifier: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(principalNullifier),
    'HKDF',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: new TextEncoder().encode('vh:forum-author:v1'),
    },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

test.describe('LUMA account identity controls', () => {
  test.beforeEach(async ({ page }) => {
    await clearBrowserState(page);
  });

  test('Sign Out preserves the device principal and rendered copy stays inside the claim boundary', async ({ page }) => {
    const firstNullifier = await ensureReadyIdentity(page);
    const firstForumAuthorId = await deriveForumAuthorId(firstNullifier);

    await page.getByTestId('identity-sign-out').click();
    const dialog = page.getByRole('dialog', { name: 'Sign out of this device?' });
    await expect(dialog).toContainText('Signing out ends your current session.');
    await expect(dialog).toContainText('Your published posts and votes are unaffected.');

    for (const forbidden of FORBIDDEN_RENDERED_COPY) {
      await expect(dialog).not.toContainText(forbidden);
    }

    await page.getByTestId('identity-sign-out-confirm').click();
    const secondNullifier = await waitForNullifier(page, (value) => value === firstNullifier);
    const secondForumAuthorId = await deriveForumAuthorId(secondNullifier);

    expect(secondNullifier).toBe(firstNullifier);
    expect(secondForumAuthorId).toBe(firstForumAuthorId);

    await gotoIdentityControls(page);
    const text = await renderedText(page);
    expect(text).not.toContain(firstNullifier);
    expect(text).not.toMatch(/mock-session-|dev-session-|srv-token:/);
  });

  test('Reset Identity rotates the principal and prompts wallet re-bind without claiming deletion', async ({ page }) => {
    const firstNullifier = await ensureReadyIdentity(page);
    const firstForumAuthorId = await deriveForumAuthorId(firstNullifier);

    await page.getByTestId('identity-reset').click();
    const dialog = page.getByRole('dialog', { name: 'Reset your identity on this device?' });
    await expect(dialog).toContainText('Resetting stops using the current pseudonym');
    await expect(dialog).toContainText('The next identity you create on this device uses a new pseudonym.');
    await expect(dialog).toContainText('Resetting does not remove them and cannot make them yours again.');

    for (const forbidden of FORBIDDEN_RENDERED_COPY) {
      await expect(dialog).not.toContainText(forbidden);
    }

    await page.getByLabel('Type reset to confirm').fill('reset');
    await page.getByTestId('identity-reset-confirm').click();

    const secondNullifier = await waitForNullifier(page, (value) => value !== firstNullifier);
    const secondForumAuthorId = await deriveForumAuthorId(secondNullifier);

    expect(secondNullifier).not.toBe(firstNullifier);
    expect(secondForumAuthorId).not.toBe(firstForumAuthorId);

    await gotoIdentityControls(page);
    await expect(page.getByTestId('identity-wallet-rebind')).toContainText('This wallet is not bound to your current identity.');
    await expect(page.getByRole('button', { name: 'Re-bind wallet' })).toBeVisible();

    const text = await renderedText(page);
    expect(text).not.toContain(firstNullifier);
    expect(text).not.toContain(secondNullifier);
    expect(text).not.toMatch(/mock-session-|dev-session-|srv-token:/);
  });
});

test.describe('LUMA account sign-in provider binding', () => {
  test.beforeEach(async ({ page }) => {
    await clearBrowserState(page);
  });

  test('connect via the e2e mock provider binds the account to the active principal without a same-human claim', async ({ page }) => {
    const nullifier = await ensureReadyIdentity(page);
    await gotoIdentityControls(page);

    // Provider tiles render with connect controls and stay inside the copy boundary.
    await expect(page.getByTestId('signin-providers')).toBeVisible();
    for (const forbidden of FORBIDDEN_RENDERED_COPY) {
      await expect(page.getByTestId('signin-providers')).not.toContainText(forbidden);
    }

    await connectFirstProvider(page);

    // A connected status appears and the vault binding references the active principal.
    await expect(page.locator('[data-testid^="signin-status-"]').first()).toContainText('Connected', { timeout: 15_000 });
    await expect.poll(async () => readSignInBoundNullifier(page), { timeout: 15_000 }).toBe(nullifier);

    // The provider subject/label are never joined with the LUMA public id in rendered copy.
    const text = await renderedText(page);
    expect(text).not.toContain(nullifier);
    expect(text).not.toMatch(/mock-session-|dev-session-|srv-token:/);
  });

  test('disconnect marks the provider signed-out locally without claiming network deletion', async ({ page }) => {
    await ensureReadyIdentity(page);
    await gotoIdentityControls(page);
    await connectFirstProvider(page);

    const disconnect = page.locator('[data-testid^="signin-disconnect-"]').first();
    await expect(disconnect).toBeVisible({ timeout: 15_000 });
    await disconnect.click();

    await expect(page.locator('[data-testid^="signin-status-"]').first()).toContainText('Signed out', { timeout: 15_000 });
    const text = await renderedText(page);
    for (const forbidden of FORBIDDEN_RENDERED_COPY) {
      expect(text).not.toContain(forbidden);
    }
  });

  test('a sign-in callback with no pending flow surfaces a clean failure and never strands a vote', async ({ page }) => {
    await ensureReadyIdentity(page);
    // Land on the callback with a code/state but no stashed PKCE material.
    await page.goto('/auth/callback?code=stray-code&state=stray-state&returnTopicId=topic-x&returnPointId=point-y');
    await expect(page.getByTestId('auth-callback-error')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('auth-callback-error')).toContainText('No vote was saved');
    // No binding was written by the failed attempt.
    expect(await readSignInBoundNullifier(page)).toBeNull();
  });

  test('signing in on another browser profile yields a distinct principal and no same-human copy', async ({ browser }) => {
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await clearBrowserState(pageA);
    const nullifierA = await ensureReadyIdentity(pageA);
    await gotoIdentityControls(pageA);
    await connectFirstProvider(pageA);
    await expect.poll(async () => readSignInBoundNullifier(pageA), { timeout: 15_000 }).toBe(nullifierA);

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await clearBrowserState(pageB);
    const nullifierB = await ensureReadyIdentity(pageB);
    await gotoIdentityControls(pageB);
    await connectFirstProvider(pageB);
    await expect.poll(async () => readSignInBoundNullifier(pageB), { timeout: 15_000 }).toBe(nullifierB);

    // Distinct device principals — no silent merge, no same-human continuity claim.
    expect(nullifierB).not.toBe(nullifierA);
    const textB = await renderedText(pageB);
    for (const forbidden of FORBIDDEN_RENDERED_COPY) {
      expect(textB).not.toContain(forbidden);
    }
    expect(textB).not.toContain(nullifierA);

    await contextA.close();
    await contextB.close();
  });

  test('a first-vote sign-in link carries return topic/point state', async ({ page }) => {
    // The vote cell links a signed-out user into the account page with return state.
    // We assert the account route accepts and preserves those params.
    await clearBrowserState(page);
    await page.goto('/account/identity?returnTopicId=topic-42&returnPointId=point-7');
    await expect(page.getByTestId('identity-panel')).toBeVisible({ timeout: 15_000 });
    expect(new URL(page.url()).searchParams.get('returnTopicId')).toBe('topic-42');
    expect(new URL(page.url()).searchParams.get('returnPointId')).toBe('point-7');
  });

  test('same-browser sign-out then sign-in preserves the local LUMA identity; Reset clears the sign-in binding', async ({ page }) => {
    const firstNullifier = await ensureReadyIdentity(page);
    await gotoIdentityControls(page);
    await connectFirstProvider(page);
    await expect.poll(async () => readSignInBoundNullifier(page), { timeout: 15_000 }).toBe(firstNullifier);

    // Sign out, then re-create identity: same device principal is restored and
    // the sign-in binding survives (bound to the same nullifier).
    await page.getByTestId('identity-sign-out').click();
    await page.getByTestId('identity-sign-out-confirm').click();
    const afterSignOut = await waitForNullifier(page, (value) => value === firstNullifier);
    expect(afterSignOut).toBe(firstNullifier);
    await expect.poll(async () => readSignInBoundNullifier(page), { timeout: 15_000 }).toBe(firstNullifier);

    // Reset Identity rotates the principal AND clears the sign-in binding.
    await gotoIdentityControls(page);
    await page.getByTestId('identity-reset').click();
    const resetDialog = page.getByRole('dialog', { name: 'Reset your identity on this device?' });
    await expect(resetDialog).toContainText('connected sign-in accounts must be re-bound');
    for (const forbidden of FORBIDDEN_RENDERED_COPY) {
      await expect(resetDialog).not.toContainText(forbidden);
    }
    await page.getByLabel('Type reset to confirm').fill('reset');
    await page.getByTestId('identity-reset-confirm').click();

    const secondNullifier = await waitForNullifier(page, (value) => value !== firstNullifier);
    expect(secondNullifier).not.toBe(firstNullifier);
    // No binding referencing the pre-reset nullifier survives reset.
    await expect.poll(async () => readSignInBoundNullifier(page), { timeout: 15_000 }).toBeNull();
    const text = await renderedText(page);
    expect(text).not.toContain(firstNullifier);
  });
});
