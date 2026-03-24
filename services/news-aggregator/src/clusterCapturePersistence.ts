import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NewsOrchestratorClusterArtifacts } from '@vh/ai-engine';

export interface DaemonFeedClusterCaptureTick extends NewsOrchestratorClusterArtifacts {
  readonly tickSequence: number;
}

export interface DaemonFeedClusterCaptureSnapshot {
  readonly schemaVersion: 'daemon-feed-cluster-capture-v1';
  readonly generatedAt: string;
  readonly runId: string;
  readonly ticks: ReadonlyArray<DaemonFeedClusterCaptureTick>;
}

export interface ClusterCapturePersistenceOptions {
  readonly cwd?: string;
  readonly readTextFile?: typeof readFile;
  readonly writeTextFile?: typeof writeFile;
  readonly renameFile?: typeof rename;
  readonly mkdirFn?: typeof mkdir;
}

export function clusterCaptureArtifactDir(
  runId: string,
  cwd: string = process.cwd(),
): string {
  return path.resolve(cwd, '.tmp/e2e-daemon-feed', runId);
}

export function clusterCaptureArtifactPath(
  runId: string,
  cwd: string = process.cwd(),
): string {
  return path.join(clusterCaptureArtifactDir(runId, cwd), 'cluster-capture.json');
}

function normalizeTick(
  tickSequence: number,
  artifacts: NewsOrchestratorClusterArtifacts,
): DaemonFeedClusterCaptureTick {
  return {
    ...artifacts,
    tickSequence,
    normalizedItems: [...artifacts.normalizedItems],
    topicCaptures: artifacts.topicCaptures.map((capture) => ({
      topicId: capture.topicId,
      items: [...capture.items],
      result: {
        bundles: [...capture.result.bundles],
        storylines: [...capture.result.storylines],
      },
    })),
  };
}

async function readExistingSnapshot(
  artifactPath: string,
  readTextFile: typeof readFile,
): Promise<DaemonFeedClusterCaptureSnapshot | null> {
  try {
    return JSON.parse(await readTextFile(artifactPath, 'utf8')) as DaemonFeedClusterCaptureSnapshot;
  } catch {
    return null;
  }
}

async function writeAtomicSnapshot(
  artifactPath: string,
  snapshot: DaemonFeedClusterCaptureSnapshot,
  writeTextFile: typeof writeFile,
  renameFile: typeof rename,
): Promise<void> {
  const tempPath = path.join(
    path.dirname(artifactPath),
    `.${path.basename(artifactPath)}.tmp-${process.pid}-${Date.now()}`,
  );
  await writeTextFile(tempPath, JSON.stringify(snapshot, null, 2), 'utf8');
  await renameFile(tempPath, artifactPath);
}

export async function persistDaemonFeedClusterCapture(
  runId: string,
  tickSequence: number,
  artifacts: NewsOrchestratorClusterArtifacts,
  options: ClusterCapturePersistenceOptions = {},
): Promise<DaemonFeedClusterCaptureSnapshot> {
  const cwd = options.cwd ?? process.cwd();
  const readTextFile = options.readTextFile ?? readFile;
  const writeTextFile = options.writeTextFile ?? writeFile;
  const renameFile = options.renameFile ?? rename;
  const mkdirFn = options.mkdirFn ?? mkdir;
  const artifactDir = clusterCaptureArtifactDir(runId, cwd);
  const artifactPath = clusterCaptureArtifactPath(runId, cwd);

  await mkdirFn(artifactDir, { recursive: true });
  const existing = await readExistingSnapshot(artifactPath, readTextFile);
  const nextTick = normalizeTick(tickSequence, artifacts);
  const ticks = [
    ...(existing?.ticks ?? []).filter((tick) => tick.tickSequence !== tickSequence),
    nextTick,
  ].sort((left, right) => left.tickSequence - right.tickSequence);

  const snapshot: DaemonFeedClusterCaptureSnapshot = {
    schemaVersion: 'daemon-feed-cluster-capture-v1',
    generatedAt: new Date().toISOString(),
    runId,
    ticks,
  };

  await writeAtomicSnapshot(artifactPath, snapshot, writeTextFile, renameFile);

  return snapshot;
}

export function createDaemonFeedClusterCaptureRecorder(
  runId: string | undefined,
  options: ClusterCapturePersistenceOptions = {},
): ((artifacts: NewsOrchestratorClusterArtifacts) => Promise<void>) | null {
  const trimmedRunId = typeof runId === 'string' ? runId.trim() : '';
  if (!trimmedRunId) {
    return null;
  }

  let tickSequence = 0;
  return async (artifacts: NewsOrchestratorClusterArtifacts): Promise<void> => {
    tickSequence += 1;
    await persistDaemonFeedClusterCapture(trimmedRunId, tickSequence, artifacts, options);
  };
}
