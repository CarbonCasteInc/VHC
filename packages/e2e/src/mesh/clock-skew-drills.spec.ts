import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';

interface ClockSkewManifest {
  runId: string;
  traceId: string;
  configUrl: string;
  peerUrls: string[];
  fixtures: Record<string, string>;
  browserClockNowMs: number;
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

type ClockSkewWindow = Window & {
  __VH_PEER_TOPOLOGY_PROOF__?: PeerTopologyProof;
  __VH_GUN_PEERS__?: unknown;
  __VH_CLOCK_SKEW_CANARY__?: {
    openedUrls: () => string[];
  };
};

const manifestPath = process.env.VH_MESH_CLOCK_SKEW_MANIFEST_PATH;
if (!manifestPath) {
  throw new Error('VH_MESH_CLOCK_SKEW_MANIFEST_PATH is required');
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ClockSkewManifest;
const browserEvidencePath = process.env.VH_MESH_CLOCK_SKEW_BROWSER_EVIDENCE_PATH;

function readFixture(name: string): unknown {
  const filePath = manifest.fixtures[name];
  if (!filePath) {
    throw new Error(`missing clock-skew peer-config fixture path: ${name}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

async function routeConfig(page: Page, body: unknown): Promise<void> {
  await page.route(manifest.configUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      },
      body: JSON.stringify(body),
    });
  });
}

async function waitForProof(page: Page, status: PeerTopologyProof['status']): Promise<PeerTopologyProof> {
  const handle = await page.waitForFunction(
    (expected) => {
      const proof = (window as ClockSkewWindow).__VH_PEER_TOPOLOGY_PROOF__;
      return proof?.status === expected ? proof : false;
    },
    status,
    { timeout: 20_000 },
  );
  return await handle.jsonValue() as PeerTopologyProof;
}

async function openedPeerSocketHosts(page: Page): Promise<string[]> {
  const urls = await page.evaluate(() => {
    return (window as ClockSkewWindow).__VH_CLOCK_SKEW_CANARY__?.openedUrls() ?? [];
  });
  return Array.from(new Set(urls.map((url) => {
    try {
      return new URL(url).host;
    } catch {
      return null;
    }
  }).filter((host): host is string => Boolean(host))));
}

function appendBrowserEvidence(row: Record<string, unknown>): void {
  if (!browserEvidencePath) return;
  const existing = fs.existsSync(browserEvidencePath)
    ? JSON.parse(fs.readFileSync(browserEvidencePath, 'utf8')) as { rows?: unknown[] }
    : { rows: [] };
  fs.writeFileSync(
    browserEvidencePath,
    `${JSON.stringify({
      gate: 'local-clock-skew-matrix-browser-peer-config',
      run_id: manifest.runId,
      trace_id: manifest.traceId,
      rows: [...(existing.rows || []), row],
    }, null, 2)}\n`,
  );
}

async function expectFailClosed(params: {
  page: Page;
  fixture: string;
  expectedError: string;
  skewMs: number;
  skewedActor: string;
}): Promise<void> {
  const { page, fixture, expectedError, skewMs, skewedActor } = params;
  await routeConfig(page, readFixture(fixture));
  await page.goto('/');
  const proof = await waitForProof(page, 'failed');
  if (proof.status !== 'failed') {
    throw new Error(`expected fail-closed peer topology proof for ${fixture}, got ${proof.status}`);
  }
  expect(proof.resolver).toBe('resolveGunPeerTopology');
  expect(proof.clientPeers).toEqual([]);
  expect(proof.error).toContain(expectedError);
  const expectedHosts = manifest.peerUrls.map((peerUrl) => new URL(peerUrl).host);
  const openedHosts = await openedPeerSocketHosts(page);
  expect(openedHosts.filter((host) => expectedHosts.includes(host))).toEqual([]);
  await expect(page.evaluate(() => (window as ClockSkewWindow).__VH_GUN_PEERS__)).resolves.toBeUndefined();
  appendBrowserEvidence({
    fixture,
    status: 'pass',
    expected_error: expectedError,
    observed_error: proof.error,
    skewed_actor: skewedActor,
    skewed_layer: 'signed-peer-config-validity-window',
    skew_ms: skewMs,
    opened_socket_hosts: openedHosts,
    client_peers: proof.clientPeers,
  });
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
    (window as ClockSkewWindow).__VH_CLOCK_SKEW_CANARY__ = {
      openedUrls: () => [...openedUrls],
    };
  });
});

test('fails closed for expired signed peer config in strict browser mode', async ({ page }) => {
  await expectFailClosed({
    page,
    fixture: 'expired',
    expectedError: 'peer config is expired',
    skewMs: 0,
    skewedActor: 'browser',
  });
});

test('fails closed for future-issued signed peer config in strict browser mode', async ({ page }) => {
  await expectFailClosed({
    page,
    fixture: 'futureIssued',
    expectedError: 'peer config is not yet valid',
    skewMs: 0,
    skewedActor: 'browser',
  });
});

test('fails closed when browser clock is past the signed peer-config expiry', async ({ page }) => {
  await page.addInitScript((fixedNowMs) => {
    Date.now = () => fixedNowMs;
  }, manifest.browserClockNowMs);
  await expectFailClosed({
    page,
    fixture: 'browserClockExpired',
    expectedError: 'peer config is expired',
    skewMs: manifest.browserClockNowMs - Date.now(),
    skewedActor: 'browser-os-clock-shim',
  });
});
