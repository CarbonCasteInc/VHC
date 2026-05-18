#!/usr/bin/env node
import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8080;
const DEFAULT_PROXY_TIMEOUT_MS = 60_000;

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
]);

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function boolEnv(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function buildCsp(connectSrc) {
  const trimmedConnectSrc = String(connectSrc || "'self'").trim();
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${trimmedConnectSrc}`,
    "frame-src 'self' https:",
    "img-src 'self' https: data: blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function applySecurityHeaders(res, csp) {
  res.setHeader('content-security-policy', csp);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'same-origin');
}

function safeStaticPath(staticDir, pathname) {
  const decoded = decodeURIComponent(pathname);
  const normalized = normalize(decoded).replace(/^(\.\.(?:\/|\\|$))+/, '');
  const relative = normalized === sep ? 'index.html' : normalized.replace(/^[/\\]+/, '');
  const candidate = resolve(staticDir, relative);
  const root = resolve(staticDir);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    return null;
  }
  return candidate;
}

function isProxyRoute(pathname) {
  return pathname === '/api/analyze'
    || pathname === '/api/analyze/config'
    || pathname === '/api/analyze/health'
    || pathname === '/article-text';
}

function filteredProxyHeaders(headers) {
  const next = {};
  for (const [key, value] of Object.entries(headers)) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    if (value !== undefined) next[key] = value;
  }
  return next;
}

async function proxyRequest(req, res, targetBaseUrl, timeoutMs) {
  const targetUrl = new URL(req.url || '/', targetBaseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const method = req.method || 'GET';
    const response = await fetch(targetUrl, {
      method,
      headers: filteredProxyHeaders(req.headers),
      body: method === 'GET' || method === 'HEAD' ? undefined : req,
      duplex: method === 'GET' || method === 'HEAD' ? undefined : 'half',
      redirect: 'manual',
      signal: controller.signal,
    });
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    if (method === 'HEAD' || !response.body) {
      res.end();
      return;
    }
    await pipeline(response.body, res);
  } catch (error) {
    sendJson(res, 502, {
      ok: false,
      error: error instanceof Error && error.name === 'AbortError'
        ? 'Upstream request timed out'
        : 'Upstream request failed',
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function serveFile(req, res, filePath, csp, immutable = false) {
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }
  const stats = statSync(filePath);
  const contentType = MIME_TYPES.get(extname(filePath).toLowerCase()) || 'application/octet-stream';
  applySecurityHeaders(res, csp);
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': stats.size,
    'cache-control': immutable
      ? 'public, max-age=31536000, immutable'
      : 'no-cache, must-revalidate',
  });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  await pipeline(createReadStream(filePath), res);
}

export function createPublicBetaOriginHandler(options) {
  const staticDir = resolve(options.staticDir);
  const peerConfigPath = resolve(options.peerConfigPath);
  const analysisTarget = options.analysisTarget ? new URL(options.analysisTarget) : null;
  const csp = buildCsp(options.cspConnectSrc);
  const proxyTimeoutMs = options.proxyTimeoutMs || DEFAULT_PROXY_TIMEOUT_MS;

  return async function publicBetaOriginHandler(req, res) {
    const parsed = new URL(req.url || '/', 'http://vh-public-origin.local');
    const pathname = parsed.pathname;

    if (pathname === '/healthz') {
      sendJson(res, 200, {
        ok: true,
        service: 'vh-public-beta-origin',
        static_dir_present: existsSync(staticDir),
        peer_config_present: existsSync(peerConfigPath),
        analysis_proxy_configured: Boolean(analysisTarget),
      });
      return;
    }

    if (pathname === '/mesh-peer-config.json') {
      if (!existsSync(peerConfigPath)) {
        sendJson(res, 503, { error: 'Peer config not deployed' });
        return;
      }
      await serveFile(req, res, peerConfigPath, csp);
      return;
    }

    if (isProxyRoute(pathname)) {
      if (!analysisTarget) {
        sendJson(res, 503, { error: 'Analysis proxy not configured' });
        return;
      }
      await proxyRequest(req, res, analysisTarget, proxyTimeoutMs);
      return;
    }

    const candidate = safeStaticPath(staticDir, pathname);
    const target = candidate && existsSync(candidate) && statSync(candidate).isFile()
      ? candidate
      : join(staticDir, 'index.html');
    if (!existsSync(target)) {
      sendJson(res, 503, { error: 'Built Web PWA assets not deployed' });
      return;
    }
    await serveFile(req, res, target, csp, target.includes(`${sep}assets${sep}`));
  };
}

export function startPublicBetaOriginServer(options) {
  const host = options.host || DEFAULT_HOST;
  const port = Number(options.port || DEFAULT_PORT);
  const server = createServer(createPublicBetaOriginHandler(options));
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolvePromise(server);
    });
  });
}

async function main() {
  const root = resolve(new URL('../..', import.meta.url).pathname);
  const staticDir = process.env.VH_PUBLIC_ORIGIN_STATIC_DIR || join(root, 'apps/web-pwa/dist');
  const peerConfigPath = process.env.VH_PUBLIC_ORIGIN_PEER_CONFIG_PATH || join(staticDir, 'mesh-peer-config.json');
  const server = await startPublicBetaOriginServer({
    host: process.env.HOST || process.env.VH_PUBLIC_ORIGIN_HOST || DEFAULT_HOST,
    port: process.env.PORT || process.env.VH_PUBLIC_ORIGIN_PORT || DEFAULT_PORT,
    staticDir,
    peerConfigPath,
    analysisTarget: process.env.VH_PUBLIC_ORIGIN_ANALYSIS_TARGET || '',
    cspConnectSrc: process.env.VH_PUBLIC_ORIGIN_CSP_CONNECT_SRC || "'self'",
    proxyTimeoutMs: Number(process.env.VH_PUBLIC_ORIGIN_PROXY_TIMEOUT_MS || DEFAULT_PROXY_TIMEOUT_MS),
  });
  const address = server.address();
  const label = typeof address === 'object' && address
    ? `http://${address.address}:${address.port}`
    : String(address);
  console.log(`[vh:public-origin] listening ${label} static=${staticDir}`);

  if (boolEnv(process.env.VH_PUBLIC_ORIGIN_FAIL_IF_MISSING_STATIC, false)) {
    await readFile(join(staticDir, 'index.html'), 'utf8');
    await readFile(peerConfigPath, 'utf8');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
