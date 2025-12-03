import { test, expect } from '@playwright/test';
import * as fs from 'fs';

test.describe('The Tracer Bullet: E2E Integration', () => {
    test('should complete the full Identity -> Analysis loop', async ({ page }) => {
        page.on('console', msg => console.error(`BROWSER LOG: ${msg.text()} `));
        page.on('pageerror', err => console.error(`BROWSER ERROR: ${err.message} `));
        page.on('requestfailed', req => console.error(`REQUEST FAILED: ${req.url()} - ${req.failure()?.errorText}`));

        // 1. Load App
        await page.goto('/');
        await page.getByTestId('user-link').click();
        await page.waitForURL('**/dashboard');
        await expect(page.getByText('Loading Mesh…')).toBeHidden({ timeout: 10000 });
        const createIdentityBtn = page.getByTestId('create-identity-btn');
        const welcomeMsg = page.getByTestId('welcome-msg');
        if (!(await createIdentityBtn.isVisible())) {
            await expect(welcomeMsg).toBeVisible({ timeout: 10000 });
        }

        // 2. Create Identity (Mock)
        if (await createIdentityBtn.isVisible()) {
            await page.fill('input[placeholder="Choose a username"]', 'TrinityTester');
            await createIdentityBtn.click();
        }
        await expect(page.getByTestId('welcome-msg')).toContainText('TrinityTester', { timeout: 10000 });

        // 3. Verify Mesh Connection
        // Note: Codex needs to ensure this text appears when connected
        await expect(page.getByText(/Peers: \d+/)).toBeVisible();

        // 4. Run Analysis
        const analyzeBtn = page.getByTestId('analyze-btn');
        await expect(analyzeBtn).toBeVisible();
        await analyzeBtn.click();

        // 5. Verify Status Transitions
        const currentStatus = page.getByTestId('current-status');
        await expect(currentStatus).toHaveText(/Status: (loading|generating|complete)/);
        await expect(currentStatus).toHaveText(/Status: complete/, { timeout: 30000 });

        // 6. Verify Result
        await expect(page.getByText('Summary', { exact: true })).toBeVisible();
        await expect(page.getByText('Biases', { exact: true })).toBeVisible();

        // 7. Link Device UI Flow
        await page.getByTestId('link-device-btn').click();
        const code = await page.getByTestId('link-code').innerText();
        await page.fill('[data-testid="link-input"]', code);
        await page.getByTestId('link-complete-btn').click();
        await expect(page.getByTestId('linked-count')).toContainText(/Linked devices: 1/);

        // 8. Verify Persistence (Reload)
        await page.reload();
        // Identity should still be there (no create button)
        await expect(createIdentityBtn).not.toBeVisible();
        // Mesh should reconnect
        await expect(page.getByText(/Peers: \d+/)).toBeVisible();
        await expect(page.getByTestId('linked-count')).toContainText(/Linked devices: 1/);
    });
});
