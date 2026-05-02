import { afterEach, describe, expect, it, vi } from 'vitest';
import SEA from 'gun/sea';
import { createRelayDaemonAuthHeaders, createRelayUserSignatureHeaders } from './relayAuth';

describe('relayAuth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
});
