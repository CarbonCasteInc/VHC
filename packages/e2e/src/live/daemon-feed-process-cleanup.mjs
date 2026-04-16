import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PROBE_HOLDER_ID = 'vh-probe-news-daemon';
const PROBE_RUN_SEGMENT = `${path.sep}.tmp${path.sep}e2e-daemon-feed${path.sep}probe-`;
const DAEMON_CHILD_MARKER = `${path.sep}dist${path.sep}daemon.js`;
const DAEMON_CHILD_FALLBACK_MARKER = `dist${path.sep}daemon.js`;
const STORYCLUSTER_SERVER_MARKER = `${path.sep}services${path.sep}storycluster-engine${path.sep}dist${path.sep}server.js`;
const STORYCLUSTER_SERVER_FALLBACK_MARKER = `services${path.sep}storycluster-engine${path.sep}dist${path.sep}server.js`;
const NEWS_DAEMON_MARKER = '@vh/news-aggregator daemon';
const RELAY_SERVER_MARKER = `${path.sep}infra${path.sep}relay${path.sep}server.js`;
const RELAY_SERVER_FALLBACK_MARKER = `infra${path.sep}relay${path.sep}server.js`;

export function parseProcessTable(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      if (!match) {
        return null;
      }
      return { pid: match[1], command: match[2] };
    })
    .filter(Boolean);
}

export function processCwdWithinRepo(pid, repoRoot, execSync = execFileSync) {
  try {
    const output = execSync('lsof', ['-a', '-d', 'cwd', '-p', pid, '-Fn'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const cwdLine = output.split(/\r?\n/).find((line) => line.startsWith('n'));
    const cwd = cwdLine?.slice(1).trim();
    return Boolean(cwd && cwd.startsWith(repoRoot));
  } catch {
    return false;
  }
}

function workspaceRoot(repoRoot) {
  return path.dirname(repoRoot);
}

function commandWithinWorkspace(command, repoRoot) {
  return command.includes(workspaceRoot(repoRoot));
}

function cwdWithinWorkspace(pid, repoRoot, execSync = execFileSync) {
  return processCwdWithinRepo(pid, workspaceRoot(repoRoot), execSync);
}

function normalizeCleanupOptions(options = {}) {
  return {
    preserveRelayServer: options.preserveRelayServer === true,
    preserveStoryclusterServer: options.preserveStoryclusterServer === true,
  };
}

export function hasFlag(flag, argv = process.argv) {
  return argv.includes(flag);
}

export function shouldKillStaleProbeWriter(
  entry,
  repoRoot,
  gunPeerUrl,
  execSync = execFileSync,
  options = {},
) {
  const cleanupOptions = normalizeCleanupOptions(options);
  if (entry.command.includes(PROBE_RUN_SEGMENT)) {
    return true;
  }

  const isDaemonChild = entry.command.includes(DAEMON_CHILD_MARKER)
    || entry.command.includes(DAEMON_CHILD_FALLBACK_MARKER);
  const isStoryclusterServer = entry.command.includes(STORYCLUSTER_SERVER_MARKER)
    || entry.command.includes(STORYCLUSTER_SERVER_FALLBACK_MARKER);
  const isRelayServer = entry.command.includes(RELAY_SERVER_MARKER)
    || entry.command.includes(RELAY_SERVER_FALLBACK_MARKER);

  if (entry.command.includes(NEWS_DAEMON_MARKER)) {
    return true;
  }
  if (isRelayServer && cleanupOptions.preserveRelayServer) {
    return false;
  }
  if (isStoryclusterServer && cleanupOptions.preserveStoryclusterServer) {
    return false;
  }
  if (isRelayServer || isStoryclusterServer) {
    return commandWithinWorkspace(entry.command, repoRoot) || cwdWithinWorkspace(entry.pid, repoRoot, execSync);
  }
  if (!isDaemonChild) {
    return false;
  }

  const targetsCurrentPeer = gunPeerUrl.length > 0 && entry.command.includes(gunPeerUrl);
  const isProbeHolder = entry.command.includes(`VH_NEWS_DAEMON_HOLDER_ID=${PROBE_HOLDER_ID}`);
  if (targetsCurrentPeer || isProbeHolder) {
    return commandWithinWorkspace(entry.command, repoRoot) || cwdWithinWorkspace(entry.pid, repoRoot, execSync);
  }

  return cwdWithinWorkspace(entry.pid, repoRoot, execSync);
}

export function killStaleProbeWriters(
  repoRoot,
  gunPeerUrl,
  execSync = execFileSync,
  currentPid = process.pid,
  parentPid = process.ppid,
  options = {},
) {
  let output = '';
  try {
    output = execSync('ps', ['eww', '-axo', 'pid=,command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EPERM') {
      return [];
    }
    throw error;
  }
  const pids = parseProcessTable(output)
    .filter((entry) => entry.pid !== String(currentPid) && entry.pid !== String(parentPid))
    .filter((entry) => shouldKillStaleProbeWriter(entry, repoRoot, gunPeerUrl, execSync, options))
    .map((entry) => entry.pid);

  if (pids.length > 0) {
    execSync('kill', ['-9', ...pids], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  }

  return pids;
}

export function readArg(flag, argv = process.argv) {
  const index = argv.indexOf(flag);
  if (index < 0) {
    return '';
  }
  return argv[index + 1] ?? '';
}

export function runCleanup(argv = process.argv, execSync = execFileSync, log = console.log) {
  const repoRoot = readArg('--repo-root', argv);
  const gunPeerUrl = readArg('--gun-peer-url', argv);
  if (!repoRoot || !gunPeerUrl) {
    throw new Error('usage: --repo-root <path> --gun-peer-url <url>');
  }

  const cleanupOptions = normalizeCleanupOptions({
    preserveRelayServer: hasFlag('--preserve-relay-server', argv),
    preserveStoryclusterServer: hasFlag('--preserve-storycluster-server', argv),
  });
  const killed = killStaleProbeWriters(
    repoRoot,
    gunPeerUrl,
    execSync,
    process.pid,
    process.ppid,
    cleanupOptions,
  );
  log(JSON.stringify({ killed }, null, 2));
  return killed;
}

/* c8 ignore next 3 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCleanup();
}
