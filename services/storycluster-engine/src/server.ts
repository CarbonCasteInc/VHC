import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StoryClusterStageError } from './contracts';
import { getDefaultClusterStore, type ClusterStore } from './clusterStore';
import { STORYCLUSTER_STAGE_SEQUENCE } from './contracts';
import { runStoryClusterRemoteContract } from './remoteContract';
import { type ClusterVectorBackend, resolveVectorBackend } from './vectorBackend';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 4310;
const MAX_BODY_BYTES = 1024 * 1024;
let nextTraceRequestId = 0;

export interface StoryClusterServerOptions {
  host?: string;
  port?: number;
  authToken?: string;
  authHeader?: string;
  authScheme?: string;
  now?: () => number;
  store?: ClusterStore;
  vectorBackend?: ClusterVectorBackend;
}

function traceEnabled(): boolean {
  const raw = process.env.VH_STORYCLUSTER_TRACE?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function traceNow(options: StoryClusterServerOptions): number {
  return Math.floor((options.now ?? Date.now)());
}

function traceRequestId(options: StoryClusterServerOptions): string {
  nextTraceRequestId += 1;
  return `storycluster-${traceNow(options)}-${nextTraceRequestId}`;
}

function traceLog(event: string, detail: Record<string, unknown>): void {
  if (!traceEnabled()) {
    return;
  }
  console.info(`[vh:storycluster] ${event}`, detail);
}

async function runtimeReadiness(
  store: ClusterStore,
  vectorBackend: ClusterVectorBackend,
): Promise<{ ok: boolean; detail: string }> {
  const storeStatus = store.readiness();
  if (!storeStatus.ok) {
    return storeStatus;
  }
  return vectorBackend.readiness();
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
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

function readHeaderValue(req: IncomingMessage, headerName: string): string | undefined {
  const header = req.headers[headerName.toLowerCase()];
  if (Array.isArray(header)) {
    return header[0];
  }
  return typeof header === 'string' ? header : undefined;
}

function isAuthorized(req: IncomingMessage, options: StoryClusterServerOptions): boolean {
  if (!options.authToken) {
    return true;
  }

  const authHeader = (options.authHeader ?? 'authorization').toLowerCase();
  const authScheme = options.authScheme ?? 'Bearer';
  const expected = `${authScheme} ${options.authToken}`.trim();
  const received = readHeaderValue(req, authHeader)?.trim() ?? '';

  return received === expected;
}

async function readJsonBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      throw new Error(`request body exceeds ${maxBytes} bytes`);
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    throw new Error('request body is required');
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error('request body must be valid JSON');
  }
}

function isHealthPath(pathname: string): boolean {
  return pathname === '/health' || pathname === '/api/health';
}

function isClusterPath(pathname: string): boolean {
  return pathname === '/cluster' || pathname === '/api/cluster';
}

function isReadyPath(pathname: string): boolean {
  return pathname === '/ready' || pathname === '/api/ready';
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: StoryClusterServerOptions,
): Promise<void> {
  const parsed = parseUrl(req);
  if (!parsed) {
    sendJson(res, 400, { error: 'Invalid request URL' });
    return;
  }

  if (!isAuthorized(req, options)) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  const method = (req.method ?? 'GET').toUpperCase();
  if (isHealthPath(parsed.pathname)) {
    if (method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      service: 'storycluster-engine',
      stage_count: STORYCLUSTER_STAGE_SEQUENCE.length,
    });
    return;
  }

  if (isReadyPath(parsed.pathname)) {
    if (method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    const store = options.store ?? getDefaultClusterStore();
    const readiness = await runtimeReadiness(store, resolveVectorBackend(options.vectorBackend));
    sendJson(res, readiness.ok ? 200 : 503, {
      ok: readiness.ok,
      service: 'storycluster-engine',
      detail: readiness.detail,
    });
    return;
  }

  if (!isClusterPath(parsed.pathname)) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  const requestId = traceRequestId(options);
  const startedAtMs = traceNow(options);

  if (method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  try {
    const store = options.store ?? getDefaultClusterStore();
    const vectorBackend = resolveVectorBackend(options.vectorBackend);
    const readiness = await runtimeReadiness(store, vectorBackend);
    if (!readiness.ok) {
      traceLog('cluster_request_rejected', {
        request_id: requestId,
        method,
        path: parsed.pathname,
        reason: readiness.detail,
      });
      sendJson(res, 503, { error: readiness.detail });
      return;
    }
    const payload = await readJsonBody(req);
    const topicId = typeof (payload as { topic_id?: unknown })?.topic_id === 'string'
      ? (payload as { topic_id: string }).topic_id
      : null;
    const itemCount = Array.isArray((payload as { items?: unknown })?.items)
      ? ((payload as { items: unknown[] }).items.length)
      : null;
    traceLog('cluster_request_received', {
      request_id: requestId,
      method,
      path: parsed.pathname,
      topic_id: topicId,
      item_count: itemCount,
    });
    const result = await runStoryClusterRemoteContract(payload, {
      clock: options.now,
      store,
      vectorBackend,
    });
    traceLog('cluster_request_completed', {
      request_id: requestId,
      method,
      path: parsed.pathname,
      topic_id: topicId,
      item_count: itemCount,
      bundle_count: result.bundles.length,
      storyline_count: result.storylines.length,
      stage_count: result.telemetry.stage_count,
      duration_ms: Math.max(0, traceNow(options) - startedAtMs),
    });
    sendJson(res, 200, result);
  } catch (error) {
    traceLog('cluster_request_failed', {
      request_id: requestId,
      method,
      path: parsed.pathname,
      duration_ms: Math.max(0, traceNow(options) - startedAtMs),
      error: error instanceof Error ? error.message : String(error),
      failed_stage: error instanceof StoryClusterStageError ? error.stageId : null,
    });
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : 'Invalid storycluster request payload',
    });
  }
}

export function createStoryClusterServer(options: StoryClusterServerOptions = {}) {
  return createServer((req, res) => {
    void handleRequest(req, res, options).catch((error) => {
      sendJson(res, 503, {
        error: error instanceof Error ? error.message : 'storycluster runtime failed',
      });
    });
  });
}

export function startStoryClusterServer(options: StoryClusterServerOptions = {}) {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const server = createStoryClusterServer(options);
  server.listen(port, host);
  return server;
}

export const serverInternal = {
  handleRequest,
  isAuthorized,
  isClusterPath,
  isHealthPath,
  isReadyPath,
  parseUrl,
  readHeaderValue,
  readJsonBody,
  runtimeReadiness,
};
