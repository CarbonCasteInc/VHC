import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from './index';
import { resolveRelayRestEndpointFromPeer } from './relayRestFallback';
import {
  readTopicLatestSynthesisViaRelayRest,
  readTopicLatestSynthesisWithRelayRestFallback,
} from './synthesisAdapters';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveRelayRestEndpointFromPeer', () => {
  it('normalizes websocket peers to relay HTTPS endpoints outside the browser', () => {
    expect(resolveRelayRestEndpointFromPeer('wss://relay.example.test/gun', '/vh/forum/comment'))
      .toBe('https://relay.example.test/vh/forum/comment');
    expect(resolveRelayRestEndpointFromPeer('ws://127.0.0.1:7777/gun', '/vh/aggregates/voter'))
      .toBe('http://127.0.0.1:7777/vh/aggregates/voter');
    expect(resolveRelayRestEndpointFromPeer('wss://relay.example.test/gun', 'vh/forum/thread'))
      .toBe('https://relay.example.test/vh/forum/thread');
  });

  it('uses the app origin for HTTPS browser fallbacks to preserve strict CSP', () => {
    vi.stubGlobal('location', {
      href: 'https://venn.carboncaste.io/stories/story-1',
      origin: 'https://venn.carboncaste.io',
      protocol: 'https:',
    });

    expect(resolveRelayRestEndpointFromPeer('wss://gun-a.carboncaste.io/gun', '/vh/forum/comment'))
      .toBe('https://venn.carboncaste.io/vh/forum/comment');
  });

  it('keeps same-origin and non-HTTPS browser fallbacks on the relay origin', () => {
    vi.stubGlobal('location', {
      href: 'http://127.0.0.1:5173/',
      origin: 'http://127.0.0.1:5173',
      protocol: 'http:',
    });

    expect(resolveRelayRestEndpointFromPeer('http://127.0.0.1:7777/gun', '/vh/forum/thread'))
      .toBe('http://127.0.0.1:7777/vh/forum/thread');
  });

  it('rejects non-http peer protocols and malformed peer urls', () => {
    expect(resolveRelayRestEndpointFromPeer('mailto:relay@example.test', '/vh/forum/thread'))
      .toBeNull();
    expect(resolveRelayRestEndpointFromPeer('http://[', '/vh/forum/thread'))
      .toBeNull();
  });
});

