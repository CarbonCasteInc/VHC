import { spawn } from 'node:child_process';
import { openSync, writeFileSync } from 'node:fs';

const [, , pidFile, cwd, logFile, command, ...args] = process.argv;

if (!pidFile || !cwd || !logFile || !command) {
  console.error('Usage: node spawn-detached.mjs <pid-file> <cwd> <log-file> <command> [args...]');
  process.exit(1);
}

const logFd = openSync(logFile, 'a');
const child = spawn(command, args, {
  cwd,
  detached: true,
  env: process.env,
  stdio: ['ignore', logFd, logFd],
});

writeFileSync(pidFile, `${child.pid}\n`, 'utf8');
child.unref();
