import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';

interface BrowserDrillNode {
  section: 'canonical' | 'attempts' | 'indexes' | 'projections';
  nodeId: string;
  record: Record<string, unknown>;
}

interface BrowserDisconnectManifest {
  runId: string;
  traceId: string;
  peerUrls: string[];
  caseId: string;
  canonicalId: string;
  logicalKey: string;
  nodes: {
    firstCanonical: BrowserDrillNode;
    retryCanonical: BrowserDrillNode;
    index: BrowserDrillNode;
    projection: BrowserDrillNode;
  };
}

type PeerTopologyProof =
  | {
      status: 'resolved';
      resolver: 'resolveGunPeerTopology';
      topology: {
        source: string;
        strict: boolean;
        signed: boolean;
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

type WriteResult = { ok: boolean; latency_ms: number; error: string | null };
type ReadResult = { observed: boolean; latency_ms: number | null; record: Record<string, unknown> | null };

type DrillWindow = Window & {
  __VH_PEER_TOPOLOGY_PROOF__?: PeerTopologyProof;
  __VH_MESH_DISCONNECT_DRILL__?: {
    topology: unknown;
    clientPeers: string[];
    writeNode: (args: {
      runId: string;
      caseId: string;
      section: BrowserDrillNode['section'];
      nodeId: string;
      record: Record<string, unknown> | null;
      timeoutMs?: number;
    }) => Promise<WriteResult>;
    readNode: (args: {
      runId: string;
      caseId: string;
      section: BrowserDrillNode['section'];
      nodeId: string;
      timeoutMs?: number;
    }) => Promise<ReadResult>;
  };
  __VH_MESH_DISCONNECT_SOCKET_CONTROL__?: {
    activeSocketCount: () => number;
    openSocketCount: () => number;
    openedUrls: () => string[];
    openedEventCount: () => number;
    closeCount: () => number;
    closedEvents: () => Array<{ url: string; code: number; reason: string; wasClean: boolean }>;
    forceCloseSockets: () => void;
  };
};

const manifestPath = process.env.VH_MESH_DISCONNECT_BROWSER_MANIFEST_PATH;
if (!manifestPath) {
  throw new Error('VH_MESH_DISCONNECT_BROWSER_MANIFEST_PATH is required');
}

const evidencePath = process.env.VH_MESH_DISCONNECT_BROWSER_EVIDENCE_PATH;
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BrowserDisconnectManifest;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const nativeWebSocket = window.WebSocket;
    const sockets = new Set<WebSocket>();
    const openedUrls: string[] = [];
    const closedEvents: Array<{ url: string; code: number; reason: string; wasClean: boolean }> = [];
    let openedEventCount = 0;
    let forcedCloseCount = 0;

    class TrackingWebSocket extends nativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        const socketUrl = String(url);
        openedUrls.push(socketUrl);
        super(url, protocols);
        sockets.add(this);
        this.addEventListener('open', () => {
          openedEventCount += 1;
        });
        this.addEventListener('close', () => {
          sockets.delete(this);
        });
        this.addEventListener('close', (event) => {
          closedEvents.push({
            url: socketUrl,
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
          });
        });
      }
    }

    Object.defineProperties(TrackingWebSocket, {
      CONNECTING: { value: nativeWebSocket.CONNECTING },
      OPEN: { value: nativeWebSocket.OPEN },
      CLOSING: { value: nativeWebSocket.CLOSING },
      CLOSED: { value: nativeWebSocket.CLOSED },
    });

    window.WebSocket = TrackingWebSocket as typeof WebSocket;
    (window as DrillWindow).__VH_MESH_DISCONNECT_SOCKET_CONTROL__ = {
      activeSocketCount: () => sockets.size,
      openSocketCount: () => [...sockets].filter((socket) => socket.readyState === nativeWebSocket.OPEN).length,
      openedUrls: () => [...openedUrls],
      openedEventCount: () => openedEventCount,
      closeCount: () => forcedCloseCount,
      closedEvents: () => [...closedEvents],
      forceCloseSockets: () => {
        for (const socket of sockets) {
          forcedCloseCount += 1;
          socket.close(4000, 'mesh-disconnect-drill');
        }
      },
    };
  });
});

async function waitForResolvedTopology(page: import('@playwright/test').Page): Promise<PeerTopologyProof> {
  const handle = await page.waitForFunction(
    () => {
      const proof = (window as DrillWindow).__VH_PEER_TOPOLOGY_PROOF__;
      return proof?.status === 'resolved' ? proof : false;
    },
    undefined,
    { timeout: 20_000 },
  );
  return await handle.jsonValue() as PeerTopologyProof;
}

async function waitForDrillHook(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => Boolean((window as DrillWindow).__VH_MESH_DISCONNECT_DRILL__),
    undefined,
    { timeout: 20_000 },
  );
}

async function waitForAppDrillReady(page: import('@playwright/test').Page): Promise<PeerTopologyProof> {
  await expect(page.locator('[data-testid="feed-shell"]')).toBeVisible({ timeout: 20_000 });
  const proof = await waitForResolvedTopology(page);
  await waitForDrillHook(page);
  expect(proof).toMatchObject({
    status: 'resolved',
    resolver: 'resolveGunPeerTopology',
    topology: {
      source: 'env-peers',
      strict: true,
      signed: false,
      peers: manifest.peerUrls,
      minimumPeerCount: 3,
      quorumRequired: 2,
      allowLocalPeers: true,
    },
    clientPeers: manifest.peerUrls,
  });
  await expect
    .poll(() => page.evaluate(() => (window as DrillWindow).__VH_MESH_DISCONNECT_SOCKET_CONTROL__?.openSocketCount() ?? 0), {
      timeout: 15_000,
    })
    .toBe(manifest.peerUrls.length);
  return proof;
}

