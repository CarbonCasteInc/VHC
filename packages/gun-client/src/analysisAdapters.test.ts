import { describe, expect, it, vi } from 'vitest';
import type { StoryAnalysisArtifact } from '@vh/data-model';
import { HydrationBarrier } from './sync/barrier';
import type { TopologyGuard } from './topology';
import type { VennClient } from './types';
import {
  getStoryAnalysisChain,
  getStoryAnalysisLatestChain,
  getStoryAnalysisRootChain,
  hasForbiddenAnalysisPayloadFields,
  listAnalyses,
  readAnalysis,
  readLatestAnalysis,
  writeAnalysis,
} from './analysisAdapters';

interface FakeMesh {
  root: any;
  writes: Array<{ path: string; value: unknown }>;
  setRead: (path: string, value: unknown) => void;
  setPutError: (path: string, err: string) => void;
}

function createFakeMesh(): FakeMesh {
  const reads = new Map<string, unknown>();
  const putErrors = new Map<string, string>();
  const writes: Array<{ path: string; value: unknown }> = [];

  const makeNode = (segments: string[]): any => {
    const path = segments.join('/');
    const node: any = {
      once: vi.fn((cb?: (data: unknown) => void) => cb?.(reads.get(path))),
      put: vi.fn((value: unknown, cb?: (ack?: { err?: string }) => void) => {
        writes.push({ path, value });
        const err = putErrors.get(path);
        cb?.(err ? { err } : {});
      }),
      get: vi.fn((key: string) => makeNode([...segments, key])),
    };
    return node;
  };

  return {
    root: makeNode([]),
    writes,
    setRead(path: string, value: unknown) {
      reads.set(path, value);
    },
    setPutError(path: string, err: string) {
      putErrors.set(path, err);
    },
  };
}

function createClient(mesh: FakeMesh, guard: TopologyGuard): VennClient {
  const barrier = new HydrationBarrier();
  barrier.markReady();

  return {
    config: { peers: [] },
    hydrationBarrier: barrier,
    storage: {} as VennClient['storage'],
    topologyGuard: guard,
    gun: { user: vi.fn() } as unknown as VennClient['gun'],
    user: {} as VennClient['user'],
    chat: {} as VennClient['chat'],
    outbox: {} as VennClient['outbox'],
    mesh: mesh.root,
    sessionReady: true,
    markSessionReady: vi.fn(),
    linkDevice: vi.fn(),
    shutdown: vi.fn(),
  };
}

const ARTIFACT: StoryAnalysisArtifact = {
  schemaVersion: 'story-analysis-v1',
  story_id: 'story-1',
  topic_id: 'topic-1',
  provenance_hash: 'prov-1',
  analysisKey: 'analysis-1',
  pipeline_version: 'pipeline-v1',
  model_scope: 'model:default',
  summary: 'Synthesis summary',
  frames: [{ frame: 'Frame 1', reframe: 'Reframe 1' }],
  analyses: [
    {
      source_id: 'src-1',
      publisher: 'Example News',
      url: 'https://example.com/story-1',
      summary: 'Source summary',
      biases: ['Bias 1'],
      counterpoints: ['Counterpoint 1'],
      biasClaimQuotes: ['Quote 1'],
      justifyBiasClaims: ['Justification 1'],
      provider_id: 'provider-x',
      model_id: 'model-y',
    },
  ],
  provider: {
    provider_id: 'provider-x',
    model: 'model-y',
    timestamp: 1_700_000_000,
  },
  created_at: '2026-02-18T22:00:00.000Z',
};

