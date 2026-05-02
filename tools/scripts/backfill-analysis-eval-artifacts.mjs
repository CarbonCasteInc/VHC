#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createClient, readTopicLatestSynthesis, writeTopicSynthesis } from '@vh/gun-client';

function parseArgs(argv) {
  const parsed = {
    artifactDir: process.env.VH_ANALYSIS_EVAL_ARTIFACT_DIR ?? '.tmp/analysis-eval-artifacts',
    peers: process.env.VH_GUN_PEERS ?? process.env.VITE_GUN_PEERS ?? '["http://127.0.0.1:7777/gun"]',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--artifact-dir') {
      parsed.artifactDir = argv[index + 1] ?? parsed.artifactDir;
      index += 1;
    } else if (arg === '--peers') {
      parsed.peers = argv[index + 1] ?? parsed.peers;
      index += 1;
    }
  }

  return parsed;
}

function parsePeers(raw) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return ['http://127.0.0.1:7777/gun'];
  }
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : ['http://127.0.0.1:7777/gun'];
  }
  return trimmed.split(',').map((peer) => peer.trim()).filter(Boolean);
}

function synthesisRank(entry) {
  const synthesis = entry.synthesis;
  return [
    Number.isFinite(synthesis.epoch) ? synthesis.epoch : 0,
    Number.isFinite(synthesis.created_at) ? synthesis.created_at : 0,
    Number.isFinite(entry.capturedAt) ? entry.capturedAt : 0,
  ];
}

function compareRank(a, b) {
  const left = synthesisRank(a);
  const right = synthesisRank(b);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }
  return 0;
}

function withTimeout(promise, timeoutMs, label) {
  let timeout;
  return Promise.race([
    promise.finally(() => clearTimeout(timeout)),
    new Promise((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error(`${label}-timeout`)), timeoutMs);
    }),
  ]);
}

async function loadAcceptedSyntheses(artifactRoot) {
  const artifactDir = path.join(artifactRoot, 'artifacts');
  const names = await readdir(artifactDir);
  const latestByTopic = new Map();

  for (const name of names) {
    if (!name.endsWith('.json')) {
      continue;
    }
    const filePath = path.join(artifactDir, name);
    const artifact = JSON.parse(await readFile(filePath, 'utf8'));
    if (artifact.lifecycle_status !== 'accepted' || !artifact.final_accepted_synthesis) {
      continue;
    }
    const synthesis = artifact.final_accepted_synthesis;
    if (!synthesis.topic_id || !synthesis.synthesis_id) {
      continue;
    }

    const entry = {
      filePath,
      storyId: artifact.story?.story_id ?? null,
      capturedAt: artifact.captured_at ?? 0,
      synthesis,
    };
    const existing = latestByTopic.get(synthesis.topic_id);
    if (!existing || compareRank(existing, entry) <= 0) {
      latestByTopic.set(synthesis.topic_id, entry);
    }
  }

  return [...latestByTopic.values()].sort((a, b) => String(a.storyId).localeCompare(String(b.storyId)));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const peers = parsePeers(options.peers);
  const entries = await loadAcceptedSyntheses(options.artifactDir);
  const client = createClient({ requireSession: false, peers, gunRadisk: false });
  client.markSessionReady();
  await new Promise((resolve) => setTimeout(resolve, 1000));

  let written = 0;
  let alreadyCurrent = 0;
  let failed = 0;

  for (const entry of entries) {
    const current = await withTimeout(
      readTopicLatestSynthesis(client, entry.synthesis.topic_id),
      10_000,
      'current-read',
    ).catch(() => null);
    if (current?.synthesis_id === entry.synthesis.synthesis_id) {
      alreadyCurrent += 1;
      continue;
    }

    try {
      await withTimeout(writeTopicSynthesis(client, entry.synthesis), 15_000, 'synthesis-write');
      const readback = await withTimeout(
        readTopicLatestSynthesis(client, entry.synthesis.topic_id),
        10_000,
        'readback',
      );
      if (readback?.synthesis_id !== entry.synthesis.synthesis_id) {
        throw new Error('readback mismatch');
      }
      written += 1;
      console.info('[vh:analysis-eval-backfill] synthesis written', {
        topic_id: entry.synthesis.topic_id,
        story_id: entry.storyId,
        synthesis_id: entry.synthesis.synthesis_id,
      });
    } catch (error) {
      failed += 1;
      console.warn('[vh:analysis-eval-backfill] synthesis write failed', {
        topic_id: entry.synthesis.topic_id,
        story_id: entry.storyId,
        synthesis_id: entry.synthesis.synthesis_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.info('[vh:analysis-eval-backfill] complete', {
    artifact_dir: options.artifactDir,
    peers,
    candidates: entries.length,
    written,
    already_current: alreadyCurrent,
    failed,
  });

  if (failed > 0) {
    process.exitCode = 1;
  }
  client.shutdown?.();
  setTimeout(() => process.exit(process.exitCode ?? 0), 250).unref();
}

main().catch((error) => {
  console.error('[vh:analysis-eval-backfill] failed', error);
  process.exit(1);
});