async function socketEvidence(page: import('@playwright/test').Page) {
  return await page.evaluate(() => ({
    active_socket_count: (window as DrillWindow).__VH_MESH_DISCONNECT_SOCKET_CONTROL__?.activeSocketCount() ?? 0,
    open_socket_count: (window as DrillWindow).__VH_MESH_DISCONNECT_SOCKET_CONTROL__?.openSocketCount() ?? 0,
    opened_urls: (window as DrillWindow).__VH_MESH_DISCONNECT_SOCKET_CONTROL__?.openedUrls() ?? [],
    opened_event_count: (window as DrillWindow).__VH_MESH_DISCONNECT_SOCKET_CONTROL__?.openedEventCount() ?? 0,
    forced_close_count: (window as DrillWindow).__VH_MESH_DISCONNECT_SOCKET_CONTROL__?.closeCount() ?? 0,
    closed_events: (window as DrillWindow).__VH_MESH_DISCONNECT_SOCKET_CONTROL__?.closedEvents() ?? [],
  }));
}

test('web pwa app client retry writes one canonical drill record after forced socket close', async ({ page }) => {
  await page.goto('/');
  const firstPageProof = await waitForAppDrillReady(page);

  const firstWrite = await page.evaluate(async ({ runId, caseId, node }) => {
    const win = window as DrillWindow;
    const pending = win.__VH_MESH_DISCONNECT_DRILL__!.writeNode({
      runId,
      caseId,
      section: node.section,
      nodeId: node.nodeId,
      record: node.record,
      timeoutMs: 900,
    });
    win.__VH_MESH_DISCONNECT_SOCKET_CONTROL__!.forceCloseSockets();
    return await pending;
  }, { runId: manifest.runId, caseId: manifest.caseId, node: manifest.nodes.firstCanonical });

  await expect
    .poll(() => page.evaluate(() => (window as DrillWindow).__VH_MESH_DISCONNECT_SOCKET_CONTROL__?.closeCount() ?? 0), {
      timeout: 5_000,
    })
    .toBeGreaterThan(0);
  const forcedCloseEvidence = await socketEvidence(page);

  await page.reload();
  const retryPageProof = await waitForAppDrillReady(page);

  const retryWrite = await page.evaluate(async ({ runId, caseId, node }) => {
    const win = window as DrillWindow;
    return await win.__VH_MESH_DISCONNECT_DRILL__!.writeNode({
      runId,
      caseId,
      section: node.section,
      nodeId: node.nodeId,
      record: node.record,
      timeoutMs: 5_000,
    });
  }, { runId: manifest.runId, caseId: manifest.caseId, node: manifest.nodes.retryCanonical });

  const indexWrite = await page.evaluate(async ({ runId, caseId, node }) => {
    const win = window as DrillWindow;
    return await win.__VH_MESH_DISCONNECT_DRILL__!.writeNode({
      runId,
      caseId,
      section: node.section,
      nodeId: node.nodeId,
      record: node.record,
      timeoutMs: 5_000,
    });
  }, { runId: manifest.runId, caseId: manifest.caseId, node: manifest.nodes.index });

  const projectionWrite = await page.evaluate(async ({ runId, caseId, node }) => {
    const win = window as DrillWindow;
    return await win.__VH_MESH_DISCONNECT_DRILL__!.writeNode({
      runId,
      caseId,
      section: node.section,
      nodeId: node.nodeId,
      record: node.record,
      timeoutMs: 5_000,
    });
  }, { runId: manifest.runId, caseId: manifest.caseId, node: manifest.nodes.projection });

  expect(retryWrite.ok).toBe(true);
  expect(indexWrite.ok).toBe(true);
  expect(projectionWrite.ok).toBe(true);
  await page.waitForTimeout(2_500);

  const canonicalRead = await page.evaluate(async ({ runId, caseId, section, nodeId }) => {
    const win = window as DrillWindow;
    return await win.__VH_MESH_DISCONNECT_DRILL__!.readNode({
      runId,
      caseId,
      section,
      nodeId,
      timeoutMs: 8_000,
    });
  }, {
    runId: manifest.runId,
    caseId: manifest.caseId,
    section: 'canonical' as const,
    nodeId: manifest.canonicalId,
  });
  expect(canonicalRead.observed).toBe(true);
  expect(canonicalRead.record?._drillCanonicalId).toBe(manifest.canonicalId);
  expect(canonicalRead.record?._drillLogicalKey).toBe(manifest.logicalKey);

  const retrySocketEvidence = await socketEvidence(page);
  expect(forcedCloseEvidence.forced_close_count).toBeGreaterThan(0);
  expect(retrySocketEvidence.open_socket_count).toBe(manifest.peerUrls.length);

  if (evidencePath) {
    fs.writeFileSync(
      evidencePath,
      `${JSON.stringify({
	        gate: 'web-pwa-disconnect-retry-canonical-write',
	        run_id: manifest.runId,
	        trace_id: manifest.traceId,
	        case_id: manifest.caseId,
	        canonical_id: manifest.canonicalId,
	        logical_key: manifest.logicalKey,
	        topology: retryPageProof,
	        first_page_topology: firstPageProof,
	        first_write: firstWrite,
	        retry_write: retryWrite,
	        index_write: indexWrite,
	        projection_write: projectionWrite,
	        canonical_read: canonicalRead,
	        opened_urls: [
	          ...forcedCloseEvidence.opened_urls,
	          ...retrySocketEvidence.opened_urls,
	        ],
	        forced_close_count: forcedCloseEvidence.forced_close_count,
	        forced_close_socket_evidence: forcedCloseEvidence,
	        retry_socket_evidence: retrySocketEvidence,
	      }, null, 2)}\n`,
    );
  }
});
