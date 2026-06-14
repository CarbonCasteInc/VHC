#!/usr/bin/env node
'use strict';

const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3001);
const ARTICLE_TEXT_CACHE_TTL_MS = Number(process.env.ARTICLE_TEXT_CACHE_TTL_MS || 5 * 60 * 1000);
const ARTICLE_TEXT_MAX_CHARS = Number(process.env.ARTICLE_TEXT_MAX_CHARS || 24_000);
const ARTICLE_FETCH_TIMEOUT_MS = Number(process.env.ARTICLE_FETCH_TIMEOUT_MS || 12_000);
const ARTICLE_FETCH_USER_AGENT =
  process.env.ARTICLE_FETCH_USER_AGENT
  || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const ANALYZE_FAIL_CLOSED_STATUS = 501;

const startedAt = Date.now();
const articleTextCache = new Map();

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function decodeHtmlEntities(input) {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function normalizeWhitespace(input) {
  return decodeHtmlEntities(input).replace(/\s+/g, ' ').trim();
}

function extractTitle(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return normalizeWhitespace(titleMatch?.[1] ?? '').slice(0, 300);
}

function stripNonContentTags(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, ' ');
}

function htmlToReadableText(rawHtml) {
  const cleaned = stripNonContentTags(rawHtml);

  const paragraphChunks = Array.from(
    cleaned.matchAll(/<(?:article|p|h1|h2|h3|li|blockquote)\b[^>]*>([\s\S]*?)<\/(?:article|p|h1|h2|h3|li|blockquote)>/gi),
    (match) => normalizeWhitespace((match[1] ?? '').replace(/<[^>]+>/g, ' ')),
  ).filter((chunk) => chunk.length > 0);

  if (paragraphChunks.length > 0) {
    return normalizeWhitespace(paragraphChunks.join(' '));
  }

  return normalizeWhitespace(cleaned.replace(/<[^>]+>/g, ' '));
}

function buildHealthPayload(parsedRequest) {
  return {
    ok: true,
    service: 'vh-analysis-backend-3001',
    contract: 'analysis-backend-health-v1',
    host: HOST,
    port: PORT,
    pipeline: parsedRequest.searchParams.get('pipeline') === 'true',
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    routes: {
      health: ['/health', '/api/health', '/healthz', '/status', '/api/analyze/health', '/api/analysis/health?pipeline=true', '/?pipeline=true'],
      config: '/api/analyze/config',
      analyze: '/api/analyze',
      articleText: '/api/article-text?url=<http(s)://...>',
    },
  };
}

function buildAnalyzeConfigPayload() {
  return {
    configured: true,
    service: 'vh-analysis-backend-3001',
    contract: 'analysis-backend-config-v1',
    provider_id: 'vh-analysis-backend-3001',
    upstream_url: 'local-only',
    model: 'not-configured',
    analyses_limit: 0,
    analyses_per_topic_limit: 0,
    article_text: {
      configured: true,
      route: '/api/article-text?url=<http(s)://...>',
      max_chars: ARTICLE_TEXT_MAX_CHARS,
      cache_ttl_ms: ARTICLE_TEXT_CACHE_TTL_MS,
      fetch_timeout_ms: ARTICLE_FETCH_TIMEOUT_MS,
    },
    analyze_post: {
      configured: false,
      status: 'fail_closed',
      http_status: ANALYZE_FAIL_CLOSED_STATUS,
      reason: 'full_analysis_out_of_beta_scope',
    },
  };
}

function isHealthPath(pathname, parsedRequest) {
  if (
    pathname === '/health' ||
    pathname === '/api/health' ||
    pathname === '/healthz' ||
    pathname === '/status' ||
    pathname === '/api/analyze/health' ||
    pathname === '/api/analysis/health'
  ) {
    return true;
  }

  if (pathname === '/' && parsedRequest.searchParams.get('pipeline') === 'true') {
    return true;
  }

  return false;
}

