import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CandidateSynthesis, TopicSynthesisV2 } from '@vh/data-model';
import type { NewsSynthesisLifecycleRecord, VennClient } from '@vh/gun-client';
import {
  createRelayRestSynthesisWritersFromEnv,
  shouldEnableRelayRestSynthesisWritesFromEnv,
} from './relayRestSynthesisWriters';

const CLIENT = {
  config: {
    peers: [
      'wss://gun-a.example.test/gun',
      'wss://gun-b.example.test/gun',
    ],
  },
} as VennClient;

const CLIENT_3 = {
  config: {
    peers: [
      'wss://gun-a.example.test/gun',
      'wss://gun-b.example.test/gun',
      'wss://gun-c.example.test/gun',
    ],
  },
} as VennClient;

const SYNTHESIS: TopicSynthesisV2 = {
  schemaVersion: 'topic-synthesis-v2',
  topic_id: 'topic-1',
  epoch: 0,
  synthesis_id: 'news-bundle:story-1:abc123',
  inputs: { story_bundle_ids: ['story-1'] },
  quorum: {
    required: 1,
    received: 1,
    reached_at: 1_000,
    timed_out: false,
    selection_rule: 'deterministic',
  },
  facts_summary: 'A verified summary.',
  frames: [{
    frame: 'Frame',
    reframe: 'Reframe',
    frame_point_id: 'point-frame',
    reframe_point_id: 'point-reframe',
  }],
  warnings: [],
  divergence_metrics: {
    disagreement_score: 0.5,
    source_dispersion: 1,
    candidate_count: 1,
  },
  provenance: {
    candidate_ids: ['candidate-1'],
    provider_mix: [{ provider_id: 'openai', count: 1 }],
  },
  created_at: 1_000,
};

const CANDIDATE: CandidateSynthesis = {
  candidate_id: 'candidate-1',
  topic_id: 'topic-1',
  epoch: 0,
  critique_notes: [],
  key_facts: ['A verified fact.'],
  facts_summary: 'A verified summary.',
  frames: [{
    frame: 'Frame',
    reframe: 'Reframe',
  }],
  source_analyses: [{
    source_id: 'source-1',
    publisher: 'Publisher',
    title: 'Source story',
    url: 'https://example.com/story',
    url_hash: 'abc123',
    key_facts: ['A verified fact.'],
    summary: 'Source summary.',
    bias_claim_quote: [],
    justify_bias_claim: [],
    biases: [],
    counterpoints: [],
    perspectives: [{
      frame: 'Frame',
      reframe: 'Reframe',
    }],
    analyzed_at: 1_000,
  }],
  warnings: [],
  divergence_hints: [],
  provider: {
    provider_id: 'remote-analysis',
    model_id: 'gpt-test',
    kind: 'remote',
  },
  created_at: 1_000,
};

const LIFECYCLE: NewsSynthesisLifecycleRecord = {
  schemaVersion: 'vh-news-synthesis-lifecycle-v1',
  story_id: 'story-1',
  topic_id: 'topic-1',
  source_set_revision: 'source-set-1',
  source_count: 2,
  canonical_source_count: 2,
  status: 'accepted_available',
  retryable: false,
  synthesis_id: SYNTHESIS.synthesis_id,
  epoch: SYNTHESIS.epoch,
  frame_table_state: 'frame_table_ready',
  updated_at: 1_000,
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
  });
}

