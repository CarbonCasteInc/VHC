import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FileClusterStore,
  MemoryClusterStore,
  getDefaultClusterStore,
  resetDefaultClusterStore,
} from './clusterStore';
import { sha256Hex } from './hashUtils';

const createdPaths: string[] = [];

afterEach(() => {
  for (const path of createdPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
  delete process.env.VH_STORYCLUSTER_STATE_DIR;
  delete process.env.VITEST;
  resetDefaultClusterStore();
});

describe('clusterStore', () => {
  it('stores topic state in memory', () => {
    const store = new MemoryClusterStore();
    const state = store.loadTopic('topic-a');
    state.next_cluster_seq = 4;
    store.saveTopic(state);

    const loaded = store.loadTopic('topic-a');
    expect(loaded.next_cluster_seq).toBe(4);
    expect(store.readiness()).toEqual({ ok: true, detail: 'memory-store' });
  });

  it('stores topic state on disk and tolerates invalid files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vh-storycluster-'));
    createdPaths.push(dir);
    const store = new FileClusterStore(dir);

    const state = store.loadTopic('topic-a');
    state.next_cluster_seq = 2;
    store.saveTopic(state);
    expect(store.loadTopic('topic-a').next_cluster_seq).toBe(2);

    writeFileSync(join(dir, 'corrupt.json'), '{bad json', 'utf8');
    expect(store.readiness().ok).toBe(true);

    const topicPath = join(dir, `${sha256Hex('topic-a', 24)}.json`);
    writeFileSync(topicPath, JSON.stringify({ schema_version: 'wrong', topic_id: 'different', next_cluster_seq: 99, clusters: [] }), 'utf8');
    expect(store.loadTopic('topic-a').next_cluster_seq).toBe(1);
  });

  it('reports readiness failure for invalid state directories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vh-storycluster-file-'));
    const filePath = join(dir, 'occupied');
    writeFileSync(filePath, 'x', 'utf8');
    createdPaths.push(dir);

    const brokenStore = Object.create(FileClusterStore.prototype) as FileClusterStore;
    Object.defineProperty(brokenStore, 'stateDir', { value: filePath });

    expect(brokenStore.readiness().ok).toBe(false);

    const throwingStore = Object.create(FileClusterStore.prototype) as FileClusterStore;
    Object.defineProperty(throwingStore, 'stateDir', { get: () => { throw 'bad-state-dir'; } });
    expect(throwingStore.readiness()).toEqual({ ok: false, detail: 'bad-state-dir' });
  });

  it('creates default stores from env', () => {
    process.env.VITEST = 'true';
    expect(getDefaultClusterStore()).toBeInstanceOf(MemoryClusterStore);

    resetDefaultClusterStore();
    delete process.env.VITEST;
    const dir = mkdtempSync(join(tmpdir(), 'vh-storycluster-default-'));
    createdPaths.push(dir);
    process.env.VH_STORYCLUSTER_STATE_DIR = dir;
    expect(getDefaultClusterStore()).toBeInstanceOf(FileClusterStore);

    resetDefaultClusterStore();
    delete process.env.VH_STORYCLUSTER_STATE_DIR;
    const defaultFileStore = getDefaultClusterStore() as FileClusterStore;
    expect(defaultFileStore.readiness().ok).toBe(true);
  });
});
