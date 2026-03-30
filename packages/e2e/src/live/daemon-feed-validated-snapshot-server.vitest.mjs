import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { resolveValidatedSnapshotFixture, startValidatedSnapshotServer } from './daemon-feed-validated-snapshot-server.mjs';

async function findAvailablePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

describe('validated snapshot server', () => {
  const tempRoots = [];

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('resolves the latest passing publisher canary snapshot', () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'vh-validated-snapshot-'));
    tempRoots.push(repoRoot);
    const canaryDir = path.join(repoRoot, '.tmp', 'daemon-feed-publisher-canary', '100');
    mkdirSync(canaryDir, { recursive: true });
    writeFileSync(path.join(canaryDir, 'publisher-canary-summary.json'), JSON.stringify({ pass: true }), 'utf8');
    writeFileSync(path.join(canaryDir, 'published-store-snapshot.json'), JSON.stringify({ stories: [] }), 'utf8');

    const fixture = resolveValidatedSnapshotFixture({ repoRoot });
    expect(fixture.snapshotPath).toBe(path.join(canaryDir, 'published-store-snapshot.json'));
    expect(fixture.summaryPath).toBe(path.join(canaryDir, 'publisher-canary-summary.json'));
    expect(fixture.snapshot).toEqual({ stories: [] });
  });

  it('serves health and snapshot payloads from an explicit fixture path', async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), 'vh-validated-snapshot-'));
    tempRoots.push(repoRoot);
    const fixturePath = path.join(repoRoot, 'snapshot.json');
    writeFileSync(fixturePath, JSON.stringify({
      stories: [{ story_id: 'story-1', sources: [{ source_id: 'guardian-us' }, { source_id: 'ap-topnews' }] }],
      storylines: [{ storyline_id: 'storyline-1' }],
      latestIndex: { 'story-1': 123 },
      hotIndex: { 'story-1': 0.8 },
    }), 'utf8');
    const port = await findAvailablePort();
    const { server } = await startValidatedSnapshotServer({
      repoRoot,
      env: {
        ...process.env,
        VH_VALIDATED_SNAPSHOT_PORT: String(port),
        VH_VALIDATED_SNAPSHOT_FIXTURE_PATH: fixturePath,
      },
      log: () => {},
    });

    try {
      const healthResponse = await fetch(`http://127.0.0.1:${port}/health`);
      const snapshotResponse = await fetch(`http://127.0.0.1:${port}/snapshot.json`);
      const health = await healthResponse.json();
      const snapshot = await snapshotResponse.json();
      expect(health.ok).toBe(true);
      expect(health.snapshotSummary).toMatchObject({ storyCount: 1, uniqueSourceCount: 2 });
      expect(snapshot.stories).toHaveLength(1);
      expect(healthResponse.headers.get('access-control-allow-origin')).toBe('*');
      expect(snapshotResponse.headers.get('access-control-allow-origin')).toBe('*');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
