import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VennClientConfig } from '@vh/gun-client';
import { createNodeMeshClient } from '@vh/gun-client/node';
import {
  createBundleSynthesisEnrichmentFromEnv,
  resolveBundleSynthesisLifecycleLedgerPathFromEnv,
} from './bundleSynthesisDaemonConfig';
import {
  collectPendingSynthesisCatchupCandidates,
  DEFAULT_SYNTHESIS_IN_PROGRESS_STALE_MS,
} from './pendingSynthesisCatchup';
import {
  parseGunPeers,
  parseOptionalPositiveInt,
  readEnvVar,
  resolveSystemWriterClientConfigFromEnv,
  type LoggerLike,
} from './daemonUtils';
import { isDirectExecution } from './daemonCli';

export interface PublicSynthesisCatchupReport {
  readonly schemaVersion: 'vh-public-synthesis-catchup-v1';
  readonly generated_at: number;
  readonly status: 'pass' | 'no_candidates' | 'partial' | 'fail';
  readonly commit_sha: string | null;
  readonly configured_peer_count: number;
  readonly scan: {
    readonly scanned: number;
    readonly enqueued: number;
    readonly skipped: number;
    readonly stale_in_progress: number;
    readonly sample_limit: number;
  };
  readonly results: Array<{
    readonly story_id: string;
    readonly topic_id: string;
    readonly source_count: number;
    readonly canonical_source_count: number;
    readonly source_set_revision: string;
    readonly previous_lifecycle_status: string;
    readonly worker_status: string;
    readonly synthesis_id?: string;
    readonly latest_status?: string;
    readonly reason?: string;
    readonly error?: string;
  }>;
  readonly artifact_dir: string;
  readonly lifecycle_ledger_path: string;
}

function repoRoot(): string {
  return path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
}