describe('relayRestSynthesisWriters', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stays disabled unless explicitly requested', () => {
    expect(shouldEnableRelayRestSynthesisWritesFromEnv()).toBe(false);

    vi.stubEnv('VH_BUNDLE_SYNTHESIS_RELAY_WRITE_ORIGINS', 'https://gun-a.example.test');
    expect(shouldEnableRelayRestSynthesisWritesFromEnv()).toBe(true);
  });

  it('fails closed when relay REST writes are enabled without a daemon token', () => {
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_WRITE_RELAY_REST', 'true');

    expect(() => createRelayRestSynthesisWritersFromEnv(CLIENT))
      .toThrow(
        'VH_RELAY_DAEMON_TOKEN or VH_BUNDLE_SYNTHESIS_RELAY_WRITE_TOKENS[https://gun-a.example.test] is required',
      );
  });

  it('posts candidate, accepted synthesis, and lifecycle rows to every configured relay endpoint', async () => {
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_WRITE_RELAY_REST', 'true');
    vi.stubEnv('VH_RELAY_DAEMON_TOKEN', 'relay-token');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'GET' && url.includes('/vh/topics/synthesis?')) {
        return jsonResponse({ ok: false, error: 'topic-synthesis-not-found' }, { status: 404 });
      }
      if (init?.method === 'POST' && url.endsWith('/vh/topics/synthesis')) {
        return jsonResponse({
          ok: true,
          topic_id: SYNTHESIS.topic_id,
          synthesis_id: SYNTHESIS.synthesis_id,
        });
      }
      if (init?.method === 'POST' && url.endsWith('/vh/topics/synthesis-candidate')) {
        return jsonResponse({
          ok: true,
          topic_id: CANDIDATE.topic_id,
          candidate_id: CANDIDATE.candidate_id,
        });
      }
      if (init?.method === 'POST' && url.endsWith('/vh/news/synthesis-lifecycle')) {
        return jsonResponse({
          ok: true,
          story_id: LIFECYCLE.story_id,
          status: LIFECYCLE.status,
        });
      }
      return jsonResponse({ ok: false }, { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const writers = createRelayRestSynthesisWritersFromEnv(CLIENT, console);

    await expect(writers.writeCandidate?.(CLIENT, CANDIDATE)).resolves.toEqual(CANDIDATE);
    await expect(writers.writeSynthesis?.(CLIENT, SYNTHESIS)).resolves.toEqual(SYNTHESIS);
    await expect(writers.writeLatest?.(CLIENT, SYNTHESIS)).resolves.toMatchObject({
      status: 'written',
      synthesis: SYNTHESIS,
      previous: null,
    });
    await expect(writers.writeLifecycle?.(CLIENT, LIFECYCLE)).resolves.toEqual(LIFECYCLE);

    const postCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(postCalls.map(([url]) => String(url))).toEqual([
      'https://gun-a.example.test/vh/topics/synthesis-candidate',
      'https://gun-b.example.test/vh/topics/synthesis-candidate',
      'https://gun-a.example.test/vh/topics/synthesis',
      'https://gun-b.example.test/vh/topics/synthesis',
      'https://gun-a.example.test/vh/news/synthesis-lifecycle',
      'https://gun-b.example.test/vh/news/synthesis-lifecycle',
    ]);
    expect(postCalls.every(([, init]) => (
      (init?.headers as Record<string, string>).Authorization === 'Bearer relay-token'
    ))).toBe(true);
  });

  it('accepts explicit 2-of-3 quorum for accepted synthesis writes', async () => {
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_WRITE_RELAY_REST', 'true');
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_RELAY_WRITE_MIN_SUCCESS', '2');
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_RELAY_WRITE_REQUIRE_ALL', 'true');
    vi.stubEnv('VH_RELAY_DAEMON_TOKEN', 'relay-token');
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'GET' && url.includes('/vh/topics/synthesis?')) {
        return jsonResponse({ ok: false, error: 'topic-synthesis-not-found' }, { status: 404 });
      }
      if (init?.method === 'POST' && url.includes('gun-a')) {
        return jsonResponse({
          ok: true,
          topic_id: SYNTHESIS.topic_id,
          synthesis_id: SYNTHESIS.synthesis_id,
        });
      }
      if (init?.method === 'POST' && url.includes('gun-b')) {
        return jsonResponse({ ok: false }, { status: 503 });
      }
      if (init?.method === 'POST' && url.includes('gun-c')) {
        return jsonResponse({
          ok: true,
          topic_id: SYNTHESIS.topic_id,
          synthesis_id: SYNTHESIS.synthesis_id,
        });
      }
      return jsonResponse({ ok: false }, { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const writers = createRelayRestSynthesisWritersFromEnv(CLIENT_3, logger);
    await expect(writers.writeLatest?.(CLIENT_3, SYNTHESIS)).resolves.toMatchObject({
      status: 'written',
      synthesis: SYNTHESIS,
      previous: null,
    });

    expect(logger.info).toHaveBeenCalledWith('[vh:bundle-synthesis] relay REST write completed', expect.objectContaining({
      path: '/vh/topics/synthesis',
      relay_success_count: 2,
      relay_target_count: 3,
      relay_required_success_count: 2,
      relay_failed_endpoint_labels: ['https://gun-b.example.test'],
      min_success_configured: true,
    }));
  });

  it('fails explicit 2-of-3 quorum for synthesis writes with one validated success', async () => {
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_WRITE_RELAY_REST', 'true');
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_RELAY_WRITE_MIN_SUCCESS', '2');
    vi.stubEnv('VH_RELAY_DAEMON_TOKEN', 'relay-token');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        topic_id: CANDIDATE.topic_id,
        candidate_id: CANDIDATE.candidate_id,
      }))
      .mockResolvedValueOnce(jsonResponse({ ok: false }, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        topic_id: CANDIDATE.topic_id,
        candidate_id: 'wrong-candidate',
      }));
    vi.stubGlobal('fetch', fetchMock);

    const writers = createRelayRestSynthesisWritersFromEnv(CLIENT_3, console);
    await expect(writers.writeCandidate?.(CLIENT_3, CANDIDATE))
      .rejects.toThrow('Relay REST write failed for /vh/topics/synthesis-candidate: 1/3 succeeded; required=2');
  });

  it('classifies relay backpressure as a failed retryable relay without turning optional synthesis fatality into success', async () => {
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_WRITE_RELAY_REST', 'true');
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_RELAY_WRITE_MIN_SUCCESS', '2');
    vi.stubEnv('VH_RELAY_DAEMON_TOKEN', 'relay-token');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        topic_id: CANDIDATE.topic_id,
        candidate_id: CANDIDATE.candidate_id,
      }))
      .mockResolvedValueOnce(jsonResponse({
        ok: false,
        error: 'relay-critical-readback-backpressure',
        retryable: true,
        retry_after_seconds: 2,
      }, {
        status: 503,
        headers: { 'retry-after': '2' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        topic_id: CANDIDATE.topic_id,
        candidate_id: 'wrong-candidate',
      }));
    vi.stubGlobal('fetch', fetchMock);

    const writers = createRelayRestSynthesisWritersFromEnv(CLIENT_3, console);
    await expect(writers.writeCandidate?.(CLIENT_3, CANDIDATE))
      .rejects.toThrow(/failed=https:\/\/gun-b\.example\.test:relay-backpressure/);
  });

  it('fails before posting synthesis writes for invalid or impossible explicit quorum', async () => {
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_WRITE_RELAY_REST', 'true');
    vi.stubEnv('VH_RELAY_DAEMON_TOKEN', 'relay-token');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    vi.stubEnv('VH_BUNDLE_SYNTHESIS_RELAY_WRITE_MIN_SUCCESS', '0');
    let writers = createRelayRestSynthesisWritersFromEnv(CLIENT, console);
    await expect(writers.writeCandidate?.(CLIENT, CANDIDATE))
      .rejects.toThrow('Invalid VH_BUNDLE_SYNTHESIS_RELAY_WRITE_MIN_SUCCESS');

    vi.stubEnv('VH_BUNDLE_SYNTHESIS_RELAY_WRITE_MIN_SUCCESS', '3');
    writers = createRelayRestSynthesisWritersFromEnv(CLIENT, console);
    await expect(writers.writeCandidate?.(CLIENT, CANDIDATE))
      .rejects.toThrow('Impossible VH_BUNDLE_SYNTHESIS_RELAY_WRITE_MIN_SUCCESS=3: only 2 relay REST endpoint(s) resolved');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves legacy synthesis require_all=false one-success behavior when min success is absent', async () => {
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_WRITE_RELAY_REST', 'true');
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_RELAY_WRITE_REQUIRE_ALL', 'false');
    vi.stubEnv('VH_RELAY_DAEMON_TOKEN', 'relay-token');
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        topic_id: CANDIDATE.topic_id,
        candidate_id: CANDIDATE.candidate_id,
      }))
      .mockResolvedValueOnce(jsonResponse({ ok: false }, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const writers = createRelayRestSynthesisWritersFromEnv(CLIENT, logger);
    await expect(writers.writeCandidate?.(CLIENT, CANDIDATE)).resolves.toEqual(CANDIDATE);

    expect(logger.info).toHaveBeenCalledWith('[vh:bundle-synthesis] relay REST write completed', expect.objectContaining({
      relay_success_count: 1,
      relay_target_count: 2,
      relay_required_success_count: 1,
      require_all: false,
      min_success_configured: false,
    }));
  });

  it('rejects impossible synthesis quorum after runtime endpoints shrink', async () => {
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_WRITE_RELAY_REST', 'true');
    vi.stubEnv(
      'VH_BUNDLE_SYNTHESIS_RELAY_WRITE_ORIGINS',
      'https://gun-a.example.test,mailto:bad,https://gun-b.example.test,https://gun-a.example.test',
    );
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_RELAY_WRITE_MIN_SUCCESS', '3');
    vi.stubEnv('VH_RELAY_DAEMON_TOKEN', 'relay-token');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const writers = createRelayRestSynthesisWritersFromEnv(CLIENT_3, console);
    await expect(writers.writeLifecycle?.(CLIENT_3, LIFECYCLE))
      .rejects.toThrow('Impossible VH_BUNDLE_SYNTHESIS_RELAY_WRITE_MIN_SUCCESS=3: only 2 relay REST endpoint(s) resolved');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts synthesis rows with per-origin daemon tokens from the news relay token map', async () => {
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_WRITE_RELAY_REST', 'true');
    vi.stubEnv('VH_NEWS_RELAY_REST_WRITE_TOKENS', JSON.stringify({
      'https://gun-a.example.test': 'token-a',
      'https://gun-b.example.test': 'token-b',
    }));
    const fetchMock = vi.fn(async () => jsonResponse({
      ok: true,
      topic_id: CANDIDATE.topic_id,
      candidate_id: CANDIDATE.candidate_id,
    }));
    vi.stubGlobal('fetch', fetchMock);

    const writers = createRelayRestSynthesisWritersFromEnv(CLIENT, console);

    await expect(writers.writeCandidate?.(CLIENT, CANDIDATE)).resolves.toEqual(CANDIDATE);

    expect(fetchMock.mock.calls.map(([url, init]) => ({
      origin: new URL(String(url)).origin,
      auth: (init?.headers as Record<string, string>).Authorization,
    }))).toEqual([
      { origin: 'https://gun-a.example.test', auth: 'Bearer token-a' },
      { origin: 'https://gun-b.example.test', auth: 'Bearer token-b' },
    ]);
  });

  it('fails before posting when synthesis relay token coverage is incomplete', () => {
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_WRITE_RELAY_REST', 'true');
    vi.stubEnv('VH_NEWS_RELAY_REST_WRITE_TOKENS', JSON.stringify({
      'https://gun-a.example.test': 'token-a',
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(() => createRelayRestSynthesisWritersFromEnv(CLIENT))
      .toThrow(
        'VH_RELAY_DAEMON_TOKEN or VH_BUNDLE_SYNTHESIS_RELAY_WRITE_TOKENS[https://gun-b.example.test] is required',
      );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('honors the latest synthesis ownership guard before relay writes', async () => {
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_WRITE_RELAY_REST', 'true');
    vi.stubEnv('VH_RELAY_DAEMON_TOKEN', 'relay-token');
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_RELAY_WRITE_ORIGINS', 'https://gun-a.example.test');
    const existing = { ...SYNTHESIS, synthesis_id: 'manual-synthesis' };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'GET') {
        return jsonResponse({ ok: true, synthesis: existing });
      }
      return jsonResponse({ ok: false }, { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const writers = createRelayRestSynthesisWritersFromEnv(CLIENT, console);
    await expect(writers.writeLatest?.(CLIENT, SYNTHESIS, {
      canOverwriteExisting: (observed) => observed.synthesis_id.startsWith('news-bundle:'),
    })).resolves.toMatchObject({
      status: 'skipped',
      reason: 'ownership_guard',
      previous: existing,
    });

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  });
});
