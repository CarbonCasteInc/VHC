import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './src',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
    use: {
        baseURL: 'http://localhost:5173',
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        command: 'cd ../.. && VITE_E2E_MODE=true pnpm --filter @vh/web-pwa preview',
        url: 'http://localhost:5173',
        reuseExistingServer: false,
        timeout: 120 * 1000,
        env: {
            VITE_E2E_MODE: 'true'
        }
    },
});
