import { describe, expect, it } from 'vitest';
import { createDeterministicTestModelProvider } from './testModelProvider';

describe('createDeterministicTestModelProvider low-signal conflicts', () => {
  it('rejects low-signal canonical overlap when trigger categories conflict', async () => {
    const provider = createDeterministicTestModelProvider();

    await expect(provider.adjudicatePairs([{
      pair_id: 'low-signal-canonical-conflict',
      document_title: "Trump doesn't rule out sending American troops to Iran",
      document_text: "Trump doesn't rule out sending American troops to Iran",
      document_entities: ['donald_trump'],
      document_trigger: 'troops',
      cluster_headline: 'Trump tells Starmer help not needed in Iran campaign',
      cluster_summary: 'Summary',
      cluster_entities: ['donald_trump'],
      cluster_triggers: ['tells'],
    }])).resolves.toEqual([{
      pair_id: 'low-signal-canonical-conflict',
      score: 0.12,
      decision: 'rejected',
    }]);
  });
});
