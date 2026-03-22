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
    const gate = Promise.withResolvers<void>();
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
          gate.promise,
          new Promise((resolve) => setTimeout(resolve, 50)),
        ]);
      }
      if (currentCall === 2) {
        gate.resolve();
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

  it('includes explicit perspective-shift guidance in the audit rubric', () => {
    expect(liveSemanticAuditInternal.buildSemanticAuditSystemPrompt()).toContain(
      'Different national, political, or institutional perspectives alone are not enough to downgrade a pair to related_topic_only',
    );
    expect(liveSemanticAuditInternal.buildSemanticAuditSystemPrompt()).toContain(
      'same ongoing confrontation, escalation, negotiation, investigation, or response arc involving the same core actors and immediate trigger',
    );
  });
});