function readPositiveInt(...names: string[]): number | undefined {
  for (const name of names) {
    const parsed = parseOptionalPositiveInt(readEnvVar(name));
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = readEnvVar(name)?.toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (['1', 'true', 'yes', 'on'].includes(raw)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(raw)) {
    return false;
  }
  return fallback;
}

function resolveArtifactDir(now: number): string {
  const root = readEnvVar('VH_PUBLIC_SYNTHESIS_CATCHUP_ARTIFACT_ROOT')
    ?? path.join(repoRoot(), '.tmp', 'release-evidence', 'public-synthesis-catchup');
  return path.join(root, String(now));
}

function writeReport(report: PublicSynthesisCatchupReport): void {
  mkdirSync(report.artifact_dir, { recursive: true });
  const reportPath = path.join(report.artifact_dir, 'public-synthesis-catchup-summary.json');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const latestDir = path.join(path.dirname(report.artifact_dir), 'latest');
  mkdirSync(latestDir, { recursive: true });
  writeFileSync(path.join(latestDir, 'public-synthesis-catchup-summary.json'), `${JSON.stringify(report, null, 2)}\n`);
}

function resultStatus(results: PublicSynthesisCatchupReport['results'], candidateCount: number): PublicSynthesisCatchupReport['status'] {
  if (candidateCount === 0) {
    return 'no_candidates';
  }
  const written = results.filter((result) => result.worker_status === 'written').length;
  if (written === candidateCount) {
    return 'pass';
  }
  if (written > 0) {
    return 'partial';
  }
  return 'fail';
}

export function assertPublicSynthesisCatchupSystemWriterPin(
  systemWriterConfig: Pick<VennClientConfig, 'systemWriterPin'>,
): void {
  if (!systemWriterConfig.systemWriterPin) {
    throw new Error(
      'Public synthesis catch-up requires VH_SYSTEM_WRITER_PIN_JSON, VH_NEWS_SYSTEM_WRITER_PIN_JSON, '
        + 'VH_SYSTEM_WRITER_PUBLIC_KEY_SPKI_BASE64URL, or VH_NEWS_SYSTEM_WRITER_PUBLIC_KEY_SPKI_BASE64URL '
        + 'so signed public lifecycle rows can be verified before enqueueing work',
    );
  }
}

async function currentCommitSha(): Promise<string | null> {
  try {
    const { execFile } = await import('node:child_process');
    return await new Promise((resolve) => {
      execFile('git', ['rev-parse', 'HEAD'], { cwd: repoRoot() }, (error, stdout) => {
        resolve(error ? null : stdout.trim() || null);
      });
    });
  } catch {
    return null;
  }
}

export async function runPublicSynthesisCatchup(
  logger: LoggerLike = console,
  now: () => number = Date.now,
): Promise<PublicSynthesisCatchupReport> {
  const generatedAt = Math.max(0, Math.floor(now()));
  const sampleLimit = readPositiveInt(
    'VH_PUBLIC_SYNTHESIS_CATCHUP_LIMIT',
    'VH_BUNDLE_SYNTHESIS_CATCHUP_SAMPLE_LIMIT',
  ) ?? 5;
  const staleInProgressMs = readPositiveInt('VH_BUNDLE_SYNTHESIS_IN_PROGRESS_STALE_MS')
    ?? DEFAULT_SYNTHESIS_IN_PROGRESS_STALE_MS;
  const peers = parseGunPeers(readEnvVar('VH_GUN_PEERS') ?? readEnvVar('VITE_GUN_PEERS'));
  if (peers.length === 0) {
    throw new Error('VH_GUN_PEERS or VITE_GUN_PEERS must configure at least one public relay peer');
  }

  const systemWriterConfig = await resolveSystemWriterClientConfigFromEnv();
  assertPublicSynthesisCatchupSystemWriterPin(systemWriterConfig);
  const client = createNodeMeshClient({
    peers,
    requireSession: false,
    gunRadisk: readBoolean('VH_PUBLIC_SYNTHESIS_CATCHUP_GUN_RADISK', false),
    ...systemWriterConfig,
  });

  try {
    const enrichment = createBundleSynthesisEnrichmentFromEnv(client, logger);
    if (!enrichment.enrichmentWorker) {
      throw new Error('Bundle synthesis worker is not enabled; configure synthesis credentials or VH_BUNDLE_SYNTHESIS_ENABLED=true');
    }
    const scan = await collectPendingSynthesisCatchupCandidates(client, {
      limit: sampleLimit,
      logger,
      now,
      staleInProgressMs,
    });
    const results: PublicSynthesisCatchupReport['results'] = [];
    for (const candidate of scan.candidates) {
      try {
        const output = await enrichment.enrichmentWorker(candidate.candidate);
        enrichment.enrichmentQueueOptions?.onWorkerResult?.(candidate.candidate, output);
        const workerResult = output as {
          status?: unknown;
          synthesisId?: unknown;
          latestStatus?: unknown;
          reason?: unknown;
        };
        results.push({
          story_id: candidate.story.story_id,
          topic_id: candidate.story.topic_id,
          source_count: candidate.story.sources.length,
          canonical_source_count: (candidate.story.primary_sources ?? candidate.story.sources).length,
          source_set_revision: candidate.story.provenance_hash,
          previous_lifecycle_status: candidate.lifecycle.status,
          worker_status: String(workerResult.status ?? 'unknown'),
          ...(typeof workerResult.synthesisId === 'string' ? { synthesis_id: workerResult.synthesisId } : {}),
          ...(typeof workerResult.latestStatus === 'string' ? { latest_status: workerResult.latestStatus } : {}),
          ...(typeof workerResult.reason === 'string' ? { reason: workerResult.reason } : {}),
        });
      } catch (error) {
        results.push({
          story_id: candidate.story.story_id,
          topic_id: candidate.story.topic_id,
          source_count: candidate.story.sources.length,
          canonical_source_count: (candidate.story.primary_sources ?? candidate.story.sources).length,
          source_set_revision: candidate.story.provenance_hash,
          previous_lifecycle_status: candidate.lifecycle.status,
          worker_status: 'worker_error',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const artifactDir = resolveArtifactDir(generatedAt);
    const report: PublicSynthesisCatchupReport = {
      schemaVersion: 'vh-public-synthesis-catchup-v1',
      generated_at: generatedAt,
      status: resultStatus(results, scan.candidates.length),
      commit_sha: await currentCommitSha(),
      configured_peer_count: peers.length,
      scan: {
        scanned: scan.scanned,
        enqueued: scan.enqueued,
        skipped: scan.skipped,
        stale_in_progress: scan.staleInProgress,
        sample_limit: sampleLimit,
      },
      results,
      artifact_dir: artifactDir,
      lifecycle_ledger_path: resolveBundleSynthesisLifecycleLedgerPathFromEnv(),
    };
    writeReport(report);
    logger.info('[vh:public-synthesis-catchup] complete', {
      status: report.status,
      artifact_dir: report.artifact_dir,
      scanned: report.scan.scanned,
      enqueued: report.scan.enqueued,
      results: report.results.length,
    });
    return report;
  } finally {
    await client.shutdown();
  }
}

if (isDirectExecution(import.meta.url)) {
  void runPublicSynthesisCatchup()
    .then((report) => {
      console.log(JSON.stringify({
        status: report.status,
        artifactDir: report.artifact_dir,
        scanned: report.scan.scanned,
        enqueued: report.scan.enqueued,
        results: report.results.length,
      }));
      process.exit(report.status === 'fail' ? 1 : 0);
    })
    .catch((error) => {
      console.error('[vh:public-synthesis-catchup] failed', error);
      process.exit(1);
    });
}
