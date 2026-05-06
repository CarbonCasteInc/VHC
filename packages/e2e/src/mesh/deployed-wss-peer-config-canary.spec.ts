import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';

interface DeployedWssManifest {
  runId: string;
  traceId: string;
  configId: string;
  rolloverConfigId: string;
  peerUrls: string[];
  configUrl: string;
  controlUrl: string;
  stateUrl: string;
  controlToken: string;
  publicKey: string;
  expectedCspConnectSrc: string[];
  fixtures: Record<string, string>;
}

type PeerTopologyProof =
  | {
      status: 'resolved';
      resolver: 'resolveGunPeerTopology';
      topology: {
        source: string;
        strict: boolean;
        signed: boolean;
        configId?: string;
        peers: string[];
        minimumPeerCount: number;
        quorumRequired: number;
        allowLocalPeers: boolean;
      };
      clientPeers: string[];
    }
  | {
      status: 'failed';
      resolver: 'resolveGunPeerTopology';
      error: string;
      clientPeers: [];
    };

type CanaryWindow = Window & {
  __VH_PEER_TOPOLOGY_PROOF__?: PeerTopologyProof;
  __VH_GUN_PEERS__?: unknown;
  __VH_DEPLOYED_WSS_CANARY__?: {
    openedUrls: () => string[];
  };
};

