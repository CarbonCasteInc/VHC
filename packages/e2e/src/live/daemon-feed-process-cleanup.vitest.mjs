import { describe, expect, it, vi } from 'vitest';
import {
  PROBE_HOLDER_ID,
  killStaleProbeWriters,
  parseProcessTable,
  processCwdWithinRepo,
  readArg,
  runCleanup,
  shouldKillStaleProbeWriter,
} from './daemon-feed-process-cleanup.mjs';

describe('daemon-feed-process-cleanup', () => {
  it('parses ps output into pid/command entries', () => {
    expect(parseProcessTable('123 node dist/daemon.js\nbogus\n456 node other.js\n')).toEqual([
      { pid: '123', command: 'node dist/daemon.js' },
      { pid: '456', command: 'node other.js' },
    ]);
  });

  it('matches stale probe writers by holder id and current peer', () => {
    const execSync = vi.fn(() => 'n/Users/bldt/Desktop/VHC/VHC-hottest-fix/services/news-aggregator\n');
    const repoRoot = '/Users/bldt/Desktop/VHC/VHC-hottest-fix';
    const gunPeerUrl = 'http://localhost:9787/gun';

    expect(
      shouldKillStaleProbeWriter(
        { pid: '110', command: 'node server.js VH_NEWS_DAEMON_HOLDER_ID=vh-probe-news-daemon' },
        repoRoot,
        gunPeerUrl,
        execSync,
      ),
    ).toBe(false);

    expect(
      shouldKillStaleProbeWriter(
        {
          pid: '111',
          command: `node dist/daemon.js VH_NEWS_DAEMON_HOLDER_ID=${PROBE_HOLDER_ID} VH_GUN_PEERS=[\"${gunPeerUrl}\"]`,
        },
        repoRoot,
        gunPeerUrl,
        execSync,
      ),
    ).toBe(true);

    expect(
      shouldKillStaleProbeWriter(
        { pid: '112', command: 'node dist/daemon.js VH_GUN_PEERS=["http://localhost:9787/gun"]' },
        repoRoot,
        gunPeerUrl,
        execSync,
      ),
    ).toBe(true);

    expect(
      shouldKillStaleProbeWriter(
        { pid: '113', command: 'node dist/daemon.js VH_GUN_PEERS=["http://localhost:9999/gun"]' },
        repoRoot,
        gunPeerUrl,
        execSync,
      ),
    ).toBe(true);
  });

  it('matches repo-owned stale storycluster servers and probe-run wrappers', () => {
    const execSync = vi.fn(() => 'n/Users/bldt/Desktop/VHC/VHC-hottest-fix/services/storycluster-engine\n');
    const repoRoot = '/Users/bldt/Desktop/VHC/VHC-hottest-fix';

    expect(
      shouldKillStaleProbeWriter(
        {
          pid: '114',
          command:
            'node /Users/bldt/Desktop/VHC/VHC-hottest-fix/services/storycluster-engine/dist/server.js',
        },
        repoRoot,
        '',
        execSync,
      ),
    ).toBe(true);

    expect(
      shouldKillStaleProbeWriter(
        {
          pid: '115',
          command:
            '/bin/zsh -lc /Users/bldt/Desktop/VHC/VHC-hottest-fix/.tmp/e2e-daemon-feed/probe-123/news-daemon.log',
        },
        repoRoot,
        '',
        execSync,
      ),
    ).toBe(true);
  });

  it('matches sibling-repo relay processes inside the same workspace family', () => {
    const repoRoot = '/Users/bldt/Desktop/VHC/VHC-hottest-fix';
    const execSync = vi.fn((command, args) => {
      if (command === 'lsof') {
        const pid = args?.[4];
        if (pid === '118') {
          return 'n/Users/bldt/Desktop/VHC/VHC/packages/e2e\n';
        }
      }
      return '';
    });

    expect(
      shouldKillStaleProbeWriter(
        { pid: '118', command: 'node /Users/bldt/Desktop/VHC/VHC/infra/relay/server.js' },
        repoRoot,
        '',
        execSync,
      ),
    ).toBe(true);
  });

  it('matches stale storycluster servers by cwd when repo root is absent from command', () => {
    const execSync = vi.fn(() => 'n/Users/bldt/Desktop/VHC/VHC-hottest-fix/services/storycluster-engine\n');

    expect(
      shouldKillStaleProbeWriter(
        {
          pid: '117',
          command: 'node services/storycluster-engine/dist/server.js',
        },
        '/Users/bldt/Desktop/VHC/VHC-hottest-fix',
        '',
        execSync,
      ),
    ).toBe(true);
  });

  it('matches stale news daemon wrapper commands directly', () => {
    expect(
      shouldKillStaleProbeWriter(
        {
          pid: '116',
          command: 'pnpm --filter @vh/news-aggregator daemon',
        },
        '/Users/bldt/Desktop/VHC/VHC-hottest-fix',
        '',
      ),
    ).toBe(true);
  });

  it('uses lsof cwd lookup when repo root is not present in command', () => {
    const execSync = vi.fn(() => 'n/Users/bldt/Desktop/VHC/VHC-hottest-fix/services/news-aggregator\n');
    expect(processCwdWithinRepo('222', '/Users/bldt/Desktop/VHC/VHC-hottest-fix', execSync)).toBe(true);
  });

  it('returns false when cwd lookup fails', () => {
    expect(
      processCwdWithinRepo(
        '222',
        '/Users/bldt/Desktop/VHC/VHC-hottest-fix',
        vi.fn(() => {
          throw new Error('no lsof');
        }),
      ),
    ).toBe(false);
  });

  it('kills only matching stale probe writers', () => {
    const repoRoot = '/Users/bldt/Desktop/VHC/VHC-hottest-fix';
    const gunPeerUrl = 'http://localhost:9787/gun';
    const execSync = vi.fn((command, args) => {
      if (command === 'ps') {
        return [
          `111 node dist/daemon.js VH_NEWS_DAEMON_HOLDER_ID=${PROBE_HOLDER_ID} VH_GUN_PEERS=["${gunPeerUrl}"]`,
          '222 node dist/daemon.js VH_GUN_PEERS=["http://localhost:9999/gun"]',
          '333 node /Users/bldt/Desktop/VHC/VHC-hottest-fix/services/storycluster-engine/dist/server.js',
          '444 node /Users/bldt/Desktop/VHC/VHC/infra/relay/server.js',
        ].join('\n');
      }
      if (command === 'lsof') {
        const pid = args?.[4];
        if (pid === '111') {
          return 'n/Users/bldt/Desktop/VHC/VHC-hottest-fix/services/news-aggregator\n';
        }
        if (pid === '222') {
          return 'n/Users/bldt/Desktop/VHC/VHC-hottest-fix/services/news-aggregator\n';
        }
        if (pid === '444') {
          return 'n/Users/bldt/Desktop/VHC/VHC/packages/e2e\n';
        }
        return '';
      }
      if (command === 'kill') {
        expect(args).toEqual(['-9', '111', '222', '333', '444']);
        return '';
      }
      throw new Error(`unexpected ${command}`);
    });

    expect(killStaleProbeWriters(repoRoot, gunPeerUrl, execSync, 999, 998)).toEqual(['111', '222', '333', '444']);
  });

  it('skips the current cleanup process and its parent shell', () => {
    const execSync = vi.fn((command) => {
      if (command === 'ps') {
        return [
          '998 node /Users/bldt/Desktop/VHC/VHC/infra/relay/server.js',
          '999 node daemon-feed-process-cleanup.mjs',
          '111 node /Users/bldt/Desktop/VHC/VHC/infra/relay/server.js',
        ].join('\n');
      }
      if (command === 'kill') {
        return '';
      }
      return '';
    });

    expect(
      killStaleProbeWriters(
        '/Users/bldt/Desktop/VHC/VHC-hottest-fix',
        'http://localhost:9787/gun',
        execSync,
        999,
        998,
      ),
    ).toEqual(['111']);
  });

  it('reads args and executes cleanup with explicit output', () => {
    const log = vi.fn();
    const execSync = vi.fn((command, args) => {
      if (command === 'ps') {
        return `111 node dist/daemon.js VH_NEWS_DAEMON_HOLDER_ID=${PROBE_HOLDER_ID} VH_GUN_PEERS=["http://localhost:9787/gun"]`;
      }
      if (command === 'lsof') {
        return 'n/Users/bldt/Desktop/VHC/VHC-hottest-fix/services/news-aggregator\n';
      }
      if (command === 'kill') {
        return '';
      }
      throw new Error(`unexpected ${command}`);
    });
    const argv = [
      'node',
      'cleanup',
      '--repo-root',
      '/Users/bldt/Desktop/VHC/VHC-hottest-fix',
      '--gun-peer-url',
      'http://localhost:9787/gun',
    ];

    expect(readArg('--repo-root', argv)).toBe('/Users/bldt/Desktop/VHC/VHC-hottest-fix');
    expect(readArg('--missing', argv)).toBe('');
    expect(readArg('--repo-root', ['node', 'cleanup', '--repo-root'])).toBe('');
    expect(runCleanup(argv, execSync, log)).toEqual(['111']);
    expect(log).toHaveBeenCalledWith('{\n  "killed": [\n    "111"\n  ]\n}');
  });

  it('throws for missing required args', () => {
    expect(() => runCleanup(['node', 'cleanup'], vi.fn(), vi.fn())).toThrow(
      'usage: --repo-root <path> --gun-peer-url <url>',
    );
  });
});
