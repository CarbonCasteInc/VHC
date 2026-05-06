import { defineConfig, devices } from '@playwright/test';
import * as path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');
const relayHttpPorts = (process.env.VH_MESH_DEPLOYED_WSS_RELAY_HTTP_PORTS ?? '7788,7789,7790')
  .split(',')
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isFinite(value));
const relayWssPorts = (process.env.VH_MESH_DEPLOYED_WSS_RELAY_WSS_PORTS ?? '7988,7989,7990')
  .split(',')
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isFinite(value));
const relayIds = ['deployed-wss-relay-a', 'deployed-wss-relay-b', 'deployed-wss-relay-c'];
const appPort = Number.parseInt(process.env.VH_MESH_DEPLOYED_WSS_APP_PORT ?? '2348', 10);
const configPort = Number.parseInt(process.env.VH_MESH_DEPLOYED_WSS_CONFIG_PORT ?? '2349', 10);
const appUrl = process.env.VH_MESH_DEPLOYED_WSS_APP_URL ?? `http://127.0.0.1:${appPort}/`;
const appOrigin = new URL(appUrl).origin;
const tlsCertPath = process.env.VH_MESH_TLS_CERT_PATH;
const tlsKeyPath = process.env.VH_MESH_TLS_KEY_PATH;
const positiveFixturePath = process.env.VH_MESH_DEPLOYED_WSS_PEER_CONFIG_PATH;
const rolloverFixturePath = process.env.VH_MESH_DEPLOYED_WSS_ROLLOVER_CONFIG_PATH;
const controlToken = process.env.VH_MESH_DEPLOYED_WSS_CONTROL_TOKEN ?? 'local-deployed-wss-control';
const peerUrls = relayWssPorts.map((port) => `wss://127.0.0.1:${port}/gun`);

if (!tlsCertPath || !tlsKeyPath) {
  throw new Error('VH_MESH_TLS_CERT_PATH and VH_MESH_TLS_KEY_PATH are required');
}
if (!positiveFixturePath || !rolloverFixturePath) {
  throw new Error('VH_MESH_DEPLOYED_WSS_PEER_CONFIG_PATH and VH_MESH_DEPLOYED_WSS_ROLLOVER_CONFIG_PATH are required');
}

export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: appUrl,
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
  },
  reporter: [['list']],
  webServer: [
    ...relayHttpPorts.map((port, index) => ({
      command: [
        'env',
        'NODE_ENV=production',
        `GUN_PORT=${port}`,
        'GUN_HOST=127.0.0.1',
        `GUN_FILE=${repoRoot}/.tmp/mesh-deployed-wss-relay-${port}`,
        'GUN_RADISK=true',
        `VH_RELAY_ID=${relayIds[index] ?? `deployed-wss-relay-${index + 1}`}`,
        `VH_RELAY_PEERS='${JSON.stringify(peerUrls.filter((_, peerIndex) => peerIndex !== index))}'`,
        'VH_RELAY_AUTH_REQUIRED=true',
        'VH_RELAY_DAEMON_TOKEN=local-mesh-deployed-wss-daemon-token',
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
    ...relayWssPorts.map((port, index) => ({
      command: [
        'env',
        `VH_MESH_TLS_PROXY_PORT=${port}`,
        `VH_MESH_TLS_PROXY_BACKEND_PORT=${relayHttpPorts[index]}`,
        `VH_MESH_TLS_PROXY_RELAY_ID=${relayIds[index] ?? `deployed-wss-relay-${index + 1}`}`,
        `VH_MESH_TLS_CERT_PATH=${tlsCertPath}`,
        `VH_MESH_TLS_KEY_PATH=${tlsKeyPath}`,
        `node ${repoRoot}/packages/e2e/src/mesh/tls-wss-proxy.mjs`,
      ].join(' '),
      url: `https://127.0.0.1:${port}/readyz`,
      timeout: 30_000,
      reuseExistingServer: false,
      cwd: repoRoot,
      ignoreHTTPSErrors: true,
    })),
    {
      command: [
        'env',
        `VH_MESH_DEPLOYED_WSS_CONFIG_PORT=${configPort}`,
        `VH_MESH_DEPLOYED_WSS_PEER_CONFIG_PATH=${positiveFixturePath}`,
        `VH_MESH_DEPLOYED_WSS_ROLLOVER_CONFIG_PATH=${rolloverFixturePath}`,
        `VH_MESH_DEPLOYED_WSS_CONTROL_TOKEN=${controlToken}`,
        `VH_MESH_TLS_CERT_PATH=${tlsCertPath}`,
        `VH_MESH_TLS_KEY_PATH=${tlsKeyPath}`,
        `node ${repoRoot}/packages/e2e/src/mesh/deployed-wss-peer-config-server.mjs`,
      ].join(' '),
      url: `https://127.0.0.1:${configPort}/healthz`,
      timeout: 15_000,
      reuseExistingServer: false,
      cwd: repoRoot,
      ignoreHTTPSErrors: true,
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
