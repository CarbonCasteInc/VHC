import { describe, expect, it, vi } from 'vitest';

import {
  buildPortClearShellCommand,
  killPortOccupantsWith,
  killStaleDaemonFirstProcessesWith,
  shouldKillDaemonFirstProcess,
} from './daemonFirstFeedProcesses';

describe('daemonFirstFeedProcesses', () => {
  it('matches only stale probe and daemon processes for cleanup', () => {
    const repoRoot = '/tmp/vhc';

    expect(
      shouldKillDaemonFirstProcess(
        '/bin/zsh -lc ... /tmp/vhc/.tmp/e2e-daemon-feed/probe-123/news-daemon.log ...',
        repoRoot,
      ),
    ).toBe(true);
    expect(
      shouldKillDaemonFirstProcess(
        `node ${repoRoot}/services/storycluster-engine/dist/server.js`,
        repoRoot,
      ),
    ).toBe(true);
    expect(
      shouldKillDaemonFirstProcess(
        'node /opt/homebrew/bin/pnpm --filter @vh/news-aggregator daemon',
        repoRoot,
      ),
    ).toBe(true);
    expect(
      shouldKillDaemonFirstProcess(
        `node --loader ../../tools/node/esm-resolve-loader.mjs ${repoRoot}/services/news-aggregator/dist/daemon.js`,
        repoRoot,
      ),
    ).toBe(true);
    expect(
      shouldKillDaemonFirstProcess(
        `${repoRoot}/infra/relay/server.js`,
        repoRoot,
      ),
    ).toBe(false);
    expect(
      shouldKillDaemonFirstProcess(
        `node ${repoRoot}/packages/e2e/src/live/daemon-feed-fixtures.mjs`,
        repoRoot,
      ),
    ).toBe(false);
    expect(
      shouldKillDaemonFirstProcess(
        `node ${repoRoot}/packages/e2e/src/live/daemon-feed-qdrant-stub.mjs`,
        repoRoot,
      ),
    ).toBe(false);
    expect(
      shouldKillDaemonFirstProcess(
        `node ${repoRoot}/packages/e2e/src/live/daemon-feed-analysis-stub.mjs`,
        repoRoot,
      ),
    ).toBe(false);
    expect(
      shouldKillDaemonFirstProcess(
        `/Users/bldt/Desktop/VHC/VHC/infra/relay/server.js`,
        repoRoot,
      ),
    ).toBe(false);
  });

  it('kills matched stale daemon processes and skips unrelated ones', () => {
    const execSync = vi.fn()
      .mockReturnValueOnce(
        [
          '111 node /tmp/vhc/services/storycluster-engine/dist/server.js',
          '222 node /tmp/vhc/packages/e2e/src/live/daemon-feed-fixtures.mjs',
          '223 node /tmp/vhc/infra/relay/server.js',
          '224 node /tmp/vhc/packages/e2e/src/live/daemon-feed-qdrant-stub.mjs',
          '225 node /tmp/vhc/packages/e2e/src/live/daemon-feed-analysis-stub.mjs',
          '333 /bin/zsh -lc /tmp/vhc/.tmp/e2e-daemon-feed/probe-123',
          '444 node /Users/elsewhere/dist/daemon.js',
          '555 node dist/daemon.js',
          '666 node /opt/homebrew/bin/pnpm --filter @vh/news-aggregator daemon',
        ].join('\n'),
      )
      .mockReturnValueOnce('pcwd\nn/Users/elsewhere\n')
      .mockReturnValueOnce('pcwd\nn/tmp/vhc/services/news-aggregator\n')
      .mockReturnValueOnce('');

    killStaleDaemonFirstProcessesWith('/tmp/vhc', execSync, 999);

    expect(execSync).toHaveBeenNthCalledWith(
      1,
      'ps',
      ['-axo', 'pid=,command='],
      expect.objectContaining({ encoding: 'utf8' }),
    );
    expect(execSync).toHaveBeenNthCalledWith(
      2,
      'lsof',
      ['-a', '-d', 'cwd', '-p', '444', '-Fn'],
      expect.objectContaining({ encoding: 'utf8' }),
    );
    expect(execSync).toHaveBeenNthCalledWith(
      3,
      'lsof',
      ['-a', '-d', 'cwd', '-p', '555', '-Fn'],
      expect.objectContaining({ encoding: 'utf8' }),
    );
    expect(execSync).toHaveBeenNthCalledWith(
      4,
      'kill',
      ['-9', '111', '333', '555', '666'],
      expect.any(Object),
    );
  });

  it('skips kill when no processes match and swallows exec failures', () => {
    const emptyExec = vi.fn().mockReturnValueOnce('');
    killStaleDaemonFirstProcessesWith('/tmp/vhc', emptyExec, 999);
    expect(emptyExec).toHaveBeenCalledTimes(1);

    const failingExec = vi.fn().mockImplementation(() => {
      throw new Error('ps failed');
    });
    expect(() =>
      killStaleDaemonFirstProcessesWith('/tmp/vhc', failingExec, 999),
    ).not.toThrow();
  });

  it('builds a bounded port-clear shell command for startup reuse', () => {
    const command = buildPortClearShellCommand(4310);

    expect(command).toContain('kill -TERM');
    expect(command).toContain('kill -KILL');
    expect(command).toContain('attempts=$((attempts + 1))');
    expect(command).toContain('tcp:4310');
  });

  it('reuses the bounded port-clear command when clearing port occupants', () => {
    const execSync = vi.fn();

    killPortOccupantsWith(6333, execSync);

    expect(execSync).toHaveBeenCalledWith(
      'sh',
      ['-lc', expect.stringContaining('tcp:6333')],
      expect.objectContaining({
        stdio: ['ignore', 'ignore', 'ignore'],
      }),
    );
  });
});
