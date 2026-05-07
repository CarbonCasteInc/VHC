import { test, expect, type Page } from '@playwright/test';

async function ensureIdentity(page: Page, username: string) {
  // Wait for header to be visible before clicking
  await page.getByTestId('user-link').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('user-link').click();
  await page.waitForURL('**/dashboard');
  const joinBtn = page.getByTestId('create-identity-btn');
  const welcomeMsg = page.getByTestId('welcome-msg');
  if (!(await joinBtn.isVisible())) {
    await expect(welcomeMsg).toBeVisible({ timeout: 15_000 });
  }
  if (await joinBtn.isVisible()) {
    await page.fill('input[placeholder="Choose a username"]', username);
    // Handle is now required for identity creation
    await page.fill('input[placeholder="Choose a handle (letters, numbers, _)"]', username.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
    await joinBtn.click();
  }
  await expect(page.getByTestId('welcome-msg')).toBeVisible({ timeout: 10_000 });
}

test.describe('Golden Path E2E', () => {
  test('Identity -> Attestation -> Wallet -> UBE -> Analysis -> Device Link Deferred', async ({ page }) => {
    page.on('console', (msg) => console.error(`BROWSER LOG: ${msg.text()}`));
    page.on('pageerror', (err) => console.error(`BROWSER ERROR: ${err.message}`));

    // Create identity and claim UBE
    await page.goto('/');
    await expect(page.getByText('Loading Mesh…')).toBeHidden({ timeout: 15_000 });
    await ensureIdentity(page, 'UserA');

    await page.getByTestId('user-link').click();
    const claimButtonById = page.getByTestId('claim-ube-btn');
    await claimButtonById.click();
    await expect(claimButtonById).toBeDisabled({ timeout: 5_000 });
    await expect(claimButtonById).toHaveText(/Daily Boost|Come back tomorrow/i, { timeout: 5_000 });
    // Verify RVU balance is shown somewhere on page
    await expect(page.getByText('RVU Balance')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('user-link').click();

    // Generate analysis (uses demo text)
    await page.waitForURL('**/dashboard');
    await page.getByTestId('analyze-btn').click();
    // Wait for analysis result to appear
    await expect(page.getByTestId('current-status')).toHaveText(/Status: complete/i, { timeout: 30_000 });
    await expect(page.getByText('Summary', { exact: true })).toBeVisible();
    await expect(page.getByText('Biases', { exact: true })).toBeVisible();

    // Multi-device linking is explicitly deferred until the LUMA Phase 3+ identity graph.
    await expect(page.getByTestId('link-device-btn')).toBeDisabled();
    await expect(page.getByTestId('linked-count')).toContainText('Device linking: deferred');
    await expect(page.getByTestId('link-code')).toHaveCount(0);
  });
});
