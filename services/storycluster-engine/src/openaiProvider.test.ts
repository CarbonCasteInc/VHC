import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OpenAIStoryClusterProvider,
  createOpenAIStoryClusterProviderFromEnv,
} from './openaiProvider';

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('OpenAIStoryClusterProvider', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('chunks translation requests and trims summaries', async () => {
    const chunkSizes: number[] = [];
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const userPayload = JSON.parse(String(body.messages?.[1]?.content ?? '{}'));
      if (userPayload.translations) {
        chunkSizes.push(userPayload.translations.length);
        return jsonResponse({
          choices: [{
            message: {
              content: JSON.stringify({
                translations: userPayload.translations.map((item: { doc_id: string }) => ({
                  doc_id: item.doc_id,
                  translated_text: `  translated ${item.doc_id}  `,
                })),
              }),
            },
          }],
        });
      }
      throw new Error(`Unexpected request body: ${JSON.stringify(userPayload)}`);
    });
    const provider = new OpenAIStoryClusterProvider({ apiKey: 'key', fetchFn, textModel: '  custom-text  ' });

    expect(await provider.translate([])).toEqual([]);
    const translated = await provider.translate(Array.from({ length: 9 }, (_, index) => ({
      doc_id: `doc-${index}`,
      language: 'es',
      text: `texto ${index}`,
    })));

    expect(chunkSizes).toEqual([8, 1]);
    expect(translated[0]).toEqual({ doc_id: 'doc-0', translated_text: 'translated doc-0' });
  });

  it('chunks embeddings and falls back to an empty vector when a chunk omits an item', async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe('embed-custom');
      return jsonResponse({
        data: body.input.map((_value: string, index: number) => ({
          embedding: [index, index + 1],
        })),
      });
    });
    const provider = new OpenAIStoryClusterProvider({ apiKey: 'key', fetchFn, embeddingModel: 'embed-custom' });
    vi.spyOn((provider as unknown as { client: { embed: (options: unknown) => Promise<number[][]> } }).client, 'embed')
      .mockResolvedValueOnce(Array.from({ length: 64 }, (_unused, index) => [index, index + 1]))
      .mockResolvedValueOnce([]);

    expect(await provider.embed([], 2)).toEqual([]);
    const embeddings = await provider.embed(Array.from({ length: 65 }, (_, index) => ({
      item_id: `item-${index}`,
      text: `text-${index}`,
    })), 2);

    expect(embeddings).toHaveLength(65);
    expect(embeddings[0]).toEqual({ item_id: 'item-0', vector: [0, 1] });
    expect(embeddings[64]).toEqual({ item_id: 'item-64', vector: [] });
  });

  it('normalizes provider-backed document analysis output', async () => {
    const provider = new OpenAIStoryClusterProvider({
      apiKey: 'key',
      fetchFn: async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        const userPayload = JSON.parse(String(body.messages?.[1]?.content ?? '{}'));
        return jsonResponse({
          choices: [{
            message: {
              content: JSON.stringify({
                documents: userPayload.documents.map((item: { doc_id: string }, index: number) => (
                  index === 0
                    ? {
                      doc_id: item.doc_id,
                      doc_type: 'wire_report',
                      entities: ['Port Attack', 'Shipping Delays'],
                      linked_entities: ['Port Attack'],
                      locations: ['New York'],
                      temporal_iso: '2024-03-09T16:00:00.000Z',
                      trigger: 'Attack',
                      event_tuple: {
                        description: 'Port attack response',
                        trigger: 'Attack',
                        who: ['Port Authority'],
                        where: ['New York'],
                        when_iso: '2024-03-09T16:00:00.000Z',
                        outcome: 'Shipping remains delayed',
                      },
                    }
                    : {
                      doc_id: item.doc_id,
                      doc_type: index === 1 ? 'mystery_type' : 'hard_news',
                      entities: null,
                      linked_entities: null,
                      locations: null,
                      temporal_iso: null,
                      trigger: null,
                      event_tuple: index === 1
                        ? {
                          trigger: null,
                          who: null,
                          where: null,
                          when_iso: null,
                          outcome: null,
                        }
                        : [],
                    }
                )),
              }),
            },
          }],
        });
      },
    });

    expect(await provider.analyzeDocuments([])).toEqual([]);
    await expect(provider.analyzeDocuments([
      {
        doc_id: 'doc-1',
        title: 'Port attack response',
        summary: 'Summary',
        publisher: 'Reuters',
        language: 'en',
        text: 'Port attack response summary',
        published_at: 100,
        entity_hints: ['port_attack'],
      },
      {
        doc_id: 'doc-2',
        title: 'Unknown analysis shape',
        summary: 'Summary',
        publisher: 'Desk',
        language: 'en',
        text: 'Unknown analysis shape summary',
        published_at: 200,
        entity_hints: [],
      },
      {
        doc_id: 'doc-3',
        title: 'Array event tuple',
        summary: 'Summary',
        publisher: 'Desk',
        language: 'en',
        text: 'Array event tuple summary',
        published_at: 300,
        entity_hints: [],
      },
    ])).resolves.toEqual([
      {
        doc_id: 'doc-1',
        doc_type: 'wire_report',
        entities: ['port_attack', 'shipping_delays'],
        linked_entities: ['port_attack'],
        locations: ['new_york'],
        temporal_ms: Date.parse('2024-03-09T16:00:00.000Z'),
        trigger: 'Attack',
        event_tuple: {
          description: 'Port attack response',
          trigger: 'Attack',
          who: ['port_authority'],
          where: ['new_york'],
          when_ms: Date.parse('2024-03-09T16:00:00.000Z'),
          outcome: 'Shipping remains delayed',
        },
      },
      {
        doc_id: 'doc-2',
        doc_type: 'hard_news',
        entities: [],
        linked_entities: [],
        locations: [],
        temporal_ms: null,
        trigger: null,
        event_tuple: {
          description: '',
          trigger: null,
          who: [],
          where: [],
          when_ms: null,
          outcome: null,
        },
      },
      {
        doc_id: 'doc-3',
        doc_type: 'hard_news',
        entities: [],
        linked_entities: [],
        locations: [],
        temporal_ms: null,
        trigger: null,
        event_tuple: null,
      },
    ]);
  });

  it('normalizes pair judgements and summary output', async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const userPayload = JSON.parse(String(body.messages?.[1]?.content ?? '{}'));
      if (userPayload.rerank_pairs) {
        return jsonResponse({
          choices: [{
            message: {
              content: JSON.stringify({
                reranks: [
                  { pair_id: 'pair-accepted', score: 1.8 },
                  { pair_id: 'pair-rejected', score: -4 },
                  { pair_id: 'pair-fallback', score: null },
                ],
              }),
            },
          }],
        });
      }
      if (userPayload.adjudication_pairs) {
        return jsonResponse({
          choices: [{
            message: {
              content: JSON.stringify({
                judgements: [
                  { pair_id: 'pair-accepted', score: 1.8, decision: 'accepted' },
                  { pair_id: 'pair-rejected', score: -4, decision: 'rejected' },
                  { pair_id: 'pair-abstain', score: 0.4, decision: 'abstain' },
                  { pair_id: 'pair-fallback', score: null, decision: 'weird' },
                ],
              }),
            },
          }],
        });
      }
      if (userPayload.clusters) {
        return jsonResponse({
          choices: [{
            message: {
              content: JSON.stringify({
                summaries: userPayload.clusters.map((item: { cluster_id: string }) => ({
                  cluster_id: item.cluster_id,
                  summary: `  summary for ${item.cluster_id}  `,
                })),
              }),
            },
          }],
        });
      }
      throw new Error(`Unexpected request body: ${JSON.stringify(userPayload)}`);
    });
    const provider = new OpenAIStoryClusterProvider({ apiKey: 'key', fetchFn });

    expect(await provider.rerankPairs([])).toEqual([]);
    const reranks = await provider.rerankPairs(Array.from({ length: 10 }, (_, index) => ({
      pair_id: ['pair-accepted', 'pair-rejected', 'pair-fallback'][index % 3]!,
      document_title: 'Doc',
      document_text: 'Text',
      document_entities: ['entity'],
      document_trigger: 'attack',
      cluster_headline: 'Headline',
      cluster_summary: 'Summary',
      cluster_entities: ['entity'],
      cluster_triggers: ['attack'],
    })));
    expect(reranks.slice(0, 3)).toEqual([
      { pair_id: 'pair-accepted', score: 1 },
      { pair_id: 'pair-rejected', score: 0 },
      { pair_id: 'pair-fallback', score: 0 },
    ]);

    expect(await provider.adjudicatePairs([])).toEqual([]);
    const judgements = await provider.adjudicatePairs(Array.from({ length: 10 }, (_, index) => ({
      pair_id: ['pair-accepted', 'pair-rejected', 'pair-abstain', 'pair-fallback'][index % 4]!,
      document_title: 'Doc',
      document_text: 'Text',
      document_entities: ['entity'],
      document_trigger: 'attack',
      cluster_headline: 'Headline',
      cluster_summary: 'Summary',
      cluster_entities: ['entity'],
      cluster_triggers: ['attack'],
    })));
    expect(judgements.slice(0, 4)).toEqual([
      { pair_id: 'pair-accepted', score: 1, decision: 'accepted' },
      { pair_id: 'pair-rejected', score: 0, decision: 'rejected' },
      { pair_id: 'pair-abstain', score: 0.4, decision: 'abstain' },
      { pair_id: 'pair-fallback', score: 0, decision: 'abstain' },
    ]);

    expect(await provider.summarize([])).toEqual([]);
    const summaries = await provider.summarize(Array.from({ length: 7 }, (_, index) => ({
      cluster_id: `cluster-${index}`,
      headline: `Headline ${index}`,
      source_titles: [`Title ${index}`],
      source_summaries: [`Summary ${index}`],
    })));
    expect(summaries[0]).toEqual({ cluster_id: 'cluster-0', summary: 'summary for cluster-0' });
    expect(summaries).toHaveLength(7);
  });

  it('completes missing provider outputs deterministically after retry exhaustion', async () => {
    const provider = new OpenAIStoryClusterProvider({
      apiKey: 'key',
      fetchFn: async () => jsonResponse({
        choices: [{ message: { content: '{}' } }],
      }),
    });

    await expect(provider.translate([{ doc_id: 'doc-1', language: 'es', text: 'texto' }])).resolves.toEqual([
      { doc_id: 'doc-1', translated_text: 'texto' },
    ]);
    await expect(provider.analyzeDocuments([{
      doc_id: 'doc-1',
      title: 'Title',
      summary: 'Summary',
      publisher: 'Desk',
      language: 'en',
      text: 'Title summary',
      published_at: 100,
      entity_hints: [],
    }])).resolves.toEqual([{
      doc_id: 'doc-1',
      doc_type: 'hard_news',
      entities: [],
      linked_entities: [],
      locations: [],
      temporal_ms: null,
      trigger: null,
      event_tuple: {
        description: 'Title',
        trigger: null,
        who: [],
        where: [],
        when_ms: null,
        outcome: 'Summary',
      },
    }]);
    await expect(provider.rerankPairs([{
      pair_id: 'pair-1',
      document_title: 'Doc',
      document_text: 'Text',
      document_entities: ['entity'],
      document_trigger: 'attack',
      cluster_headline: 'Headline',
      cluster_summary: 'Summary',
      cluster_entities: ['entity'],
      cluster_triggers: ['attack'],
    }])).resolves.toEqual([{
      pair_id: 'pair-1',
      score: 0,
    }]);
    await expect(provider.adjudicatePairs([{
      pair_id: 'pair-1',
      document_title: 'Doc',
      document_text: 'Text',
      document_entities: ['entity'],
      document_trigger: 'attack',
      cluster_headline: 'Headline',
      cluster_summary: 'Summary',
      cluster_entities: ['entity'],
      cluster_triggers: ['attack'],
    }])).resolves.toEqual([{
      pair_id: 'pair-1',
      score: 0,
      decision: 'abstain',
    }]);
    await expect(provider.summarize([{
      cluster_id: 'cluster-1',
      headline: 'Headline',
      source_titles: ['Title'],
      source_summaries: [],
    }])).resolves.toEqual([{
      cluster_id: 'cluster-1',
      summary: 'Headline.',
    }]);
  });

  it('retries missing provider items before falling back', async () => {
    let callCount = 0;
    const provider = new OpenAIStoryClusterProvider({
      apiKey: 'key',
      fetchFn: async (_url: string, init?: RequestInit) => {
        callCount += 1;
        const body = JSON.parse(String(init?.body));
        const userPayload = JSON.parse(String(body.messages?.[1]?.content ?? '{}'));
        const pending = userPayload.adjudication_pairs as Array<{ pair_id: string }>;
        if (callCount === 1) {
          return jsonResponse({
            choices: [{
              message: {
                content: JSON.stringify({
                  judgements: [{ pair_id: pending[0]!.pair_id, score: 0.8, decision: 'accepted' }],
                }),
              },
            }],
          });
        }
        return jsonResponse({
          choices: [{
            message: {
              content: JSON.stringify({
                judgements: [{ pair_id: pending[0]!.pair_id, score: 0.3, decision: 'abstain' }],
              }),
            },
          }],
        });
      },
    });

    await expect(provider.adjudicatePairs([
      {
        pair_id: 'pair-1',
        document_title: 'Doc 1',
        document_text: 'Text 1',
        document_entities: ['entity'],
        document_trigger: 'attack',
        cluster_headline: 'Headline',
        cluster_summary: 'Summary',
        cluster_entities: ['entity'],
        cluster_triggers: ['attack'],
      },
      {
        pair_id: 'pair-2',
        document_title: 'Doc 2',
        document_text: 'Text 2',
        document_entities: ['entity'],
        document_trigger: 'attack',
        cluster_headline: 'Headline',
        cluster_summary: 'Summary',
        cluster_entities: ['entity'],
        cluster_triggers: ['attack'],
      },
    ])).resolves.toEqual([
      { pair_id: 'pair-1', score: 0.8, decision: 'accepted' },
      { pair_id: 'pair-2', score: 0.3, decision: 'abstain' },
    ]);
    expect(callCount).toBe(2);
  });

  it('creates a provider from environment and rejects missing api keys', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    expect(() => createOpenAIStoryClusterProviderFromEnv()).toThrow('OPENAI_API_KEY is required for StoryCluster provider');

    vi.stubEnv('OPENAI_API_KEY', 'env-key');
    vi.stubEnv('VH_STORYCLUSTER_TEXT_MODEL', 'env-text-model');
    vi.stubEnv('VH_STORYCLUSTER_EMBEDDING_MODEL', 'env-embed-model');
    vi.stubEnv('VH_STORYCLUSTER_OPENAI_BASE_URL', 'https://proxy.example/v1/');

    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (url.endsWith('/chat/completions')) {
        const userPayload = JSON.parse(String(body.messages?.[1]?.content ?? '{}'));
        expect(url).toBe('https://proxy.example/v1/chat/completions');
        expect(body.model).toBe('env-text-model');
        return jsonResponse({
          choices: [{
            message: {
              content: JSON.stringify({
                translations: userPayload.translations.map((item: { doc_id: string }) => ({
                  doc_id: item.doc_id,
                  translated_text: 'translated',
                })),
              }),
            },
          }],
        });
      }
      expect(body.model).toBe('env-embed-model');
      return jsonResponse({ data: [{ embedding: [1, 2] }] });
    });

    const provider = createOpenAIStoryClusterProviderFromEnv({ fetchFn });
    await expect(provider.translate([{ doc_id: 'doc-1', language: 'es', text: 'texto' }])).resolves.toEqual([
      { doc_id: 'doc-1', translated_text: 'translated' },
    ]);
    await expect(provider.embed([{ item_id: 'item-1', text: 'text' }], 2)).resolves.toEqual([
      { item_id: 'item-1', vector: [1, 2] },
    ]);
  });
});
