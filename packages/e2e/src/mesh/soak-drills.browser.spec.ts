import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';

interface BrowserSoakNode {
  namespace: string;
  caseId?: string;
  sampleId?: string;
  canonicalId?: string;
  logicalKey?: string;
  section: 'canonical' | 'attempts' | 'indexes' | 'projections';
  nodeId: string;
  record: Record<string, unknown>;
  forceReconnect?: boolean;
}

interface BrowserSoakManifest {
  runId: string;
  traceId: string;
  peerUrls: string[];
  caseId: string;
  canonicalId: string;
  logicalKey: string;
  nodes: BrowserSoakNode[];
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
      namespace?: string;
      runId: string;
      caseId: string;
      section: BrowserSoakNode['section'];
      nodeId: string;
      record: Record<string, unknown> | null;
      timeoutMs?: number;
    }) => Promise<WriteResult>;
    readNode: (args: {
      namespace?: string;
      runId: string;
      caseId: string;
      section: BrowserSoakNode['section'];
      nodeId: string;
      timeoutMs?: number;
    }) => Promise<ReadResult>;
  };
  __VH_MESH_SOAK_SOCKET_CONTROL__?: {
    activeSocketCount: () => number;
    openSocketCount: () => number;
    openedUrls: () => string[];
    openedEventCount: () => number;
    forceCloseCount: () => number;
    closedEvents: () => Array<{ url: string; code: number; reason: string; wasClean: boolean }>;
    forceCloseSockets: () => void;
  };
};

const manifestPath = process.env.VH_MESH_SOAK_BROWSER_MANIFEST_PATH;
if (!manifestPath) {
  throw new Error('VH_MESH_SOAK_BROWSER_MANIFEST_PATH is required');
}

const evidencePath = process.env.VH_MESH_SOAK_BROWSER_EVIDENCE_PATH;
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BrowserSoakManifest;

