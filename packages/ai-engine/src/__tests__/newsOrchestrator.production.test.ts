import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  newsOrchestratorInternal,
  orchestrateNewsPipeline,
} from '../newsOrchestrator';
import type { StoryBundle } from '../newsTypes';

const xmlForSourceA = `
  <rss>
    <channel>
      <item>
        <title>Markets rally after rate decision</title>
        <link>https://news.example.com/a?utm_source=rss</link>
        <description>Markets moved up.</description>
        <pubDate>Mon, 05 Feb 2024 12:10:00 GMT</pubDate>
      </item>
    </channel>
  </rss>
`;

const remoteBundle: StoryBundle = {
  schemaVersion: 'story-bundle-v0',
  story_id: 'story-remote-prod',
  topic_id: 'topic-finance',
  headline: 'Remote clustered headline',
  summary_hint: 'Remote clustered summary',
  cluster_window_start: 1_700_000_000_000,
  cluster_window_end: 1_700_000_100_000,
  sources: [
    {
      source_id: 'source-a',
      publisher: 'Source A',
      url: 'https://news.example.com/a',
      url_hash: 'hash-a',
      published_at: 1_700_000_000_000,
      title: 'Markets rally after rate decision',
    },
  ],
  cluster_features: {
    entity_keys: ['markets'],
    time_bucket: 'tb-1',
    semantic_signature: 'sig-1',
  },
  provenance_hash: 'prov-1',
  created_at: 1_700_000_200_000,
};

describe('newsOrchestrator production mode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('requires remote endpoint in production mode', async () => {
    await expect(
      orchestrateNewsPipeline(
        {
          feedSources: [
            {
              id: 'source-a',
              name: 'Source A',
              rssUrl: 'https://feeds.example.com/a.xml',
              enabled: true,
            },
          ],
          topicMapping: {
            defaultTopicId: 'topic-finance',
          },
        },
        {
          productionMode: true,
          allowHeuristicFallback: false,
        },
      ),
    ).rejects.toThrow('storycluster remote endpoint is required in production mode');
  });

  it('rejects production mode fallback toggles', () => {
    expect(() =>
      newsOrchestratorInternal.resolveClusterEngine({
        productionMode: true,
        allowHeuristicFallback: true,
        remoteClusterEndpoint: 'https://storycluster.example.com/cluster',
        remoteFetchFn: vi.fn(async () => new Response(JSON.stringify({ bundles: [] }), { status: 200 })),
      }),
    ).toThrow('heuristic fallback is disallowed in production mode');
  });

  it('fails closed when remote clustering is unavailable', async () => {
    const ingestFetch = vi.mocked(globalThis.fetch);
    ingestFetch.mockResolvedValueOnce({
      ok: true,
      text: vi.fn().mockResolvedValue(xmlForSourceA),
    } as unknown as Response);

    const remoteFetchFn = vi.fn(async () => new Response('remote down', { status: 503 }));
    const onRemoteFailure = vi.fn();

    await expect(
      orchestrateNewsPipeline(
        {
          feedSources: [
            {
              id: 'source-a',
              name: 'Source A',
              rssUrl: 'https://feeds.example.com/a.xml',
              enabled: true,
            },
          ],
          topicMapping: {
            defaultTopicId: 'topic-finance',
          },
        },
        {
          productionMode: true,
          allowHeuristicFallback: false,
          remoteClusterEndpoint: 'https://storycluster.example.com/cluster',
          remoteFetchFn,
          onRemoteFailure,
        },
      ),
    ).rejects.toThrow('HTTP 503');

    expect(remoteFetchFn).toHaveBeenCalledTimes(1);
    expect(onRemoteFailure).not.toHaveBeenCalled();
  });

  it('uses remote-only clustering in production mode when healthy', async () => {
    const ingestFetch = vi.mocked(globalThis.fetch);
    ingestFetch.mockResolvedValueOnce({
      ok: true,
      text: vi.fn().mockResolvedValue(xmlForSourceA),
    } as unknown as Response);

    const remoteFetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ bundles: [remoteBundle] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await orchestrateNewsPipeline(
      {
        feedSources: [
          {
            id: 'source-a',
            name: 'Source A',
            rssUrl: 'https://feeds.example.com/a.xml',
            enabled: true,
          },
        ],
        topicMapping: {
          defaultTopicId: 'topic-finance',
        },
      },
      {
        productionMode: true,
        allowHeuristicFallback: false,
        remoteClusterEndpoint: 'https://storycluster.example.com/cluster',
        remoteFetchFn,
      },
    );

    expect(result).toEqual({ bundles: [remoteBundle], storylines: [] });
    expect(remoteFetchFn).toHaveBeenCalledTimes(1);
  });
});
