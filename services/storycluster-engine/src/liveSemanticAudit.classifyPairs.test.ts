import { describe, expect, it, vi } from 'vitest';
import { classifyCanonicalSourcePairs, liveSemanticAuditInternal } from './liveSemanticAudit';

function makePair(overrides: Record<string, unknown> = {}) {
  return {
    pair_id: 'story-1::wire-a:hash-a::wire-b:hash-b',
    story_id: 'story-1',
    topic_id: 'topic-news',
    story_headline: 'Markets fall after strike',
    left: {
      source_id: 'wire-a',
      publisher: 'Wire A',
      url: 'https://example.com/a',
      url_hash: 'hash-a',
      title: 'Markets fall after strike',
      text: 'Market reaction coverage.',
    },
    right: {
      source_id: 'wire-b',
      publisher: 'Wire B',
      url: 'https://example.com/b',
      url_hash: 'hash-b',
      title: 'Investors react to strike',
      text: 'Another market reaction report.',
    },
    ...overrides,
  };
}

describe('liveSemanticAudit classifier', () => {
  it('classifies canonical source pairs and preserves input order', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              pair_labels: [
                {
                  pair_id: 'story-1::wire-a:hash-a::wire-b:hash-b',
                  label: 'same_incident',
                  confidence: 0.93,
                  rationale: 'Both sources describe the same strike-driven market selloff.',
                },
                {
                  pair_id: 'story-1::wire-a:hash-a::wire-c:hash-c',
                  label: 'same_developing_episode',
                  confidence: 0.79,
                  rationale: 'The later report is a direct follow-up within the same episode.',
                },
              ],
            }),
          },
        },
      ],
    }), { status: 200 }));

    const results = await classifyCanonicalSourcePairs(
      [
        makePair(),
        makePair({
          pair_id: 'story-1::wire-a:hash-a::wire-c:hash-c',
          right: {
            source_id: 'wire-c',
            publisher: 'Wire C',
            url: 'https://example.com/c',
            url_hash: 'hash-c',
            title: 'Stocks still slide the next morning',
            text: 'Later follow-up coverage.',
          },
        }),
      ],
      {
        apiKey: 'test-key',
        fetchFn,
      },
    );

    expect(results).toEqual([
      {
        pair_id: 'story-1::wire-a:hash-a::wire-b:hash-b',
        label: 'same_incident',
        confidence: 0.93,
        rationale: 'Both sources describe the same strike-driven market selloff.',
      },
      {
        pair_id: 'story-1::wire-a:hash-a::wire-c:hash-c',
        label: 'same_developing_episode',
        confidence: 0.79,
        rationale: 'The later report is a direct follow-up within the same episode.',
      },
    ]);
  });

  it('retries only omitted pair labels and preserves original order', async () => {
    const omittedPair = makePair({
      pair_id: 'story-1::wire-a:hash-a::wire-c:hash-c',
      right: {
        source_id: 'wire-c',
        publisher: 'Wire C',
        url: 'https://example.com/c',
        url_hash: 'hash-c',
        title: 'Stocks still slide the next morning',
        text: 'Later follow-up coverage.',
      },
    });
    const responses = [
      {
        pair_labels: [
          {
            pair_id: 'story-1::wire-a:hash-a::wire-b:hash-b',
            label: 'same_incident',
            confidence: 0.93,
            rationale: 'Both sources describe the same strike-driven market selloff.',
          },
        ],
      },
      {
        pair_labels: [
          {
            pair_id: 'story-1::wire-a:hash-a::wire-c:hash-c',
            label: 'same_developing_episode',
            confidence: 0.79,
            rationale: 'The later report is a direct follow-up within the same episode.',
          },
        ],
      },
    ];
    const fetchFn = vi.fn<typeof fetch>(async (_input, init) => {
      const response = responses[fetchFn.mock.calls.length - 1]!;
      const request = JSON.parse(String(init?.body ?? '{}'));
      const userPayload = JSON.parse(request.messages?.[1]?.content ?? '{}');
      if (fetchFn.mock.calls.length === 1) {
        expect(userPayload.required_pair_ids).toEqual([
          'story-1::wire-a:hash-a::wire-b:hash-b',
          'story-1::wire-a:hash-a::wire-c:hash-c',
        ]);
      } else {
        expect(userPayload.required_pair_ids).toEqual([
          'story-1::wire-a:hash-a::wire-c:hash-c',
        ]);
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(response) } }],
      }), { status: 200 });
    });

    const results = await classifyCanonicalSourcePairs(
      [
        makePair(),
        omittedPair,
      ],
      {
        apiKey: 'test-key',
        fetchFn,
      },
    );

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(results).toEqual([
      {
        pair_id: 'story-1::wire-a:hash-a::wire-b:hash-b',
        label: 'same_incident',
        confidence: 0.93,
        rationale: 'Both sources describe the same strike-driven market selloff.',
      },
      {
        pair_id: 'story-1::wire-a:hash-a::wire-c:hash-c',
        label: 'same_developing_episode',
        confidence: 0.79,
        rationale: 'The later report is a direct follow-up within the same episode.',
      },
    ]);
  });

  it('rejects invalid model labels', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              pair_labels: [
                {
                  pair_id: 'story-1::wire-a:hash-a::wire-b:hash-b',
                  label: 'topic_overlap',
                  confidence: 0.4,
                  rationale: 'Invalid label.',
                },
              ],
            }),
          },
        },
      ],
    }), { status: 200 }));

    await expect(classifyCanonicalSourcePairs([makePair()], {
      apiKey: 'test-key',
      fetchFn,
    })).rejects.toThrow('must be one of duplicate, same_incident, same_developing_episode, related_topic_only');
  });

  it('rejects malformed classifier payloads and clamps confidence bounds', async () => {
    const malformedFetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ pair_labels: [{ pair_id: '', label: 'same_incident', confidence: 0.3, rationale: 'bad' }] }) } }],
    }), { status: 200 }));
    await expect(classifyCanonicalSourcePairs([makePair()], {
      apiKey: 'test-key',
      fetchFn: malformedFetch,
    })).rejects.toThrow('pair_labels[0].pair_id must be non-empty');

    const nonStringPairIdFetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ pair_labels: [{ pair_id: 42, label: 'same_incident', confidence: 0.3, rationale: 'bad' }] }) } }],
    }), { status: 200 }));
    await expect(classifyCanonicalSourcePairs([makePair()], {
      apiKey: 'test-key',
      fetchFn: nonStringPairIdFetch,
    })).rejects.toThrow('pair_labels[0].pair_id must be non-empty');

    const missingPairFetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ pair_labels: [] }) } }],
    }), { status: 200 }));
    await expect(classifyCanonicalSourcePairs([makePair()], {
      apiKey: 'test-key',
      fetchFn: missingPairFetch,
    })).rejects.toThrow('pair label response missing story-1::wire-a:hash-a::wire-b:hash-b');

    const missingPairLabelsFetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({}) } }],
    }), { status: 200 }));
    await expect(classifyCanonicalSourcePairs([makePair()], {
      apiKey: 'test-key',
      fetchFn: missingPairLabelsFetch,
    })).rejects.toThrow('pair label response must include pair_labels');

    const nonObjectEntryFetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ pair_labels: [42] }) } }],
    }), { status: 200 }));
    await expect(classifyCanonicalSourcePairs([makePair()], {
      apiKey: 'test-key',
      fetchFn: nonObjectEntryFetch,
    })).rejects.toThrow('pair_labels[0] must be an object');

    const nonObjectPayloadFetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '[]' } }],
    }), { status: 200 }));
    await expect(classifyCanonicalSourcePairs([makePair()], {
      apiKey: 'test-key',
      fetchFn: nonObjectPayloadFetch,
    })).rejects.toThrow('OpenAI chat response missing JSON object');

    const invalidRationaleFetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ pair_labels: [{ pair_id: 'story-1::wire-a:hash-a::wire-b:hash-b', label: 'same_incident', confidence: 0.4, rationale: '   ' }] }) } }],
    }), { status: 200 }));
    await expect(classifyCanonicalSourcePairs([makePair()], {
      apiKey: 'test-key',
      fetchFn: invalidRationaleFetch,
    })).rejects.toThrow('pair_labels[0].rationale must be non-empty');

    const invalidRationaleTypeFetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ pair_labels: [{ pair_id: 'story-1::wire-a:hash-a::wire-b:hash-b', label: 'same_incident', confidence: 0.4, rationale: 42 }] }) } }],
    }), { status: 200 }));
    await expect(classifyCanonicalSourcePairs([makePair()], {
      apiKey: 'test-key',
      fetchFn: invalidRationaleTypeFetch,
    })).rejects.toThrow('pair_labels[0].rationale must be a string');

    const invalidConfidenceFetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ pair_labels: [{ pair_id: 'story-1::wire-a:hash-a::wire-b:hash-b', label: 'same_incident', confidence: 'bad', rationale: 'ok' }] }) } }],
    }), { status: 200 }));
    await expect(classifyCanonicalSourcePairs([makePair()], {
      apiKey: 'test-key',
      fetchFn: invalidConfidenceFetch,
    })).rejects.toThrow('pair_labels[0].confidence must be a finite number');

    const invalidLabelTypeFetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ pair_labels: [{ pair_id: 'story-1::wire-a:hash-a::wire-b:hash-b', label: 42, confidence: 0.4, rationale: 'ok' }] }) } }],
    }), { status: 200 }));
    await expect(classifyCanonicalSourcePairs([makePair()], {
      apiKey: 'test-key',
      fetchFn: invalidLabelTypeFetch,
    })).rejects.toThrow('pair_labels[0].label must be one of duplicate, same_incident, same_developing_episode, related_topic_only');

    const clampedFetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              pair_labels: [
                {
                  pair_id: 'story-1::wire-a:hash-a::wire-b:hash-b',
                  label: 'duplicate',
                  confidence: 3,
                  rationale: 'Near verbatim rewrite.',
                },
                {
                  pair_id: 'story-1::wire-a:hash-a::wire-c:hash-c',
                  label: 'related_topic_only',
                  confidence: -2,
                  rationale: 'Only topical overlap.',
                },
              ],
            }),
          },
        },
      ],
    }), { status: 200 }));

    const results = await classifyCanonicalSourcePairs([
      makePair(),
      makePair({
        pair_id: 'story-1::wire-a:hash-a::wire-c:hash-c',
        right: {
          source_id: 'wire-c',
          publisher: 'Wire C',
          url: 'https://example.com/c',
          url_hash: 'hash-c',
          title: 'Explainer: what the strike means',
          text: 'Explainer coverage.',
        },
      }),
    ], {
      apiKey: 'test-key',
      fetchFn: clampedFetch,
      model: '   ',
    });

    expect(results).toEqual([
      {
        pair_id: 'story-1::wire-a:hash-a::wire-b:hash-b',
        label: 'duplicate',
        confidence: 1,
        rationale: 'Near verbatim rewrite.',
      },
      {
        pair_id: 'story-1::wire-a:hash-a::wire-c:hash-c',
        label: 'related_topic_only',
        confidence: 0,
        rationale: 'Only topical overlap.',
      },
    ]);
  });

  it('classifies batches concurrently while preserving input order', async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let callCount = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    const responses = [
      {
        pair_labels: [
          {
            pair_id: 'story-1::wire-a:hash-a::wire-b:hash-b',
            label: 'same_incident',
            confidence: 0.8,
            rationale: 'ok',
          },
          {
            pair_id: 'story-1::wire-a:hash-a::wire-c:hash-c',
            label: 'same_developing_episode',
            confidence: 0.8,
            rationale: 'ok',
          },
          {
            pair_id: 'story-1::wire-a:hash-a::wire-d:hash-d',
            label: 'same_incident',
            confidence: 0.8,
            rationale: 'ok',
          },
          {
            pair_id: 'story-1::wire-a:hash-a::wire-e:hash-e',
            label: 'same_developing_episode',
            confidence: 0.8,
            rationale: 'ok',
          },
        ],
      },
      {
        pair_labels: [
          {
            pair_id: 'story-1::wire-a:hash-a::wire-f:hash-f',
            label: 'same_incident',
            confidence: 0.8,
            rationale: 'ok',
          },
        ],
      },
    ];

    const fetchFn = vi.fn<typeof fetch>(async (_input, init) => {
      callCount += 1;
      const currentCall = callCount;
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (currentCall === 1) {
        await Promise.race([
          gate,
          new Promise((resolve) => setTimeout(resolve, 50)),
        ]);
      }
      if (currentCall === 2) {
        releaseGate();
      }
      void init;
      const payload = responses[currentCall - 1]!;
      inFlight -= 1;
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify(payload) } }],
      }), { status: 200 });
    });

    const pairs = [
      makePair(),
      makePair({
        pair_id: 'story-1::wire-a:hash-a::wire-c:hash-c',
        right: {
          source_id: 'wire-c',
          publisher: 'Wire C',
          url: 'https://example.com/c',
          url_hash: 'hash-c',
          title: 'C',
          text: 'C text',
        },
      }),
      makePair({
        pair_id: 'story-1::wire-a:hash-a::wire-d:hash-d',
        right: {
          source_id: 'wire-d',
          publisher: 'Wire D',
          url: 'https://example.com/d',
          url_hash: 'hash-d',
          title: 'D',
          text: 'D text',
        },
      }),
      makePair({
        pair_id: 'story-1::wire-a:hash-a::wire-e:hash-e',
        right: {
          source_id: 'wire-e',
          publisher: 'Wire E',
          url: 'https://example.com/e',
          url_hash: 'hash-e',
          title: 'E',
          text: 'E text',
        },
      }),
      makePair({
        pair_id: 'story-1::wire-a:hash-a::wire-f:hash-f',
        right: {
          source_id: 'wire-f',
          publisher: 'Wire F',
          url: 'https://example.com/f',
          url_hash: 'hash-f',
          title: 'F',
          text: 'F text',
        },
      }),
    ];

    const results = await classifyCanonicalSourcePairs(pairs, {
      apiKey: 'test-key',
      fetchFn,
    });

    expect(maxInFlight).toBeGreaterThan(1);
    expect(results.map((result) => result.pair_id)).toEqual(pairs.map((pair) => pair.pair_id));
  });

  it('treats same-episode perspective shifts as same_developing_episode in the Cuba regression pair', async () => {
    const cubaPair = makePair({
      pair_id: 'story-cuba::fox-latest:39e4d4b6::nbc-politics:07f8408a',
      story_id: 'story-cuba',
      topic_id: 'topic-cuba',
      story_headline: "Cuban official reveals military 'preparing' for conflict after Trump considers 'taking' island",
      left: {
        source_id: 'fox-latest',
        publisher: 'fox-latest',
        url: 'https://www.foxnews.com/media/cuban-official-reveals-military-preparing-conflict-after-trump-considers-taking-island',
        url_hash: '39e4d4b6',
        published_at: 1774213218000,
        title: "Cuban official reveals military 'preparing' for conflict after Trump considers 'taking' island",
        text: 'A Cuban official says the island is preparing for conflict after Trump raised the idea of taking Cuba and the government warns of escalation.',
      },
      right: {
        source_id: 'nbc-politics',
        publisher: 'nbc-politics',
        url: 'https://www.nbcnews.com/world/cuba/cuba-foreign-minister-military-aggression-us-oil-trump-rubio-rcna264568',
        url_hash: '07f8408a',
        published_at: 1774185083000,
        title: "Cuba's deputy foreign minister says it is preparing for possible U.S. 'military aggression'",
        text: "Cuba's deputy foreign minister says the country is preparing for possible U.S. military aggression after Trump comments intensified tensions.",
      },
    });

    const fetchFn = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      expect(body.messages?.[0]?.content).toContain(
        'Different national, political, or institutional perspectives alone are not enough to downgrade a pair to related_topic_only',
      );
      expect(body.messages?.[0]?.content).toContain(
        'same ongoing confrontation, escalation, negotiation, investigation, or response arc involving the same core actors and immediate trigger',
      );
      expect(body.messages?.[0]?.content).toContain(
        'Timing context is not a separate event by itself',
      );
      expect(body.messages?.[1]?.content).toContain("Cuban official reveals military 'preparing' for conflict");
      expect(body.messages?.[1]?.content).toContain("Cuba's deputy foreign minister says it is preparing for possible U.S. 'military aggression'");
      return new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                pair_labels: [
                  {
                    pair_id: 'story-cuba::fox-latest:39e4d4b6::nbc-politics:07f8408a',
                    label: 'same_developing_episode',
                    confidence: 0.84,
                    rationale: 'Both reports describe the same Cuba-U.S. escalation episode from different perspectives.',
                  },
                ],
              }),
            },
          },
        ],
      }), { status: 200 });
    });

    const results = await classifyCanonicalSourcePairs([cubaPair], {
      apiKey: 'test-key',
      fetchFn,
    });

    expect(results).toEqual([
      {
        pair_id: 'story-cuba::fox-latest:39e4d4b6::nbc-politics:07f8408a',
        label: 'same_developing_episode',
        confidence: 0.84,
        rationale: 'Both reports describe the same Cuba-U.S. escalation episode from different perspectives.',
      },
    ]);
  });

  it('corrects clear same-election-result pairs when the model over-downgrades them to related_topic_only', async () => {
    const barrPair = makePair({
      pair_id: 'story-barr::fox-latest:230ac339::nbc-politics:b87d8870',
      story_id: 'story-barr',
      topic_id: 'topic-kentucky-senate-primary',
      story_headline: 'Andy Barr bests crowded Senate primary with help from Trump on way to replacing McConnell',
      left: {
        source_id: 'fox-latest',
        publisher: 'fox-latest',
        url: 'https://www.foxnews.com/politics/barr-bests-crowded-senate-primary-help-from-trump-way-replacing-mcconnell',
        url_hash: '230ac339',
        published_at: 1779231979000,
        title: 'Andy Barr bests crowded Senate primary with help from Trump on way to replacing McConnell',
        text: 'Andy Barr won the crowded Republican Senate primary in Kentucky for the seat being vacated by Mitch McConnell.',
      },
      right: {
        source_id: 'nbc-politics',
        publisher: 'nbc-politics',
        url: 'https://www.nbcnews.com/politics/2026-election/kentucky-senate-election-win-republican-primary-andy-barr-rcna345009',
        url_hash: 'b87d8870',
        published_at: 1779231609000,
        title: 'Trump-backed Andy Barr wins GOP nomination for Mitch McConnell’s Senate seat in Kentucky',
        text: 'Trump-backed Andy Barr won the GOP nomination for Mitch McConnell’s Senate seat in Kentucky.',
      },
    });
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              pair_labels: [
                {
                  pair_id: barrPair.pair_id,
                  label: 'related_topic_only',
                  confidence: 0.2,
                  rationale: 'The reports are about Kentucky politics but appear to emphasize different implications.',
                },
              ],
            }),
          },
        },
      ],
    }), { status: 200 }));

    const results = await classifyCanonicalSourcePairs([barrPair], {
      apiKey: 'test-key',
      fetchFn,
    });

    expect(results).toEqual([
      {
        pair_id: barrPair.pair_id,
        label: 'same_incident',
        confidence: 0.9,
        rationale:
          'Deterministic audit correction: both reports describe the same election-result event with shared actor and race context.',
      },
    ]);
    expect(liveSemanticAuditInternal.isClearSameElectionResultPair(barrPair)).toBe(true);
  });

  it('does not correct politician-topic pairs that lack a shared election-result event', async () => {
    const topicOnlyPair = makePair({
      pair_id: 'story-barr::fox-latest:230ac339::wire-b:followup',
      story_id: 'story-barr-topic',
      topic_id: 'topic-kentucky-senate-primary',
      story_headline: 'Andy Barr bests crowded Senate primary with help from Trump',
      left: {
        source_id: 'fox-latest',
        publisher: 'fox-latest',
        url: 'https://example.com/barr-wins',
        url_hash: '230ac339',
        title: 'Andy Barr bests crowded Senate primary with help from Trump',
        text: 'Andy Barr won the Kentucky Senate primary.',
      },
      right: {
        source_id: 'wire-b',
        publisher: 'Wire B',
        url: 'https://example.com/barr-fundraising',
        url_hash: 'followup',
        title: 'Andy Barr touts fundraising after Kentucky Senate primary',
        text: 'Andy Barr discussed fundraising and strategy after the primary election.',
      },
    });
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              pair_labels: [
                {
                  pair_id: topicOnlyPair.pair_id,
                  label: 'related_topic_only',
                  confidence: 0.7,
                  rationale: 'The second report is a broader campaign follow-up rather than the primary result.',
                },
              ],
            }),
          },
        },
      ],
    }), { status: 200 }));

    const results = await classifyCanonicalSourcePairs([topicOnlyPair], {
      apiKey: 'test-key',
      fetchFn,
    });

    expect(results).toEqual([
      {
        pair_id: topicOnlyPair.pair_id,
        label: 'related_topic_only',
        confidence: 0.7,
        rationale: 'The second report is a broader campaign follow-up rather than the primary result.',
      },
    ]);
    expect(liveSemanticAuditInternal.isClearSameElectionResultPair(topicOnlyPair)).toBe(false);
  });

  it('corrects clear same-election-matchup pairs when the model over-downgrades them to related_topic_only', async () => {
    const matchupPair = makePair({
      pair_id: 'story-pa-gov::fox-latest:63e90db4::nbc-politics:9e13eb55',
      story_id: 'story-pa-gov',
      topic_id: 'topic-pennsylvania-governor',
      story_headline: 'Shapiro vs Trump-backed Garrity set for high-stakes Pennsylvania governor showdown',
      left: {
        source_id: 'fox-latest',
        publisher: 'fox-latest',
        url: 'https://www.foxnews.com/politics/shapiro-vs-trump-backed-garrity-set-high-stakes-pennsylvania-governor-showdown',
        url_hash: '63e90db4',
        title: 'Shapiro vs Trump-backed Garrity set for high-stakes Pennsylvania governor showdown',
        text: 'Josh Shapiro and Stacy Garrity are set for a high-stakes Pennsylvania governor showdown after their primary wins.',
      },
      right: {
        source_id: 'nbc-politics',
        publisher: 'nbc-politics',
        url: 'https://www.nbcnews.com/politics/2026-election/shapiro-garrity-pennsylvania-governor-election-primary-wins-rcna345011',
        url_hash: '9e13eb55',
        title: 'Josh Shapiro and Stacy Garrity prepare to face off for governor of Pennsylvania this fall',
        text: 'Josh Shapiro and Stacy Garrity will face off in the Pennsylvania governor election after primary wins set the matchup.',
      },
    });
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              pair_labels: [
                {
                  pair_id: matchupPair.pair_id,
                  label: 'related_topic_only',
                  confidence: 0.15,
                  rationale: 'Both discuss the Pennsylvania governor race but emphasize different campaign angles.',
                },
              ],
            }),
          },
        },
      ],
    }), { status: 200 }));

    const results = await classifyCanonicalSourcePairs([matchupPair], {
      apiKey: 'test-key',
      fetchFn,
    });

    expect(results).toEqual([
      {
        pair_id: matchupPair.pair_id,
        label: 'same_incident',
        confidence: 0.9,
        rationale:
          'Deterministic audit correction: both reports describe the same election-result event with shared actor and race context.',
      },
    ]);
    expect(liveSemanticAuditInternal.isClearSameElectionMatchupPair(matchupPair)).toBe(true);
  });

  it('does not correct broad election analysis that lacks a shared two-candidate matchup event', async () => {
    const analysisPair = makePair({
      pair_id: 'story-pa-analysis::fox-latest:analysis::nbc-politics:9e13eb55',
      story_id: 'story-pa-analysis',
      topic_id: 'topic-pennsylvania-governor',
      story_headline: 'Pennsylvania governor race enters fall campaign phase',
      left: {
        source_id: 'fox-latest',
        publisher: 'fox-latest',
        url: 'https://example.com/pennsylvania-governor-analysis',
        url_hash: 'analysis',
        title: 'Pennsylvania governor race becomes a test of Trump-era politics',
        text: 'Analysts say Josh Shapiro starts the governor race with several advantages as parties prepare for the fall campaign.',
      },
      right: {
        source_id: 'nbc-politics',
        publisher: 'nbc-politics',
        url: 'https://www.nbcnews.com/politics/2026-election/shapiro-garrity-pennsylvania-governor-election-primary-wins-rcna345011',
        url_hash: '9e13eb55',
        title: 'Josh Shapiro and Stacy Garrity prepare to face off for governor of Pennsylvania this fall',
        text: 'Josh Shapiro and Stacy Garrity will face off in the Pennsylvania governor election after primary wins set the matchup.',
      },
    });
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              pair_labels: [
                {
                  pair_id: analysisPair.pair_id,
                  label: 'related_topic_only',
                  confidence: 0.72,
                  rationale: 'One report is campaign analysis while the other reports the matchup being set.',
                },
              ],
            }),
          },
        },
      ],
    }), { status: 200 }));

    const results = await classifyCanonicalSourcePairs([analysisPair], {
      apiKey: 'test-key',
      fetchFn,
    });

    expect(results[0]).toMatchObject({
      pair_id: analysisPair.pair_id,
      label: 'related_topic_only',
    });
    expect(liveSemanticAuditInternal.isClearSameElectionMatchupPair(analysisPair)).toBe(false);
  });

  it('includes explicit perspective-shift guidance in the audit rubric', () => {
    expect(liveSemanticAuditInternal.buildSemanticAuditSystemPrompt()).toContain(
      'Different national, political, or institutional perspectives alone are not enough to downgrade a pair to related_topic_only',
    );
    expect(liveSemanticAuditInternal.buildSemanticAuditSystemPrompt()).toContain(
      'same ongoing confrontation, escalation, negotiation, investigation, or response arc involving the same core actors and immediate trigger',
    );
    expect(liveSemanticAuditInternal.buildSemanticAuditSystemPrompt()).toContain(
      'Timing context is not a separate event by itself',
    );
  });
});
