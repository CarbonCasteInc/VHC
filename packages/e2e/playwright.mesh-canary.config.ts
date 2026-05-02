import { defineConfig, devices } from '@playwright/test';
import * as path from 'node:path';

const relayPort = Number.parseInt(process.env.VH_MESH_CANARY_RELAY_PORT ?? '7788', 10);
const appPort = Number.parseInt(process.env.VH_MESH_CANARY_APP_PORT ?? '2148', 10);
const relayUrl = `http://127.0.0.1:${relayPort}`;
const appUrl = process.env.VH_MESH_CANARY_APP_URL ?? `http://127.0.0.1:${appPort}/`;
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
      command: `env GUN_PORT=${relayPort} GUN_HOST=127.0.0.1 GUN_FILE=${repoRoot}/.tmp/mesh-browser-canary-relay GUN_RADISK=true node ${repoRoot}/infra/relay/server.js`,
      url: relayUrl,
      timeout: 30_000,
      reuseExistingServer: false,
      cwd: repoRoot,
    },
    {
      command: `pnpm --filter @vh/web-pwa exec vite preview --host 127.0.0.1 --port ${appPort} --strictPort`,
      url: appUrl,
      timeout: 45_000,
      reuseExistingServer: false,
      cwd: repoRoot,
      env: {
        ...process.env,
        VITE_GUN_PEERS: `http://127.0.0.1:${relayPort}/gun`,
        VITE_VH_GUN_LOCAL_STORAGE: 'false',
        VITE_VH_SHOW_HEALTH: 'true',
      },
    },
  ],
});
