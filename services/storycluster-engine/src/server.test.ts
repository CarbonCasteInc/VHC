import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStoryClusterServer,
  serverInternal,
  startStoryClusterServer,
  type StoryClusterServerOptions,
} from './server';
import type { ClusterVectorBackend } from './vectorBackend';

async function withServer<T>(
  options: StoryClusterServerOptions,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = createStoryClusterServer(options);
  server.listen(0, '127.0.0.1');
  await waitForListening(server);
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await run(baseUrl);
  } finally {
    await closeServer(server);
  }
}

async function waitForListening(server: { once: (event: 'listening' | 'error', cb: (error?: Error) => void) => void }) {
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', (error) => reject(error));
  });
}

async function closeServer(server: { close: (cb: (error?: Error | null) => void) => void }) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function closeServerQuietly(server: { close: (cb: (error?: Error | null) => void) => void }) {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
describe('storycluster server', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('serves health and cluster endpoints with auth gate', async () => {
    await withServer(
      {
        authToken: 'token-123',
        now: () => 1_710_000_099_000,
      },
      async (baseUrl) => {
        const unauthorized = await fetch(`${baseUrl}/health`);
        expect(unauthorized.status).toBe(401);
        await unauthorized.arrayBuffer();

        const health = await fetch(`${baseUrl}/health`, {
          headers: {
            authorization: 'Bearer token-123',
          },
        });
        expect(health.status).toBe(200);
        await expect(health.json()).resolves.toEqual({
          ok: true,
          service: 'storycluster-engine',
          stage_count: 11,
        });

        const healthWrongMethod = await fetch(`${baseUrl}/health`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer token-123',
          },
        });
        expect(healthWrongMethod.status).toBe(405);
        await expect(healthWrongMethod.json()).resolves.toEqual({
          error: 'Method not allowed',
        });

        const cluster = await fetch(`${baseUrl}/cluster`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer token-123',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            topic_id: 'topic-world',
            items: [
              {
                sourceId: 'wire-a',
                publisher: 'Wire A',
                url: 'https://example.com/a',
                canonicalUrl: 'https://example.com/a',
                title: 'Breaking: Port attack triggers alerts',
                publishedAt: 1_710_000_000_000,
                summary: 'Authorities respond in the first hour',
                url_hash: 'hash-a',
                language: 'en',
                translation_applied: false,
                entity_keys: ['port', 'alerts'],
              },
            ],
          }),
        });

        expect(cluster.status).toBe(200);
        const payload = (await cluster.json()) as {
          bundles: Array<{ schemaVersion: string; story_id: string; sources: unknown[] }>;
          telemetry: { stage_count: number };
        };
        expect(payload.telemetry.stage_count).toBe(11);
        expect(payload.bundles[0]?.schemaVersion).toBe('story-bundle-v0');
        expect(payload.bundles[0]?.story_id).toMatch(/^story-/);
        expect(payload.bundles[0]?.sources.length).toBe(1);
      },
    );
  });

  it('supports custom auth header/scheme and rejects unsupported methods', async () => {
    await withServer(
      {
        authToken: 'secret',
        authHeader: 'x-storycluster-auth',
        authScheme: 'Token',
      },
      async (baseUrl) => {
        const wrongAuth = await fetch(`${baseUrl}/api/health`, {
          headers: {
            'x-storycluster-auth': 'Bearer secret',
          },
        });
        expect(wrongAuth.status).toBe(401);
        await wrongAuth.arrayBuffer();

        const goodAuth = await fetch(`${baseUrl}/api/health`, {
          headers: {
            'x-storycluster-auth': 'Token secret',
          },
        });
        expect(goodAuth.status).toBe(200);
        await goodAuth.arrayBuffer();

        const methodNotAllowed = await fetch(`${baseUrl}/api/cluster`, {
          method: 'GET',
          headers: {
            'x-storycluster-auth': 'Token secret',
          },
        });
        expect(methodNotAllowed.status).toBe(405);
        await expect(methodNotAllowed.json()).resolves.toEqual({
          error: 'Method not allowed',
        });
      },
    );
  });

  it('reports readiness failures from the vector backend and blocks cluster requests', async () => {
    const brokenVectorBackend: ClusterVectorBackend = {
      async queryTopic() {
        return new Map();
      },
      async readiness() {
        return { ok: false, detail: 'vector-backend-down' };
      },
      async replaceTopicClusters() {},
    };

    await withServer(
      { vectorBackend: brokenVectorBackend },
      async (baseUrl) => {
        const ready = await fetch(`${baseUrl}/ready`);
        expect(ready.status).toBe(503);
        await expect(ready.json()).resolves.toEqual({
          ok: false,
          service: 'storycluster-engine',
          detail: 'vector-backend-down',
        });

        const cluster = await fetch(`${baseUrl}/cluster`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ topic_id: 'topic-world', items: [] }),
        });
        expect(cluster.status).toBe(503);
        await expect(cluster.json()).resolves.toEqual({
          error: 'vector-backend-down',
        });
      },
    );
  });

  it('returns 503 when runtime dependency resolution throws before the request handler completes', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VH_STORYCLUSTER_QDRANT_URL', '');

    await withServer({}, async (baseUrl) => {
      const ready = await fetch(`${baseUrl}/ready`);
      expect(ready.status).toBe(503);
      await expect(ready.json()).resolves.toEqual({
        error: 'storycluster production requires VH_STORYCLUSTER_QDRANT_URL or QDRANT_URL',
      });
    });
  });

  it('uses the generic runtime error message when the top-level server catch receives a non-Error value', async () => {
    const throwingVectorBackend: ClusterVectorBackend = {
      async queryTopic() {
        return new Map();
      },
      async readiness() {
        throw 'boom-string';
      },
      async replaceTopicClusters() {},
    };

    await withServer({ vectorBackend: throwingVectorBackend }, async (baseUrl) => {
      const ready = await fetch(`${baseUrl}/ready`);
      expect(ready.status).toBe(503);
      await expect(ready.json()).resolves.toEqual({
        error: 'storycluster runtime failed',
      });
    });
  });

  it('rejects invalid payloads, invalid JSON, unknown paths, and malformed URLs', async () => {
    await withServer({}, async (baseUrl) => {
      const invalidJson = await fetch(`${baseUrl}/cluster`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: '{not-json',
      });
      expect(invalidJson.status).toBe(400);
      await expect(invalidJson.json()).resolves.toEqual({
        error: 'request body must be valid JSON',
      });

      const missingBody = await fetch(`${baseUrl}/cluster`, {
        method: 'POST',
      });
      expect(missingBody.status).toBe(400);
      await expect(missingBody.json()).resolves.toEqual({
        error: 'request body is required',
      });

      const invalidPayload = await fetch(`${baseUrl}/cluster`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ topic_id: 'topic-x', items: 'nope' }),
      });
      expect(invalidPayload.status).toBe(400);
      await expect(invalidPayload.json()).resolves.toEqual({
        error: 'payload.items must be an array',
      });

      const notFound = await fetch(`${baseUrl}/not-found`);
      expect(notFound.status).toBe(404);
      await expect(notFound.json()).resolves.toEqual({
        error: 'Not found',
      });
    });

    expect(serverInternal.parseUrl({ url: undefined } as never)).toBeNull();
    expect(serverInternal.parseUrl({ url: 'http://[' } as never)).toBeNull();

    const reqLike = {
      headers: {
        authorization: ['Bearer one', 'Bearer two'],
      },
    } as never;

    expect(serverInternal.readHeaderValue(reqLike, 'authorization')).toBe('Bearer one');
    expect(serverInternal.readHeaderValue({ headers: { authorization: 123 } } as never, 'authorization')).toBeUndefined();

    expect(serverInternal.isHealthPath('/health')).toBe(true);
    expect(serverInternal.isHealthPath('/api/health')).toBe(true);
    expect(serverInternal.isHealthPath('/cluster')).toBe(false);
    expect(serverInternal.isClusterPath('/cluster')).toBe(true);
    expect(serverInternal.isClusterPath('/api/cluster')).toBe(true);
    expect(serverInternal.isClusterPath('/other')).toBe(false);

    expect(
      serverInternal.isAuthorized(
        { headers: { authorization: 'Bearer ok' } } as never,
        { authToken: 'ok' },
      ),
    ).toBe(true);
    expect(
      serverInternal.isAuthorized(
        { headers: { authorization: 'Bearer no' } } as never,
        { authToken: 'ok' },
      ),
    ).toBe(false);
    expect(serverInternal.isAuthorized({ headers: {} } as never, {})).toBe(true);
  });

  it('covers direct invalid-url/default-method/error-payload handling and start helper', async () => {
    const makeResponse = () => {
      const responseState: {
        statusCode?: number;
        headers: Record<string, string>;
        body?: string;
      } = {
        headers: {},
      };

      const res = {
        statusCode: 0,
        setHeader(name: string, value: string) {
          responseState.headers[name.toLowerCase()] = value;
        },
        end(payload: string) {
          responseState.statusCode = this.statusCode;
          responseState.body = payload;
        },
      } as never;

      return { responseState, res };
    };

    const invalidUrlReq = {
      method: 'GET',
      url: undefined,
      headers: {},
      async *[Symbol.asyncIterator]() {
        // no body
      },
    } as never;

    const invalidUrlResponse = makeResponse();
    await serverInternal.handleRequest(invalidUrlReq, invalidUrlResponse.res, {});
    expect(invalidUrlResponse.responseState.statusCode).toBe(400);
    expect(invalidUrlResponse.responseState.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(invalidUrlResponse.responseState.body).toBe('{"error":"Invalid request URL"}');

    const defaultMethodReq = {
      method: undefined,
      url: '/health',
      headers: {},
      async *[Symbol.asyncIterator]() {
        // no body
      },
    } as never;

    const defaultMethodResponse = makeResponse();
    await serverInternal.handleRequest(defaultMethodReq, defaultMethodResponse.res, {});
    expect(defaultMethodResponse.responseState.statusCode).toBe(200);

    const nonErrorThrowReq = {
      method: 'POST',
      url: '/cluster',
      headers: {},
      async *[Symbol.asyncIterator]() {
        throw 'synthetic-non-error';
      },
    } as never;

    const nonErrorResponse = makeResponse();
    await serverInternal.handleRequest(nonErrorThrowReq, nonErrorResponse.res, {});
    expect(nonErrorResponse.responseState.statusCode).toBe(400);
    expect(nonErrorResponse.responseState.body).toBe('{"error":"Invalid storycluster request payload"}');

    const ephemeralServer = startStoryClusterServer({ host: '127.0.0.1', port: 0 });
    await waitForListening(ephemeralServer);
    await closeServer(ephemeralServer);

    const defaultPortServer = startStoryClusterServer({ host: '127.0.0.1' });
    try {
      await waitForListening(defaultPortServer);
      await closeServer(defaultPortServer);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('EADDRINUSE')) {
        throw error;
      }
      await closeServerQuietly(defaultPortServer);
    }

    const defaultHostServer = startStoryClusterServer({ port: 0 });
    await waitForListening(defaultHostServer);
    await closeServer(defaultHostServer);
  });

  it('enforces request-body size limit helper', async () => {
    const huge = `{"x":"${'a'.repeat(128)}"}`;

    const makeReq = (parts: string[], asBuffers: boolean) => ({
      async *[Symbol.asyncIterator]() {
        for (const part of parts) {
          yield asBuffers ? Buffer.from(part) : part;
        }
      },
    });

    const body = await serverInternal.readJsonBody(makeReq([huge], true) as never, 1024);
    expect(body).toEqual({ x: 'a'.repeat(128) });

    const bodyFromStringChunk = await serverInternal.readJsonBody(makeReq([huge], false) as never, 1024);
    expect(bodyFromStringChunk).toEqual({ x: 'a'.repeat(128) });

    const splitBody = await serverInternal.readJsonBody(
      makeReq(['{"x":"', `${'a'.repeat(128)}`, '"}'], true) as never,
      1024,
    );
    expect(splitBody).toEqual({ x: 'a'.repeat(128) });

    await expect(serverInternal.readJsonBody(makeReq([huge], true) as never, 8)).rejects.toThrow(
      'request body exceeds 8 bytes',
    );
  });
});
