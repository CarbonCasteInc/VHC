import { describe, expect, it, vi } from 'vitest';
import { classifyCanonicalSourcePairs } from './liveSemanticAudit';

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
});
