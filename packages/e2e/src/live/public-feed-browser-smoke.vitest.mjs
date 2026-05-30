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

  it('retries Chromium aborted app-route navigations with commit wait', async () => {
    const calls = [];
    let currentUrl = 'https://venn.example/';
    const page = {
      goto: vi.fn(async (url, options) => {
        calls.push({ url, options });
        if (options.waitUntil === 'domcontentloaded') {
          throw new Error('page.goto: net::ERR_ABORTED; maybe frame was detached?');
        }
        currentUrl = url;
      }),
      url: vi.fn(() => currentUrl),
    };

    await expect(internal.navigateToAppRoute(
      page,
      'https://venn.example/?detail=news%3Astory-1',
      { label: 'test-route' },
    )).resolves.toMatchObject({
      ok: true,
      aborted: false,
      reachedTarget: true,
      waitUntil: 'commit',
    });

    expect(calls.map((call) => call.options.waitUntil)).toEqual(['domcontentloaded', 'commit']);
  });

  it('allows optional app-route focus to fall back after aborted navigation', async () => {
    const progress = vi.fn();
    const page = {
      goto: vi.fn(async () => {
        throw new Error('page.goto: net::ERR_ABORTED; maybe frame was detached?');
      }),
      url: vi.fn(() => 'https://venn.example/'),
    };

    await expect(internal.navigateToAppRoute(
      page,
      'https://venn.example/?detail=news%3Astory-1',
      { label: 'detail-route-focus', optional: true, progress },
    )).resolves.toMatchObject({
      ok: false,
      aborted: true,
      reachedTarget: false,
      url: 'https://venn.example/',
    });

    expect(progress).toHaveBeenCalledWith(
      'detail-route-focus-navigation-aborted',
      expect.objectContaining({ waitUntil: 'domcontentloaded' }),
    );
    expect(progress).toHaveBeenCalledWith(
      'detail-route-focus-navigation-aborted',
      expect.objectContaining({ waitUntil: 'commit' }),
    );
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

  it('reads public aggregate proof through the deployed app origin fanout shape', async () => {
    const fetchMock = vi.fn(async (url) => {
      expect(String(url)).toBe(
        'https://venn.example/vh/aggregates/point?topic_id=topic-1&synthesis_id=synth-1&epoch=0&point_id=point-1',
      );
      return {
        ok: true,
        text: async () => JSON.stringify({
          ok: true,
          aggregate: {
            point_id: 'point-1',
            agree: 5,
            disagree: 1,
            participants: 6,
            weight: 6,
          },
          row_count: 6,
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(internal.readPublicPointAggregateViaOrigin({
        baseUrl: 'https://venn.example/',
        topicId: 'topic-1',
        synthesisId: 'synth-1',
        epoch: 0,
        pointId: 'point-1',
        timeoutMs: 100,
      })).resolves.toEqual({
        point_id: 'point-1',
        agree: 5,
        disagree: 1,
        participants: 6,
        weight: 6,
        row_count: 6,
      });
    } finally {
      vi.unstubAllGlobals();
    }
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
    expect(source).toContain('scanLimit = indexLimit');
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
              frames: [{
                frame_point_id: 'frame-1',
                frame: 'Frame',
                reframe_point_id: 'reframe-1',
                reframe: 'Reframe',
              }],
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
        storyReadbackCount: 2,
        acceptedSynthesisStoryCount: 1,
        storyBodyStatusCounts: { 200: 2 },
        synthesisStatusCounts: { 200: 2 },
        singletonReadableCount: 1,
        multiSourceReadableCount: 1,
        mediaClassCounts: { text: 2 },
        sourceFilterStatusCounts: { unknown: 3 },
        pointIdPresence: {
          frameRows: 1,
          framePointIdsPresent: 1,
          reframePointIdsPresent: 1,
        },
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

  it('samples key-only latest-index rows so public story-body 404s are counted', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const href = String(url);
      if (href.includes('/vh/news/latest-index')) {
        return {
          ok: true,
          text: async () => JSON.stringify({
            records: {
              'story-missing-body': { _: { '#': 'vh/news/index/latest/story-missing-body' } },
              'story-readable': { latest_activity_at: 20 },
            },
          }),
        };
      }
      if (href.includes('/vh/news/story') && href.includes('story-missing-body')) {
        return {
          ok: false,
          status: 404,
          text: async () => JSON.stringify({ ok: false, error: 'news-story-not-found' }),
        };
      }
      if (href.includes('/vh/news/story') && href.includes('story-readable')) {
        return {
          ok: true,
          text: async () => JSON.stringify({
            story: {
              story_id: 'story-readable',
              topic_id: 'topic-readable',
              headline: 'Readable text story',
              sources: [{ publisher: 'source-a', url: 'https://source.example/story' }],
            },
          }),
        };
      }
      if (href.includes('/vh/topics/synthesis')) {
        return {
          ok: false,
          status: 404,
          text: async () => JSON.stringify({ ok: false, error: 'topic-synthesis-not-found' }),
        };
      }
      if (href.includes('/article-text')) {
        return {
          ok: true,
          text: async () => JSON.stringify({ text: 'Readable article body.' }),
        };
      }
      return {
        ok: true,
        text: async () => JSON.stringify({}),
      };
    }));
    try {
      await expect(internal.readPublicRelaySynthesisCandidates({
        baseUrl: 'https://venn.example/',
        indexLimit: 80,
        scanLimit: 80,
        timeoutMs: 100,
      })).resolves.toMatchObject({
        latestIndexCount: 2,
        sampledStoryIds: ['story-readable', 'story-missing-body'],
        storyReadbackCount: 1,
        acceptedSynthesisStoryCount: 0,
        storyBodyStatusCounts: { 200: 1, 404: 1 },
        synthesisStatusCounts: { 404: 1 },
        articleTextSampleStatusCounts: { '200_text': 1 },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fails coverage when readable text latest-index stories lack accepted synthesis or a terminal reason', () => {
    expect(() => internal.assertPublicRelayAnalysisFrameCoverage({
      storyBodyStatusCounts: { 200: 5 },
      missingAcceptedSynthesisStoryCount: 2,
      missingAcceptedSynthesisStories: [
        { storyId: 'story-readable-a' },
        { storyId: 'story-readable-b' },
      ],
      pointIdPresence: {
        frameRows: 3,
        framePointIdsPresent: 3,
        reframePointIdsPresent: 3,
      },
    }, { VH_PUBLIC_FEED_REQUIRE_MIXED_COMPOSITION: 'false' })).toThrow(
      'public-relay-readable-text-synthesis-missing:2:story-readable-a,story-readable-b',
    );
  });

  it('fails coverage when the public relay feed is singleton-only', () => {
    expect(() => internal.assertPublicRelayAnalysisFrameCoverage({
      storyBodyStatusCounts: { 200: 3 },
      missingAcceptedSynthesisStoryCount: 0,
      singletonReadableCount: 3,
      multiSourceReadableCount: 0,
      relayComposition: {
        total_visible: 3,
        singleton_visible: 3,
        multi_source_visible: 0,
        freshness_age_ms: 1_000,
      },
      pointIdPresence: {
        frameRows: 0,
        framePointIdsPresent: 0,
        reframePointIdsPresent: 0,
      },
    })).toThrow('public-relay-feed-composition-missing-multi-source');
  });

  it('captures relay coverage failures without throwing before browser boot evidence is collected', async () => {
    const coverage = internal.capturePublicRelayAnalysisFrameCoverage({
      storyBodyStatusCounts: { 200: 2 },
      missingAcceptedSynthesisStoryCount: 0,
      singletonReadableCount: 2,
      multiSourceReadableCount: 0,
      pointIdPresence: {
        frameRows: 0,
        framePointIdsPresent: 0,
        reframePointIdsPresent: 0,
      },
    });

    expect(coverage).toMatchObject({
      status: 'fail',
      errorMessage: 'public-relay-feed-composition-missing-multi-source',
    });

    const source = await readFile(new URL('./public-feed-browser-smoke.mjs', import.meta.url), 'utf8');
    expect(source.indexOf('capturePublicRelayAnalysisFrameCoverage')).toBeLessThan(
      source.indexOf("progress('identity-start'"),
    );
    expect(source.indexOf("progress('initial-feed-wait-start'")).toBeGreaterThan(
      source.indexOf('capturePublicRelayAnalysisFrameCoverage'),
    );
    expect(source.indexOf('throw new Error(publicRelayAnalysisFrameCoverage.errorMessage')).toBeGreaterThan(
      source.indexOf('secondBrowserVisibility: secondBrowser'),
    );
  });

  it('does not count terminal unavailable synthesis outcomes as ambiguous missing synthesis', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const href = String(url);
      if (href.includes('/vh/news/latest-index')) {
        return {
          ok: true,
          text: async () => JSON.stringify({
            records: {
              'story-terminal': {
                latest_activity_at: 20,
                terminal_unavailable_reason: 'source_text_unavailable',
              },
            },
          }),
        };
      }
      if (href.includes('/vh/news/story')) {
        return {
          ok: true,
          text: async () => JSON.stringify({
            story: {
              story_id: 'story-terminal',
              topic_id: 'topic-terminal',
              headline: 'Readable text story with terminal synthesis status',
              sources: [{ publisher: 'source-a', url: 'https://source.example/story' }],
              terminal_unavailable_reason: 'source_text_unavailable',
            },
          }),
        };
      }
      if (href.includes('/vh/topics/synthesis')) {
        return {
          ok: false,
          status: 404,
          text: async () => JSON.stringify({ ok: false, error: 'topic-synthesis-not-found' }),
        };
      }
      if (href.includes('/article-text')) {
        return {
          ok: true,
          text: async () => JSON.stringify({ text: 'Readable article body.' }),
        };
      }
      return {
        ok: true,
        text: async () => JSON.stringify({}),
      };
    }));
    try {
      await expect(internal.readPublicRelaySynthesisCandidates({
        baseUrl: 'https://venn.example/',
        indexLimit: 80,
        scanLimit: 80,
        timeoutMs: 100,
      })).resolves.toMatchObject({
        latestIndexCount: 1,
        storyReadbackCount: 1,
        acceptedSynthesisStoryCount: 0,
        missingAcceptedSynthesisStoryCount: 0,
        terminalUnavailableReasonCounts: { source_text_unavailable: 1 },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not count honest pending synthesis lifecycle state as ambiguous missing synthesis', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const href = String(url);
      if (href.includes('/vh/news/latest-index')) {
        return {
          ok: true,
          text: async () => JSON.stringify({
            records: {
              'story-pending': { story_id: 'story-pending', latest_activity_at: 20 },
            },
            story_states: {
              'story-pending': {
                synthesis_state: 'synthesis_pending',
                frame_table_state: 'frame_table_pending',
                lifecycle_status: 'pending',
              },
            },
          }),
        };
      }
      if (href.includes('/vh/news/story')) {
        return {
          ok: true,
          text: async () => JSON.stringify({
            story: {
              story_id: 'story-pending',
              topic_id: 'topic-pending',
              headline: 'Readable text story with pending synthesis status',
              sources: [{ publisher: 'source-a', url: 'https://source.example/story' }],
            },
          }),
        };
      }
      if (href.includes('/vh/topics/synthesis')) {
        return {
          ok: false,
          status: 404,
          text: async () => JSON.stringify({ ok: false, error: 'topic-synthesis-not-found' }),
        };
      }
      if (href.includes('/article-text')) {
        return {
          ok: true,
          text: async () => JSON.stringify({ text: 'Readable article body.' }),
        };
      }
      return {
        ok: true,
        text: async () => JSON.stringify({}),
      };
    }));
    try {
      await expect(internal.readPublicRelaySynthesisCandidates({
        baseUrl: 'https://venn.example/',
        indexLimit: 80,
        scanLimit: 80,
        timeoutMs: 100,
      })).resolves.toMatchObject({
        latestIndexCount: 1,
        storyReadbackCount: 1,
        acceptedSynthesisStoryCount: 0,
        missingAcceptedSynthesisStoryCount: 0,
        publicStateCounts: { synthesis_pending: 1 },
        articleTextSampleStatusCounts: { '200_text': 1 },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses a release-shaped timeout for second-browser public vote convergence', async () => {
    expect(internal.DEFAULT_SECOND_BROWSER_VOTE_VISIBILITY_TIMEOUT_MS).toBe(120_000);
  });

  it('fills identity fields before waiting for the dashboard create button', async () => {
    const calls = [];
    let username = '';
    let handle = '';
    const createButton = {
      waitFor: vi.fn(async () => calls.push('button-visible')),
      isEnabled: vi.fn(async () => {
        calls.push('button-enabled-check');
        return Boolean(username && handle);
      }),
      click: vi.fn(async () => calls.push('button-click')),
    };
    const welcome = {
      visible: false,
      isVisible: vi.fn(async () => welcome.visible),
      waitFor: vi.fn(async () => {
        calls.push('welcome-visible');
        welcome.visible = true;
      }),
      textContent: vi.fn(async () => 'Welcome, launchsmokepeer123'),
    };
    const page = {
      goto: vi.fn(async () => calls.push('goto')),
      getByTestId: vi.fn((testId) => {
        if (testId === 'user-link') {
          return {
            waitFor: vi.fn(async () => calls.push('user-visible')),
            click: vi.fn(async () => calls.push('user-click')),
          };
        }
        if (testId === 'welcome-msg') return welcome;
        if (testId === 'create-identity-btn') return createButton;
        throw new Error(`unexpected-testid:${testId}`);
      }),
      waitForURL: vi.fn(async () => calls.push('dashboard-url')),
      fill: vi.fn(async (selector, value) => {
        calls.push(`fill:${selector}`);
        if (selector.includes('username')) username = value;
        if (selector.includes('handle')) handle = value;
      }),
    };

    await expect(internal.ensureIdentity(page, 'https://venn.example/', 'launchsmokepeer'))
      .resolves
      .toMatchObject({ created: true });

    expect(username).toMatch(/^launchsmokepeer/);
    expect(handle).toBe(username.toLowerCase());
    expect(calls.indexOf('fill:input[placeholder="Choose a username"]')).toBeLessThan(
      calls.indexOf('button-enabled-check'),
    );
    expect(calls.indexOf('fill:input[placeholder="Choose a handle (letters, numbers, _)"]')).toBeLessThan(
      calls.indexOf('button-enabled-check'),
    );
  });

  it('uses the release comment visibility window for story thread durability', async () => {
    expect(internal.storyThreadVisibilityTimeoutMs(12_000)).toBe(45_000);
    expect(internal.storyThreadVisibilityTimeoutMs(123_000)).toBe(123_000);
  });

  it('waits for story thread creation on the release durability window', async () => {
    const state = {
      visible: {
        'news-card-topic-1-discussion': true,
        'news-card-topic-1-discussion-compose-toggle': false,
        'news-card-topic-1-discussion-new-thread-toggle': true,
        'thread-content': true,
        'thread-form-error': false,
        'news-card-topic-1-thread-head': false,
      },
      waits: [],
      fills: {},
    };
    const locators = new Map();
    const locator = (testId) => {
      if (!locators.has(testId)) {
        locators.set(testId, {
          testId,
          waitFor: vi.fn(async (options) => {
            state.waits.push({ testId, options });
            if (!state.visible[testId]) throw new Error(`${testId}-not-visible`);
          }),
          isVisible: vi.fn(async () => Boolean(state.visible[testId])),
          scrollIntoViewIfNeeded: vi.fn(async () => {}),
          evaluate: vi.fn(async () => {}),
          click: vi.fn(async () => {
            if (testId === 'submit-thread-btn') {
              state.visible['news-card-topic-1-thread-head'] = true;
              state.visible['news-card-topic-1-discussion-compose-toggle'] = true;
            }
          }),
          fill: vi.fn(async (value) => {
            state.fills[testId] = value;
          }),
          textContent: vi.fn(async () => ''),
        });
      }
      return locators.get(testId);
    };
    const page = { getByTestId: locator };

    await expect(internal.ensureStoryThread(
      page,
      { storyId: 'story-1', topicId: 'topic-1' },
      123_000,
    )).resolves.toMatchObject({
      sectionId: 'news-card-topic-1',
      createdThread: true,
    });

    expect(state.fills['thread-content']).toContain('Launch smoke thread for story-1');
    expect(state.waits).toContainEqual({
      testId: 'news-card-topic-1-discussion-compose-toggle',
      options: { state: 'visible', timeout: 30_000 },
    });
    expect(locators.get('news-card-topic-1-thread-head').isVisible).toHaveBeenCalled();
  });

  it('surfaces story thread form errors instead of timing out silently', async () => {
    const locator = (testId) => ({
      isVisible: vi.fn(async () => testId === 'thread-form-error'),
      textContent: vi.fn(async () => 'thread-write-not-durable:news-story:story-1'),
    });

    await expect(internal.waitForStoryThreadHead({ getByTestId: locator }, 'news-card-topic-1', 1_000))
      .rejects
      .toThrow('story-thread-create-error:thread-write-not-durable:news-story:story-1');
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

    expect(source).toContain("progress('second-browser-detail-route-scope-visible'");
    expect(source).toContain("progress('second-browser-detail-route-retry-feed'");
    expect(source).toContain("progress('second-browser-feed-route-visible'");
    expect(source).toContain("progress('second-browser-detail-scope-fallback'");
  });

  it('re-resolves second-browser vote controls from page scope while aggregates hydrate', async () => {
    const source = await readFile(new URL('./public-feed-browser-smoke.mjs', import.meta.url), 'utf8');

    expect(source).toContain('async function visibleAgreeVoteCount(scope, voteProof)');
    expect(source).toContain('const agree = await findAgreeButtonByCanonical(scope, voteProof.canonicalPointId, voteProof.pointId);');
    expect(source).toContain('await agree.scrollIntoViewIfNeeded({ timeout: 1_000 }).catch(() => {});');
    expect(source).toContain('const { count } = await visibleAgreeVoteCount(page, voteProof);');
    expect(source).toContain("progress('second-browser-vote-public-ready-current-detail'");
    expect(source).toContain("progress('second-browser-vote-public-ready-reopen'");
    expect(source).toContain("progress('second-browser-vote-reopen-detail-scope-visible'");
    expect(source).toContain("progress('second-browser-vote-reopen-feed-route-failed'");
    expect(source).toContain("progress('second-browser-diagnostics'");
    expect(source).not.toContain("const agree = await findAgreeButtonByCanonical(card, voteProof.canonicalPointId, voteProof.pointId);\n    const voteCount = await waitFor('second-browser-vote-visibility'");
  });

  it('keeps post-vote reload proof valid on detail-route page scope', async () => {
    const source = await readFile(new URL('./public-feed-browser-smoke.mjs', import.meta.url), 'utf8');

    expect(source).toContain("progress('post-vote-detail-route-scope-visible'");
    expect(source).toContain("progress('reload-detail-scope-visible'");
    expect(source).toContain("progress('reload-detail-route-retry-feed'");
    expect(source).toContain("progress('reload-feed-route-visible'");
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

  it('keeps initial app-open feed proof separate from manual refresh recovery', async () => {
    const source = await readFile(new URL('./public-feed-browser-smoke.mjs', import.meta.url), 'utf8');
    const initialWaitStart = source.indexOf('async function waitForInitialOpenHeadlines');
    const initialWaitEnd = source.indexOf('function findVisibleStoryRow', initialWaitStart);
    const initialWaitSource = source.slice(initialWaitStart, initialWaitEnd);

    expect(source).toContain('manualRefreshAllowed: false');
    expect(source).toContain('const initialCards = await gotoFeedInitialOpen(');
    expect(initialWaitSource).toContain("waitFor('public-feed-initial-open-headlines'");
    expect(initialWaitSource).toContain("progress('initial-open-wait-diagnostics'");
    expect(initialWaitSource).not.toContain('clickFeedRefresh');
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

  it('extracts the deployed public system writer pin from a Vite bundle', () => {
    const pin = {
      pinVersion: 1,
      schemaEpoch: 'luma-public-v1',
      maxProtocolVersion: 'luma-public-v1',
      signatureSuite: 'jcs-ed25519-sha256-v1',
      writers: [{
        id: 'vh-public-beta-news-system-writer-v1',
        status: 'active',
        publicKey: { encoding: 'spki-base64url', material: 'public-material' },
      }],
    };
    const source = `const env={BASE_URL:"/",VITE_NEWS_SYSTEM_WRITER_PIN_JSON:'${JSON.stringify(pin)}',MODE:"production"};`;

    expect(JSON.parse(internal.extractViteEnvString(source, 'VITE_NEWS_SYSTEM_WRITER_PIN_JSON'))).toEqual(pin);
  });

  it('uses the deployed app pin before falling back to the E2E fixture', async () => {
    const pin = {
      pinVersion: 1,
      schemaEpoch: 'luma-public-v1',
      maxProtocolVersion: 'luma-public-v1',
      signatureSuite: 'jcs-ed25519-sha256-v1',
      writers: [{
        id: 'vh-public-beta-news-system-writer-v1',
        status: 'active',
        publicKey: { encoding: 'spki-base64url', material: 'public-material' },
      }],
    };
    const fetchImpl = vi.fn(async (url) => {
      if (url === 'https://venn.example/') {
        return new Response('<script type="module" crossorigin src="/assets/index-public.js"></script>');
      }
      if (url === 'https://venn.example/assets/index-public.js') {
        return new Response(`const env={VITE_NEWS_SYSTEM_WRITER_PIN_JSON:${JSON.stringify(JSON.stringify(pin))}};`);
      }
      return new Response('not found', { status: 404 });
    });

    await expect(internal.fetchDeployedSystemWriterPin('https://venn.example/', fetchImpl)).resolves.toEqual(pin);
  });
});
