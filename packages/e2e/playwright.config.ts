import { defineConfig, devices } from '@playwright/test';

const e2ePort = Number.parseInt(process.env.E2E_PORT ?? '5173', 10);
const baseURL = `http://127.0.0.1:${Number.isFinite(e2ePort) ? e2ePort : 5173}`;

export default defineConfig({
    testDir: './src',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'html',
    use: {
        baseURL,
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        command: `cd ../.. && VITE_E2E_MODE=true pnpm --filter @vh/web-pwa preview --host 127.0.0.1 --port ${Number.isFinite(e2ePort) ? e2ePort : 5173}`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120 * 1000,
        env: {
            VITE_E2E_MODE: 'true'
        }
    },
});
