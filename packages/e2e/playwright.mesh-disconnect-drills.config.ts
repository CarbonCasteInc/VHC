import { defineConfig, devices } from '@playwright/test';
import * as path from 'node:path';

const appPort = Number.parseInt(process.env.VH_MESH_DISCONNECT_APP_PORT ?? '2348', 10);
const appUrl = process.env.VH_MESH_DISCONNECT_APP_URL ?? `http://127.0.0.1:${appPort}/`;
const repoRoot = path.resolve(__dirname, '../..');

export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: appUrl,
    trace: 'retain-on-failure',
  },
  reporter: [['list']],
  webServer: [
    {
      command: `pnpm --filter @vh/web-pwa exec vite preview --host 127.0.0.1 --port ${appPort} --strictPort`,
      url: appUrl,
      timeout: 45_000,
      reuseExistingServer: false,
      cwd: repoRoot,
      env: {
        ...process.env,
        VITE_VH_GUN_LOCAL_STORAGE: 'false',
        VITE_VH_SHOW_HEALTH: 'true',
      },
    },
  ],
});