describe('analysisAdapters', () => {
  it('builds story analysis root chain and guards nested writes', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const chain = getStoryAnalysisRootChain(client, 'story-1');
    await chain.get('analysis-1').put(ARTIFACT);

    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/news/stories/story-1/analysis/analysis-1/',
      ARTIFACT,
    );
  });

  it('builds direct analysis chain and latest pointer chain', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await getStoryAnalysisChain(client, 'story-1', 'analysis-1').put(ARTIFACT);
    await getStoryAnalysisLatestChain(client, 'story-1').put({
      analysisKey: 'analysis-1',
      provenance_hash: 'prov-1',
      model_scope: 'model:default',
      created_at: '2026-02-18T22:00:00.000Z',
    });

    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/news/stories/story-1/analysis/analysis-1/',
      ARTIFACT,
    );
    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/news/stories/story-1/analysis_latest/',
      expect.objectContaining({ analysisKey: 'analysis-1' }),
    );
  });

  it('writeAnalysis writes artifact and updates latest pointer', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const result = await writeAnalysis(client, ARTIFACT);

    expect(result).toEqual(ARTIFACT);
    expect(mesh.writes).toHaveLength(2);
    expect(mesh.writes[0]).toEqual({
      path: 'news/stories/story-1/analysis/analysis-1',
      value: ARTIFACT,
    });
    expect(mesh.writes[1]).toEqual({
      path: 'news/stories/story-1/analysis_latest',
      value: {
        analysisKey: ARTIFACT.analysisKey,
        provenance_hash: ARTIFACT.provenance_hash,
        model_scope: ARTIFACT.model_scope,
        created_at: ARTIFACT.created_at,
      },
    });
  });

  it('writeAnalysis rejects forbidden payload fields and surfaces ack errors', async () => {
    const mesh = createFakeMesh();
    mesh.setPutError('news/stories/story-1/analysis/analysis-1', 'write failed');
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(
      writeAnalysis(client, {
        ...ARTIFACT,
        oauth_token: 'secret',
      }),
    ).rejects.toThrow('forbidden identity/token fields');

    await expect(writeAnalysis(client, ARTIFACT)).rejects.toThrow('write failed');
  });

  it('readAnalysis parses valid payload and strips gun metadata', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/stories/story-1/analysis/analysis-1', {
      _: { '#': 'gun-meta' },
      ...ARTIFACT,
    });
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readAnalysis(client, 'story-1', 'analysis-1')).resolves.toEqual(ARTIFACT);
  });

  it('readAnalysis returns null for missing/invalid/non-object/forbidden payload', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/stories/story-1/analysis/missing', undefined);
    mesh.setRead('news/stories/story-1/analysis/non-object', 42);
    mesh.setRead('news/stories/story-1/analysis/invalid', { summary: 'missing fields' });
    mesh.setRead('news/stories/story-1/analysis/forbidden', {
      ...ARTIFACT,
      nested: { nullifier: 'bad' },
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readAnalysis(client, 'story-1', 'missing')).resolves.toBeNull();
    await expect(readAnalysis(client, 'story-1', 'non-object')).resolves.toBeNull();
    await expect(readAnalysis(client, 'story-1', 'invalid')).resolves.toBeNull();
    await expect(readAnalysis(client, 'story-1', 'forbidden')).resolves.toBeNull();
  });

  it('readLatestAnalysis uses pointer and falls back to list sorting when pointer is invalid', async () => {
    const mesh = createFakeMesh();
    const older = { ...ARTIFACT, analysisKey: 'older', created_at: '2026-02-18T21:00:00.000Z' };
    const newer = { ...ARTIFACT, analysisKey: 'newer', created_at: '2026-02-18T22:00:00.000Z' };
    const sameDateB = { ...ARTIFACT, analysisKey: 'b-key', created_at: '2026-02-18T22:00:00.000Z' };
    const sameDateA = { ...ARTIFACT, analysisKey: 'a-key', created_at: '2026-02-18T22:00:00.000Z' };

    mesh.setRead('news/stories/story-1/analysis_latest', {
      analysisKey: 'newer',
      provenance_hash: 'prov-1',
      model_scope: 'model:default',
      created_at: '2026-02-18T22:00:00.000Z',
    });
    mesh.setRead('news/stories/story-1/analysis/newer', newer);

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readLatestAnalysis(client, 'story-1')).resolves.toEqual(newer);

    mesh.setRead('news/stories/story-1/analysis_latest', {
      analysisKey: 'newer',
      oauth_token: 'forbidden',
    });
    mesh.setRead('news/stories/story-1/analysis', {
      _: { '#': 'meta' },
      older,
      sameDateB,
      sameDateA,
      invalidDate: { ...ARTIFACT, analysisKey: 'z-key', created_at: 'not-a-date' },
      invalid: { bad: 'payload' },
    });

    await expect(readLatestAnalysis(client, 'story-1')).resolves.toEqual(sameDateA);
    await expect(listAnalyses(client, 'story-1')).resolves.toEqual([
      sameDateA,
      sameDateB,
      older,
      { ...ARTIFACT, analysisKey: 'z-key', created_at: 'not-a-date' },
    ]);

    mesh.setRead('news/stories/story-1/analysis_latest', { invalid: true });
    mesh.setRead('news/stories/story-1/analysis', null);
    await expect(readLatestAnalysis(client, 'story-1')).resolves.toBeNull();
    await expect(listAnalyses(client, 'story-1')).resolves.toEqual([]);
  });

  it('detects forbidden payload fields recursively', () => {
    expect(hasForbiddenAnalysisPayloadFields({ ok: true })).toBe(false);
    expect(hasForbiddenAnalysisPayloadFields({ oauth_token: 'x' })).toBe(true);
    expect(hasForbiddenAnalysisPayloadFields({ custom_token: 'x' })).toBe(true);
    expect(hasForbiddenAnalysisPayloadFields({ nested: { identity_session: 'x' } })).toBe(true);
    expect(hasForbiddenAnalysisPayloadFields({ list: [{ foo: 'bar' }, { nullifier: 'n' }] })).toBe(true);

    const cyclic: Record<string, unknown> = { safe: true };
    cyclic.self = cyclic;
    expect(hasForbiddenAnalysisPayloadFields(cyclic)).toBe(false);
  });

  it('throws on missing required ids', () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    expect(() => getStoryAnalysisRootChain(client, '   ')).toThrow('storyId is required');
    expect(() => getStoryAnalysisChain(client, 'story-1', '   ')).toThrow('analysisKey is required');
    expect(() => getStoryAnalysisLatestChain(client, '   ')).toThrow('storyId is required');
  });
});
