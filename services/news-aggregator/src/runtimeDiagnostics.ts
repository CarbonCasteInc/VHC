import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NewsRuntimeTickSummary } from '@vh/ai-engine';

export interface DaemonRuntimeDiagnosticSnapshot {
  readonly schemaVersion: 'vh-news-runtime-diagnostics-v1';
  readonly generatedAt: string;
  readonly runId: string | null;
  readonly noWrite: boolean;
  readonly maxSummaries: number;
  readonly latest: NewsRuntimeTickSummary;
  readonly summaries: readonly NewsRuntimeTickSummary[];
}

export interface RuntimeDiagnosticRecorderOptions {
  readonly artifactRoot?: string;
  readonly explicitFile?: string;
  readonly runId?: string;
  readonly noWrite?: boolean;
  readonly maxSummaries?: number;
  readonly readTextFile?: typeof readFile;
  readonly writeTextFile?: typeof writeFile;
  readonly renameFile?: typeof rename;
  readonly mkdirFn?: typeof mkdir;
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function defaultArtifactRoot(): string {
  const explicitRoot = process.env.VH_DAEMON_FEED_ARTIFACT_ROOT?.trim();
  if (explicitRoot) {
    return path.resolve(explicitRoot);
  }
  const stateRoot = process.env.VH_NEWS_DAEMON_STATE_DIR?.trim();
  if (stateRoot) {
    return path.resolve(stateRoot, 'artifacts');
  }
  return path.resolve(process.cwd(), '.tmp/news-runtime-diagnostics');
}

export function resolveRuntimeDiagnosticsPath(options: RuntimeDiagnosticRecorderOptions = {}): string {
  const explicitFile = options.explicitFile ?? process.env.VH_NEWS_RUNTIME_DIAGNOSTIC_FILE;
  if (explicitFile?.trim()) {
    return path.resolve(explicitFile.trim());
  }
  const artifactRoot = options.artifactRoot?.trim()
    ? path.resolve(options.artifactRoot.trim())
    : defaultArtifactRoot();
  return path.join(artifactRoot, 'news-runtime-diagnostics.json');
}

async function readExistingSnapshot(
  filePath: string,
  readTextFile: typeof readFile,
): Promise<DaemonRuntimeDiagnosticSnapshot | null> {
  try {
    const parsed = JSON.parse(await readTextFile(filePath, 'utf8')) as DaemonRuntimeDiagnosticSnapshot;
    return parsed?.schemaVersion === 'vh-news-runtime-diagnostics-v1' ? parsed : null;
  } catch {
    return null;
  }
}

async function writeAtomicJson(
  filePath: string,
  value: unknown,
  writeTextFile: typeof writeFile,
  renameFile: typeof rename,
): Promise<void> {
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  await writeTextFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await renameFile(tempPath, filePath);
}

export function createRuntimeDiagnosticRecorder(
  options: RuntimeDiagnosticRecorderOptions = {},
): (summary: NewsRuntimeTickSummary) => Promise<DaemonRuntimeDiagnosticSnapshot> {
  const filePath = resolveRuntimeDiagnosticsPath(options);
  const readTextFile = options.readTextFile ?? readFile;
  const writeTextFile = options.writeTextFile ?? writeFile;
  const renameFile = options.renameFile ?? rename;
  const mkdirFn = options.mkdirFn ?? mkdir;
  const maxSummaries = normalizePositiveInt(options.maxSummaries, 50);
  const runId = options.runId?.trim() || process.env.VH_DAEMON_FEED_RUN_ID?.trim() || null;
  const noWrite = options.noWrite === true;

  return async (summary: NewsRuntimeTickSummary): Promise<DaemonRuntimeDiagnosticSnapshot> => {
    await mkdirFn(path.dirname(filePath), { recursive: true });
    const existing = await readExistingSnapshot(filePath, readTextFile);
    const summaries = [
      ...(existing?.summaries ?? []).filter((item) => item.tick_sequence !== summary.tick_sequence),
      summary,
    ]
      .sort((left, right) => left.tick_sequence - right.tick_sequence)
      .slice(-maxSummaries);

    const snapshot: DaemonRuntimeDiagnosticSnapshot = {
      schemaVersion: 'vh-news-runtime-diagnostics-v1',
      generatedAt: new Date().toISOString(),
      runId,
      noWrite,
      maxSummaries,
      latest: summary,
      summaries,
    };

    await writeAtomicJson(filePath, snapshot, writeTextFile, renameFile);
    return snapshot;
  };
}