function nodeCaseId(node: BrowserSoakNode): string {
  return node.caseId || manifest.caseId;
}

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
    (window as DrillWindow).__VH_MESH_SOAK_SOCKET_CONTROL__ = {
      activeSocketCount: () => sockets.size,
      openSocketCount: () => [...sockets].filter((socket) => socket.readyState === nativeWebSocket.OPEN).length,
      openedUrls: () => [...openedUrls],
      openedEventCount: () => openedEventCount,
      forceCloseCount: () => forcedCloseCount,
      closedEvents: () => [...closedEvents],
      forceCloseSockets: () => {
        for (const socket of sockets) {
          forcedCloseCount += 1;
          socket.close(4001, 'mesh-soak-drill');
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

async function waitForAppDrillReady(page: import('@playwright/test').Page): Promise<PeerTopologyProof> {
  await expect(page.locator('[data-testid="feed-shell"]')).toBeVisible({ timeout: 20_000 });
  const proof = await waitForResolvedTopology(page);
  await page.waitForFunction(
    () => Boolean((window as DrillWindow).__VH_MESH_DISCONNECT_DRILL__),
    undefined,
    { timeout: 20_000 },
  );
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
    .poll(() => page.evaluate(() => (window as DrillWindow).__VH_MESH_SOAK_SOCKET_CONTROL__?.openSocketCount() ?? 0), {
      timeout: 15_000,
    })
    .toBe(manifest.peerUrls.length);
  return proof;
}

async function socketEvidence(page: import('@playwright/test').Page) {
  return await page.evaluate(() => ({
    active_socket_count: (window as DrillWindow).__VH_MESH_SOAK_SOCKET_CONTROL__?.activeSocketCount() ?? 0,
    open_socket_count: (window as DrillWindow).__VH_MESH_SOAK_SOCKET_CONTROL__?.openSocketCount() ?? 0,
    opened_urls: (window as DrillWindow).__VH_MESH_SOAK_SOCKET_CONTROL__?.openedUrls() ?? [],
    opened_event_count: (window as DrillWindow).__VH_MESH_SOAK_SOCKET_CONTROL__?.openedEventCount() ?? 0,
    forced_close_count: (window as DrillWindow).__VH_MESH_SOAK_SOCKET_CONTROL__?.forceCloseCount() ?? 0,
    closed_events: (window as DrillWindow).__VH_MESH_SOAK_SOCKET_CONTROL__?.closedEvents() ?? [],
  }));
}

test('web pwa app client reconnects and writes deterministic soak records', async ({ page }) => {
  await page.goto('/');
  const firstPageProof = await waitForAppDrillReady(page);
  const writes: Array<{ nodeId: string; section: string; caseId: string; sampleId?: string; forceReconnect: boolean; first?: WriteResult; retry?: WriteResult; result: WriteResult }> = [];
  let forcedSocketEvidence: Awaited<ReturnType<typeof socketEvidence>> | null = null;

  for (const node of manifest.nodes) {
    const caseId = nodeCaseId(node);
    if (node.forceReconnect) {
      const first = await page.evaluate(async ({ runId, caseId, node }) => {
        const win = window as DrillWindow;
        const pending = win.__VH_MESH_DISCONNECT_DRILL__!.writeNode({
          namespace: node.namespace,
          runId,
          caseId,
          section: node.section,
          nodeId: node.nodeId,
          record: node.record,
          timeoutMs: 900,
        });
        win.__VH_MESH_SOAK_SOCKET_CONTROL__!.forceCloseSockets();
        return await pending;
      }, { runId: manifest.runId, caseId, node });
      forcedSocketEvidence = await socketEvidence(page);
      await page.reload();
      await waitForAppDrillReady(page);
      const retry = await page.evaluate(async ({ runId, caseId, node }) => {
        const win = window as DrillWindow;
        return await win.__VH_MESH_DISCONNECT_DRILL__!.writeNode({
          namespace: node.namespace,
          runId,
          caseId,
          section: node.section,
          nodeId: node.nodeId,
          record: node.record,
          timeoutMs: 5_000,
        });
      }, { runId: manifest.runId, caseId, node });
      expect(retry.ok).toBe(true);
      writes.push({ nodeId: node.nodeId, section: node.section, caseId, sampleId: node.sampleId, forceReconnect: true, first, retry, result: retry });
      continue;
    }

    const result = await page.evaluate(async ({ runId, caseId, node }) => {
      const win = window as DrillWindow;
      return await win.__VH_MESH_DISCONNECT_DRILL__!.writeNode({
        namespace: node.namespace,
        runId,
        caseId,
        section: node.section,
        nodeId: node.nodeId,
        record: node.record,
        timeoutMs: 5_000,
      });
    }, { runId: manifest.runId, caseId, node });
    expect(result.ok).toBe(true);
    writes.push({ nodeId: node.nodeId, section: node.section, caseId, sampleId: node.sampleId, forceReconnect: false, result });
  }

  await page.waitForTimeout(2_500);
  const firstNode = manifest.nodes[0];
  if (!firstNode) {
    throw new Error('browser soak manifest must include at least one node');
  }
  const read = await page.evaluate(async ({ runId, caseId, node }) => {
    const win = window as DrillWindow;
    return await win.__VH_MESH_DISCONNECT_DRILL__!.readNode({
      namespace: node.namespace,
      runId,
      caseId: node.caseId || caseId,
      section: node.section,
      nodeId: node.nodeId,
      timeoutMs: 8_000,
    });
  }, {
    runId: manifest.runId,
    caseId: manifest.caseId,
    node: firstNode,
  });
  expect(read.observed).toBe(true);
  expect(read.record?._drillCanonicalId).toBe(firstNode.canonicalId || manifest.canonicalId);
  expect(read.record?._drillLogicalKey).toBe(firstNode.logicalKey || manifest.logicalKey);

  const finalPageProof = await waitForResolvedTopology(page);
  const sockets = await socketEvidence(page);
  expect((forcedSocketEvidence?.forced_close_count ?? 0) + sockets.forced_close_count).toBeGreaterThan(0);
  expect(sockets.open_socket_count).toBe(manifest.peerUrls.length);

  if (evidencePath) {
    fs.writeFileSync(
      evidencePath,
      `${JSON.stringify({
        gate: 'web-pwa-rolling-restart-soak-reconnect',
        run_id: manifest.runId,
        trace_id: manifest.traceId,
        case_id: manifest.caseId,
        canonical_id: manifest.canonicalId,
        logical_key: manifest.logicalKey,
        first_page_topology: firstPageProof,
        final_page_topology: finalPageProof,
        writes,
        read,
        socket_evidence: {
          ...sockets,
          forced_close_count: (forcedSocketEvidence?.forced_close_count ?? 0) + sockets.forced_close_count,
          pre_reload_forced_close_socket_evidence: forcedSocketEvidence,
          final_socket_evidence: sockets,
        },
      }, null, 2)}\n`,
    );
  }
});
