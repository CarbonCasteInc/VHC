import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ArticleTextServiceError,
  type ArticleTextResult,
} from '../articleTextService';
import {
  createArticleTextServer,
  serverInternal,
  startArticleTextServer,
} from '../server';

interface RunningServer {
  readonly server: Server;
  readonly baseUrl: string;
}

interface MockResponseCapture {
  readonly response: ServerResponse;
  readonly body: () => string;
}

function createMockResponse(): MockResponseCapture {
  let body = '';
  const response = {
    statusCode: 0,
    setHeader: () => undefined,
    end: (value: string) => {
      body = value;
    },
  } as unknown as ServerResponse;

  return {
    response,
    body: () => body,
  };
}

function makeSuccess(url: string): ArticleTextResult {
  return {
    url,
    urlHash: 'hash',
    contentHash: 'content',
    sourceDomain: 'allowed.com',
    title: 'Title',
    text: 'word '.repeat(220).trim(),
    extractionMethod: 'article-extractor',
    cacheHit: 'none',
    attempts: 1,
    fetchedAt: 1,
    quality: {
      charCount: 1200,
      wordCount: 220,
      sentenceCount: 8,
      score: 0.95,
    },
  };
}

async function start(service: { extract: (url: string) => Promise<ArticleTextResult> }): Promise<RunningServer> {
  const server = createArticleTextServer({ service });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.once('error', reject);
  });

  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stop(server: Server): Promise<void> {
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

afterEach(async () => {
  // No-op; tests close their own server instances.
});

describe('article extraction server', () => {
  it('returns health responses for /health and /api/health', async () => {
    const { server, baseUrl } = await start({
      extract: async () => makeSuccess('https://allowed.com/a'),
    });

    try {
      const health = await fetch(`${baseUrl}/health`);
      const apiHealth = await fetch(`${baseUrl}/api/health`);

      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true });

      expect(apiHealth.status).toBe(200);
      expect(await apiHealth.json()).toEqual({ ok: true });
    } finally {
      await stop(server);
    }
  });

  it('returns 400 for missing article URL query and invalid request URLs', async () => {
    const { server, baseUrl } = await start({
      extract: async () => makeSuccess('https://allowed.com/a'),
    });

    try {
      const missing = await fetch(`${baseUrl}/api/article-text`);
      expect(missing.status).toBe(400);
      expect(await missing.json()).toEqual({ error: 'Missing url query parameter' });

      expect(serverInternal.parseUrl({ url: undefined } as never)).toBeNull();
      expect(serverInternal.parseUrl({ url: 'http://%zz' } as never)).toBeNull();

      const mock = createMockResponse();
      await serverInternal.handleRequest(
        { method: 'GET', url: undefined } as never,
        mock.response,
        { extract: async (url: string) => makeSuccess(url) },
      );
      expect(mock.response.statusCode).toBe(400);
      expect(JSON.parse(mock.body())).toEqual({ error: 'Invalid request URL' });

      const defaultMethodMock = createMockResponse();
      await serverInternal.handleRequest(
        { method: undefined, url: '/health' } as never,
        defaultMethodMock.response,
        { extract: async (url: string) => makeSuccess(url) },
      );
      expect(defaultMethodMock.response.statusCode).toBe(200);
      expect(JSON.parse(defaultMethodMock.body())).toEqual({ ok: true });
    } finally {
      await stop(server);
    }
  });

  it('returns 404 for unknown routes and 405 for unsupported methods', async () => {
    const { server, baseUrl } = await start({
      extract: async () => makeSuccess('https://allowed.com/a'),
    });

    try {
      const unknown = await fetch(`${baseUrl}/api/unknown`);
      expect(unknown.status).toBe(404);
      expect(await unknown.json()).toEqual({ error: 'Not found' });

      const wrongMethod = await fetch(`${baseUrl}/api/article-text?url=https://allowed.com/a`, {
        method: 'POST',
      });
      expect(wrongMethod.status).toBe(405);
      expect(await wrongMethod.json()).toEqual({ error: 'Method not allowed' });

      const healthWrongMethod = await fetch(`${baseUrl}/health`, { method: 'POST' });
      expect(healthWrongMethod.status).toBe(405);
      expect(await healthWrongMethod.json()).toEqual({ error: 'Method not allowed' });
    } finally {
      await stop(server);
    }
  });

  it('returns 200 with extraction payload on success', async () => {
    const extract = async (url: string) => makeSuccess(url);
    const { server, baseUrl } = await start({ extract });

    try {
      const response = await fetch(
        `${baseUrl}/api/article-text?url=${encodeURIComponent('https://allowed.com/a')}`,
      );
      const payload = (await response.json()) as ArticleTextResult;

      expect(response.status).toBe(200);
      expect(payload.url).toBe('https://allowed.com/a');
      expect(payload.extractionMethod).toBe('article-extractor');
    } finally {
      await stop(server);
    }
  });

  it('maps service and unknown errors to JSON responses', async () => {
    const serviceErrorServer = await start({
      extract: async () => {
        throw new ArticleTextServiceError('removed', 'gone', 410, false);
      },
    });

    try {
      const response = await fetch(
        `${serviceErrorServer.baseUrl}/api/article-text?url=${encodeURIComponent('https://allowed.com/a')}`,
      );
      expect(response.status).toBe(410);
      expect(await response.json()).toEqual({
        error: 'gone',
        code: 'removed',
        retryable: false,
      });
    } finally {
      await stop(serviceErrorServer.server);
    }

    const unknownErrorServer = await start({
      extract: async () => {
        throw new Error('boom');
      },
    });

    try {
      const response = await fetch(
        `${unknownErrorServer.baseUrl}/api/article-text?url=${encodeURIComponent('https://allowed.com/a')}`,
      );
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'boom' });
    } finally {
      await stop(unknownErrorServer.server);
    }

    const nonErrorServer = await start({
      extract: async () => {
        throw 'bad-state';
      },
    });

    try {
      const response = await fetch(
        `${nonErrorServer.baseUrl}/api/article-text?url=${encodeURIComponent('https://allowed.com/a')}`,
      );
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Unexpected extraction error' });
    } finally {
      await stop(nonErrorServer.server);
    }
  });
});

describe('startArticleTextServer', () => {
  it('starts a listening server on requested host/port', async () => {
    const server = startArticleTextServer({
      host: '127.0.0.1',
      port: 0,
      service: {
        extract: async (url: string) => makeSuccess(url),
      },
    });

    await new Promise<void>((resolve, reject) => {
      if (server.listening) {
        resolve();
        return;
      }
      server.once('listening', () => resolve());
      server.once('error', reject);
    });

    expect(server.listening).toBe(true);
    await stop(server);
  });

  it('uses default host/port and default service when options are omitted', async () => {
    const server = startArticleTextServer();

    await new Promise<void>((resolve, reject) => {
      if (server.listening) {
        resolve();
        return;
      }
      server.once('listening', () => resolve());
      server.once('error', reject);
    });

    expect(server.listening).toBe(true);
    await stop(server);
  });
});
