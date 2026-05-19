import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { publicFeedBrowserSmokeInternal as internal } from './public-feed-browser-smoke.mjs';

describe('public feed browser smoke helpers', () => {
  it('normalizes browser and Gun endpoints', () => {
    expect(internal.normalizeUrl('http://127.0.0.1:2048')).toBe('http://127.0.0.1:2048/');
    expect(internal.normalizeGunPeer('http://127.0.0.1:7777')).toBe('http://127.0.0.1:7777/gun');
    expect(internal.normalizeGunPeer('wss://gun-a.venn.carboncaste.io/gun')).toBe('wss://gun-a.venn.carboncaste.io/gun');
  });

  it('builds canonical story detail URLs for second-browser persistence checks', () => {
    expect(internal.storyDetailUrl('https://venn.example/feed?mode=latest', 'story-1'))
      .toBe('https://venn.example/feed?mode=latest&detail=news%3Astory-1');
  });

  it('quotes test ids safely for CSS attribute selectors', () => {
    expect(internal.cssAttr('news-card-headline-topic:with/slash')).toBe('"news-card-headline-topic:with/slash"');
    expect(internal.cssAttr('story "quoted"')).toBe('"story \\"quoted\\""');
  });

  it('parses signed vote control labels', () => {
    expect(internal.parseVoteCount('+ 12')).toBe(12);
    expect(internal.parseVoteCount('- 3')).toBe(3);
    expect(internal.parseVoteCount('no count')).toBe(0);
  });

  it('parses durable synthesis ids from public point ids', () => {
    expect(internal.parseSynthesisIdFromPointId(
      'synth-point:news-bundle:story-f66103718bda:bacd11de013320c1:0:frame',
    )).toBe('news-bundle:story-f66103718bda:bacd11de013320c1');
    expect(internal.parseSynthesisIdFromPointId(
      'synth-point:news-bundle:story-f66103718bda:bacd11de013320c1:1:reframe',
    )).toBe('news-bundle:story-f66103718bda:bacd11de013320c1');
    expect(internal.parseSynthesisIdFromPointId('story-f66103718bda')).toBeNull();
  });

  it('uses the direct public aggregate baseline for durable vote proof', () => {
    expect(internal.minimumPublicAgreeAfterVote({ agree: 2 }, 7)).toBe(3);
    expect(internal.minimumPublicAgreeAfterVote(null, 7)).toBe(8);
  });

  it('accepts durable public voter-row readback when aggregate snapshots lag', () => {
    const beforeRows = [
      { voter_id: 'voter-a', node: { agreement: 1 } },
      { voter_id: 'voter-b', node: { agreement: -1 } },
    ];
    const afterRows = [
      ...beforeRows,
      { voter_id: 'voter-c', node: { agreement: 1 } },
    ];

    expect(internal.publicAgreeVoterRowsAfterVote(beforeRows, afterRows)).toEqual({
      beforeTotalRows: 2,
      afterTotalRows: 3,
      beforeAgreeRows: 1,
      afterAgreeRows: 2,
      newAgreeRows: 1,
      newAgreeVoterIds: ['voter-c'],
    });
    expect(internal.publicAgreeVoterRowsAfterVote(beforeRows, beforeRows)).toBeNull();
  });

  it('treats a changed existing public voter row as a new agree readback', () => {
    const beforeRows = [
      { voter_id: 'voter-a', node: { agreement: -1 } },
    ];
    const afterRows = [
      { voter_id: 'voter-a', node: { agreement: 1 } },
    ];

    expect(internal.publicAgreeVoterRowsAfterVote(beforeRows, afterRows)).toMatchObject({
      beforeAgreeRows: 0,
      afterAgreeRows: 1,
      newAgreeRows: 1,
      newAgreeVoterIds: ['voter-a'],
    });
  });

  it('reopens the target story by story id before falling back to topic id', () => {
    const rows = [
      { storyId: 'story-old', topicId: 'topic-1' },
      { storyId: 'story-target', topicId: 'topic-2' },
      { storyId: 'story-other', topicId: 'topic-target' },
    ];

    expect(internal.findVisibleStoryRow(rows, { storyId: 'story-target', topicId: 'topic-target' }))
      .toEqual({ storyId: 'story-target', topicId: 'topic-2' });
    expect(internal.findVisibleStoryRow(rows, { storyId: 'story-missing', topicId: 'topic-target' }))
      .toEqual({ storyId: 'story-other', topicId: 'topic-target' });
    expect(internal.findVisibleStoryRow(rows, { storyId: 'story-missing', topicId: 'topic-missing' }))
      .toBeNull();
  });

  it('does not reject accepted synthesis summaries that contain words like spending', () => {
    expect(internal.isAcceptedSynthesisText(
      'The primary race set a spending record with multiple sourced frames.',
      2,
    )).toBe(true);
    expect(internal.isAcceptedSynthesisText('Synthesis pending for this story.', 2)).toBe(false);
    expect(internal.isAcceptedSynthesisText('Accepted summary without controls.', 0)).toBe(false);
  });

  it('keeps reload and second-browser synthesis waits on the page-scoped signature', async () => {
    const source = await readFile(new URL('./public-feed-browser-smoke.mjs', import.meta.url), 'utf8');

    expect(source).toContain('await waitForSynthesis(page, card, routedRow, analysisTimeoutMs);');
    expect(source).not.toContain('await waitForSynthesis(card, row, analysisTimeoutMs);');
  });

  it('keeps accepted-synthesis target discovery wider than the visible singleton headline window', async () => {
    const source = await readFile(new URL('./public-feed-browser-smoke.mjs', import.meta.url), 'utf8');

    expect(source).toContain('const DEFAULT_GUN_READBACK_STORY_LIMIT = 16;');
    expect(source).toContain('const DEFAULT_PUBLIC_RELAY_SYNTHESIS_INDEX_LIMIT = 80;');
    expect(source).toContain('readPublicRelaySynthesisCandidates({');
    expect(source).toContain('topStories: stories,');
    expect(source).not.toContain('topStories: stories.slice(0, 8)');
  });

  it('discovers accepted public synthesis candidates through the deployed relay REST shape', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const href = String(url);
      calls.push(href);
      if (href.includes('/vh/news/latest-index')) {
        return {
          ok: true,
          text: async () => JSON.stringify({
            records: {
              'story-singleton': { story_id: 'story-singleton', latest_activity_at: 20 },
              'story-bundled': { story_id: 'story-bundled', latest_activity_at: 10 },
            },
          }),
        };
      }
      if (href.includes('/vh/news/story') && href.includes('story-singleton')) {
        return {
          ok: true,
          text: async () => JSON.stringify({
            story: {
              story_id: 'story-singleton',
              topic_id: 'topic-singleton',
              headline: 'One valid singleton story',
              sources: [{ publisher: 'one-source' }],
            },
          }),
        };
      }
      if (href.includes('/vh/news/story') && href.includes('story-bundled')) {
        return {
          ok: true,
          text: async () => JSON.stringify({
            story: {
              story_id: 'story-bundled',
              topic_id: 'topic-bundled',
              headline: 'Bundled story with accepted synthesis',
              sources: [{ publisher: 'source-a' }, { publisher: 'source-b' }],
            },
          }),
        };
      }
      if (href.includes('/vh/topics/synthesis') && href.includes('topic-bundled')) {
        return {
          ok: true,
          text: async () => JSON.stringify({
            synthesis: {
              synthesis_id: 'news-bundle:story-bundled:abc',
              facts_summary: 'Accepted synthesis with enough context.',
              frames: [{ point_id: 'frame-1' }],
            },
          }),
        };
      }
      return {
        ok: true,
        text: async () => JSON.stringify({ synthesis: { facts_summary: '', frames: [] } }),
      };
    }));
    try {
      await expect(internal.readPublicRelaySynthesisCandidates({
        baseUrl: 'https://venn.example/',
        indexLimit: 80,
        scanLimit: 4,
        timeoutMs: 100,
      })).resolves.toMatchObject({
        latestIndexCount: 2,
        storyReadbackCount: 1,
        topStories: [{
          storyId: 'story-bundled',
          topicId: 'topic-bundled',
          headline: 'Bundled story with accepted synthesis',
          sourceCount: 2,
          acceptedSynthesisReady: true,
          synthesisId: 'news-bundle:story-bundled:abc',
        }],
      });
      expect(calls.some((href) => href === 'https://venn.example/vh/news/story?story_id=story-bundled')).toBe(true);
      expect(calls.some((href) => href === 'https://venn.example/vh/topics/synthesis?topic_id=topic-bundled')).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses a release-shaped timeout for second-browser public vote convergence', async () => {
    expect(internal.DEFAULT_SECOND_BROWSER_VOTE_VISIBILITY_TIMEOUT_MS).toBe(120_000);
  });

  it('prefers visible vote controls when duplicate canonical point controls exist', async () => {
    const calls = [];
    const makeCandidate = (label, visible) => ({
      label,
      isVisible: vi.fn(async () => visible),
    });
    const hidden = makeCandidate('hidden', false);
    const visible = makeCandidate('visible', true);
    const locator = {
      count: vi.fn(async () => 2),
      nth: vi.fn((index) => {
        calls.push(index);
        return index === 0 ? hidden : visible;
      }),
      first: vi.fn(() => hidden),
    };

    await expect(internal.firstVisibleLocator(locator)).resolves.toBe(visible);
    expect(calls).toEqual([0, 1]);
  });

  it('recovers second-browser target routing through the feed before using page scope', async () => {
    const source = await readFile(new URL('./public-feed-browser-smoke.mjs', import.meta.url), 'utf8');

    expect(source).toContain("progress('second-browser-detail-route-retry-feed'");
    expect(source).toContain("progress('second-browser-feed-route-visible'");
    expect(source).toContain("progress('second-browser-detail-scope-fallback'");
  });

  it('re-resolves second-browser vote controls from page scope while aggregates hydrate', async () => {
    const source = await readFile(new URL('./public-feed-browser-smoke.mjs', import.meta.url), 'utf8');

    expect(source).toContain('const agree = await findAgreeButtonByCanonical(page, voteProof.canonicalPointId, voteProof.pointId);');
    expect(source).toContain('await agree.scrollIntoViewIfNeeded({ timeout: 1_000 }).catch(() => {});');
    expect(source).toContain("progress('second-browser-vote-public-ready-reopen'");
    expect(source).toContain("progress('second-browser-diagnostics'");
    expect(source).not.toContain("const agree = await findAgreeButtonByCanonical(card, voteProof.canonicalPointId, voteProof.pointId);\n    const voteCount = await waitFor('second-browser-vote-visibility'");
  });

  it('keeps post-vote reload proof valid on detail-route page scope', async () => {
    const source = await readFile(new URL('./public-feed-browser-smoke.mjs', import.meta.url), 'utf8');

    expect(source).toContain("progress('post-vote-detail-route-scope-visible'");
    expect(source).toContain("progress('reload-detail-scope-visible'");
    expect(source).toContain('const pageScopedSynthesis = await waitForSynthesis(page, page, row, analysisTimeoutMs)');
    expect(source).toContain('let synthesis = await waitForSynthesis(page, page, row, analysisTimeoutMs)');
    expect(source).toContain('return { row, card: page };');
    expect(source).toContain('let card = page;');
  });

  it('falls back for invalid positive integers', () => {
    expect(internal.parsePositiveInt('42', 7)).toBe(42);
    expect(internal.parsePositiveInt('0', 7)).toBe(7);
    expect(internal.parsePositiveInt('bad', 7)).toBe(7);
  });

  it('resolves an explicit artifact directory', () => {
    expect(internal.resolveArtifactDir({ VH_PUBLIC_FEED_SMOKE_ARTIFACT_DIR: '/tmp/proof' }, '/repo')).toBe('/tmp/proof');
  });

  it('builds Chromium IPv4 host resolver rules for public smoke evidence', async () => {
    const hosts = internal.publicSmokeBrowserHostnames({
      baseUrl: 'https://venn.carboncaste.io/',
      gunPeerUrl: 'wss://gun-a.carboncaste.io/gun',
      env: {
        VH_PUBLIC_FEED_SMOKE_IPV4_HOSTS: 'gun-b.carboncaste.io,gun-c.carboncaste.io',
        VH_MESH_PUBLIC_WSS_PEERS: '["wss://gun-a.carboncaste.io/gun","wss://gun-b.carboncaste.io/gun"]',
      },
    });

    expect(hosts).toEqual([
      'gun-a.carboncaste.io',
      'gun-b.carboncaste.io',
      'gun-c.carboncaste.io',
      'venn.carboncaste.io',
    ]);

    await expect(internal.buildChromiumHostResolverRules(hosts, async (host) => ({
      address: host === 'venn.carboncaste.io' ? '104.21.86.178' : '172.67.223.77',
      family: 4,
    }))).resolves.toBe(
      '--host-resolver-rules=MAP gun-a.carboncaste.io 172.67.223.77,MAP gun-b.carboncaste.io 172.67.223.77,MAP gun-c.carboncaste.io 172.67.223.77,MAP venn.carboncaste.io 104.21.86.178',
    );
  });

  it('uses viewport screenshots to keep live feed evidence bounded', () => {
    expect(internal.viewportScreenshotOptions('/tmp/feed.png')).toEqual({
      path: '/tmp/feed.png',
      fullPage: false,
      animations: 'disabled',
    });
  });

  it('bounds app feed refresh when the page refresh promise does not resolve', async () => {
    const originalWindow = globalThis.window;
    const page = {
      evaluate: async (callback, args) => {
        globalThis.window = {
          __VH_NEWS_STORE__: {
            getState: () => ({
              refreshLatest: () => new Promise(() => {}),
            }),
          },
        };
        try {
          return await callback(args);
        } finally {
          globalThis.window = originalWindow;
        }
      },
    };

    await expect(internal.refreshLatest(page, 12, 5)).resolves.toEqual({ status: 'timeout' });
  });

  it('reports public headline wait diagnostics while strict peer hydration catches up', async () => {
    const source = await readFile(new URL('./public-feed-browser-smoke.mjs', import.meta.url), 'utf8');

    expect(source).toContain("progress('initial-feed-wait-start'");
    expect(source).toContain("progress('headline-wait-diagnostics'");
    expect(source).toContain('summarizeFeedState(page)');
  });

  it('bounds direct Gun reads used by release proof collection', async () => {
    await expect(internal.withTimeout('gun-read', new Promise(() => {}), 5))
      .rejects
      .toThrow('gun-read-timeout');
  });

  it('does not count the comment composer as a persisted rendered comment', async () => {
    const page = {
      evaluate: async (callback, body) => {
        const nodes = [
          {
            getAttribute: () => 'comment-composer-container',
            textContent: body,
          },
          {
            getAttribute: () => 'comment-12345678-abcd-4abc-8abc-123456789abc',
            textContent: body,
          },
        ];
        const originalDocument = globalThis.document;
        globalThis.document = {
          querySelectorAll: () => nodes,
        };
        try {
          return await callback(body);
        } finally {
          globalThis.document = originalDocument;
        }
      },
    };

    await expect(internal.postedCommentVisible(page, 'Launch smoke reply')).resolves.toBe(true);

    const composerOnlyPage = {
      evaluate: async (callback, body) => {
        const originalDocument = globalThis.document;
        globalThis.document = {
          querySelectorAll: () => [{
            getAttribute: () => 'comment-composer-container',
            textContent: body,
          }],
        };
        try {
          return await callback(body);
        } finally {
          globalThis.document = originalDocument;
        }
      },
    };
    await expect(internal.postedCommentVisible(composerOnlyPage, 'Launch smoke reply')).resolves.toBe(false);
  });

  it('bounds persisted comment DOM queries when the page stalls', async () => {
    vi.useFakeTimers();
    try {
      const stalledPage = {
        evaluate: () => new Promise(() => {}),
      };
      const visible = internal.postedCommentVisible(stalledPage, 'Launch smoke reply');

      await vi.advanceTimersByTimeAsync(5_000);

      await expect(visible).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads string constants from the system-writer fixture source', () => {
    expect(internal.readFixtureConst("export const EXAMPLE =\n  'value-1';", 'EXAMPLE')).toBe('value-1');
  });

  it('prefers the production news system writer pin over the E2E fixture pin', () => {
    const pin = {
      pinVersion: 1,
      schemaEpoch: 'luma-public-v1',
      maxProtocolVersion: 'luma-public-v1',
      signatureSuite: 'jcs-ed25519-sha256-v1',
      writers: [{
        id: 'vh-public-beta-news-system-writer-v1',
        status: 'active',
        publicKey: {
          encoding: 'spki-base64url',
          material: 'public-material',
        },
      }],
    };

    expect(internal.loadSystemWriterPin('/repo', {
      VITE_NEWS_SYSTEM_WRITER_PIN_JSON: JSON.stringify(pin),
      VITE_E2E_SYSTEM_WRITER_PIN_JSON: JSON.stringify({
        ...pin,
        writers: [{ ...pin.writers[0], id: 'vh-e2e-news-daemon-system-writer-v1' }],
      }),
    })).toEqual(pin);
  });
});
