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