describe('readTopicLatestSynthesisViaRelayRest', () => {
  it('uses same-origin relay fallback and validates the returned latest record', async () => {
    vi.stubGlobal('location', {
      href: 'https://venn.carboncaste.io/',
      origin: 'https://venn.carboncaste.io',
      protocol: 'https:',
    });
    const synthesis = {
      schemaVersion: 'topic-synthesis-v2',
      topic_id: 'topic-1',
      epoch: 2,
      synthesis_id: 'synth-2',
      inputs: { story_bundle_ids: ['story-1'] },
      quorum: {
        required: 1,
        received: 1,
        reached_at: 100,
        timed_out: false,
        selection_rule: 'deterministic',
      },
      facts_summary: 'Accepted synthesis summary.',
      frames: [
        {
          frame_point_id: 'frame-1',
          frame: 'Frame',
          reframe_point_id: 'reframe-1',
          reframe: 'Reframe',
        },
      ],
      warnings: [],
      divergence_metrics: {
        disagreement_score: 0,
        source_dispersion: 0,
        candidate_count: 1,
      },
      provenance: {
        candidate_ids: ['candidate-1'],
        provider_mix: [{ provider_id: 'provider-1', count: 1 }],
      },
      created_at: 200,
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      record: {
        __topic_synthesis_json: JSON.stringify(synthesis),
        schemaVersion: synthesis.schemaVersion,
        topic_id: synthesis.topic_id,
        epoch: synthesis.epoch,
        synthesis_id: synthesis.synthesis_id,
        created_at: synthesis.created_at,
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createClient({
      peers: ['wss://gun-a.carboncaste.io/gun'],
      requireSession: false,
      gunLocalStorage: false,
      gunRadisk: false,
    });
    client.markSessionReady();

    try {
      await expect(readTopicLatestSynthesisViaRelayRest(client, 'topic-1'))
        .resolves.toMatchObject({
          topic_id: 'topic-1',
          synthesis_id: 'synth-2',
          facts_summary: 'Accepted synthesis summary.',
        });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://venn.carboncaste.io/vh/topics/synthesis?topic_id=topic-1',
        expect.objectContaining({ method: 'GET' }),
      );
    } finally {
      await client.shutdown();
    }
  });

  it('accepts the relay-validated synthesis body when the signed record cannot be locally verified', async () => {
    vi.stubGlobal('location', {
      href: 'https://venn.carboncaste.io/',
      origin: 'https://venn.carboncaste.io',
      protocol: 'https:',
    });
    const synthesis = {
      schemaVersion: 'topic-synthesis-v2',
      topic_id: 'topic-1',
      epoch: 2,
      synthesis_id: 'synth-2',
      inputs: { story_bundle_ids: ['story-1'] },
      quorum: {
        required: 1,
        received: 1,
        reached_at: 100,
        timed_out: false,
        selection_rule: 'deterministic',
      },
      facts_summary: 'Relay validated synthesis summary.',
      frames: [
        {
          frame_point_id: 'frame-1',
          frame: 'Frame',
          reframe_point_id: 'reframe-1',
          reframe: 'Reframe',
        },
      ],
      warnings: [],
      divergence_metrics: {
        disagreement_score: 0,
        source_dispersion: 0,
        candidate_count: 1,
      },
      provenance: {
        candidate_ids: ['candidate-1'],
        provider_mix: [{ provider_id: 'provider-1', count: 1 }],
      },
      created_at: 200,
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      synthesis,
      record: {
        __topic_synthesis_json: JSON.stringify(synthesis),
        schemaVersion: synthesis.schemaVersion,
        topic_id: synthesis.topic_id,
        epoch: synthesis.epoch,
        synthesis_id: synthesis.synthesis_id,
        created_at: synthesis.created_at,
        _protocolVersion: 'luma-public-v1',
        _writerKind: 'system',
        _systemWriterId: 'unconfigured-public-writer',
        _systemIssuedAt: 200,
        _systemSignature: 'invalid',
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    const client = createClient({
      peers: ['wss://gun-a.carboncaste.io/gun'],
      requireSession: false,
      gunLocalStorage: false,
      gunRadisk: false,
      systemWriterPin: null,
    });
    client.markSessionReady();

    try {
      await expect(readTopicLatestSynthesisViaRelayRest(client, 'topic-1'))
        .resolves.toMatchObject({
          topic_id: 'topic-1',
          synthesis_id: 'synth-2',
          facts_summary: 'Relay validated synthesis summary.',
        });
    } finally {
      await client.shutdown();
    }
  });

  it('uses relay REST fallback when the direct latest synthesis read is unavailable', async () => {
    vi.stubGlobal('location', {
      href: 'https://venn.carboncaste.io/',
      origin: 'https://venn.carboncaste.io',
      protocol: 'https:',
    });
    const synthesis = {
      schemaVersion: 'topic-synthesis-v2',
      topic_id: 'topic-1',
      epoch: 2,
      synthesis_id: 'synth-2',
      inputs: { story_bundle_ids: ['story-1'] },
      quorum: {
        required: 1,
        received: 1,
        reached_at: 100,
        timed_out: false,
        selection_rule: 'deterministic',
      },
      facts_summary: 'Fallback synthesis summary.',
      frames: [
        {
          frame_point_id: 'frame-1',
          frame: 'Frame',
          reframe_point_id: 'reframe-1',
          reframe: 'Reframe',
        },
      ],
      warnings: [],
      divergence_metrics: {
        disagreement_score: 0,
        source_dispersion: 0,
        candidate_count: 1,
      },
      provenance: {
        candidate_ids: ['candidate-1'],
        provider_mix: [{ provider_id: 'provider-1', count: 1 }],
      },
      created_at: 200,
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      record: {
        __topic_synthesis_json: JSON.stringify(synthesis),
        schemaVersion: synthesis.schemaVersion,
        topic_id: synthesis.topic_id,
        epoch: synthesis.epoch,
        synthesis_id: synthesis.synthesis_id,
        created_at: synthesis.created_at,
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    const client = createClient({
      peers: ['wss://gun-a.carboncaste.io/gun'],
      requireSession: false,
      gunLocalStorage: false,
      gunRadisk: false,
    });
    client.markSessionReady();

    try {
      await expect(readTopicLatestSynthesisWithRelayRestFallback(client, 'topic-1'))
        .resolves.toMatchObject({
          topic_id: 'topic-1',
          synthesis_id: 'synth-2',
          facts_summary: 'Fallback synthesis summary.',
        });
    } finally {
      await client.shutdown();
    }
  });

  it('returns null when both direct and relay latest synthesis reads miss', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 404 })));
    const client = createClient({
      peers: ['wss://gun-a.carboncaste.io/gun'],
      requireSession: false,
      gunLocalStorage: false,
      gunRadisk: false,
    });
    client.markSessionReady();

    try {
      await expect(readTopicLatestSynthesisWithRelayRestFallback(client, 'topic-1'))
        .resolves.toBeNull();
    } finally {
      await client.shutdown();
    }
  }, 10_000);

  it('fails closed for missing synthesis relay endpoints and invalid relay payloads', async () => {
    await expect(
      readTopicLatestSynthesisViaRelayRest({ config: { peers: [] } } as never, 'topic-1'),
    ).resolves.toBeNull();

    const noPeerClient = createClient({
      requireSession: false,
      gunLocalStorage: false,
      gunRadisk: false,
    });
    noPeerClient.markSessionReady();

    try {
      await expect(readTopicLatestSynthesisViaRelayRest(noPeerClient, 'topic-1'))
        .resolves.toBeNull();
    } finally {
      await noPeerClient.shutdown();
    }

    const invalidPeerClient = createClient({
      peers: ['mailto:relay@example.test'],
      requireSession: false,
      gunLocalStorage: false,
      gunRadisk: false,
    });
    invalidPeerClient.markSessionReady();

    try {
      await expect(readTopicLatestSynthesisViaRelayRest(invalidPeerClient, 'topic-1'))
        .resolves.toBeNull();
    } finally {
      await invalidPeerClient.shutdown();
    }

    const relayClient = createClient({
      peers: ['wss://gun-a.carboncaste.io/gun'],
      requireSession: false,
      gunLocalStorage: false,
      gunRadisk: false,
    });
    relayClient.markSessionReady();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, record: { topic_id: 'topic-1' } }), { status: 200 }))
      .mockRejectedValueOnce(new Error('relay synthesis down'));
    vi.stubGlobal('fetch', fetchMock);

    try {
      await expect(readTopicLatestSynthesisViaRelayRest(relayClient, 'topic-1'))
        .resolves.toBeNull();
      await expect(readTopicLatestSynthesisViaRelayRest(relayClient, 'topic-1'))
        .resolves.toBeNull();
    } finally {
      await relayClient.shutdown();
    }
  });
});
