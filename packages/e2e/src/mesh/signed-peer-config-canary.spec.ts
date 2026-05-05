import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';

interface SignedPeerConfigManifest {
  runId: string;
  traceId: string;
  configId: string;
  peerUrls: string[];
  configUrl: string;
  publicKey: string;
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

type SignedCanaryWindow = Window & {
  __VH_PEER_TOPOLOGY_PROOF__?: PeerTopologyProof;
  __VH_GUN_PEERS__?: unknown;
  __VH_SIGNED_CONFIG_CANARY__?: {
    openedUrls: () => string[];
  };
};

const manifestPath = process.env.VH_MESH_SIGNED_CANARY_MANIFEST_PATH;
if (!manifestPath) {
  throw new Error('VH_MESH_SIGNED_CANARY_MANIFEST_PATH is required');
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as SignedPeerConfigManifest;
const mode = process.env.VH_MESH_SIGNED_CANARY_MODE ?? 'common';
const expectedBuildFailure = process.env.VH_MESH_SIGNED_CANARY_EXPECT_FAILURE ?? '';
const browserEvidencePath = process.env.VH_MESH_SIGNED_CANARY_BROWSER_EVIDENCE_PATH;

function readFixture(name: string): unknown {
  const filePath = manifest.fixtures[name];
  if (!filePath) {
    throw new Error(`missing signed peer-config fixture path: ${name}`);
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
      const proof = (window as SignedCanaryWindow).__VH_PEER_TOPOLOGY_PROOF__;
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

async function openedPeerSocketHosts(page: Page): Promise<string[]> {
  const urls = await page.evaluate(() => {
    return (window as SignedCanaryWindow).__VH_SIGNED_CONFIG_CANARY__?.openedUrls() ?? [];
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
  const peerHosts = expectedSocketHosts();
  const openedHosts = await openedPeerSocketHosts(page);
  expect(openedHosts.filter((host) => peerHosts.includes(host))).toEqual([]);
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
    (window as SignedCanaryWindow).__VH_SIGNED_CONFIG_CANARY__ = {
      openedUrls: () => [...openedUrls],
    };
  });
});

test('accepts signed remote config through the app peer resolver @common', async ({ page }) => {
  test.skip(mode !== 'common', `mode ${mode} runs a build-time fail-closed case`);

  for (const peerUrl of manifest.peerUrls) {
    const health = await page.request.get(new URL('/healthz', peerUrl.replace('/gun', '/')).toString());
    expect(health.ok()).toBe(true);
    await expect(health.json()).resolves.toMatchObject({ ok: true, service: 'vh-relay' });
  }

  await page.goto('/');
  const proof = await waitForProof(page, 'resolved');
  expect(proof).toMatchObject({
    status: 'resolved',
    resolver: 'resolveGunPeerTopology',
    topology: {
      source: 'remote-config',
      strict: true,
      signed: true,
      configId: manifest.configId,
      peers: manifest.peerUrls,
      minimumPeerCount: 3,
      quorumRequired: 2,
      allowLocalPeers: true,
    },
    clientPeers: manifest.peerUrls,
  });
  await expect(page.locator('[data-testid="feed-shell"]')).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(() => openedPeerSocketHosts(page), { timeout: 15_000 })
    .toEqual(expect.arrayContaining(expectedSocketHosts()));
  await expect(page.evaluate(() => (window as SignedCanaryWindow).__VH_GUN_PEERS__)).resolves.toBeUndefined();

  if (browserEvidencePath) {
    fs.writeFileSync(
      browserEvidencePath,
      `${JSON.stringify({
        gate: 'local-signed-peer-config-browser-boot',
        run_id: manifest.runId,
        trace_id: manifest.traceId,
        config_id: manifest.configId,
        proof,
        opened_socket_hosts: await openedPeerSocketHosts(page),
      }, null, 2)}\n`,
    );
  }
});

test('fails closed for unsigned peer config @common', async ({ page }) => {
  test.skip(mode !== 'common', `mode ${mode} runs a build-time fail-closed case`);
  await routeConfig(page, readFixture('unsigned'));
  await expectFailClosed(page, 'strict peer config requires a signed peer config envelope');
});

test('fails closed for expired signed peer config @common', async ({ page }) => {
  test.skip(mode !== 'common', `mode ${mode} runs a build-time fail-closed case`);
  await routeConfig(page, readFixture('expired'));
  await expectFailClosed(page, 'peer config is expired');
});

test('fails closed for fewer than three signed peers @common', async ({ page }) => {
  test.skip(mode !== 'common', `mode ${mode} runs a build-time fail-closed case`);
  await routeConfig(page, readFixture('insufficientPeers'));
  await expectFailClosed(page, 'strict peer config requires at least 3 peers');
});

test('fails closed for signed config missing lifecycle fields @common', async ({ page }) => {
  test.skip(mode !== 'common', `mode ${mode} runs a build-time fail-closed case`);
  await routeConfig(page, readFixture('missingExpiresAt'));
  await expectFailClosed(page, 'strict signed peer config requires expiresAt');
});

test('fails closed for signed config with impossible quorum @common', async ({ page }) => {
  test.skip(mode !== 'common', `mode ${mode} runs a build-time fail-closed case`);
  await routeConfig(page, readFixture('impossibleQuorum'));
  await expectFailClosed(page, 'strict signed peer config quorumRequired cannot exceed configured peers');
});

test('fails closed for a bad peer-config signature @common', async ({ page }) => {
  test.skip(mode !== 'common', `mode ${mode} runs a build-time fail-closed case`);
  await routeConfig(page, readFixture('badSignature'));
  await expectFailClosed(page, 'signed peer config verification failed');
});

test('fails closed for build-time strict peer-config guardrails @build-failure', async ({ page }) => {
  test.skip(mode === 'common', 'common mode covers signed-config content failures');
  expect(expectedBuildFailure).not.toBe('');
  await expectFailClosed(page, expectedBuildFailure);
});