const manifestPath = process.env.VH_MESH_DEPLOYED_WSS_MANIFEST_PATH;
if (!manifestPath) {
  throw new Error('VH_MESH_DEPLOYED_WSS_MANIFEST_PATH is required');
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as DeployedWssManifest;
const browserEvidencePath = process.env.VH_MESH_DEPLOYED_WSS_BROWSER_EVIDENCE_PATH;

function readFixture(name: string): unknown {
  const filePath = manifest.fixtures[name];
  if (!filePath) {
    throw new Error(`missing deployed WSS peer-config fixture path: ${name}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

async function routeConfig(page: Page, body: unknown): Promise<void> {
  await page.route(manifest.configUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      },
      body: JSON.stringify(body),
    });
  });
}

async function waitForProof(page: Page, status: PeerTopologyProof['status']): Promise<PeerTopologyProof> {
  const handle = await page.waitForFunction(
    (expected) => {
      const proof = (window as CanaryWindow).__VH_PEER_TOPOLOGY_PROOF__;
      return proof?.status === expected ? proof : false;
    },
    status,
    { timeout: 20_000 },
  );
  return await handle.jsonValue() as PeerTopologyProof;
}

function expectedSocketHosts(): string[] {
  return manifest.peerUrls.map((peerUrl) => new URL(peerUrl).host);
}

function httpsHealthUrl(peerUrl: string, pathname: string): string {
  const url = new URL(peerUrl);
  url.protocol = 'https:';
  url.pathname = pathname;
  url.search = '';
  url.hash = '';
  return url.toString();
}

async function openedPeerSocketHosts(page: Page): Promise<string[]> {
  const urls = await page.evaluate(() => {
    return (window as CanaryWindow).__VH_DEPLOYED_WSS_CANARY__?.openedUrls() ?? [];
  });
  const hosts = urls
    .map((url) => {
      try {
        return new URL(url).host;
      } catch {
        return null;
      }
    })
    .filter((host): host is string => Boolean(host));
  return Array.from(new Set(hosts));
}

async function expectFailClosed(page: Page, expectedError: string): Promise<PeerTopologyProof> {
  await page.goto('/');
  const proof = await waitForProof(page, 'failed');
  if (proof.status !== 'failed') {
    throw new Error(`expected fail-closed peer topology proof, got ${proof.status}`);
  }
  expect(proof.resolver).toBe('resolveGunPeerTopology');
  expect(proof.clientPeers).toEqual([]);
  expect(proof.error).toContain(expectedError);
  const openedHosts = await openedPeerSocketHosts(page);
  expect(openedHosts.filter((host) => expectedSocketHosts().includes(host))).toEqual([]);
  return proof;
}

async function expectResolvedWssTopology(page: Page, configId: string): Promise<PeerTopologyProof> {
  await page.goto('/');
  const proof = await waitForProof(page, 'resolved');
  expect(proof).toMatchObject({
    status: 'resolved',
    resolver: 'resolveGunPeerTopology',
    topology: {
      source: 'remote-config',
      strict: true,
      signed: true,
      configId,
      peers: manifest.peerUrls,
      minimumPeerCount: 3,
      quorumRequired: 2,
      allowLocalPeers: false,
    },
    clientPeers: manifest.peerUrls,
  });
  await expect(page.locator('[data-testid="feed-shell"]')).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(() => openedPeerSocketHosts(page), { timeout: 15_000 })
    .toEqual(expect.arrayContaining(expectedSocketHosts()));
  await expect(page.evaluate(() => (window as CanaryWindow).__VH_GUN_PEERS__)).resolves.toBeUndefined();
  return proof;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const nativeWebSocket = window.WebSocket;
    const openedUrls: string[] = [];

    class TrackingWebSocket extends nativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        openedUrls.push(String(url));
        super(url, protocols);
      }
    }

    Object.defineProperties(TrackingWebSocket, {
      CONNECTING: { value: nativeWebSocket.CONNECTING },
      OPEN: { value: nativeWebSocket.OPEN },
      CLOSING: { value: nativeWebSocket.CLOSING },
      CLOSED: { value: nativeWebSocket.CLOSED },
    });

    window.WebSocket = TrackingWebSocket as typeof WebSocket;
    (window as CanaryWindow).__VH_DEPLOYED_WSS_CANARY__ = {
      openedUrls: () => [...openedUrls],
    };
  });
});

test('accepts signed deployed-WSS config with local peer allowance disabled', async ({ page }) => {
  for (const peerUrl of manifest.peerUrls) {
    const health = await page.request.get(httpsHealthUrl(peerUrl, '/healthz'));
    expect(health.ok()).toBe(true);
    await expect(health.json()).resolves.toMatchObject({ ok: true, service: 'vh-relay' });

    const ready = await page.request.get(httpsHealthUrl(peerUrl, '/readyz'));
    expect(ready.ok()).toBe(true);

    const metrics = await page.request.get(httpsHealthUrl(peerUrl, '/metrics'));
    expect(metrics.ok()).toBe(true);
    await expect(metrics.text()).resolves.toContain('vh_relay_active_connections');
  }

  const proof = await expectResolvedWssTopology(page, manifest.configId);

  if (browserEvidencePath) {
    fs.writeFileSync(
      browserEvidencePath,
      `${JSON.stringify({
        gate: 'deployed-wss-signed-peer-config-browser-boot',
        run_id: manifest.runId,
        trace_id: manifest.traceId,
        config_id: manifest.configId,
        proof,
        opened_socket_hosts: await openedPeerSocketHosts(page),
      }, null, 2)}\n`,
    );
  }
});

test('fails closed for insecure peers when local allowance is disabled', async ({ page }) => {
  await routeConfig(page, readFixture('insecurePeers'));
  await expectFailClosed(page, 'strict peer config rejects insecure peer');
});

test('renders CSP connect-src for only the expected WSS and peer-config origins', async ({ page }) => {
  await page.goto('/');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).not.toBeNull();
  const connectSrc = csp
    ?.split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('connect-src ')) ?? '';

  for (const expected of manifest.expectedCspConnectSrc) {
    expect(connectSrc).toContain(expected);
  }
  const connectSrcTokens = connectSrc.split(/\s+/);
  expect(new Set(connectSrcTokens.slice(1))).toEqual(new Set([
    "'self'",
    ...manifest.expectedCspConnectSrc,
  ]));
  expect(connectSrcTokens).not.toContain('http://localhost:*');
  expect(connectSrcTokens).not.toContain('ws://localhost:*');
  expect(connectSrcTokens).not.toContain('http://127.0.0.1:*');
  expect(connectSrcTokens).not.toContain('ws://127.0.0.1:*');
  expect(connectSrcTokens).not.toContain('https:');
  expect(connectSrcTokens).not.toContain('wss:');
  expect(connectSrc).not.toContain('https://evil.example');
  expect(connectSrc).not.toContain('wss://evil.example');
});

test('refetches signed peer config after rollover instead of using stale service-worker cache', async ({ page }) => {
  const firstProof = await expectResolvedWssTopology(page, manifest.configId);
  expect(firstProof.status).toBe('resolved');

  const rollover = await page.request.post(manifest.controlUrl, {
    headers: { 'x-vh-mesh-control-token': manifest.controlToken },
  });
  expect(rollover.ok()).toBe(true);

  await page.reload({ waitUntil: 'domcontentloaded' });
  const secondProof = await waitForProof(page, 'resolved');
  expect(secondProof).toMatchObject({
    status: 'resolved',
    resolver: 'resolveGunPeerTopology',
    topology: {
      source: 'remote-config',
      strict: true,
      signed: true,
      configId: manifest.rolloverConfigId,
      allowLocalPeers: false,
    },
  });

  const state = await page.request.get(manifest.stateUrl);
  expect(state.ok()).toBe(true);
  const stateBody = await state.json() as { ok: boolean; active: string; config_hits?: number };
  expect(stateBody).toMatchObject({
    ok: true,
    active: 'rollover',
  });
  expect(stateBody.config_hits ?? 0).toBeGreaterThanOrEqual(2);
});
