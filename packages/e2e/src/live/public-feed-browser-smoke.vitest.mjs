import { describe, expect, it } from 'vitest';
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

  it('falls back for invalid positive integers', () => {
    expect(internal.parsePositiveInt('42', 7)).toBe(42);
    expect(internal.parsePositiveInt('0', 7)).toBe(7);
    expect(internal.parsePositiveInt('bad', 7)).toBe(7);
  });

  it('resolves an explicit artifact directory', () => {
    expect(internal.resolveArtifactDir({ VH_PUBLIC_FEED_SMOKE_ARTIFACT_DIR: '/tmp/proof' }, '/repo')).toBe('/tmp/proof');
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
