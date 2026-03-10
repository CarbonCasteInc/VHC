import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryClusterStore } from './clusterStore';
import { runStoryClusterStagePipeline } from './stageRunner';
import { createDeterministicTestModelProvider } from './testModelProvider';
import { MemoryVectorBackend } from './vectorBackend';

function makeDoc(docId: string, title: string, publishedAt: number) {
  return {
    doc_id: docId,
    source_id: `wire-${docId}`,
    title,
    summary: `${title} summary.`,
    published_at: publishedAt,
    url: `https://example.com/${docId}`,
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe.sequential('stageRunner provider resolution', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('uses an explicitly supplied model provider', async () => {
    const response = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-explicit-provider',
        documents: [makeDoc('doc-1', 'Port attack disrupts terminals overnight', 100)],
      },
      {
        store: new MemoryClusterStore(),
        modelProvider: createDeterministicTestModelProvider(),
      },
    );

    expect(response.bundles).toHaveLength(1);
    expect(response.telemetry.stage_count).toBeGreaterThan(0);
  });

  it('resolves the OpenAI-backed provider outside test mode', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('OPENAI_API_KEY', 'env-key');

    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (url.endsWith('/embeddings')) {
        return jsonResponse({
          data: body.input.map((_value: string, index: number) => ({
            embedding: Array.from({ length: body.dimensions }, (_unused, valueIndex) => Number(index === valueIndex)),
          })),
        });
      }
      const userPayload = JSON.parse(String(body.messages?.[1]?.content ?? '{}'));
      if (userPayload.documents) {
        return jsonResponse({
          choices: [{
            message: {
              content: JSON.stringify({
                documents: userPayload.documents.map((item: { doc_id: string }) => ({
                  doc_id: item.doc_id,
                  doc_type: 'hard_news',
                  entities: ['port_attack'],
                  linked_entities: ['port_attack'],
                  locations: [],
                  temporal_iso: null,
                  trigger: 'attack',
                  event_tuple: {
                    description: 'Port attack disrupts terminals overnight',
                    trigger: 'attack',
                    who: ['port_authority'],
                    where: [],
                    when_iso: null,
                    outcome: 'Shipping remained delayed.',
                  },
                })),
              }),
            },
          }],
        });
      }
      return jsonResponse({
        choices: [{
          message: {
            content: JSON.stringify({
              summaries: userPayload.clusters.map((item: { cluster_id: string }) => ({
                cluster_id: item.cluster_id,
                summary: 'Canonical event summary.',
              })),
            }),
          },
        }],
      });
    });
    vi.stubGlobal('fetch', fetchFn);

    const response = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-env-provider',
        documents: [makeDoc('doc-1', 'Port attack disrupts terminals overnight', 100)],
      },
      { store: new MemoryClusterStore(), vectorBackend: new MemoryVectorBackend() },
    );

    expect(response.bundles).toHaveLength(1);
    expect(response.bundles[0]?.summary_hint).toBe('Canonical event summary.');
    expect(fetchFn).toHaveBeenCalled();
  });
});
