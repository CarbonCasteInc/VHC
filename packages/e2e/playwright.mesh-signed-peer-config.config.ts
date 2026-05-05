import { defineConfig, devices } from '@playwright/test';
import * as path from 'node:path';

const firstRelayPort = Number.parseInt(process.env.VH_MESH_SIGNED_CANARY_RELAY_PORT ?? '7888', 10);
const relayPorts = (process.env.VH_MESH_SIGNED_CANARY_RELAY_PORTS ?? `${firstRelayPort},${firstRelayPort + 1},${firstRelayPort + 2}`)
  .split(',')
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isFinite(value));
const relayIds = ['signed-relay-a', 'signed-relay-b', 'signed-relay-c'];
const appPort = Number.parseInt(process.env.VH_MESH_SIGNED_CANARY_APP_PORT ?? '2248', 10);
const configPort = Number.parseInt(process.env.VH_MESH_SIGNED_CANARY_CONFIG_PORT ?? '2249', 10);
const peerUrls = relayPorts.map((port) => `http://127.0.0.1:${port}/gun`);
const appUrl = process.env.VH_MESH_SIGNED_CANARY_APP_URL ?? `http://127.0.0.1:${appPort}/`;
const appOrigin = new URL(appUrl).origin;
const repoRoot = path.resolve(__dirname, '../..');
const fixturePath = process.env.VH_MESH_SIGNED_PEER_CONFIG_PATH
  ?? path.join(repoRoot, '.tmp/mesh-production-readiness/latest/signed-peer-config.json');

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
    ...relayPorts.map((port, index) => ({
      command: [
        'env',
        'NODE_ENV=production',
        `GUN_PORT=${port}`,
        'GUN_HOST=127.0.0.1',
        `GUN_FILE=${repoRoot}/.tmp/mesh-signed-peer-config-relay-${port}`,
        'GUN_RADISK=true',
        `VH_RELAY_ID=${relayIds[index] ?? `signed-relay-${index + 1}`}`,
        `VH_RELAY_PEERS='${JSON.stringify(peerUrls.filter((_, peerIndex) => peerIndex !== index))}'`,
        'VH_RELAY_AUTH_REQUIRED=true',
        'VH_RELAY_DAEMON_TOKEN=local-mesh-signed-canary-daemon-token',
        `VH_RELAY_ALLOWED_ORIGINS=${appOrigin}`,
        'VH_RELAY_PEER_AUTH_MODE=private_network_allowlist',
        'VH_RELAY_PEER_ALLOWLIST=loopback',
        'VH_RELAY_HTTP_RATE_LIMIT_PER_MIN=1200',
        'VH_RELAY_WS_BYTES_PER_SEC=1000000',
        'VH_RELAY_MAX_ACTIVE_CONNECTIONS=5000',
        `node ${repoRoot}/infra/relay/server.js`,
      ].join(' '),
      url: `http://127.0.0.1:${port}/readyz`,
      timeout: 30_000,
      reuseExistingServer: false,
      cwd: repoRoot,
    })),
    {
      command: `env VH_MESH_SIGNED_CANARY_CONFIG_PORT=${configPort} VH_MESH_SIGNED_PEER_CONFIG_PATH=${fixturePath} node ${repoRoot}/packages/e2e/src/mesh/signed-peer-config-server.mjs`,
      url: `http://127.0.0.1:${configPort}/healthz`,
      timeout: 15_000,
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
        VITE_VH_GUN_LOCAL_STORAGE: 'false',
        VITE_VH_SHOW_HEALTH: 'true',
      },
    },
  ],
});
