import { defineConfig, devices } from '@playwright/test';
import * as path from 'node:path';

const relayPort = Number.parseInt(process.env.VH_MESH_CANARY_RELAY_PORT ?? '7788', 10);
const relayPorts = (process.env.VH_MESH_CANARY_RELAY_PORTS ?? `${relayPort},${relayPort + 1},${relayPort + 2}`)
  .split(',')
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isFinite(value));
const appPort = Number.parseInt(process.env.VH_MESH_CANARY_APP_PORT ?? '2148', 10);
const peerUrls = relayPorts.map((port) => `http://127.0.0.1:${port}/gun`);
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
    ...relayPorts.map((port) => ({
      command: `env GUN_PORT=${port} GUN_HOST=127.0.0.1 GUN_FILE=${repoRoot}/.tmp/mesh-browser-canary-relay-${port} GUN_RADISK=true node ${repoRoot}/infra/relay/server.js`,
      url: `http://127.0.0.1:${port}`,
      timeout: 30_000,
      reuseExistingServer: false,
      cwd: repoRoot,
    })),
    {
      command: `pnpm --filter @vh/web-pwa exec vite preview --host 127.0.0.1 --port ${appPort} --strictPort`,
      url: appUrl,
      timeout: 45_000,
      reuseExistingServer: false,
      cwd: repoRoot,
      env: {
        ...process.env,
        VITE_GUN_PEERS: JSON.stringify(peerUrls),
        VITE_GUN_PEER_MINIMUM: String(Math.min(3, peerUrls.length)),
        VITE_GUN_PEER_QUORUM_REQUIRED: String(Math.min(2, peerUrls.length)),
        VITE_VH_ALLOW_LOCAL_MESH_PEERS: 'true',
        VITE_VH_GUN_LOCAL_STORAGE: 'false',
        VITE_VH_SHOW_HEALTH: 'true',
      },
    },
  ],
});
