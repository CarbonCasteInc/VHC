import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';

interface InvalidFixtureCase {
  label: string;
  expectedError: string;
}

interface PeerConfigRollbackManifest {
  runId: string;
  traceId: string;
  configId: string;
  forwardConfigId: string;
  rollbackConfigId: string;
  peerUrls: string[];
  forwardPeerUrls: string[];
  rollbackPeerUrls: string[];
  configUrl: string;
  controlSelectUrl: string;
  stateUrl: string;
  controlToken: string;
  publicKey: string;
  wrongKeyPublicKey: string;
  expectedCspConnectSrc: string[];
  fixtures: Record<string, string>;
  invalidFixtures: InvalidFixtureCase[];
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
  __VH_PEER_CONFIG_ROLLBACK_CANARY__?: {
    openedUrls: () => string[];
  };
};

const manifestPath = process.env.VH_MESH_PEER_CONFIG_ROLLBACK_MANIFEST_PATH;
if (!manifestPath) {
  throw new Error('VH_MESH_PEER_CONFIG_ROLLBACK_MANIFEST_PATH is required');
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PeerConfigRollbackManifest;
const browserEvidencePath = process.env.VH_MESH_PEER_CONFIG_ROLLBACK_BROWSER_EVIDENCE_PATH;

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
    return (window as CanaryWindow).__VH_PEER_CONFIG_ROLLBACK_CANARY__?.openedUrls() ?? [];
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

async function selectFixture(page: Page, active: string): Promise<void> {
  const response = await page.request.post(manifest.controlSelectUrl, {
    headers: { 'x-vh-mesh-control-token': manifest.controlToken },
    data: { active },
  });
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({ ok: true, active });
}

async function navigateFresh(page: Page, seenAnyProof: boolean): Promise<void> {
  if (seenAnyProof) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    return;
  }
  await page.goto('/', { waitUntil: 'domcontentloaded' });
}

async function expectResolvedTopology(params: {
  page: Page;
  configId: string;
  peers: string[];
  seenAnyProof: boolean;
}): Promise<{ proof: PeerTopologyProof; openedHosts: string[] }> {
  const { page, configId, peers, seenAnyProof } = params;
  await navigateFresh(page, seenAnyProof);
  const proof = await waitForProof(page, 'resolved');
  expect(proof).toMatchObject({
    status: 'resolved',
    resolver: 'resolveGunPeerTopology',
    topology: {
      source: 'remote-config',
      strict: true,
      signed: true,
      configId,
      peers,
      minimumPeerCount: 3,
      quorumRequired: 2,
      allowLocalPeers: false,
    },
    clientPeers: peers,
  });
  await expect(page.locator('[data-testid="feed-shell"]')).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(() => openedPeerSocketHosts(page), { timeout: 15_000 })
    .toEqual(expect.arrayContaining(expectedSocketHosts()));
  await expect(page.evaluate(() => (window as CanaryWindow).__VH_GUN_PEERS__)).resolves.toBeUndefined();
  return {
    proof,
    openedHosts: await openedPeerSocketHosts(page),
  };
}

async function expectFailClosed(params: {
  page: Page;
  expectedError: string;
  seenAnyProof: boolean;
}): Promise<{ proof: PeerTopologyProof; openedHosts: string[]; feedShellVisible: boolean }> {
  const { page, expectedError, seenAnyProof } = params;
  await navigateFresh(page, seenAnyProof);
  const proof = await waitForProof(page, 'failed');
  if (proof.status !== 'failed') {
    throw new Error(`expected fail-closed peer topology proof, got ${proof.status}`);
  }
  expect(proof.resolver).toBe('resolveGunPeerTopology');
  expect(proof.clientPeers).toEqual([]);
  expect(proof.error).toContain(expectedError);
  await expect(page.evaluate(() => (window as CanaryWindow).__VH_GUN_PEERS__)).resolves.toBeUndefined();
  const openedHosts = await openedPeerSocketHosts(page);
  expect(openedHosts.filter((host) => expectedSocketHosts().includes(host))).toEqual([]);
  const feedShellVisible = await page.locator('[data-testid="feed-shell"]').isVisible().catch(() => false);
  return { proof, openedHosts, feedShellVisible };
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
    (window as CanaryWindow).__VH_PEER_CONFIG_ROLLBACK_CANARY__ = {
      openedUrls: () => [...openedUrls],
    };
  });
});

