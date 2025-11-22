import { test, expect } from '@playwright/test';
import * as fs from 'fs';

test.describe('The Tracer Bullet: E2E Integration', () => {
    test('should complete the full Identity -> Analysis loop', async ({ page }) => {
        page.on('console', msg => console.error(`BROWSER LOG: ${msg.text()} `));
        page.on('pageerror', err => console.error(`BROWSER ERROR: ${err.message} `));
        page.on('requestfailed', req => console.error(`REQUEST FAILED: ${req.url()} - ${req.failure()?.errorText}`));

        // 1. Load App
        await page.goto('/');
        try {
            await expect(page.getByText('Hello Trinity')).toBeVisible({ timeout: 5000 });
        } catch (e) {
            fs.writeFileSync('page_dump.html', await page.content());
            throw e;
        }

        // 2. Create Identity (Mock)
        // Note: Codex needs to implement this button with data-testid="create-identity-btn"
        const createIdentityBtn = page.getByTestId('create-identity-btn');

        // If identity doesn't exist, create it
        if (await createIdentityBtn.isVisible()) {
            await createIdentityBtn.click();
        }

        // 3. Verify Mesh Connection
        // Note: Codex needs to ensure this text appears when connected
        await expect(page.getByText(/Peers: \d+/)).toBeVisible();

        // 4. Run Analysis
        const analyzeBtn = page.getByText('Analyze demo');
        await expect(analyzeBtn).toBeVisible();
        await analyzeBtn.click();

        // 5. Verify Status Transitions
        const currentStatus = page.getByTestId('current-status');
        await expect(currentStatus).toHaveText(/Status: (loading|generating|complete)/);
        await expect(currentStatus).toHaveText(/Status: complete/, { timeout: 30000 });

        // 6. Verify Result
        await expect(page.getByText('Summary', { exact: true })).toBeVisible();
        await expect(page.getByText('Biases', { exact: true })).toBeVisible();

        // 7. Verify Persistence (Reload)
        await page.reload();
        // Identity should still be there (no create button)
        await expect(createIdentityBtn).not.toBeVisible();
        // Mesh should reconnect
        await expect(page.getByText(/Peers: \d+/)).toBeVisible();
    });
});
