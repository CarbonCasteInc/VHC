#!/usr/bin/env node
import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8080;
const DEFAULT_PROXY_TIMEOUT_MS = 60_000;
const DEFAULT_RELAY_PROXY_TIMEOUT_MS = 10_000;
const DEFAULT_RELAY_FANOUT_TIMEOUT_MS = 30_000;
const DEFAULT_RELAY_NEWS_FANOUT_TIMEOUT_MS = 60_000;
const AGGREGATE_FANOUT_WRITE_PATHS = new Set([
  '/vh/aggregates/voter',
  '/vh/aggregates/point-snapshot',
]);
const FORUM_FANOUT_WRITE_PATHS = new Set([
  '/vh/forum/thread',
  '/vh/forum/comment',
]);
const FORUM_FANOUT_READ_PATHS = new Set([
  '/vh/forum/thread',
  '/vh/forum/comments',
]);
const NEWS_FANOUT_READ_PATHS = new Set([
  '/vh/news/latest-index',
  '/vh/news/hot-index',
  '/vh/news/story',
  '/vh/news/synthesis-lifecycle',
  '/vh/topics/synthesis',
]);

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
  'host',
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

function escapeHtmlAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function rewriteCspMeta(html, csp) {
  const escapedCsp = escapeHtmlAttribute(csp);
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${escapedCsp}" />`;
  const cspMetaPattern = /<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/i;
  if (cspMetaPattern.test(html)) {
    return html.replace(cspMetaPattern, cspMeta);
  }
  return html.replace(/<head([^>]*)>/i, `<head$1>\n    ${cspMeta}`);
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

function isClientDisconnectError(error) {
  if (!error || typeof error !== 'object') return false;
  const code = error.code;
  return code === 'ERR_STREAM_PREMATURE_CLOSE'
    || code === 'ECONNRESET'
    || code === 'EPIPE';
}

function responseWritable(res) {
  return !res.destroyed && !res.writableEnded;
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

function isRelayProxyRoute(pathname) {
  return pathname === '/vh/forum/thread'
    || pathname === '/vh/forum/comment'
    || pathname === '/vh/forum/comments'
    || pathname === '/vh/topics/synthesis'
    || pathname === '/vh/news/story'
    || pathname === '/vh/news/latest-index'
    || pathname === '/vh/news/hot-index'
    || pathname === '/vh/news/synthesis-lifecycle'
    || pathname === '/vh/aggregates/point'
    || pathname === '/vh/aggregates/voter'
    || pathname === '/vh/aggregates/point-snapshot';
}

function isRelayProxyMethodAllowed(pathname, method) {
  if (
    pathname === '/vh/news/story'
    || pathname === '/vh/news/latest-index'
    || pathname === '/vh/news/hot-index'
    || pathname === '/vh/news/synthesis-lifecycle'
    || pathname === '/vh/aggregates/point'
  ) {
    return method === 'GET';
  }
  if (pathname === '/vh/topics/synthesis') {
    return method === 'GET' || method === 'POST';
  }
  if (pathname === '/vh/forum/thread') {
    return method === 'GET' || method === 'POST';
  }
  if (pathname === '/vh/forum/comments') {
    return method === 'GET';
  }
  return method === 'POST';
}

function parseRelayTargets(value) {
  if (!value) return [];
  const rawValues = Array.isArray(value)
    ? value
    : (() => {
      const text = String(value).trim();
      if (!text) return [];
      if (text.startsWith('[')) {
        try {
          const parsed = JSON.parse(text);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
      return text.split(',');
    })();
  const targets = [];
  const seen = new Set();
  for (const raw of rawValues) {
    const text = String(raw || '').trim();
    if (!text) continue;
    try {
      const url = new URL(text);
      const normalized = url.href.replace(/\/+$/, '');
      if (!seen.has(normalized)) {
        seen.add(normalized);
        targets.push(new URL(normalized));
      }
    } catch {
      // Ignore malformed relay fanout entries; health/config surfaces expose
      // whether a usable primary target was configured.
    }
  }
  return targets;
}

function filteredProxyHeaders(headers) {
  const next = {};
  for (const [key, value] of Object.entries(headers)) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
    if (value !== undefined) next[key] = value;
  }
  return next;
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function fetchRelayTarget(req, targetBaseUrl, timeoutMs, body = undefined) {
  const targetUrl = new URL(req.url || '/', targetBaseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const method = req.method || 'GET';
    const response = await fetch(targetUrl, {
      method,
      headers: filteredProxyHeaders(req.headers),
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      redirect: 'manual',
      signal: controller.signal,
    });
    const responseBody = Buffer.from(await response.arrayBuffer());
    return {
      ok: true,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: responseBody,
      target: targetBaseUrl.href,
    };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: Buffer.from(JSON.stringify({
        ok: false,
        error: error instanceof Error && error.name === 'AbortError'
          ? 'Upstream request timed out'
          : 'Upstream request failed',
      })),
      target: targetBaseUrl.href,
      error,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function jsonFromRelayResult(result) {
  if (!result?.body || result.body.length === 0) return null;
  try {
    return JSON.parse(result.body.toString('utf8'));
  } catch {
    return null;
  }
}

function aggregateScore(payload) {
  const aggregate = payload?.aggregate;
  if (!aggregate || typeof aggregate !== 'object') return -1;
  const participants = Number(aggregate.participants);
  const weight = Number(aggregate.weight);
  const agree = Number(aggregate.agree);
  const disagree = Number(aggregate.disagree);
  const rowCount = Number(payload.row_count);
  return [
    Number.isFinite(participants) ? participants : 0,
    Number.isFinite(weight) ? weight : 0,
    Number.isFinite(rowCount) ? rowCount : 0,
    Number.isFinite(agree) ? agree : 0,
    Number.isFinite(disagree) ? disagree : 0,
  ].reduce((score, value, index) => score + Math.max(0, value) / (index + 1), 0);
}

function selectBestUpstreamHttpError(results) {
  const errors = results.filter((result) =>
    result?.ok === true && (result.status < 200 || result.status >= 300));
  if (errors.length === 0) return null;

  const clientErrors = errors.filter((result) => result.status >= 400 && result.status < 500);
  const candidates = clientErrors.length > 0 ? clientErrors : errors;
  return [...candidates].sort((a, b) => a.status - b.status)[0] ?? null;
}

function selectBestAggregateRead(results) {
  let best = null;
  for (const result of results) {
    if (!result.ok || result.status < 200 || result.status >= 300) continue;
    const payload = jsonFromRelayResult(result);
    if (!payload?.ok || !payload.aggregate) continue;
    const score = aggregateScore(payload);
    if (!best || score > best.score) {
      best = { result, score };
    }
  }
  return best?.result ?? selectBestUpstreamHttpError(results);
}

function selectBestAggregateWrite(results) {
  const success = results.find((result) => {
    if (!result.ok || result.status < 200 || result.status >= 300) return false;
    const payload = jsonFromRelayResult(result);
    return payload?.ok === true;
  });
  if (success) return success;
  return results.find((result) => result.ok) ?? results[0] ?? null;
}

function forumCommentsScore(payload) {
  if (!payload?.ok || !Array.isArray(payload.comments)) return -1;
  return payload.comments.length;
}

function selectBestForumRead(results, pathname) {
  let best = null;
  for (const result of results) {
    if (!result.ok || result.status < 200 || result.status >= 300) continue;
    const payload = jsonFromRelayResult(result);
    let score = -1;
    if (pathname === '/vh/forum/comments') {
      score = forumCommentsScore(payload);
    } else if (pathname === '/vh/forum/thread') {
      score = payload?.ok === true && payload.thread ? 1 : 0;
    }
    if (score < 0) continue;
    if (!best || score > best.score) {
      best = { result, score };
    }
  }
  return best?.result ?? results.find((result) => result.ok) ?? results[0] ?? null;
}

function relayRecordScore(payload, pathname) {
  if (!payload?.ok) return -1;
  if (pathname === '/vh/news/latest-index' || pathname === '/vh/news/hot-index') {
    const records = payload.records && typeof payload.records === 'object'
      ? payload.records
      : payload.index && typeof payload.index === 'object'
        ? payload.index
        : null;
    if (!records) return -1;
    const recordCount = Object.keys(records).length;
    const composition = payload.composition && typeof payload.composition === 'object'
      ? payload.composition
      : null;
    if (!composition) return recordCount;
    const totalVisible = Number.isFinite(Number(composition.total_visible))
      ? Number(composition.total_visible)
      : recordCount;
    const multiSourceVisible = Number.isFinite(Number(composition.multi_source_visible))
      ? Number(composition.multi_source_visible)
      : 0;
    const maxSourceCount = Number.isFinite(Number(composition.max_source_count))
      ? Number(composition.max_source_count)
      : 0;
    const freshnessAgeMs = Number(composition.freshness_age_ms);
    const freshnessPenalty = Number.isFinite(freshnessAgeMs)
      ? Math.min(Math.floor(Math.max(0, freshnessAgeMs) / 60_000), 10_080)
      : 10_080;
    return recordCount
      + (totalVisible * 10)
      + (multiSourceVisible * 100_000)
      + (maxSourceCount * 1_000)
      - freshnessPenalty;
  }
  if (pathname === '/vh/news/story') {
    return (payload.record && typeof payload.record === 'object')
      || (payload.story && typeof payload.story === 'object')
      ? 1
      : -1;
  }
  if (pathname === '/vh/topics/synthesis') {
    return payload.record && typeof payload.record === 'object' ? 1 : -1;
  }
  return -1;
}

function selectBestNewsRead(results, pathname) {
  let best = null;
  for (const result of results) {
    if (!result.ok || result.status < 200 || result.status >= 300) continue;
    const payload = jsonFromRelayResult(result);
    const score = relayRecordScore(payload, pathname);
    if (score < 0) continue;
    if (!best || score > best.score) {
      best = { result, score };
    }
  }
  return best?.result ?? results.find((result) => result.ok) ?? results[0] ?? null;
}

function isUsableOrderedNewsRead(result, pathname) {
  if (!result?.ok || result.status < 200 || result.status >= 300) return false;
  const payload = jsonFromRelayResult(result);
  const score = relayRecordScore(payload, pathname);
  if (score <= 0) return false;
  if (pathname !== '/vh/news/latest-index') return true;
  const records = payload?.records && typeof payload.records === 'object'
    ? payload.records
    : payload?.index && typeof payload.index === 'object'
      ? payload.index
      : null;
  if (!records || Object.keys(records).length === 0) return false;
  const composition = payload?.composition && typeof payload.composition === 'object'
    ? payload.composition
    : null;
  if (!composition) return true;
  const multiSourceVisible = Number(composition.multi_source_visible);
  return Number.isFinite(multiSourceVisible) && multiSourceVisible > 0;
}

function writeRelayResult(res, result) {
  if (!result) {
    sendJson(res, 502, { ok: false, error: 'Upstream request failed' });
    return;
  }
  res.writeHead(result.status, result.headers);
  res.end(result.body);
}

async function proxyRelayFanout(req, res, relayTargets, timeoutMs) {
  const pathname = new URL(req.url || '/', 'http://vh-public-origin.local').pathname;
  const method = req.method || 'GET';
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readRequestBody(req);
  const results = await Promise.all(relayTargets.map((target) =>
    fetchRelayTarget(req, target, timeoutMs, body)));
  let selected = null;
  if (method === 'GET' && pathname === '/vh/aggregates/point') {
    selected = selectBestAggregateRead(results);
  } else if (method === 'GET' && FORUM_FANOUT_READ_PATHS.has(pathname)) {
    selected = selectBestForumRead(results, pathname);
  } else if (method === 'GET' && NEWS_FANOUT_READ_PATHS.has(pathname)) {
    selected = selectBestNewsRead(results, pathname);
  } else {
    selected = selectBestAggregateWrite(results);
  }
  writeRelayResult(res, selected);
}

async function proxyRelayOrderedNewsRead(req, res, relayTargets, timeoutMs) {
  const pathname = new URL(req.url || '/', 'http://vh-public-origin.local').pathname;
  const results = [];
  let pending = relayTargets.map((target) => {
    const item = {};
    item.promise = fetchRelayTarget(req, target, timeoutMs).then((result) => ({ item, result }));
    return item;
  });

  while (pending.length > 0) {
    const { item, result } = await Promise.race(pending.map((candidate) => candidate.promise));
    pending = pending.filter((candidate) => candidate !== item);
    results.push(result);
    if (isUsableOrderedNewsRead(result, pathname)) {
      writeRelayResult(res, result);
      return;
    }
  }

  writeRelayResult(res, selectBestNewsRead(results, pathname));
}

async function proxyRequest(req, res, targetBaseUrl, timeoutMs) {
  const targetUrl = new URL(req.url || '/', targetBaseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortForClientClose = () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  };
  req.once('aborted', abortForClientClose);
  res.once('close', abortForClientClose);
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
    try {
      await pipeline(response.body, res);
    } catch (error) {
      if (isClientDisconnectError(error)) return;
      throw error;
    }
  } catch (error) {
    if (isClientDisconnectError(error) || !responseWritable(res)) return;
    sendJson(res, 502, {
      ok: false,
      error: error instanceof Error && error.name === 'AbortError'
        ? 'Upstream request timed out'
        : 'Upstream request failed',
    });
  } finally {
    clearTimeout(timeout);
    req.off('aborted', abortForClientClose);
    res.off('close', abortForClientClose);
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
  const isHtml = contentType.startsWith('text/html');
  applySecurityHeaders(res, csp);
  if (isHtml) {
    const body = rewriteCspMeta(await readFile(filePath, 'utf8'), csp);
    res.writeHead(200, {
      'content-type': contentType,
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-cache, must-revalidate',
    });
    if (method === 'HEAD') {
      res.end();
      return;
    }
    res.end(body);
    return;
  }
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
  try {
    await pipeline(createReadStream(filePath), res);
  } catch (error) {
    if (isClientDisconnectError(error)) return;
    throw error;
  }
}

export function createPublicBetaOriginHandler(options) {
  const staticDir = resolve(options.staticDir);
  const peerConfigPath = resolve(options.peerConfigPath);
  const analysisTarget = options.analysisTarget ? new URL(options.analysisTarget) : null;
  const relayTargets = parseRelayTargets(options.relayTargets);
  if (relayTargets.length === 0 && options.relayTarget) {
    relayTargets.push(...parseRelayTargets([options.relayTarget]));
  }
  const relayTarget = relayTargets[0] ?? null;
  const csp = buildCsp(options.cspConnectSrc);
  const proxyTimeoutMs = options.proxyTimeoutMs || DEFAULT_PROXY_TIMEOUT_MS;
  const relayProxyTimeoutMs = options.relayProxyTimeoutMs || Math.min(proxyTimeoutMs, DEFAULT_RELAY_PROXY_TIMEOUT_MS);
  const relayFanoutTimeoutMs = Math.min(
    relayProxyTimeoutMs,
    options.relayFanoutTimeoutMs || DEFAULT_RELAY_FANOUT_TIMEOUT_MS,
  );
  const relayNewsFanoutTimeoutMs = Math.min(
    relayFanoutTimeoutMs,
    options.relayNewsFanoutTimeoutMs || DEFAULT_RELAY_NEWS_FANOUT_TIMEOUT_MS,
  );

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
        relay_proxy_configured: Boolean(relayTarget),
        relay_proxy_target_count: relayTargets.length,
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

    if (isRelayProxyRoute(pathname)) {
      if (!isRelayProxyMethodAllowed(pathname, req.method || 'GET')) {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      if (!relayTarget) {
        sendJson(res, 503, { error: 'Relay proxy not configured' });
        return;
      }
      const isNewsFanoutRead = NEWS_FANOUT_READ_PATHS.has(pathname) && (req.method || 'GET') === 'GET';
      if (
        relayTargets.length > 1
        && (
          (pathname === '/vh/aggregates/point' && (req.method || 'GET') === 'GET')
          || isNewsFanoutRead
          || (AGGREGATE_FANOUT_WRITE_PATHS.has(pathname) && (req.method || 'GET') === 'POST')
          || (FORUM_FANOUT_READ_PATHS.has(pathname) && (req.method || 'GET') === 'GET')
          || (FORUM_FANOUT_WRITE_PATHS.has(pathname) && (req.method || 'GET') === 'POST')
        )
      ) {
        if (isNewsFanoutRead) {
          if (pathname === '/vh/news/hot-index') {
            await proxyRelayFanout(req, res, relayTargets, relayNewsFanoutTimeoutMs);
            return;
          }
          await proxyRelayOrderedNewsRead(req, res, relayTargets, relayNewsFanoutTimeoutMs);
          return;
        }
        await proxyRelayFanout(req, res, relayTargets, relayFanoutTimeoutMs);
        return;
      }
      await proxyRequest(req, res, relayTarget, relayProxyTimeoutMs);
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
  const port = options.port === undefined || options.port === null || options.port === ''
    ? DEFAULT_PORT
    : Number(options.port);
  const handler = createPublicBetaOriginHandler(options);
  const server = createServer((req, res) => {
    handler(req, res).catch((error) => {
      if (isClientDisconnectError(error) || !responseWritable(res)) return;
      sendJson(res, 500, { ok: false, error: 'Origin request failed' });
    });
  });
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
    relayTarget: process.env.VH_PUBLIC_ORIGIN_RELAY_TARGET || '',
    relayTargets: process.env.VH_PUBLIC_ORIGIN_RELAY_TARGETS || process.env.VH_PUBLIC_ORIGIN_RELAY_TARGET || '',
    cspConnectSrc: process.env.VH_PUBLIC_ORIGIN_CSP_CONNECT_SRC || "'self'",
    proxyTimeoutMs: Number(process.env.VH_PUBLIC_ORIGIN_PROXY_TIMEOUT_MS || DEFAULT_PROXY_TIMEOUT_MS),
    relayProxyTimeoutMs: Number(process.env.VH_PUBLIC_ORIGIN_RELAY_PROXY_TIMEOUT_MS || DEFAULT_RELAY_PROXY_TIMEOUT_MS),
    relayFanoutTimeoutMs: Number(process.env.VH_PUBLIC_ORIGIN_RELAY_FANOUT_TIMEOUT_MS || DEFAULT_RELAY_FANOUT_TIMEOUT_MS),
    relayNewsFanoutTimeoutMs: Number(
      process.env.VH_PUBLIC_ORIGIN_RELAY_NEWS_FANOUT_TIMEOUT_MS || DEFAULT_RELAY_NEWS_FANOUT_TIMEOUT_MS,
    ),
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
