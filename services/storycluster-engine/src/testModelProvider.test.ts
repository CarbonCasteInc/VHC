import { describe, expect, it } from 'vitest';
import { createDeterministicTestModelProvider } from './testModelProvider';

describe('createDeterministicTestModelProvider', () => {
  it('returns deterministic translations, embeddings, reranks, adjudications, and summaries', async () => {
    const provider = createDeterministicTestModelProvider();

    await expect(provider.translate([{ doc_id: 'doc-1', language: 'es', text: 'texto' }])).resolves.toEqual([
      { doc_id: 'doc-1', translated_text: 'texto' },
    ]);

    const embeddings = await provider.embed([{ item_id: 'item-1', text: 'port attack update' }], 8);
    expect(embeddings[0]?.item_id).toBe('item-1');
    expect(embeddings[0]?.vector).toHaveLength(8);

    await expect(provider.analyzeDocuments([{
      doc_id: 'doc-1',
      title: 'Opinion: how to think about the widening Iran conflict',
      summary: 'Commentary on framing the conflict.',
      publisher: 'Opinion Desk',
      language: 'en',
      text: 'Opinion: how to think about the widening Iran conflict. Commentary on framing the conflict.',
      published_at: 100,
      entity_hints: ['iran_conflict'],
    }])).resolves.toEqual([expect.objectContaining({
      doc_id: 'doc-1',
      doc_type: 'opinion',
      entities: expect.arrayContaining(['iran_conflict']),
      linked_entities: expect.arrayContaining(['iran_conflict']),
      trigger: null,
    })]);

    await expect(provider.rerankPairs([{
      pair_id: 'accepted',
      document_title: 'Port attack update',
      document_text: 'Port attack update',
      document_entities: ['port_attack'],
      document_trigger: 'attack',
      cluster_headline: 'Port attack expands',
      cluster_summary: 'Summary',
      cluster_entities: ['port_attack'],
      cluster_triggers: ['attack'],
    }])).resolves.toEqual([{
      pair_id: 'accepted',
      score: 0.92,
    }]);

    await expect(provider.adjudicatePairs([{
      pair_id: 'accepted',
      document_title: 'Port attack update',
      document_text: 'Port attack update',
      document_entities: ['port_attack'],
      document_trigger: 'attack',
      cluster_headline: 'Port attack expands',
      cluster_summary: 'Summary',
      cluster_entities: ['port_attack'],
      cluster_triggers: ['attack'],
    }])).resolves.toEqual([{
      pair_id: 'accepted',
      score: 0.92,
      decision: 'accepted',
    }]);

    await expect(provider.rerankPairs([{
      pair_id: 'abstain',
      document_title: 'Port update',
      document_text: 'Port update',
      document_entities: ['port_attack'],
      document_trigger: null,
      cluster_headline: 'Port attack expands',
      cluster_summary: 'Summary',
      cluster_entities: ['port_attack'],
      cluster_triggers: ['attack'],
    }])).resolves.toEqual([{
      pair_id: 'abstain',
      score: 0.58,
    }]);

    await expect(provider.adjudicatePairs([{
      pair_id: 'abstain',
      document_title: 'Port update',
      document_text: 'Port update',
      document_entities: ['port_attack'],
      document_trigger: null,
      cluster_headline: 'Port attack expands',
      cluster_summary: 'Summary',
      cluster_entities: ['port_attack'],
      cluster_triggers: ['attack'],
    }])).resolves.toEqual([{
      pair_id: 'abstain',
      score: 0.58,
      decision: 'abstain',
    }]);

    await expect(provider.adjudicatePairs([{
      pair_id: 'canonical-substantive-accepted',
      document_title: 'Coalition leaders whip support ahead of the ceasefire vote',
      document_text: 'Coalition leaders whip support ahead of the ceasefire vote',
      document_entities: ['ceasefire_vote', 'ceasefire', 'leaders'],
      document_trigger: 'vote',
      cluster_headline: 'Parliament schedules a ceasefire vote after the weekend attacks',
      cluster_summary: 'Summary',
      cluster_entities: ['ceasefire_vote', 'ceasefire', 'parliament'],
      cluster_triggers: ['attacks'],
    }])).resolves.toEqual([{
      pair_id: 'canonical-substantive-accepted',
      score: 0.92,
      decision: 'accepted',
    }]);

    await expect(provider.rerankPairs([{
      pair_id: 'rejected',
      document_title: 'Market slump update',
      document_text: 'Market slump update',
      document_entities: ['market_slump'],
      document_trigger: 'inflation',
      cluster_headline: 'Port attack expands',
      cluster_summary: 'Summary',
      cluster_entities: ['port_attack'],
      cluster_triggers: ['attack'],
    }])).resolves.toEqual([{
      pair_id: 'rejected',
      score: 0.12,
    }]);

    await expect(provider.adjudicatePairs([{
      pair_id: 'rejected',
      document_title: 'Market slump update',
      document_text: 'Market slump update',
      document_entities: ['market_slump'],
      document_trigger: 'inflation',
      cluster_headline: 'Port attack expands',
      cluster_summary: 'Summary',
      cluster_entities: ['port_attack'],
      cluster_triggers: ['attack'],
    }])).resolves.toEqual([{
      pair_id: 'rejected',
      score: 0.12,
      decision: 'rejected',
    }]);

    await expect(provider.adjudicatePairs([{
      pair_id: 'weak-overlap-rejected',
      document_title: 'Ceasefire vote scheduled after weekend attacks',
      document_text: 'Ceasefire vote scheduled after weekend attacks',
      document_entities: ['summary', 'ceasefire_vote'],
      document_trigger: 'attacks',
      cluster_headline: 'Stocks slide after the overnight strike',
      cluster_summary: 'Summary',
      cluster_entities: ['summary', 'market_aftershock'],
      cluster_triggers: ['strike'],
    }])).resolves.toEqual([{
      pair_id: 'weak-overlap-rejected',
      score: 0.12,
      decision: 'rejected',
    }]);

    await expect(provider.adjudicatePairs([{
      pair_id: 'substantive-accepted',
      document_title: 'Shipping insurers extend losses after overnight attack',
      document_text: 'Shipping insurers extend losses after overnight attack',
      document_entities: ['shipping', 'insurers'],
      document_trigger: 'attack',
      cluster_headline: 'Stocks slide after overnight strike',
      cluster_summary: 'Summary',
      cluster_entities: ['shipping', 'insurers'],
      cluster_triggers: ['strike'],
    }])).resolves.toEqual([{
      pair_id: 'substantive-accepted',
      score: 0.92,
      decision: 'accepted',
    }]);

    await expect(provider.adjudicatePairs([{
      pair_id: 'substantive-abstain',
      document_title: 'Shipping outlook changes after overnight attack',
      document_text: 'Shipping outlook changes after overnight attack',
      document_entities: ['shipping'],
      document_trigger: 'attack',
      cluster_headline: 'Stocks slide after overnight strike',
      cluster_summary: 'Summary',
      cluster_entities: ['shipping', 'insurers'],
      cluster_triggers: ['strike'],
    }])).resolves.toEqual([{
      pair_id: 'substantive-abstain',
      score: 0.58,
      decision: 'abstain',
    }]);

    await expect(provider.summarize([
      {
        cluster_id: 'cluster-1',
        headline: 'Fallback headline',
        source_titles: ['Title'],
        source_summaries: ['Port attack expands overnight'],
      },
      {
        cluster_id: 'cluster-2',
        headline: 'Use headline instead',
        source_titles: ['Title'],
        source_summaries: [],
      },
    ])).resolves.toEqual([
      { cluster_id: 'cluster-1', summary: 'Port attack expands overnight.' },
      { cluster_id: 'cluster-2', summary: 'Use headline instead.' },
    ]);
  });
});
