import { test, expect, type Page } from '@playwright/test';

const ANALYSIS_URL = 'https://venn.example/full-flow';

async function ensureIdentity(page: Page, username: string) {
  await expect(page.getByText('Hello Trinity')).toBeVisible({ timeout: 15_000 });
  const joinBtn = page.getByTestId('create-identity-btn');
  if (await joinBtn.isVisible()) {
    await page.fill('input[placeholder="Choose a username"]', username);
    await joinBtn.click();
  }
  await expect(page.getByTestId('welcome-msg')).toBeVisible({ timeout: 10_000 });
}

test.describe('Golden Path E2E', () => {
  test('Identity -> Attestation -> Wallet -> UBE -> Analysis -> Mesh sync', async ({ page, context }) => {
    page.on('console', (msg) => console.error(`BROWSER LOG: ${msg.text()}`));
    page.on('pageerror', (err) => console.error(`BROWSER ERROR: ${err.message}`));

    // User A: create identity and claim UBE
    await page.goto('/');
    await expect(page.getByText('Loading Mesh…')).toBeHidden({ timeout: 15_000 });
    await ensureIdentity(page, 'UserA');

    const claimButton = page.getByRole('button', { name: /Claim UBE/i });
    await claimButton.click();
    await expect(claimButton).toBeDisabled({ timeout: 5_000 });
    await expect(page.getByText(/RVU Balance/i).locator('xpath=../p[contains(@class,"text-lg")]')).toContainText('RVU', {
      timeout: 5_000
    });

    // User A: generate analysis for URL X
    const feedInput = page.getByTestId('analysis-url-input');
    await feedInput.fill(ANALYSIS_URL);
    await feedInput.locator('xpath=ancestor::form').getByRole('button', { name: 'Analyze' }).click();
    await expect(page.getByText(`Analysis ready for ${ANALYSIS_URL}`)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(ANALYSIS_URL, { exact: true })).toBeVisible();

    // User B: fresh identity in same mesh, link device, and reuse analysis from mesh
    const pageB = await context.newPage();
    await pageB.goto('/');
    await pageB.evaluate(() => {
      ['vh_profile', 'vh_identity', 'vh_canonical_analyses', 'vh_analysis_history'].forEach((key) =>
        localStorage.removeItem(key)
      );
    });
    await pageB.reload();
    await expect(pageB.getByText('Loading Mesh…')).toBeHidden({ timeout: 15_000 });
    await ensureIdentity(pageB, 'UserB');

    await pageB.getByTestId('link-device-btn').click();
    const linkCode = (await pageB.getByTestId('link-code').innerText()).trim();
    await pageB.getByTestId('link-input').fill(linkCode);
    await pageB.getByTestId('link-complete-btn').click();
    await expect(pageB.getByTestId('linked-count')).toContainText('1', { timeout: 5_000 });

    const feedInputB = pageB.getByTestId('analysis-url-input');
    await feedInputB.fill(ANALYSIS_URL);
    await feedInputB.locator('xpath=ancestor::form').getByRole('button', { name: 'Analyze' }).click();
    await expect(pageB.getByText(/Analysis fetched from mesh/i)).toBeVisible({ timeout: 10_000 });
    await expect(pageB.getByText(ANALYSIS_URL, { exact: true })).toBeVisible();
  });
});
