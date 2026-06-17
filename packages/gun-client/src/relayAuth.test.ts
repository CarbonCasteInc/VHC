import { afterEach, describe, expect, it, vi } from 'vitest';
import SEA from 'gun/sea.js';
import {
  createRelayDaemonAuthHeaders,
  createRelayDaemonAuthHeadersForEndpoint,
  createRelayUserSignatureHeaders,
  normalizeRelayDaemonAuthOrigin,
  readRelayDaemonTokenMap,
  resolveRelayDaemonTokenForEndpoint,
} from './relayAuth';

describe('relayAuth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('creates daemon bearer headers from server-side env', () => {
    const previous = process.env.VH_RELAY_DAEMON_TOKEN;
    process.env.VH_RELAY_DAEMON_TOKEN = 'daemon-secret';
    try {
      expect(createRelayDaemonAuthHeaders()).toEqual({ Authorization: 'Bearer daemon-secret' });
    } finally {
      if (previous === undefined) delete process.env.VH_RELAY_DAEMON_TOKEN;
      else process.env.VH_RELAY_DAEMON_TOKEN = previous;
    }
  });

  it('returns no daemon auth header when no token is configured', () => {
    const previousServer = process.env.VH_RELAY_DAEMON_TOKEN;
    const previousVite = process.env.VITE_VH_RELAY_DAEMON_TOKEN;
    delete process.env.VH_RELAY_DAEMON_TOKEN;
    delete process.env.VITE_VH_RELAY_DAEMON_TOKEN;
    try {
      expect(createRelayDaemonAuthHeaders()).toEqual({});
    } finally {
      if (previousServer === undefined) delete process.env.VH_RELAY_DAEMON_TOKEN;
      else process.env.VH_RELAY_DAEMON_TOKEN = previousServer;
      if (previousVite === undefined) delete process.env.VITE_VH_RELAY_DAEMON_TOKEN;
      else process.env.VITE_VH_RELAY_DAEMON_TOKEN = previousVite;
    }
  });

  it('creates per-origin daemon bearer headers from a token map with single-token fallback', () => {
    vi.stubEnv('VH_NEWS_RELAY_REST_WRITE_TOKENS', JSON.stringify({
      'https://gun-a.example.test': 'token-a',
      'wss://gun-b.example.test/gun': 'token-b',
    }));
    vi.stubEnv('VH_RELAY_DAEMON_TOKEN', 'fallback-token');

    expect(createRelayDaemonAuthHeadersForEndpoint(
      'https://gun-a.example.test/vh/news/story',
      { tokenMapEnvNames: ['VH_NEWS_RELAY_REST_WRITE_TOKENS'] },
    )).toEqual({ Authorization: 'Bearer token-a' });
    expect(createRelayDaemonAuthHeadersForEndpoint(
      'https://gun-b.example.test/vh/news/story',
      { tokenMapEnvNames: ['VH_NEWS_RELAY_REST_WRITE_TOKENS'] },
    )).toEqual({ Authorization: 'Bearer token-b' });
    expect(createRelayDaemonAuthHeadersForEndpoint(
      'https://gun-c.example.test/vh/news/story',
      { tokenMapEnvNames: ['VH_NEWS_RELAY_REST_WRITE_TOKENS'] },
    )).toEqual({ Authorization: 'Bearer fallback-token' });
  });

  it('normalizes relay auth origins across websocket and HTTPS inputs', () => {
    expect(normalizeRelayDaemonAuthOrigin('ws://gun-a.example.test/gun')).toBe('http://gun-a.example.test');
    expect(normalizeRelayDaemonAuthOrigin('wss://gun-a.example.test/gun')).toBe('https://gun-a.example.test');
    expect(normalizeRelayDaemonAuthOrigin('https://gun-a.example.test/vh/news/story')).toBe(
      'https://gun-a.example.test',
    );
    expect(normalizeRelayDaemonAuthOrigin('mailto:bad')).toBeNull();
    expect(normalizeRelayDaemonAuthOrigin('not a url')).toBeNull();
  });

  it('supports alternate token env sources and custom fallback env names', () => {
    vi.stubEnv('VH_RELAY_DAEMON_TOKEN', '');
    vi.stubEnv('VITE_VH_RELAY_DAEMON_TOKEN', '');
    const target = globalThis as {
      __VH_GUN_CLIENT_CONFIG__?: Record<string, unknown> | undefined;
      __VH_IMPORT_META_ENV__?: Record<string, unknown> | undefined;
    };
    const previousGlobalConfig = target.__VH_GUN_CLIENT_CONFIG__;
    const previousImportMetaEnv = target.__VH_IMPORT_META_ENV__;
    try {
      target.__VH_IMPORT_META_ENV__ = { VITE_VH_RELAY_DAEMON_TOKEN: 'vite-token' };
      expect(createRelayDaemonAuthHeaders()).toEqual({ Authorization: 'Bearer vite-token' });

      target.__VH_IMPORT_META_ENV__ = undefined;
      target.__VH_GUN_CLIENT_CONFIG__ = { VH_RELAY_DAEMON_TOKEN: 'global-token' };
      expect(createRelayDaemonAuthHeaders()).toEqual({ Authorization: 'Bearer global-token' });

      vi.stubEnv('CUSTOM_RELAY_TOKEN', 'custom-token');
      expect(resolveRelayDaemonTokenForEndpoint('not a url', {
        tokenEnvNames: ['CUSTOM_RELAY_TOKEN'],
      })).toBe('custom-token');
      expect(resolveRelayDaemonTokenForEndpoint('https://gun-a.example.test/vh/news/story', {
        tokenEnvNames: ['CUSTOM_RELAY_TOKEN'],
      })).toBe('custom-token');
    } finally {
      target.__VH_GUN_CLIENT_CONFIG__ = previousGlobalConfig;
      target.__VH_IMPORT_META_ENV__ = previousImportMetaEnv;
    }
  });

  it('parses relay daemon token maps from arrays and delimited entries', () => {
    vi.stubEnv('ARRAY_RELAY_TOKENS', JSON.stringify([
      'https://gun-a.example.test=token-a',
      { origin: 'wss://gun-b.example.test/gun', token: 'token-b' },
      { url: 'https://gun-c.example.test/path', token: 'token-c' },
    ]));
    expect([...readRelayDaemonTokenMap(['ARRAY_RELAY_TOKENS'])]).toEqual([
      ['https://gun-a.example.test', 'token-a'],
      ['https://gun-b.example.test', 'token-b'],
      ['https://gun-c.example.test', 'token-c'],
    ]);

    vi.stubEnv(
      'DELIMITED_RELAY_TOKENS',
      'https://gun-a.example.test=primary-a,\nhttps://gun-d.example.test=token-d',
    );
    vi.stubEnv('FALLBACK_RELAY_TOKENS', JSON.stringify({
      'https://gun-a.example.test': 'fallback-a',
      'https://gun-e.example.test': 'token-e',
    }));
    expect([...readRelayDaemonTokenMap(['DELIMITED_RELAY_TOKENS', 'FALLBACK_RELAY_TOKENS'])]).toEqual([
      ['https://gun-a.example.test', 'primary-a'],
      ['https://gun-d.example.test', 'token-d'],
      ['https://gun-e.example.test', 'token-e'],
    ]);
  });

  it('fails closed for malformed relay daemon token map entries', () => {
    vi.stubEnv('BAD_RELAY_TOKEN_MAP', JSON.stringify({ 'mailto:bad': 'token' }));
    expect(() => readRelayDaemonTokenMap(['BAD_RELAY_TOKEN_MAP']))
      .toThrow('BAD_RELAY_TOKEN_MAP contains an invalid relay origin/token entry');

    vi.stubEnv('BAD_RELAY_TOKEN_MAP', JSON.stringify(['https://gun-a.example.test']));
    expect(() => readRelayDaemonTokenMap(['BAD_RELAY_TOKEN_MAP']))
      .toThrow('BAD_RELAY_TOKEN_MAP contains an invalid relay token entry');

    vi.stubEnv('BAD_RELAY_TOKEN_MAP', JSON.stringify([false]));
    expect(() => readRelayDaemonTokenMap(['BAD_RELAY_TOKEN_MAP']))
      .toThrow('BAD_RELAY_TOKEN_MAP contains an invalid relay token entry');

    vi.stubEnv('BAD_RELAY_TOKEN_MAP', JSON.stringify([{ origin: null, token: null }]));
    expect(() => readRelayDaemonTokenMap(['BAD_RELAY_TOKEN_MAP']))
      .toThrow('BAD_RELAY_TOKEN_MAP contains an invalid relay origin/token entry');

    vi.stubEnv('BAD_RELAY_TOKEN_MAP', 'https://gun-a.example.test');
    expect(() => readRelayDaemonTokenMap(['BAD_RELAY_TOKEN_MAP']))
      .toThrow('BAD_RELAY_TOKEN_MAP contains an invalid relay token entry');
  });

  it('does not create user signature headers without a complete device pair', async () => {
    await expect(createRelayUserSignatureHeaders('/vh/aggregates/voter', {}, null)).resolves.toEqual({});
    await expect(createRelayUserSignatureHeaders('/vh/aggregates/voter', {}, { pub: 'pub', priv: '' })).resolves.toEqual({});
  });

  it('creates replay-scoped SEA user signature headers over canonical relay payloads', async () => {
    const pair = await SEA.pair() as { pub: string; priv: string };
    const body = { topic_id: 'topic-1', value: 1 };
    const headers = await createRelayUserSignatureHeaders('/vh/aggregates/voter', body, pair, {
      nonce: 'nonce-1',
      timestamp: '1777752000000',
    });

    expect(headers).toMatchObject({
      'x-vh-relay-device-pub': pair.pub,
      'x-vh-relay-nonce': 'nonce-1',
      'x-vh-relay-timestamp': '1777752000000',
    });
    const signature = Buffer.from(headers['x-vh-relay-signature'], 'base64url').toString('utf8');
    await expect(SEA.verify(signature, pair.pub)).resolves.toEqual({
      path: '/vh/aggregates/voter',
      body,
      nonce: 'nonce-1',
      timestamp: '1777752000000',
    });
  });

  it('generates default nonce and timestamp values when omitted', async () => {
    const pair = await SEA.pair() as { pub: string; priv: string };
    vi.spyOn(Date, 'now').mockReturnValue(1777752111000);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const headers = await createRelayUserSignatureHeaders('/vh/forum/thread', { thread_id: 'thread-1' }, pair);

    expect(headers).toMatchObject({
      'x-vh-relay-device-pub': pair.pub,
      'x-vh-relay-nonce': '1777752111000-i',
      'x-vh-relay-timestamp': '1777752111000',
    });
  });

  it('returns no user signature headers when SEA does not return a usable signature', async () => {
    vi.spyOn(SEA, 'sign').mockResolvedValue('   ' as never);

    await expect(
      createRelayUserSignatureHeaders('/vh/forum/comment', { comment_id: 'comment-1' }, { pub: 'pub', priv: 'priv' }),
    ).resolves.toEqual({});
  });

  it('uses the browser base64url fallback when Buffer is unavailable', async () => {
    vi.spyOn(SEA, 'sign').mockResolvedValue('sig+/=' as never);
    vi.stubGlobal('Buffer', undefined);

    const headers = await createRelayUserSignatureHeaders('/vh/forum/comment', { comment_id: 'comment-1' }, {
      pub: 'pub',
      priv: 'priv',
    }, {
      nonce: 'nonce-2',
      timestamp: '1777752222000',
    });

    expect(headers['x-vh-relay-signature']).toBe(btoa('sig+/=').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''));
  });

  it('encodes non-Latin1 SEA signatures in browser fallback mode', async () => {
    vi.spyOn(SEA, 'sign').mockResolvedValue('SEA{"m":"tonight’s thread","s":"sig"}' as never);
    vi.stubGlobal('Buffer', undefined);

    const headers = await createRelayUserSignatureHeaders('/vh/forum/thread', {
      thread: {
        id: 'news-story:story-1',
        title: 'Tonight’s unique district',
      },
    }, {
      pub: 'pub',
      priv: 'priv',
    }, {
      nonce: 'nonce-3',
      timestamp: '1777752333000',
    });

    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode('SEA{"m":"tonight’s thread","s":"sig"}')))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    expect(headers['x-vh-relay-signature']).toBe(encoded);
  });
});
