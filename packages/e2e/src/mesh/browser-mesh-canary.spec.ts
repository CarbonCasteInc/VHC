import { test, expect } from '@playwright/test';
import * as path from 'node:path';

const relayPort = Number.parseInt(process.env.VH_MESH_CANARY_RELAY_PORT ?? '7788', 10);
const relayPorts = (process.env.VH_MESH_CANARY_RELAY_PORTS ?? `${relayPort},${relayPort + 1},${relayPort + 2}`)
  .split(',')
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isFinite(value));
const peerUrls = relayPorts.map((port) => `http://127.0.0.1:${port}/gun`);
const gunScriptPath = path.resolve(__dirname, '../../../gun-client/node_modules/gun/gun.js');

type MeshCanaryWindow = Window & {
  __VH_MESH_CANARY__?: {
    forceCloseSockets: () => void;
    messageCount: () => number;
    resetMessageCount: () => void;
  };
  Gun?: (options: Record<string, unknown>) => {
    get: (key: string) => unknown;
    off?: () => void;
  };
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript({ path: gunScriptPath });
  await page.addInitScript(() => {
    const nativeWebSocket = window.WebSocket;
    const sockets = new Set<WebSocket>();
    let messageCount = 0;

    class CountingWebSocket extends nativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.add(this);
        this.addEventListener('message', () => {
          messageCount += 1;
        });
        this.addEventListener('close', () => {
          sockets.delete(this);
        });
      }
    }

    Object.defineProperties(CountingWebSocket, {
      CONNECTING: { value: nativeWebSocket.CONNECTING },
      OPEN: { value: nativeWebSocket.OPEN },
      CLOSING: { value: nativeWebSocket.CLOSING },
      CLOSED: { value: nativeWebSocket.CLOSED },
    });

    window.WebSocket = CountingWebSocket as typeof WebSocket;
    (window as MeshCanaryWindow).__VH_MESH_CANARY__ = {
      forceCloseSockets: () => {
        for (const socket of sockets) {
          socket.close();
        }
      },
      messageCount: () => messageCount,
      resetMessageCount: () => {
        messageCount = 0;
      },
    };
  });
});

