#!/usr/bin/env node

import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLatestPassingCanaryArtifact, summarizePublishedStoreSnapshot } from './daemon-feed-canary-shared.mjs';

const DEFAULT_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

function readJson(filePath, readFile = readFileSync) {
  return JSON.parse(readFile(filePath, 'utf8'));
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

  const artifactRoot = path.join(repoRoot, '.tmp', 'daemon-feed-publisher-canary');
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

export async function startValidatedSnapshotServer({
  repoRoot = DEFAULT_REPO_ROOT,
  env = process.env,
  log = console.log,
} = {}) {
  const port = Number.parseInt(env.VH_VALIDATED_SNAPSHOT_PORT ?? '8790', 10);
  const fixture = resolveValidatedSnapshotFixture({ repoRoot, env });
  const summary = summarizePublishedStoreSnapshot(fixture.snapshot);
  const corsHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };

  const server = createServer((req, res) => {
    const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }
    if (requestUrl.pathname === '/health') {
      res.writeHead(200, { ...corsHeaders, 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        fixture: {
          artifactDir: fixture.artifactDir,
          summaryPath: fixture.summaryPath,
          snapshotPath: fixture.snapshotPath,
        },
        snapshotSummary: summary,
      }));
      return;
    }
    if (requestUrl.pathname === '/snapshot.json') {
      res.writeHead(200, { ...corsHeaders, 'content-type': 'application/json' });
      res.end(JSON.stringify(fixture.snapshot));
      return;
    }
    if (requestUrl.pathname === '/meta.json') {
      res.writeHead(200, { ...corsHeaders, 'content-type': 'application/json' });
      res.end(JSON.stringify({
        fixture: {
          artifactDir: fixture.artifactDir,
          summaryPath: fixture.summaryPath,
          snapshotPath: fixture.snapshotPath,
        },
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
  log(`[vh:validated-snapshot] fixture ${fixture.snapshotPath}`);
  return { server, port, fixture, summary };
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