async function handleArticleText(parsedRequest, res) {
  const targetParam = parsedRequest.searchParams.get('url')?.trim() ?? '';
  if (!targetParam) {
    sendJson(res, 400, { error: 'Missing url query parameter' });
    return;
  }

  let targetUrl;
  try {
    targetUrl = new URL(targetParam);
  } catch {
    sendJson(res, 400, { error: 'Invalid target URL' });
    return;
  }

  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    sendJson(res, 400, { error: 'Only http/https URLs are supported' });
    return;
  }

  const cacheKey = targetUrl.toString();
  const cached = articleTextCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    sendJson(res, 200, cached.payload);
    return;
  }

  try {
    const { stdout } = await execFileAsync(
      'curl',
      [
        '--http1.1',
        '--location',
        '--max-time',
        String(Math.ceil(ARTICLE_FETCH_TIMEOUT_MS / 1000)),
        '--silent',
        '--show-error',
        '--header',
        'Accept: text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
        '--user-agent',
        ARTICLE_FETCH_USER_AGENT,
        cacheKey,
      ],
      {
        maxBuffer: 4 * 1024 * 1024,
      },
    );

    const raw = stdout.toString();
    const title = extractTitle(raw);
    const text = htmlToReadableText(raw);
    if (!text) {
      sendJson(res, 422, {
        error: 'Article text extraction returned empty content',
        url: cacheKey,
      });
      return;
    }

    const payload = {
      url: cacheKey,
      title,
      text: text.slice(0, ARTICLE_TEXT_MAX_CHARS),
      truncated: text.length > ARTICLE_TEXT_MAX_CHARS,
    };

    articleTextCache.set(cacheKey, {
      expiresAt: Date.now() + ARTICLE_TEXT_CACHE_TTL_MS,
      payload,
    });

    sendJson(res, 200, payload);
  } catch (error) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
    const fallbackMessage =
      typeof error?.message === 'string'
        ? error.message
        : 'Article fetch failed';

    sendJson(res, 502, {
      error: stderr || fallbackMessage,
      url: cacheKey,
    });
  }
}

async function drainRequestBody(req) {
  for await (const _chunk of req) {
    // Drain the request so keep-alive clients do not see a reset.
  }
}

async function handleAnalyzePost(req, res) {
  await drainRequestBody(req);
  sendJson(res, ANALYZE_FAIL_CLOSED_STATUS, {
    ok: false,
    configured: false,
    service: 'vh-analysis-backend-3001',
    contract: 'analysis-backend-post-v1',
    error: 'On-demand full analysis is not enabled on this beta backend',
    error_class: 'full_analysis_out_of_beta_scope',
    release_ready: false,
    article_text_route: '/api/article-text?url=<http(s)://...>',
  });
}

function createAnalysisBackendServer() {
  return http.createServer((req, res) => {
    const method = (req.method ?? 'GET').toUpperCase();
    const parsedRequest = new URL(req.url ?? '/', 'http://localhost');
    const pathname = parsedRequest.pathname;

    if (isHealthPath(pathname, parsedRequest)) {
      if (method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      sendJson(res, 200, buildHealthPayload(parsedRequest));
      return;
    }

    if (pathname === '/api/analyze/config') {
      if (method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      sendJson(res, 200, buildAnalyzeConfigPayload());
      return;
    }

    if (pathname === '/api/analyze') {
      if (method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      void handleAnalyzePost(req, res);
      return;
    }

    if (pathname === '/api/article-text' || pathname === '/article-text') {
      if (method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      void handleArticleText(parsedRequest, res);
      return;
    }

    sendJson(res, 404, {
      error: 'Not found',
      contract: 'analysis-backend-health-v1',
      hint: 'Use /api/analyze/health, /api/analyze/config, /health, or /api/analysis/health?pipeline=true',
    });
  });
}

if (require.main === module) {
  const server = createAnalysisBackendServer();
  server.listen(PORT, HOST, () => {
    console.log(
      `[vh:analysis-backend] listening http://${HOST}:${PORT} (health=/api/analyze/health config=/api/analyze/config article=/api/article-text?url=...)`,
    );
  });

  function shutdown(signal) {
    console.log(`[vh:analysis-backend] received ${signal}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = {
  ANALYZE_FAIL_CLOSED_STATUS,
  buildAnalyzeConfigPayload,
  buildHealthPayload,
  createAnalysisBackendServer,
};
