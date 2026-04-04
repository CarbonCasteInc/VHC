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

  it('rejects low-signal executive-order overlap without specific event support', async () => {
    const provider = createDeterministicTestModelProvider();

    await expect(provider.adjudicatePairs([{
      pair_id: 'nevada-vs-college-sports-order',
      document_title: 'Nevada is suing to stop Trump order to make eligible voter lists. Is Lombardo looped in?',
      document_text: 'Nevada sued over a Trump voting-order requirement about eligible voter lists, centering on election administration, state litigation, and Gov. Joe Lombardo instead of college sports or NCAA governance.',
      document_entities: [
        'nevada_voter_list_order_lawsuit_episode',
        'donald_trump',
        'executive_order',
        'eligible_voter_lists',
        'joe_lombardo',
      ],
      document_trigger: null,
      cluster_headline: 'President Trump signs executive order that aims to stabilize college sports',
      cluster_summary: 'Trump signed an executive order focused on stabilizing college sports, athlete compensation, and NCAA policy.',
      cluster_entities: [
        'college_sports_stabilization_order_episode',
        'donald_trump',
        'executive_order',
        'college_sports',
        'ncaa',
      ],
      cluster_triggers: [],
    }])).resolves.toEqual([{
      pair_id: 'nevada-vs-college-sports-order',
      score: 0.12,
      decision: 'rejected',
    }]);
  });
});
