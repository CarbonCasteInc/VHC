import { spawn, type ChildProcess, execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';

export type LoggedProcess = {
  readonly name: string;
  readonly proc: ChildProcess;
  readonly output: string[];
};

const PROBE_RUN_SEGMENT = `${path.sep}.tmp${path.sep}e2e-daemon-feed${path.sep}probe-`;
const NEWS_DAEMON_MARKER = '@vh/news-aggregator daemon';
const STORYCLUSTER_SERVER_MARKER = 'services/storycluster-engine/dist/server.js';
const NEWS_DAEMON_CHILD_MARKER = `${path.sep}dist${path.sep}daemon.js`;
const NEWS_DAEMON_CHILD_FALLBACK_MARKER = `dist${path.sep}daemon.js`;
export function repoRootDir(): string {
  return path.resolve(process.cwd(), '..', '..');
}

export function buildPortClearShellCommand(port: number): string {
  return [
    `pids=$(lsof -ti tcp:${port} 2>/dev/null || true)`,
    'if [ -n "$pids" ]; then',
    '  echo "$pids" | xargs kill -TERM 2>/dev/null || true',
    '  attempts=0',
    `  while [ "$attempts" -lt 40 ] && lsof -ti tcp:${port} >/dev/null 2>&1; do`,
    '    sleep 0.25',
    '    attempts=$((attempts + 1))',
    '  done',
    `  pids=$(lsof -ti tcp:${port} 2>/dev/null || true)`,
    '  if [ -n "$pids" ]; then',
    '    echo "$pids" | xargs kill -KILL 2>/dev/null || true',
    '  fi',
    '  attempts=0',
    `  while [ "$attempts" -lt 40 ] && lsof -ti tcp:${port} >/dev/null 2>&1; do`,
    '    sleep 0.25',
    '    attempts=$((attempts + 1))',
    '  done',
    'fi',
  ].join('\n');
}

function workspaceRootDir(repoRoot: string): string {
  return path.dirname(repoRoot);
}

export function runArtifactDir(runId: string): string {
  return path.join(repoRootDir(), `.tmp/e2e-daemon-feed/${runId}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function shouldKillDaemonFirstProcess(command: string, repoRoot: string): boolean {
  return command.includes(PROBE_RUN_SEGMENT)
    || (command.includes(workspaceRootDir(repoRoot)) && command.includes(STORYCLUSTER_SERVER_MARKER))
    || command.includes(NEWS_DAEMON_MARKER)
    || (command.includes(workspaceRootDir(repoRoot)) && command.includes(NEWS_DAEMON_CHILD_MARKER));
}

function processCwdWithinRepo(
  pid: string,
  repoRoot: string,
  execSync: typeof execFileSync,
): boolean {
  try {
    const output = execSync('lsof', ['-a', '-d', 'cwd', '-p', pid, '-Fn'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const cwdLine = output
      .split(/\r?\n/)
      .find((line) => line.startsWith('n'));
    const cwd = cwdLine?.slice(1).trim();
    return Boolean(cwd && cwd.startsWith(repoRoot));
  } catch {
    return false;
  }
}

function shouldKillByProcessMetadata(
  entry: { pid: string; command: string },
  repoRoot: string,
  execSync: typeof execFileSync,
): boolean {
  if (shouldKillDaemonFirstProcess(entry.command, repoRoot)) {
    return true;
  }

  if (
    entry.command.includes(NEWS_DAEMON_CHILD_MARKER)
    || entry.command.includes(NEWS_DAEMON_CHILD_FALLBACK_MARKER)
  ) {
    return processCwdWithinRepo(entry.pid, workspaceRootDir(repoRoot), execSync);
  }

  return false;
}

export function killPortOccupantsWith(
  port: number,
  execSync: typeof execFileSync,
): void {
  try {
    execSync('sh', ['-lc', buildPortClearShellCommand(port)], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch {
    // Port already free or lsof unavailable.
  }
}

export function killPortOccupants(port: number): void {
  killPortOccupantsWith(port, execFileSync);
}

export function killStaleDaemonFirstProcesses(): void {
  killStaleDaemonFirstProcessesWith(repoRootDir(), execFileSync, process.pid);
}

export function killStaleDaemonFirstProcessesWith(
  repoRoot: string,
  execSync: typeof execFileSync,
  currentPid: number,
): void {
  try {
    const output = execSync('ps', ['-axo', 'pid=,command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const pids = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const match = line.match(/^(\d+)\s+(.*)$/);
        if (!match) {
          return null;
        }
        return {
          pid: match[1]!,
          command: match[2]!,
        };
      })
      .filter((entry): entry is { pid: string; command: string } => Boolean(entry))
      .filter((entry) => entry.pid !== String(currentPid))
      .filter((entry) => shouldKillByProcessMetadata(entry, repoRoot, execSync))
      .map((entry) => entry.pid);
    if (pids.length === 0) {
      return;
    }
    execSync('kill', ['-9', ...pids], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch {
    // Best-effort cleanup only.
  }
}

export function spawnLoggedProcess(
  name: string,
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  runId: string,
): LoggedProcess {
  mkdirSync(runArtifactDir(runId), { recursive: true });
  const logFile = path.join(runArtifactDir(runId), `${name}.log`);
  const proc = spawn(command, [...args], {
    cwd: repoRootDir(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output: string[] = [];
  const onData = (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      output.push(trimmed);
      appendFileSync(logFile, `${trimmed}\n`, 'utf8');
    }
  };
  proc.stdout?.on('data', onData);
  proc.stderr?.on('data', onData);
  return { name, proc, output };
}

export function waitForOutput(process: LoggedProcess, pattern: RegExp, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (process.output.some((line) => pattern.test(line))) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (process.proc.exitCode !== null) {
        clearInterval(timer);
        reject(new Error(`${process.name} exited before readiness`));
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        reject(new Error(`${process.name} readiness timeout`));
      }
    }, 250);
  });
}

export async function stopProcess(process: LoggedProcess | null): Promise<void> {
  if (!process || process.proc.exitCode !== null) {
    return;
  }
  process.proc.kill('SIGTERM');
  const startedAt = Date.now();
  while (process.proc.exitCode === null && Date.now() - startedAt < 10_000) {
    await sleep(100);
  }
  if (process.proc.exitCode === null) {
    process.proc.kill('SIGKILL');
  }
}