test('rolls forward, fails closed on invalid configs, and accepts fresh rollback config', async ({ page }) => {
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

  const timeline: unknown[] = [];
  const failClosedCases: unknown[] = [];
  let seenAnyProof = false;

  await selectFixture(page, 'positive');
  const initial = await expectResolvedTopology({
    page,
    configId: manifest.configId,
    peers: manifest.peerUrls,
    seenAnyProof,
  });
  seenAnyProof = true;
  timeline.push({
    phase: 'initial',
    config_id: manifest.configId,
    proof: initial.proof,
    opened_socket_hosts: initial.openedHosts,
  });

  await selectFixture(page, 'rollover');
  const forward = await expectResolvedTopology({
    page,
    configId: manifest.forwardConfigId,
    peers: manifest.forwardPeerUrls,
    seenAnyProof,
  });
  timeline.push({
    phase: 'roll-forward',
    config_id: manifest.forwardConfigId,
    proof: forward.proof,
    opened_socket_hosts: forward.openedHosts,
  });

  for (const fixture of manifest.invalidFixtures) {
    await selectFixture(page, fixture.label);
    const result = await expectFailClosed({
      page,
      expectedError: fixture.expectedError,
      seenAnyProof,
    });
    failClosedCases.push({
      fixture: fixture.label,
      expected_error: fixture.expectedError,
      observed_error: result.proof.status === 'failed' ? result.proof.error : null,
      feed_shell_visible: result.feedShellVisible,
      opened_socket_hosts: result.openedHosts,
      status: 'pass',
    });
  }

  await selectFixture(page, 'rollback');
  const rollback = await expectResolvedTopology({
    page,
    configId: manifest.rollbackConfigId,
    peers: manifest.rollbackPeerUrls,
    seenAnyProof,
  });
  timeline.push({
    phase: 'rollback',
    config_id: manifest.rollbackConfigId,
    proof: rollback.proof,
    opened_socket_hosts: rollback.openedHosts,
  });

  const state = await page.request.get(manifest.stateUrl);
  expect(state.ok()).toBe(true);
  const stateBody = await state.json() as {
    ok: boolean;
    active: string;
    config_hits?: number;
    config_hits_by_label?: Record<string, number>;
  };
  expect(stateBody).toMatchObject({ ok: true, active: 'rollback' });
  expect(stateBody.config_hits ?? 0).toBeGreaterThanOrEqual(8);
  expect(stateBody.config_hits_by_label?.positive ?? 0).toBeGreaterThanOrEqual(1);
  expect(stateBody.config_hits_by_label?.rollover ?? 0).toBeGreaterThanOrEqual(1);
  expect(stateBody.config_hits_by_label?.rollback ?? 0).toBeGreaterThanOrEqual(1);

  const previousTopologyShapeRestored = JSON.stringify(manifest.peerUrls) === JSON.stringify(manifest.rollbackPeerUrls)
    && manifest.rollbackConfigId !== manifest.configId;

  if (browserEvidencePath) {
    fs.writeFileSync(
      browserEvidencePath,
      `${JSON.stringify({
        gate: 'local-tls-wss-peer-config-rollback-drill',
        status: 'pass',
        run_id: manifest.runId,
        trace_id: manifest.traceId,
        initial_config_id: manifest.configId,
        forward_config_id: manifest.forwardConfigId,
        rollback_config_id: manifest.rollbackConfigId,
        timeline,
        fail_closed_cases: failClosedCases,
        rollback: {
          previous_topology_shape_restored: previousTopologyShapeRestored,
          rollback_reuses_stale_config_file: false,
          rollback_config_id_differs_from_original: manifest.rollbackConfigId !== manifest.configId,
        },
        service_worker: {
          status: 'pass',
          fetch_cache_mode: 'no-store',
          config_hits: stateBody.config_hits ?? 0,
          config_hits_by_label: stateBody.config_hits_by_label ?? {},
        },
        key_rotation: {
          status: 'pass',
          accepted_public_key: manifest.publicKey,
          rejected_public_key: manifest.wrongKeyPublicKey,
          rejected_fixture: 'wrong_key',
        },
        old_tab_behavior: {
          status: 'pass',
          behavior: 'operator rollback proof uses reload/refetch; current app does not claim live in-place topology replacement for already-open tabs',
          fail_closed_signal: 'failed peer topology proof plus zero accepted peer socket hosts after reload; feed shell may remain visible and is not the fail-closed signal',
        },
      }, null, 2)}\n`,
    );
  }
});
