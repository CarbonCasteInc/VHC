#!/usr/bin/env node

import { chmod, link, lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';

const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : '';
if (!['preflight', 'start', 'diagnostic'].includes(mode)) {
  console.error('[vh:publisher-recovery] artifact mode must be preflight, start, or diagnostic');
  process.exit(78);
}

const revision = process.env.VH_NEWS_DAEMON_EXPECTED_REVISION?.trim() ?? '';
if (!/^[0-9a-f]{40}$/.test(revision)) {
  console.error('[vh:publisher-recovery] artifact revision is missing or malformed');
  process.exit(78);
}

const runId = process.env.VH_DAEMON_FEED_RUN_ID?.trim() ?? '';
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId) || runId === '.' || runId === '..') {
  console.error('[vh:publisher-recovery] artifact run id is missing');
  process.exit(78);
}

async function requirePrivateParent(filePath) {
  const parent = path.dirname(filePath);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const stat = await lstat(parent);
  if (stat.isSymbolicLink() || !stat.isDirectory()
    || (typeof process.getuid === 'function' && stat.uid !== process.getuid())
    || (stat.mode & 0o777) !== 0o700
    || await realpath(parent) !== path.resolve(parent)) {
    throw new Error('artifact parent must be private');
  }
  return parent;
}

async function writePrivateJsonAtomic(filePath, payload, { replace = true } = {}) {
  if (!path.isAbsolute(filePath)) {
    throw new Error('artifact path must be absolute');
  }
  const parent = await requirePrivateParent(filePath);
  const tempPath = path.join(parent, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  let handle;
  try {
    handle = await open(tempPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(tempPath, 0o600);
    if (replace) {
      try {
        const existing = await lstat(filePath);
        if (existing.isSymbolicLink() || !existing.isFile()
          || (typeof process.getuid === 'function' && existing.uid !== process.getuid())
          || (existing.mode & 0o777) !== 0o600) {
          throw new Error('artifact replace target is unsafe');
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      await rename(tempPath, filePath);
      await chmod(filePath, 0o600);
    } else {
      await link(tempPath, filePath);
      // The linked final path already references the fsynced mode-0600 inode.
      // A hidden-temp cleanup failure cannot make that commit ambiguous.
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

const generatedAt = new Date().toISOString();
const common = {
  generatedAt,
  status: 'preflight_passed',
  revision,
  runId,
  stateDir: process.env.VH_NEWS_DAEMON_STATE_DIR,
  artifactRoot: process.env.VH_DAEMON_FEED_ARTIFACT_ROOT,
  queueDir: process.env.VH_BUNDLE_SYNTHESIS_QUEUE_DIR,
  lifecycleLedger: process.env.VH_BUNDLE_SYNTHESIS_LIFECYCLE_LEDGER,
};

try {
  if (mode === 'preflight') {
    const filePath = process.env.VH_NEWS_DAEMON_PREFLIGHT_ARTIFACT?.trim() ?? '';
    if (!filePath) throw new Error('preflight artifact path is missing');
    await writePrivateJsonAtomic(filePath, {
      schemaVersion: 'vh-news-daemon-recovery-preflight-v1',
      ...common,
      mode: 'preflight_only',
      gates: [
        'source_liveness',
        'storycluster_build',
        'openai_provider',
        'storycluster_qdrant_readiness',
        'raw_publication_readiness',
      ],
    }, { replace: false });
  } else {
    const lastSuccessFile = process.env.VH_NEWS_DAEMON_LAST_SUCCESS_FILE?.trim() ?? '';
    const currentRunFile = process.env.VH_NEWS_DAEMON_CURRENT_RUN_FILE?.trim() ?? '';
    if (!lastSuccessFile || !currentRunFile) throw new Error('start artifact path is missing');
    await writePrivateJsonAtomic(lastSuccessFile, {
      schemaVersion: 'vh-news-daemon-production-start-v1',
      ...common,
      approvalScope: mode === 'diagnostic' ? 'diagnostic_no_write' : 'attended_start_once',
      noWrite: mode === 'diagnostic',
    });
    await writePrivateJsonAtomic(currentRunFile, {
      schemaVersion: 'vh-news-daemon-current-run-v1',
      ...common,
      approvalScope: mode === 'diagnostic' ? 'diagnostic_no_write' : 'attended_start_once',
      noWrite: mode === 'diagnostic',
    });
  }
} catch (error) {
  console.error(`[vh:publisher-recovery] ${mode}_artifact_write_failed`);
  process.exit(78);
}
