import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const ARTICLE_TEXT_CACHE_TTL_MS = 5 * 60 * 1000;
const ARTICLE_TEXT_MAX_CHARS = 24_000;
const ARTICLE_FETCH_TIMEOUT_MS = 12_000;
const articleTextCache = new Map<
  string,
  {
    expiresAt: number;
    payload: {
      url: string;
      title: string;
      text: string;
      truncated: boolean;
    };
  }
>();
const execFileAsync = promisify(execFile);

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function normalizeWhitespace(input: string): string {
  return decodeHtmlEntities(input).replace(/\s+/g, ' ').trim();
}

function extractTitle(html: string): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return normalizeWhitespace(titleMatch?.[1] ?? '').slice(0, 300);
}

function stripNonContentTags(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, ' ');
}

function htmlToReadableText(rawHtml: string): string {
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

function createArticleTextProxyPlugin(): Plugin {
  return {
    name: 'vh-article-text-proxy',
    configureServer(server) {
      server.middlewares.use('/article-text', async (req, res) => {
        if (!req.url) {
          sendJson(res, 400, { error: 'Missing request URL' });
          return;
        }

        if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
          sendJson(res, 405, { error: 'Method not allowed' });
          return;
        }

        const parsedRequest = new URL(req.url, 'http://localhost');
        const targetParam = parsedRequest.searchParams.get('url')?.trim() ?? '';
        if (!targetParam) {
          sendJson(res, 400, { error: 'Missing url query parameter' });
          return;
        }

        let targetUrl: URL;
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
              '--location',
              '--max-time',
              String(Math.ceil(ARTICLE_FETCH_TIMEOUT_MS / 1000)),
              '--silent',
              '--show-error',
              '--header',
              'Accept: text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
              '--user-agent',
              'Mozilla/5.0 (compatible; VHC-NewsCard/1.0; +https://ccibootstrap.tail6cc9b5.ts.net)',
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

          const truncatedText = text.slice(0, ARTICLE_TEXT_MAX_CHARS);
          const payload = {
            url: cacheKey,
            title,
            text: truncatedText,
            truncated: text.length > ARTICLE_TEXT_MAX_CHARS,
          };

          articleTextCache.set(cacheKey, {
            expiresAt: Date.now() + ARTICLE_TEXT_CACHE_TTL_MS,
            payload,
          });

          sendJson(res, 200, payload);
        } catch (error) {
          const errorObject =
            error && typeof error === 'object'
              ? (error as { stderr?: unknown; message?: unknown })
              : undefined;
          const stderr =
            typeof errorObject?.stderr === 'string' ? errorObject.stderr.trim() : '';
          const fallbackMessage =
            typeof errorObject?.message === 'string'
              ? errorObject.message
              : error instanceof Error
                ? error.message
                : 'Article fetch failed';

          sendJson(res, 502, {
            error: stderr || fallbackMessage,
            url: cacheKey,
          });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), createArticleTextProxyPlugin()],
  server: {
    host: true,
    port: 2048,
    strictPort: true,
    allowedHosts: [
      '100.75.18.26',
      'ccibootstrap.tail6cc9b5.ts.net',
      '.tail6cc9b5.ts.net'
    ],
    proxy: {
      '/gun': {
        target: 'http://127.0.0.1:7777',
        changeOrigin: true,
        ws: true,
        secure: false
      },

      // Same-origin RSS proxy routes (avoids browser CORS/CSP issues).
      '/rss/fox-latest': {
        target: 'https://moxie.foxnews.com',
        changeOrigin: true,
        secure: true,
        rewrite: () => '/google-publisher/latest.xml'
      },
      '/rss/washtimes-politics': {
        target: 'https://www.washingtontimes.com',
        changeOrigin: true,
        secure: true,
        rewrite: () => '/rss/headlines/news/politics/'
      },
      '/rss/federalist': {
        target: 'https://thefederalist.com',
        changeOrigin: true,
        secure: true,
        rewrite: () => '/feed/'
      },
      '/rss/guardian-us': {
        target: 'https://www.theguardian.com',
        changeOrigin: true,
        secure: true,
        rewrite: () => '/us-news/rss'
      },
      '/rss/huffpost-us': {
        target: 'https://chaski.huffpost.com',
        changeOrigin: true,
        secure: true,
        rewrite: () => '/us/auto/vertical/us-news'
      },
      '/rss/washpost-politics': {
        target: 'https://feeds.washingtonpost.com',
        changeOrigin: true,
        secure: true,
        rewrite: () => '/rss/politics'
      },
      '/rss/bbc-general': {
        target: 'https://feeds.bbci.co.uk',
        changeOrigin: true,
        secure: true,
        rewrite: () => '/news/rss.xml'
      },
      '/rss/bbc-us-canada': {
        target: 'https://feeds.bbci.co.uk',
        changeOrigin: true,
        secure: true,
        rewrite: () => '/news/world/us_and_canada/rss.xml'
      },
      '/rss/yahoo-world': {
        target: 'https://news.yahoo.com',
        changeOrigin: true,
        secure: true,
        rewrite: () => '/rss/world'
      }
    }
  },
  define: {
    'process.env': {},
    global: 'window'
  },
  worker: {
    format: 'es'
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@vh/ui': path.resolve(__dirname, '../../packages/ui/src'),
      '@vh/gun-client': path.resolve(__dirname, '../../packages/gun-client/src'),
      '@vh/types': path.resolve(__dirname, '../../packages/types/src'),
      '@vh/ai-engine': path.resolve(__dirname, '../../packages/ai-engine/src'),
      '@vh/crypto': path.resolve(__dirname, '../../packages/crypto/src'),
      '@vh/data-model': path.resolve(__dirname, '../../packages/data-model/src'),
      '@vh/contracts': path.resolve(__dirname, '../../packages/contracts/typechain-types'),
      '@vh/identity-vault': path.resolve(__dirname, '../../packages/identity-vault/src')
    }
  }
});
