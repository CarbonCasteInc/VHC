import { describe, expect, it, vi } from 'vitest';
import type { StoryAnalysisArtifact } from '@vh/data-model';
import { HydrationBarrier } from './sync/barrier';
import {
  SYSTEM_WRITER_KIND,
  SYSTEM_WRITER_PROTOCOL_VERSION,
  SYSTEM_WRITER_SIGNATURE_SUITE,
  SYSTEM_WRITER_VALIDATION_EVENT,
  canonicalizeSystemWriterRecordBytes,
  type SystemWriterPin,
  type SystemWriterSignHook,
} from './systemWriter';
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
  setReadDelay: (path: string, delayMs: number) => void;
  setPutError: (path: string, err: string) => void;
  setPutDelay: (path: string, delayMs: number) => void;
}

const ED25519 = 'Ed25519';
const WRITER_ID = 'vh-system-writer-test-v1';
const ISSUED_AT = 1_777_777_777_000;

function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url');
}

function bytesToCryptoBufferSource(bytes: Uint8Array): BufferSource {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

const defaultSystemWriterSign: SystemWriterSignHook = ({ writerId, path, canonicalBytes }) =>
  `test-signature:${writerId}:${path}:${canonicalBytes.byteLength}`;

async function createRealSystemWriterHooks(): Promise<{
  readonly pin: SystemWriterPin;
  readonly sign: SystemWriterSignHook;
}> {
  const keyPair = await crypto.subtle.generateKey(ED25519, true, ['sign', 'verify']);
  if (!('privateKey' in keyPair) || !('publicKey' in keyPair)) {
    throw new Error('Ed25519 key generation failed');
  }
  const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  return {
    pin: {
      pinVersion: 1,
      schemaEpoch: SYSTEM_WRITER_PROTOCOL_VERSION,
      maxProtocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      signatureSuite: SYSTEM_WRITER_SIGNATURE_SUITE,
      writers: [
        {
          id: WRITER_ID,
          status: 'active',
          publicKey: {
            encoding: 'spki-base64url',
            material: bytesToBase64Url(spki),
          },
        },
      ],
    },
    sign: async ({ canonicalBytes }) => {
      const signature = await crypto.subtle.sign(
        ED25519,
        keyPair.privateKey,
        bytesToCryptoBufferSource(canonicalBytes),
      );
      return bytesToBase64Url(signature);
    },
  };
}

function createFakeMesh(): FakeMesh {
  const reads = new Map<string, unknown>();
  const readDelays = new Map<string, number>();
  const putErrors = new Map<string, string>();
  const putDelays = new Map<string, number>();
  const writes: Array<{ path: string; value: unknown }> = [];

  const makeNode = (segments: string[]): any => {
    const path = segments.join('/');
    const node: any = {
      once: vi.fn((cb?: (data: unknown) => void) => {
        const delayMs = readDelays.get(path);
        if (typeof delayMs === 'number') {
          setTimeout(() => cb?.(reads.get(path)), delayMs);
          return;
        }
        cb?.(reads.get(path));
      }),
      put: vi.fn((value: unknown, cb?: (ack?: { err?: string }) => void) => {
        writes.push({ path, value });
        const err = putErrors.get(path);
        const delayMs = putDelays.get(path);
        if (typeof delayMs === 'number') {
          setTimeout(() => cb?.(err ? { err } : {}), delayMs);
          return;
        }
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
    setReadDelay(path: string, delayMs: number) {
      readDelays.set(path, delayMs);
    },
    setPutError(path: string, err: string) {
      putErrors.set(path, err);
    },
    setPutDelay(path: string, delayMs: number) {
      putDelays.set(path, delayMs);
    },
  };
}

function createClient(
  mesh: FakeMesh,
  guard: TopologyGuard,
  config: Partial<VennClient['config']> = {},
): VennClient {
  const barrier = new HydrationBarrier();
  barrier.markReady();

  return {
    config: {
      peers: [],
      systemWriterId: WRITER_ID,
      systemWriterNow: () => ISSUED_AT,
      systemWriterSign: defaultSystemWriterSign,
      ...config,
    },
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
  bundle_identity: {
    bundle_revision: 'prov-1',
    source_article_ids: ['src-1:url-hash-1'],
    source_count: 1,
    cluster_window_start: 1_700_000_000_000,
    cluster_window_end: 1_700_003_600_000,
  },
};

async function createSignedAnalysisFixture(artifact: StoryAnalysisArtifact = ARTIFACT): Promise<{
  readonly mesh: FakeMesh;
  readonly client: VennClient;
  readonly artifactRecord: Record<string, unknown>;
  readonly pointerRecord: Record<string, unknown>;
}> {
  const hooks = await createRealSystemWriterHooks();
  const mesh = createFakeMesh();
  const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
  const client = createClient(mesh, guard, {
    systemWriterPin: hooks.pin,
    systemWriterSign: hooks.sign,
  });

  await writeAnalysis(client, artifact);

  return {
    mesh,
    client,
    artifactRecord: mesh.writes[0].value as Record<string, unknown>,
    pointerRecord: mesh.writes[1].value as Record<string, unknown>,
  };
}

async function signSystemWriterTestRecord(
  sign: SystemWriterSignHook,
  path: string,
  record: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const signature = await sign({
    canonicalBytes: canonicalizeSystemWriterRecordBytes(record),
    writerId: WRITER_ID,
    path,
    record: record as Parameters<SystemWriterSignHook>[0]['record'],
  });
  return {
    ...record,
    _systemSignature: signature,
  };
}

function withRejectUnmarkedFlag(): () => void {
  const target = globalThis as { __VH_IMPORT_META_ENV__?: Record<string, unknown> };
  const previous = target.__VH_IMPORT_META_ENV__;
  target.__VH_IMPORT_META_ENV__ = { VITE_VH_GUN_REJECT_UNMARKED_SYSTEM_RECORDS: 'true' };
  return () => {
    if (previous === undefined) {
      delete target.__VH_IMPORT_META_ENV__;
    } else {
      target.__VH_IMPORT_META_ENV__ = previous;
    }
  };
}

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

  it('writeAnalysis writes encoded artifact and updates latest pointer', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const result = await writeAnalysis(client, ARTIFACT);

    expect(result).toEqual(ARTIFACT);
    expect(mesh.writes).toHaveLength(2);
    expect(mesh.writes[0].path).toBe('news/stories/story-1/analysis/analysis-1');
    expect(mesh.writes[0].value).toEqual(
      expect.objectContaining({
        __analysis_artifact_codec: 'analysis-artifact-json-v1',
        story_id: ARTIFACT.story_id,
        analysisKey: ARTIFACT.analysisKey,
        provenance_hash: ARTIFACT.provenance_hash,
        model_scope: ARTIFACT.model_scope,
        created_at: ARTIFACT.created_at,
        bundle_identity: ARTIFACT.bundle_identity,
        _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
        _writerKind: SYSTEM_WRITER_KIND,
        _systemWriterId: WRITER_ID,
        _systemIssuedAt: ISSUED_AT,
        _systemSignature: expect.stringContaining(`test-signature:${WRITER_ID}:vh/news/stories/story-1/analysis/analysis-1/`),
      }),
    );
    expect(mesh.writes[0].value).toEqual(
      expect.not.objectContaining({
        _authorScheme: expect.anything(),
        signedWriteEnvelope: expect.anything(),
      }),
    );

    const encoded = mesh.writes[0].value as { artifact_json: string };
    expect(JSON.parse(encoded.artifact_json)).toEqual(ARTIFACT);

    expect(mesh.writes[1]).toEqual({
      path: 'news/stories/story-1/analysis_latest',
      value: expect.objectContaining({
        story_id: ARTIFACT.story_id,
        analysisKey: ARTIFACT.analysisKey,
        provenance_hash: ARTIFACT.provenance_hash,
        model_scope: ARTIFACT.model_scope,
        created_at: ARTIFACT.created_at,
        bundle_identity: ARTIFACT.bundle_identity,
        _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
        _writerKind: SYSTEM_WRITER_KIND,
        _systemWriterId: WRITER_ID,
        _systemIssuedAt: ISSUED_AT,
        _systemSignature: expect.stringContaining(`test-signature:${WRITER_ID}:vh/news/stories/story-1/analysis_latest/`),
      }),
    });
    expect(mesh.writes[1].value).toEqual(
      expect.not.objectContaining({
        _authorScheme: expect.anything(),
        signedWriteEnvelope: expect.anything(),
      }),
    );
  });

  it('writeAnalysis omits optional bundle identity from signed records when absent', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    const { bundle_identity: _bundleIdentity, ...legacyArtifact } = ARTIFACT;

    await expect(writeAnalysis(client, legacyArtifact)).resolves.toEqual(legacyArtifact);

    expect(mesh.writes[0].value).toEqual(
      expect.not.objectContaining({
        bundle_identity: expect.anything(),
      }),
    );
    expect(mesh.writes[1]).toEqual({
      path: 'news/stories/story-1/analysis_latest',
      value: expect.objectContaining({
        story_id: ARTIFACT.story_id,
        analysisKey: ARTIFACT.analysisKey,
        provenance_hash: ARTIFACT.provenance_hash,
        model_scope: ARTIFACT.model_scope,
        created_at: ARTIFACT.created_at,
      }),
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

  it('writeAnalysis fails before persistence when system signing is unavailable or malformed', async () => {
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;

    const missingSignerMesh = createFakeMesh();
    await expect(
      writeAnalysis(createClient(missingSignerMesh, guard, { systemWriterSign: undefined }), ARTIFACT),
    ).rejects.toThrow('system writer signer is required for news analysis writes');
    expect(missingSignerMesh.writes).toEqual([]);

    const invalidSignatureMesh = createFakeMesh();
    await expect(
      writeAnalysis(createClient(invalidSignatureMesh, guard, { systemWriterSign: () => ' invalid-signature' }), ARTIFACT),
    ).rejects.toThrow('system writer signer returned an invalid signature');
    expect(invalidSignatureMesh.writes).toEqual([]);

    const pointerBuildFailureMesh = createFakeMesh();
    await expect(
      writeAnalysis(createClient(pointerBuildFailureMesh, guard, {
        systemWriterSign: ({ path }) => path.includes('analysis_latest') ? '' : 'valid-signature',
      }), ARTIFACT),
    ).rejects.toThrow('system writer signer returned an invalid signature');
    expect(pointerBuildFailureMesh.writes).toEqual([]);

    const invalidTimestampMesh = createFakeMesh();
    await expect(
      writeAnalysis(createClient(invalidTimestampMesh, guard, { systemWriterNow: () => -1 }), ARTIFACT),
    ).rejects.toThrow('system writer issued-at must be a non-negative safe integer');
    expect(invalidTimestampMesh.writes).toEqual([]);
  });

  it('writeAnalysis resolves on ack timeout once readback confirms persistence and ignores a late ack callback', async () => {
    vi.useFakeTimers();
    const mesh = createFakeMesh();
    mesh.setPutDelay('news/stories/story-1/analysis/analysis-1', 1100);
    setTimeout(() => {
      mesh.setRead('news/stories/story-1/analysis/analysis-1', ARTIFACT);
    }, 1200);
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const writePromise = writeAnalysis(client, ARTIFACT);
      await vi.advanceTimersByTimeAsync(2500);
      await expect(writePromise).resolves.toEqual(ARTIFACT);

      expect(mesh.writes).toHaveLength(2);
      expect(warnSpy).toHaveBeenCalledWith('[vh:gun-client] analysis put ack timed out, requiring readback confirmation');
    } finally {
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('writeAnalysis rejects when ack times out and readback never confirms persistence', async () => {
    vi.useFakeTimers();
    const mesh = createFakeMesh();
    mesh.setPutDelay('news/stories/story-1/analysis/analysis-1', 1100);
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const writePromise = writeAnalysis(client, ARTIFACT);
      const rejected = expect(writePromise).rejects.toThrow(
        'analysis artifact write timed out and readback did not confirm persistence',
      );
      await vi.advanceTimersByTimeAsync(5000);
      await rejected;
      expect(warnSpy).toHaveBeenCalledWith('[vh:gun-client] analysis put ack timed out, requiring readback confirmation');
    } finally {
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('writeAnalysis resolves when latest pointer ack times out but readback confirms persistence', async () => {
    vi.useFakeTimers();
    const mesh = createFakeMesh();
    mesh.setPutDelay('news/stories/story-1/analysis_latest', 1100);
    mesh.setRead('news/stories/story-1/analysis_latest', {
      analysisKey: ARTIFACT.analysisKey,
      provenance_hash: ARTIFACT.provenance_hash,
      model_scope: ARTIFACT.model_scope,
      created_at: ARTIFACT.created_at,
      bundle_identity: ARTIFACT.bundle_identity,
    });
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const writePromise = writeAnalysis(client, ARTIFACT);
      await vi.advanceTimersByTimeAsync(2500);
      await expect(writePromise).resolves.toEqual(ARTIFACT);
      expect(warnSpy).toHaveBeenCalledWith(
        '[vh:gun-client] analysis latest pointer ack timed out, requiring readback confirmation',
      );
    } finally {
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('writeAnalysis rejects when latest pointer ack times out and readback is invalid', async () => {
    vi.useFakeTimers();
    const mesh = createFakeMesh();
    mesh.setPutDelay('news/stories/story-1/analysis_latest', 1100);
    mesh.setRead('news/stories/story-1/analysis_latest', 42);
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    try {
      const writePromise = writeAnalysis(client, ARTIFACT);
      const rejected = expect(writePromise).rejects.toThrow(
        'analysis latest pointer write timed out and readback did not confirm persistence',
      );
      await vi.advanceTimersByTimeAsync(3500);
      await rejected;
      expect(warnSpy).toHaveBeenCalledWith(
        '[vh:gun-client] analysis latest pointer ack timed out, requiring readback confirmation',
      );
    } finally {
      infoSpy.mockRestore();
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('ignores timeout callback when put already settled and timer fires late', async () => {
    vi.useFakeTimers();
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => undefined);

    try {
      await expect(writeAnalysis(client, ARTIFACT)).resolves.toEqual(ARTIFACT);
      await vi.advanceTimersByTimeAsync(1000);

      expect(warnSpy).not.toHaveBeenCalledWith('[vh:gun-client] analysis put ack timed out, requiring readback confirmation');
      expect(clearTimeoutSpy).toHaveBeenCalled();
    } finally {
      clearTimeoutSpy.mockRestore();
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
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

  it('readAnalysis returns null after read timeout and ignores late once callback', async () => {
    vi.useFakeTimers();
    const mesh = createFakeMesh();
    mesh.setRead('news/stories/story-1/analysis/analysis-1', ARTIFACT);
    mesh.setReadDelay('news/stories/story-1/analysis/analysis-1', 3_000);
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    try {
      const readPromise = readAnalysis(client, 'story-1', 'analysis-1');
      await vi.advanceTimersByTimeAsync(2_500);
      await expect(readPromise).resolves.toBeNull();

      await vi.advanceTimersByTimeAsync(1_000);
      await Promise.resolve();
    } finally {
      vi.useRealTimers();
    }
  });

  it('readAnalysis ignores timeout callback when once settles first and timer fires late', async () => {
    vi.useFakeTimers();
    const mesh = createFakeMesh();
    mesh.setRead('news/stories/story-1/analysis/analysis-1', ARTIFACT);
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => undefined);

    try {
      await expect(readAnalysis(client, 'story-1', 'analysis-1')).resolves.toEqual(ARTIFACT);
      await vi.advanceTimersByTimeAsync(2_500);
      await Promise.resolve();
    } finally {
      clearTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('readAnalysis decodes encoded JSON artifact payload', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/stories/story-1/analysis/analysis-1', {
      __analysis_artifact_codec: 'analysis-artifact-json-v1',
      artifact_json: JSON.stringify(ARTIFACT),
      story_id: ARTIFACT.story_id,
      analysisKey: ARTIFACT.analysisKey,
      provenance_hash: ARTIFACT.provenance_hash,
      model_scope: ARTIFACT.model_scope,
      created_at: ARTIFACT.created_at,
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readAnalysis(client, 'story-1', 'analysis-1')).resolves.toEqual(ARTIFACT);
  });

  it('readAnalysis and readLatestAnalysis validate real signed system writer records', async () => {
    const { mesh, client, artifactRecord, pointerRecord } = await createSignedAnalysisFixture();
    mesh.setRead('news/stories/story-1/analysis/analysis-1', artifactRecord);
    mesh.setRead('news/stories/story-1/analysis_latest', pointerRecord);

    await expect(readAnalysis(client, 'story-1', 'analysis-1')).resolves.toEqual(ARTIFACT);
    await expect(readLatestAnalysis(client, 'story-1')).resolves.toEqual(ARTIFACT);
  });

  it('rejects unmarked and clean legacy-marked analysis artifacts and pointers when reject-unmarked mode is on', async () => {
    const { mesh, client, artifactRecord, pointerRecord } = await createSignedAnalysisFixture();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    class TestCustomEvent extends Event {
      readonly detail: unknown;

      constructor(type: string, init?: CustomEventInit) {
        super(type);
        this.detail = init?.detail;
      }
    }
    const dispatchSpy = vi.fn(() => true);
    vi.stubGlobal('CustomEvent', TestCustomEvent);
    vi.stubGlobal('dispatchEvent', dispatchSpy);
    const restoreFlag = withRejectUnmarkedFlag();

    const bareArtifact = {
      __analysis_artifact_codec: 'analysis-artifact-json-v1',
      artifact_json: JSON.stringify(ARTIFACT),
      story_id: ARTIFACT.story_id,
      analysisKey: ARTIFACT.analysisKey,
      provenance_hash: ARTIFACT.provenance_hash,
      model_scope: ARTIFACT.model_scope,
      created_at: ARTIFACT.created_at,
    };
    const legacyArtifact = { ...bareArtifact, _writerKind: 'legacy', _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION };
    const barePointer = {
      analysisKey: ARTIFACT.analysisKey,
      provenance_hash: ARTIFACT.provenance_hash,
      model_scope: ARTIFACT.model_scope,
      created_at: ARTIFACT.created_at,
      bundle_identity: ARTIFACT.bundle_identity,
    };
    const legacyPointer = { ...barePointer, _writerKind: 'legacy', _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION };

    try {
      // Signed records still read back flag-on.
      mesh.setRead('news/stories/story-1/analysis/analysis-1', artifactRecord);
      mesh.setRead('news/stories/story-1/analysis_latest', pointerRecord);
      await expect(readAnalysis(client, 'story-1', 'analysis-1')).resolves.toEqual(ARTIFACT);
      await expect(readLatestAnalysis(client, 'story-1')).resolves.toEqual(ARTIFACT);

      // Bare-unmarked AND clean legacy-marked artifacts are refused flag-on.
      for (const record of [bareArtifact, legacyArtifact]) {
        warnSpy.mockClear();
        mesh.setRead('news/stories/story-1/analysis/analysis-1', record);
        await expect(readAnalysis(client, 'story-1', 'analysis-1')).resolves.toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(
          `[vh:analysis] ${SYSTEM_WRITER_VALIDATION_EVENT}`,
          expect.objectContaining({
            event: SYSTEM_WRITER_VALIDATION_EVENT,
            reason: 'unmarked-record-rejected',
          }),
        );
      }

      // Bare-unmarked AND clean legacy-marked latest pointers are refused flag-on
      // (parseLatestPointerFromStoredRecord returns { state: 'blocked' }).
      for (const record of [barePointer, legacyPointer]) {
        warnSpy.mockClear();
        mesh.setRead('news/stories/story-1/analysis_latest', record);
        await expect(readLatestAnalysis(client, 'story-1')).resolves.toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(
          `[vh:analysis] ${SYSTEM_WRITER_VALIDATION_EVENT}`,
          expect.objectContaining({
            event: SYSTEM_WRITER_VALIDATION_EVENT,
            reason: 'unmarked-record-rejected',
          }),
        );
      }

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: SYSTEM_WRITER_VALIDATION_EVENT,
          detail: expect.objectContaining({ reason: 'unmarked-record-rejected' }),
        }),
      );
    } finally {
      restoreFlag();
      vi.unstubAllGlobals();
      warnSpy.mockRestore();
    }
  });

  it('readAnalysis rejects tampered or path-mismatched system writer artifacts', async () => {
    const { mesh, client, artifactRecord } = await createSignedAnalysisFixture();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      for (const record of [
        { ...artifactRecord, artifact_json: JSON.stringify({ ...ARTIFACT, summary: 'Tampered summary' }) },
        { ...artifactRecord, _protocolVersion: 'luma-public-v2' },
        { ...artifactRecord, _systemWriterId: 'unknown-writer' },
        { ...artifactRecord, _systemIssuedAt: ISSUED_AT + 1 },
        { ...artifactRecord, _systemSignature: `${String(artifactRecord._systemSignature)}tampered` },
      ]) {
        mesh.setRead('news/stories/story-1/analysis/analysis-1', record);
        await expect(readAnalysis(client, 'story-1', 'analysis-1')).resolves.toBeNull();
      }

      mesh.setRead('news/stories/story-1/analysis/wrong-key', artifactRecord);
      await expect(readAnalysis(client, 'story-1', 'wrong-key')).resolves.toBeNull();

      mesh.setRead('news/stories/story-1/analysis/analysis-1', {
        ...artifactRecord,
        _writerKind: 'legacy',
      });
      await expect(readAnalysis(client, 'story-1', 'analysis-1')).resolves.toBeNull();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('readAnalysis fails closed with system-writer-validation-failed when the pin is missing', async () => {
    const { artifactRecord } = await createSignedAnalysisFixture();
    const mesh = createFakeMesh();
    mesh.setRead('news/stories/story-1/analysis/analysis-1', artifactRecord);
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, { systemWriterPin: null });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(readAnalysis(client, 'story-1', 'analysis-1')).resolves.toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        `[vh:analysis] ${SYSTEM_WRITER_VALIDATION_EVENT}`,
        expect.objectContaining({
          event: SYSTEM_WRITER_VALIDATION_EVENT,
          reason: 'missing-pin',
          path: '[REDACTED:mesh-path]',
        }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('dispatches browser system-writer validation events when available', async () => {
    const { artifactRecord } = await createSignedAnalysisFixture();
    const mesh = createFakeMesh();
    mesh.setRead('news/stories/story-1/analysis/analysis-1', artifactRecord);
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, { systemWriterPin: null });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dispatchEventSpy = vi.fn(() => true);
    const hadDispatchEvent = 'dispatchEvent' in globalThis;
    const previousDispatchEvent = globalThis.dispatchEvent;
    const hadCustomEvent = 'CustomEvent' in globalThis;
    const previousCustomEvent = globalThis.CustomEvent;
    const TestCustomEvent = class {
      readonly type: string;
      readonly detail: unknown;

      constructor(type: string, init?: CustomEventInit) {
        this.type = type;
        this.detail = init?.detail;
      }
    } as unknown as typeof CustomEvent;

    Object.defineProperty(globalThis, 'dispatchEvent', {
      configurable: true,
      value: dispatchEventSpy,
    });
    Object.defineProperty(globalThis, 'CustomEvent', {
      configurable: true,
      value: TestCustomEvent,
    });

    try {
      await expect(readAnalysis(client, 'story-1', 'analysis-1')).resolves.toBeNull();
      expect(dispatchEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: SYSTEM_WRITER_VALIDATION_EVENT,
          detail: expect.objectContaining({ reason: 'missing-pin' }),
        }),
      );
    } finally {
      if (hadDispatchEvent) {
        Object.defineProperty(globalThis, 'dispatchEvent', {
          configurable: true,
          value: previousDispatchEvent,
        });
      } else {
        delete (globalThis as typeof globalThis & { dispatchEvent?: unknown }).dispatchEvent;
      }
      if (hadCustomEvent) {
        Object.defineProperty(globalThis, 'CustomEvent', {
          configurable: true,
          value: previousCustomEvent,
        });
      } else {
        delete (globalThis as typeof globalThis & { CustomEvent?: unknown }).CustomEvent;
      }
      warnSpy.mockRestore();
    }
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
    mesh.setRead('news/stories/story-1/analysis/encoded-non-string', {
      __analysis_artifact_codec: 'analysis-artifact-json-v1',
      artifact_json: 123,
    });
    mesh.setRead('news/stories/story-1/analysis/encoded-malformed-json', {
      __analysis_artifact_codec: 'analysis-artifact-json-v1',
      artifact_json: '{not-json',
    });
    mesh.setRead('news/stories/story-1/analysis/encoded-forbidden', {
      __analysis_artifact_codec: 'analysis-artifact-json-v1',
      artifact_json: JSON.stringify({ ...ARTIFACT, nullifier: 'bad' }),
    });
    mesh.setRead('news/stories/story-1/analysis/encoded-invalid-schema', {
      __analysis_artifact_codec: 'analysis-artifact-json-v1',
      artifact_json: JSON.stringify({ schemaVersion: 'story-analysis-v1', story_id: 'story-1' }),
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readAnalysis(client, 'story-1', 'missing')).resolves.toBeNull();
    await expect(readAnalysis(client, 'story-1', 'non-object')).resolves.toBeNull();
    await expect(readAnalysis(client, 'story-1', 'invalid')).resolves.toBeNull();
    await expect(readAnalysis(client, 'story-1', 'forbidden')).resolves.toBeNull();
    await expect(readAnalysis(client, 'story-1', 'encoded-non-string')).resolves.toBeNull();
    await expect(readAnalysis(client, 'story-1', 'encoded-malformed-json')).resolves.toBeNull();
    await expect(readAnalysis(client, 'story-1', 'encoded-forbidden')).resolves.toBeNull();
    await expect(readAnalysis(client, 'story-1', 'encoded-invalid-schema')).resolves.toBeNull();

    mesh.setRead('news/stories/story-1/analysis/path-mismatch', {
      ...ARTIFACT,
      analysisKey: 'other-analysis',
    });
    await expect(readAnalysis(client, 'story-1', 'path-mismatch')).resolves.toBeNull();
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

    mesh.setRead('news/stories/story-1/analysis_latest', { invalid: true });
    mesh.setRead('news/stories/story-1/analysis', {
      only: newer,
    });
    await expect(readLatestAnalysis(client, 'story-1', { fallbackToList: false })).resolves.toBeNull();

    mesh.setRead('news/stories/story-1/analysis_latest', 42);
    mesh.setRead('news/stories/story-1/analysis', {
      only: newer,
    });
    await expect(readLatestAnalysis(client, 'story-1')).resolves.toEqual(newer);
  });

  it('readLatestAnalysis rejects invalid system latest pointers without legacy fallback', async () => {
    const { mesh, client, pointerRecord } = await createSignedAnalysisFixture();
    const newer = { ...ARTIFACT, analysisKey: 'newer', created_at: '2026-02-18T23:00:00.000Z' };
    mesh.setRead('news/stories/story-1/analysis', {
      newer,
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mesh.setRead('news/stories/story-1/analysis_latest', {
        ...pointerRecord,
        analysisKey: 'newer',
      });
      await expect(readLatestAnalysis(client, 'story-1')).resolves.toBeNull();

      mesh.setRead('news/stories/story-1/analysis_latest', {
        ...pointerRecord,
        story_id: 'other-story',
      });
      await expect(readLatestAnalysis(client, 'story-1')).resolves.toBeNull();

      mesh.setRead('news/stories/story-1/analysis_latest', {
        _writerKind: 'legacy',
        _systemWriterId: WRITER_ID,
        analysisKey: 'newer',
        provenance_hash: 'prov-1',
        model_scope: 'model:default',
        created_at: '2026-02-18T23:00:00.000Z',
      });
      await expect(readLatestAnalysis(client, 'story-1')).resolves.toBeNull();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('readLatestAnalysis blocks validly signed latest pointers whose payload does not bind to the story', async () => {
    const hooks = await createRealSystemWriterHooks();
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });
    const newer = { ...ARTIFACT, analysisKey: 'newer', created_at: '2026-02-18T23:00:00.000Z' };
    mesh.setRead('news/stories/story-1/analysis', {
      newer,
    });

    const baseRecord = {
      story_id: 'story-1',
      analysisKey: ARTIFACT.analysisKey,
      provenance_hash: ARTIFACT.provenance_hash,
      model_scope: ARTIFACT.model_scope,
      created_at: ARTIFACT.created_at,
      _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      _writerKind: SYSTEM_WRITER_KIND,
      _systemWriterId: WRITER_ID,
      _systemIssuedAt: ISSUED_AT,
    };
    const path = 'vh/news/stories/story-1/analysis_latest/';

    mesh.setRead(
      'news/stories/story-1/analysis_latest',
      await signSystemWriterTestRecord(hooks.sign, path, {
        ...baseRecord,
        analysisKey: 123,
      }),
    );
    await expect(readLatestAnalysis(client, 'story-1')).resolves.toBeNull();

    mesh.setRead(
      'news/stories/story-1/analysis_latest',
      await signSystemWriterTestRecord(hooks.sign, path, {
        ...baseRecord,
        story_id: 'other-story',
      }),
    );
    await expect(readLatestAnalysis(client, 'story-1')).resolves.toBeNull();
  });

  it('keeps safe legacy-marked analysis artifacts and latest pointers read-compatible', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    const legacyArtifact = {
      _: { '#': 'gun-meta' },
      _writerKind: 'legacy',
      _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      __analysis_artifact_codec: 'analysis-artifact-json-v1',
      artifact_json: JSON.stringify(ARTIFACT),
      story_id: ARTIFACT.story_id,
      analysisKey: ARTIFACT.analysisKey,
      provenance_hash: ARTIFACT.provenance_hash,
      model_scope: ARTIFACT.model_scope,
      created_at: ARTIFACT.created_at,
    };
    const legacyPointer = {
      _writerKind: 'legacy',
      _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      analysisKey: ARTIFACT.analysisKey,
      provenance_hash: ARTIFACT.provenance_hash,
      model_scope: ARTIFACT.model_scope,
      created_at: ARTIFACT.created_at,
      bundle_identity: ARTIFACT.bundle_identity,
    };

    mesh.setRead('news/stories/story-1/analysis/analysis-1', legacyArtifact);
    mesh.setRead('news/stories/story-1/analysis_latest', legacyPointer);

    await expect(readAnalysis(client, 'story-1', 'analysis-1')).resolves.toEqual(ARTIFACT);
    await expect(readLatestAnalysis(client, 'story-1')).resolves.toEqual(ARTIFACT);

    mesh.setRead('news/stories/story-1/analysis/analysis-1', {
      ...legacyArtifact,
      _systemSignature: 'downgraded-system-field',
    });
    mesh.setRead('news/stories/story-1/analysis_latest', {
      ...legacyPointer,
      signedWriteEnvelope: {},
    });

    await expect(readAnalysis(client, 'story-1', 'analysis-1')).resolves.toBeNull();
    await expect(readLatestAnalysis(client, 'story-1')).resolves.toBeNull();
  });

  it('listAnalyses validates system children and excludes invalid signed entries', async () => {
    const validArtifact = { ...ARTIFACT, analysisKey: 'valid', created_at: '2026-02-18T23:00:00.000Z' };
    const invalidArtifact = { ...ARTIFACT, analysisKey: 'invalid', created_at: '2026-02-18T22:30:00.000Z' };
    const validFixture = await createSignedAnalysisFixture(validArtifact);
    const invalidFixture = await createSignedAnalysisFixture(invalidArtifact);
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, {
      systemWriterPin: (validFixture.client.config.systemWriterPin as SystemWriterPin),
      systemWriterSign: validFixture.client.config.systemWriterSign,
    });
    mesh.setRead('news/stories/story-1/analysis', {
      valid: validFixture.artifactRecord,
      invalid: {
        ...invalidFixture.artifactRecord,
        artifact_json: JSON.stringify({ ...invalidArtifact, summary: 'Tampered' }),
      },
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(listAnalyses(client, 'story-1')).resolves.toEqual([validArtifact]);
    } finally {
      warnSpy.mockRestore();
    }
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