test('built preview mesh can write, read back, stay quiet, tear down, and reconnect', async ({ page }) => {
  for (const port of relayPorts) {
    const health = await page.request.get(`http://127.0.0.1:${port}/healthz`);
    expect(health.ok()).toBe(true);
    await expect(health.json()).resolves.toMatchObject({ ok: true, service: 'vh-relay' });
    const ready = await page.request.get(`http://127.0.0.1:${port}/readyz`);
    expect(ready.ok()).toBe(true);
  }

  await page.goto('/');
  await expect(page.locator('[data-testid="feed-shell"]')).toBeVisible({ timeout: 20_000 });

  const initial = await page.evaluate(async (peers) => {
    const win = window as MeshCanaryWindow;
    if (!win.Gun) {
      throw new Error('gun-script-missing');
    }
    const gun = win.Gun({
      peers,
      localStorage: false,
      radisk: false,
      file: false,
      axe: false,
    });
    const writerGun = win.Gun({
      peers,
      localStorage: false,
      radisk: false,
      file: false,
      axe: false,
    });
    type Chain = {
      get: (key: string) => Chain;
      once: (callback: (value: unknown) => void) => unknown;
      put: (value: unknown, callback?: (ack?: { err?: string }) => void) => unknown;
      on?: (callback: (value: unknown) => void) => unknown;
      off?: (callback?: (value: unknown) => void) => unknown;
    };
    const root = gun.get('vh') as Chain;
    const writerRoot = writerGun.get('vh') as Chain;
    const canaryReadNode = root.get('__canary').get('browser-preview');
    const canaryWriteNode = writerRoot.get('__canary').get('browser-preview');
    const nonce = `${Date.now()}-${Math.random()}`;
    const payload = { schemaVersion: 'mesh-canary-v1', nonce, t: Date.now() };

    const put = (node: Chain, value: unknown, timeoutMs = 5_000) =>
      new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error('put-ack-timeout'));
        }, timeoutMs);
        node.put(value, (ack?: { err?: string }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (ack?.err) reject(new Error(ack.err));
          else resolve();
        });
      });
    const read = (node: Chain, timeoutMs = 5_000) =>
      new Promise<Record<string, unknown> | null>((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve(null);
        }, timeoutMs);
        node.once((value: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value && typeof value === 'object' ? value as Record<string, unknown> : null);
        });
      });
    const readUntilNonce = async (node: Chain, expectedNonce: string, timeoutMs = 8_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const observed = await read(node, Math.min(1_000, Math.max(250, deadline - Date.now())));
        if (observed?.nonce === expectedNonce) {
          return observed;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return null;
    };

    await put(canaryWriteNode, payload);
    const observed = await readUntilNonce(canaryReadNode, nonce);
    if (observed?.nonce !== nonce) {
      throw new Error('write-readback-failed');
    }

    const subNode = root.get('__canary').get('subscription-off');
    const writerSubNode = writerRoot.get('__canary').get('subscription-off');
    const observedNonces: string[] = [];
    const afterOffNonce = `after-off-${nonce}`;
    let disposed = false;
    const subscriptionHandler = (value: unknown) => {
      if (disposed) {
        return;
      }
      const observedNonce = value && typeof value === 'object'
        ? (value as { nonce?: unknown }).nonce
        : undefined;
      if (typeof observedNonce === 'string') {
        observedNonces.push(observedNonce);
      }
    };
    subNode.on?.(subscriptionHandler);
    await put(writerSubNode, { nonce: `before-off-${nonce}` });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const beforeOff = observedNonces.length;
    disposed = true;
    subNode.off?.(subscriptionHandler);
    subNode.off?.();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await put(writerSubNode, { nonce: afterOffNonce });
    await new Promise((resolve) => setTimeout(resolve, 500));

    gun.off?.();
    writerGun.off?.();
    return { beforeOff, observedNonces, afterOffNonce, nonce };
  }, peerUrls);

  expect(initial.beforeOff).toBeGreaterThan(0);
  expect(initial.observedNonces).not.toContain(initial.afterOffNonce);

  await page.evaluate(() => {
    (window as MeshCanaryWindow).__VH_MESH_CANARY__?.forceCloseSockets();
  });
  await page.waitForTimeout(2_000);
  await page.evaluate(() => {
    (window as MeshCanaryWindow).__VH_MESH_CANARY__?.resetMessageCount();
  });
  await page.waitForTimeout(10_000);
  const steadyStateMessageRate = await page.evaluate(() => {
    return ((window as MeshCanaryWindow).__VH_MESH_CANARY__?.messageCount() ?? 0) / 10;
  });
  expect(steadyStateMessageRate).toBeLessThan(200);

  const reconnect = await page.evaluate(async ({ peers, expectedNonce }) => {
    const win = window as MeshCanaryWindow;
    win.__VH_MESH_CANARY__?.forceCloseSockets();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const gun = win.Gun!({
      peers,
      localStorage: false,
      radisk: false,
      file: false,
      axe: false,
    });
    type Chain = {
      get: (key: string) => Chain;
      once: (callback: (value: unknown) => void) => unknown;
      put: (value: unknown, callback?: (ack?: { err?: string }) => void) => unknown;
    };
    const node = (gun.get('vh') as Chain).get('__canary').get('browser-preview');
    const readOnce = (timeoutMs = 1_000) =>
      new Promise<Record<string, unknown> | null>((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve(null);
        }, timeoutMs);
        node.once((value: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value && typeof value === 'object' ? value as Record<string, unknown> : null);
        });
      });
    const readUntilNonce = async (expectedNonce: string, timeoutMs = 8_000) => {
      const deadline = Date.now() + timeoutMs;
      let lastObserved: Record<string, unknown> | null = null;
      while (Date.now() < deadline) {
        const observed = await readOnce(Math.min(1_000, Math.max(250, deadline - Date.now())));
        if (observed) lastObserved = observed;
        if (observed?.nonce === expectedNonce) {
          return { matched: true };
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return { matched: false, observed: lastObserved?.nonce };
    };
    const before = await readUntilNonce(expectedNonce);
    const nextNonce = `reconnect-${Date.now()}`;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('reconnect-put-timeout')), 5_000);
      node.put({ schemaVersion: 'mesh-canary-v1', nonce: nextNonce, t: Date.now() }, (ack?: { err?: string }) => {
        clearTimeout(timer);
        if (ack?.err) reject(new Error(ack.err));
        else resolve();
      });
    });
    const after = await readUntilNonce(nextNonce);
    return {
      readPrevious: before.matched,
      readNext: after.matched,
    };
  }, { peers: peerUrls, expectedNonce: initial.nonce });

  expect(reconnect.readPrevious).toBe(true);
  expect(reconnect.readNext).toBe(true);

  const failover = await page.evaluate(async (peers) => {
    const win = window as MeshCanaryWindow;
    const gun = win.Gun!({
      peers,
      localStorage: false,
      radisk: false,
      file: false,
      axe: false,
    });
    type Chain = {
      get: (key: string) => Chain;
      once: (callback: (value: unknown) => void) => unknown;
      put: (value: unknown, callback?: (ack?: { err?: string }) => void) => unknown;
    };
    const node = (gun.get('vh') as Chain).get('__canary').get('one-peer-unavailable');
    const nonce = `one-peer-down-${Date.now()}`;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('failover-put-timeout')), 8_000);
      node.put({ schemaVersion: 'mesh-canary-v1', nonce, t: Date.now() }, (ack?: { err?: string }) => {
        clearTimeout(timer);
        if (ack?.err) reject(new Error(ack.err));
        else resolve();
      });
    });
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      const observed = await new Promise<Record<string, unknown> | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 1_000);
        node.once((value: unknown) => {
          clearTimeout(timer);
          resolve(value && typeof value === 'object' ? value as Record<string, unknown> : null);
        });
      });
      if (observed?.nonce === nonce) {
        gun.off?.();
        return { readNext: true };
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    gun.off?.();
    return { readNext: false };
  }, [`http://127.0.0.1:9/gun`, ...peerUrls.slice(1)]);

  expect(failover.readNext).toBe(true);

  const metrics = await page.request.get(`http://127.0.0.1:${relayPorts[0]}/metrics`);
  expect(metrics.ok()).toBe(true);
  await expect(metrics.text()).resolves.toContain('vh_relay_http_requests_total');
});
