import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ArticleTextService, ArticleTextServiceError } from './articleTextService';

export interface ArticleTextServerOptions {
  readonly service?: Pick<ArticleTextService, 'extract'>;
  readonly host?: string;
  readonly port?: number;
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function parseUrl(req: IncomingMessage): URL | null {
  if (!req.url) {
    return null;
  }

  try {
    return new URL(req.url, 'http://localhost');
  } catch {
    return null;
  }
}

function notFound(res: ServerResponse): void {
  sendJson(res, 404, { error: 'Not found' });
}

function methodNotAllowed(res: ServerResponse): void {
  sendJson(res, 405, { error: 'Method not allowed' });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  service: Pick<ArticleTextService, 'extract'>,
): Promise<void> {
  const parsed = parseUrl(req);
  if (!parsed) {
    sendJson(res, 400, { error: 'Invalid request URL' });
    return;
  }

  const method = (req.method ?? 'GET').toUpperCase();

  if (parsed.pathname === '/health' || parsed.pathname === '/api/health') {
    if (method !== 'GET') {
      methodNotAllowed(res);
      return;
    }

    sendJson(res, 200, { ok: true });
    return;
  }

  if (parsed.pathname !== '/api/article-text') {
    notFound(res);
    return;
  }

  if (method !== 'GET') {
    methodNotAllowed(res);
    return;
  }

  const targetUrl = parsed.searchParams.get('url')?.trim() ?? '';
  if (!targetUrl) {
    sendJson(res, 400, { error: 'Missing url query parameter' });
    return;
  }

  try {
    const result = await service.extract(targetUrl);
    sendJson(res, 200, result);
  } catch (error) {
    if (error instanceof ArticleTextServiceError) {
      sendJson(res, error.statusCode, {
        error: error.message,
        code: error.code,
        retryable: error.retryable,
      });
      return;
    }

    sendJson(res, 500, {
      error: error instanceof Error ? error.message : 'Unexpected extraction error',
    });
  }
}

export function createArticleTextServer(options: ArticleTextServerOptions = {}) {
  const service = options.service ?? new ArticleTextService();
  return createServer((req, res) => {
    void handleRequest(req, res, service);
  });
}

export function startArticleTextServer(options: ArticleTextServerOptions = {}) {
  const server = createArticleTextServer(options);
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 3001;

  server.listen(port, host);
  return server;
}

export const serverInternal = {
  handleRequest,
  parseUrl,
};
