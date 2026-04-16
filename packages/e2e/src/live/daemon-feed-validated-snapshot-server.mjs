#!/usr/bin/env node

import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveLatestPassingCanaryArtifact,
  resolvePublisherCanaryArtifactRoot,
  summarizePublishedStoreSnapshot,
} from './daemon-feed-canary-shared.mjs';

const DEFAULT_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
const DEFAULT_SNAPSHOT_REFRESH_MS = 10_000;

function readJson(filePath, readFile = readFileSync) {
  return JSON.parse(readFile(filePath, 'utf8'));
}

function parseRefreshMs(raw, fallback = DEFAULT_SNAPSHOT_REFRESH_MS) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

export function resolveValidatedSnapshotFixture({
  repoRoot = DEFAULT_REPO_ROOT,
  env = process.env,
  exists = existsSync,
  readdir = readdirSync,
  stat = statSync,
  readFile = readFileSync,
} = {}) {
  const explicitPath = env.VH_VALIDATED_SNAPSHOT_FIXTURE_PATH?.trim();
  if (explicitPath) {
    const snapshot = readJson(explicitPath, readFile);
    return {
      snapshotPath: explicitPath,
      snapshot,
      artifactDir: path.dirname(explicitPath),
      summaryPath: null,
      summary: null,
    };
  }

  const artifactRoot = resolvePublisherCanaryArtifactRoot(repoRoot, env);
  const latest = resolveLatestPassingCanaryArtifact(artifactRoot, {
    exists,
    readdir,
    stat,
    readFile,
    summaryFileName: 'publisher-canary-summary.json',
    requiredArtifactNames: ['published-store-snapshot.json'],
    passPredicate: (summary) => summary?.pass === true,
  });
  if (!latest) {
    throw new Error(`no passing publisher-canary artifact found under ${artifactRoot}`);
  }
  const snapshotPath = path.join(latest.artifactDir, 'published-store-snapshot.json');
  return {
    snapshotPath,
    snapshot: readJson(snapshotPath, readFile),
    artifactDir: latest.artifactDir,
    summaryPath: latest.summaryPath,
    summary: latest.summary,
  };
}

export function createValidatedSnapshotResolver({
  repoRoot = DEFAULT_REPO_ROOT,
  env = process.env,
  exists = existsSync,
  readdir = readdirSync,
  stat = statSync,
  readFile = readFileSync,
  now = () => Date.now(),
} = {}) {
  const refreshMs = parseRefreshMs(env.VH_VALIDATED_SNAPSHOT_REFRESH_MS);
  let cached = null;
  let cachedAt = 0;

  function shouldRefresh(force) {
    if (force || !cached) {
      return true;
    }
    if (refreshMs === 0) {
      return false;
    }
    return now() - cachedAt >= refreshMs;
  }

  return {
    getFixture({ force = false } = {}) {
      if (!shouldRefresh(force)) {
        return cached;
      }

      try {
        cached = resolveValidatedSnapshotFixture({
          repoRoot,
          env,
          exists,
          readdir,
          stat,
          readFile,
        });
        cachedAt = now();
      } catch (error) {
        if (!cached) {
          throw error;
        }
      }

      return cached;
    },
    getRefreshMs() {
      return refreshMs;
    },
  };
}

export async function startValidatedSnapshotServer({
  repoRoot = DEFAULT_REPO_ROOT,
  env = process.env,
  log = console.log,
} = {}) {
  const port = Number.parseInt(env.VH_VALIDATED_SNAPSHOT_PORT ?? '8790', 10);
  const resolver = createValidatedSnapshotResolver({ repoRoot, env });
  const initialFixture = resolver.getFixture({ force: true });
  const initialSummary = summarizePublishedStoreSnapshot(initialFixture.snapshot);
  const corsHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };

  function resolveResponsePayload() {
    const fixture = resolver.getFixture();
    return {
      fixture,
      summary: summarizePublishedStoreSnapshot(fixture.snapshot),
    };
  }

  const server = createServer((req, res) => {
    const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }
    if (requestUrl.pathname === '/health') {
      const { fixture, summary } = resolveResponsePayload();
      res.writeHead(200, { ...corsHeaders, 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        fixture: {
          artifactDir: fixture.artifactDir,
          summaryPath: fixture.summaryPath,
          snapshotPath: fixture.snapshotPath,
        },
        refreshMs: resolver.getRefreshMs(),
        snapshotSummary: summary,
      }));
      return;
    }
    if (requestUrl.pathname === '/snapshot.json') {
      const { fixture } = resolveResponsePayload();
      res.writeHead(200, { ...corsHeaders, 'content-type': 'application/json' });
      res.end(JSON.stringify(fixture.snapshot));
      return;
    }
    if (requestUrl.pathname === '/meta.json') {
      const { fixture, summary } = resolveResponsePayload();
      res.writeHead(200, { ...corsHeaders, 'content-type': 'application/json' });
      res.end(JSON.stringify({
        fixture: {
          artifactDir: fixture.artifactDir,
          summaryPath: fixture.summaryPath,
          snapshotPath: fixture.snapshotPath,
        },
        refreshMs: resolver.getRefreshMs(),
        snapshotSummary: summary,
      }));
      return;
    }
    res.writeHead(404, { ...corsHeaders, 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  log(`[vh:validated-snapshot] listening on http://127.0.0.1:${port}`);
  log(`[vh:validated-snapshot] fixture ${initialFixture.snapshotPath}`);
  return { server, port, fixture: initialFixture, summary: initialSummary, resolver };
}

async function main() {
  await startValidatedSnapshotServer();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('[vh:validated-snapshot] failed', error);
    process.exit(1);
  });
}
