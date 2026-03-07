import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sha256Hex } from './hashUtils';
import type { StoredClusterRecord, StoredTopicState } from './stageState';

const STATE_SCHEMA_VERSION = 'storycluster-state-v1' as const;

export interface ClusterStore {
  loadTopic(topicId: string): StoredTopicState;
  saveTopic(state: StoredTopicState): void;
  readiness(): { ok: boolean; detail: string };
}

function emptyTopicState(topicId: string): StoredTopicState {
  return {
    schema_version: STATE_SCHEMA_VERSION,
    topic_id: topicId,
    next_cluster_seq: 1,
    clusters: [],
  };
}

function cloneCluster(cluster: StoredClusterRecord): StoredClusterRecord {
  return JSON.parse(JSON.stringify(cluster)) as StoredClusterRecord;
}

function cloneState(state: StoredTopicState): StoredTopicState {
  return {
    schema_version: state.schema_version,
    topic_id: state.topic_id,
    next_cluster_seq: state.next_cluster_seq,
    clusters: state.clusters.map(cloneCluster),
  };
}

export class MemoryClusterStore implements ClusterStore {
  private readonly topics = new Map<string, StoredTopicState>();

  loadTopic(topicId: string): StoredTopicState {
    const existing = this.topics.get(topicId);
    return cloneState(existing ?? emptyTopicState(topicId));
  }

  saveTopic(state: StoredTopicState): void {
    this.topics.set(state.topic_id, cloneState(state));
  }

  readiness(): { ok: boolean; detail: string } {
    return { ok: true, detail: 'memory-store' };
  }
}

export class FileClusterStore implements ClusterStore {
  constructor(private readonly stateDir: string) {
    mkdirSync(stateDir, { recursive: true });
  }

  private topicPath(topicId: string): string {
    return join(this.stateDir, `${sha256Hex(topicId, 24)}.json`);
  }

  loadTopic(topicId: string): StoredTopicState {
    const filePath = this.topicPath(topicId);
    try {
      const raw = readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as StoredTopicState;
      if (parsed.schema_version !== STATE_SCHEMA_VERSION || parsed.topic_id !== topicId) {
        return emptyTopicState(topicId);
      }
      return cloneState(parsed);
    } catch {
      return emptyTopicState(topicId);
    }
  }

  saveTopic(state: StoredTopicState): void {
    const filePath = this.topicPath(state.topic_id);
    const directory = dirname(filePath);
    mkdirSync(directory, { recursive: true });
    const tempPath = `${filePath}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    renameSync(tempPath, filePath);
  }

  readiness(): { ok: boolean; detail: string } {
    try {
      mkdirSync(this.stateDir, { recursive: true });
      const probePath = join(this.stateDir, '.ready');
      writeFileSync(probePath, 'ok\n', 'utf8');
      statSync(probePath);
      rmSync(probePath, { force: true });
      return { ok: true, detail: this.stateDir };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, detail };
    }
  }
}

let defaultStore: ClusterStore | null = null;

function resolveStateDir(): string {
  return process.env.VH_STORYCLUSTER_STATE_DIR?.trim() || join(process.cwd(), 'data', 'storycluster-engine');
}

export function getDefaultClusterStore(): ClusterStore {
  if (!defaultStore) {
    defaultStore = process.env.VITEST === 'true'
      ? new MemoryClusterStore()
      : new FileClusterStore(resolveStateDir());
  }
  return defaultStore;
}

export function resetDefaultClusterStore(): void {
  defaultStore = null;
}
