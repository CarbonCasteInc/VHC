import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyMock = vi.fn();

vi.mock('@vh/gun-client', () => ({
  SEA: {
    verify: (...args: unknown[]) => verifyMock(...args),
  },
}));

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  verifyMock.mockReset();
});

describe('peerConfig', () => {
  it('covers normalizers and strict validation edge cases', async () => {
    const {
      normalizeGunPeer,
      resolveGunPeers,
      resolveGunPeerTopologySync,
      resolveMinimumPeerCount,
      resolveQuorumRequired,
      isStrictPeerConfigMode,
      isLocalMeshPeerAllowed,
    } = await import('./peerConfig');

    expect(normalizeGunPeer(null)).toBeNull();
    expect(normalizeGunPeer('   ')).toBeNull();
    expect(normalizeGunPeer('https://peer.example')).toBe('https://peer.example/gun');
    expect(resolveQuorumRequired(0)).toBe(1);
    vi.stubEnv('VITE_GUN_PEER_QUORUM_REQUIRED', 'bad');
    expect(resolveQuorumRequired(3)).toBe(2);
    vi.stubEnv('VITE_GUN_PEER_MINIMUM', '0');
    expect(resolveMinimumPeerCount(true)).toBe(3);
    vi.stubEnv('VITE_GUN_PEER_MINIMUM', '5');
    expect(resolveMinimumPeerCount(true)).toBe(5);
    vi.stubEnv('VITE_VH_STRICT_PEER_CONFIG', 'maybe');
    vi.stubEnv('VITE_VH_ALLOW_LOCAL_MESH_PEERS', 'maybe');
    expect(isStrictPeerConfigMode()).toBe(false);
    expect(isLocalMeshPeerAllowed()).toBe(false);
    vi.stubEnv('VITE_VH_ALLOW_LOCAL_MESH_PEERS', 'off');
    expect(isLocalMeshPeerAllowed()).toBe(false);

    vi.stubEnv('VITE_VH_STRICT_PEER_CONFIG', 'true');
    vi.stubEnv('VITE_GUN_PEER_MINIMUM', '3');
    vi.stubEnv('VITE_GUN_PEERS', JSON.stringify([
      'https://a.example/gun',
      'https://b.example/gun',
      'not a url',
    ]));
    expect(() => resolveGunPeers('app.example')).toThrow('rejects insecure peer');

    vi.unstubAllEnvs();
    vi.stubEnv('VITE_GUN_PEER_CONFIG', JSON.stringify({ peers: [] }));
    expect(() => resolveGunPeerTopologySync('app.example')).toThrow('no Gun peers configured');

    vi.unstubAllEnvs();
    vi.stubEnv('VITE_GUN_PEER_CONFIG_URL', 'https://config.example/peers.json');
    expect(() => resolveGunPeerTopologySync('app.example')).toThrow('remote Gun peer config requires async');
  });

  it('accepts local insecure peers only when explicitly allowed in strict mode', async () => {
    vi.stubEnv('VITE_VH_STRICT_PEER_CONFIG', 'true');
    vi.stubEnv('VITE_VH_ALLOW_LOCAL_MESH_PEERS', 'true');
    vi.stubEnv('VITE_GUN_PEERS', JSON.stringify([
      'ws://localhost:7788/gun',
      'http://127.0.0.1:7789/gun',
      'http://[::1]:7790/gun',
    ]));
    const { resolveGunPeerTopologySync } = await import('./peerConfig');

    expect(resolveGunPeerTopologySync('app.example')).toMatchObject({
      peers: [
        'ws://localhost:7788/gun',
        'http://127.0.0.1:7789/gun',
        'http://[::1]:7790/gun',
      ],
      strict: true,
      allowLocalPeers: true,
      quorumRequired: 2,
    });
  });

  it('normalizes comma-separated peers and derives quorum', async () => {
    vi.stubEnv('VITE_GUN_PEERS', 'https://a.example, https://b.example/gun, https://c.example');
    const { resolveGunPeerTopology } = await import('./peerConfig');

    await expect(resolveGunPeerTopology('app.example')).resolves.toMatchObject({
      peers: ['https://a.example/gun', 'https://b.example/gun', 'https://c.example/gun'],
      source: 'env-peers',
      signed: false,
      quorumRequired: 2,
    });
  });

  it('requires and verifies signed remote peer config in strict mode', async () => {
    const issuedAt = Date.now() - 1_000;
    const expiresAt = issuedAt + 86_400_000;
    const payload = {
      schemaVersion: 'mesh-peer-config-v1',
      configId: 'local-three-relay-signed-canary',
      issuedAt,
      expiresAt,
      minimumPeerCount: 3,
      peers: ['https://a.example/gun', 'https://b.example/gun', 'https://c.example/gun'],
      quorumRequired: 2,
    };
    const canonical = `{"configId":"local-three-relay-signed-canary","expiresAt":${expiresAt},"issuedAt":${issuedAt},"minimumPeerCount":3,"peers":["https://a.example/gun","https://b.example/gun","https://c.example/gun"],"quorumRequired":2,"schemaVersion":"mesh-peer-config-v1"}`;
    verifyMock.mockResolvedValue(canonical);
    vi.stubEnv('VITE_VH_STRICT_PEER_CONFIG', 'true');
    vi.stubEnv('VITE_GUN_PEER_CONFIG_URL', 'https://config.example/peers.json');
    vi.stubEnv('VITE_GUN_PEER_CONFIG_PUBLIC_KEY', 'peer-config-pub');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        payload,
        signature: 'signed-peer-config',
      }),
    })));
    const { resolveGunPeerTopology } = await import('./peerConfig');

    await expect(resolveGunPeerTopology('app.example')).resolves.toMatchObject({
      peers: payload.peers,
      source: 'remote-config',
      strict: true,
      signed: true,
      configId: 'local-three-relay-signed-canary',
      quorumRequired: 2,
    });
    expect(verifyMock).toHaveBeenCalledWith('signed-peer-config', 'peer-config-pub');
  });

  it('rejects local signed peer configs in strict mode unless the harness explicitly allows them', async () => {
    const payload = {
      configId: 'local-three-relay-signed-canary',
      minimumPeerCount: 3,
      peers: ['http://127.0.0.1:7788/gun', 'http://127.0.0.1:7789/gun', 'http://127.0.0.1:7790/gun'],
      quorumRequired: 2,
    };
    verifyMock.mockResolvedValue(
      '{"configId":"local-three-relay-signed-canary","minimumPeerCount":3,"peers":["http://127.0.0.1:7788/gun","http://127.0.0.1:7789/gun","http://127.0.0.1:7790/gun"],"quorumRequired":2}',
    );
    vi.stubEnv('VITE_VH_STRICT_PEER_CONFIG', 'true');
    vi.stubEnv('VITE_GUN_PEER_CONFIG_URL', 'https://config.example/peers.json');
    vi.stubEnv('VITE_GUN_PEER_CONFIG_PUBLIC_KEY', 'peer-config-pub');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({
        payload,
        signature: 'signed-peer-config',
      }),
    })));
    const { resolveGunPeerTopology } = await import('./peerConfig');

    await expect(resolveGunPeerTopology('app.example')).rejects.toThrow('rejects insecure peer');

    vi.stubEnv('VITE_VH_ALLOW_LOCAL_MESH_PEERS', 'true');
    await expect(resolveGunPeerTopology('app.example')).resolves.toMatchObject({
      allowLocalPeers: true,
      configId: 'local-three-relay-signed-canary',
      peers: payload.peers,
      quorumRequired: 2,
    });
  });

  it('parses inline peer-config payload variants and rejects bad signatures', async () => {
    const { resolveGunPeerTopology } = await import('./peerConfig');

    vi.stubEnv('VITE_GUN_PEER_CONFIG', JSON.stringify([
      'https://array-a.example/gun',
      'https://array-b.example/gun',
      'https://array-c.example/gun',
    ]));
    await expect(resolveGunPeerTopology('app.example')).resolves.toMatchObject({
      peers: [
        'https://array-a.example/gun',
        'https://array-b.example/gun',
        'https://array-c.example/gun',
      ],
      source: 'env-config',
    });

    vi.stubEnv('VITE_GUN_PEER_CONFIG', JSON.stringify('bad-config'));
    await expect(resolveGunPeerTopology('app.example')).rejects.toThrow('peer config must be an array or object');

    const payload = {
      peers: ['https://a.example/gun', 'https://b.example/gun', 'https://c.example/gun'],
    };
    vi.stubEnv('VITE_GUN_PEER_CONFIG', JSON.stringify({
      payload: JSON.stringify(payload),
      signature: 'bad-signature',
      signerPub: 'dev-signer',
    }));
    verifyMock.mockResolvedValue('{"peers":["https://wrong.example/gun"]}');
    await expect(resolveGunPeerTopology('app.example')).rejects.toThrow('signed peer config verification failed');

    vi.stubEnv('VITE_GUN_PEER_CONFIG', JSON.stringify({
      payload,
      signature: 'signature-without-key',
    }));
    await expect(resolveGunPeerTopology('app.example')).rejects.toThrow('signed peer config is missing');

    vi.stubEnv('VITE_GUN_PEER_CONFIG', JSON.stringify({
      payload,
      signature: 123,
      signerPub: 456,
    }));
    await expect(resolveGunPeerTopology('app.example')).resolves.toMatchObject({
      peers: payload.peers,
      signed: false,
    });

    vi.stubEnv('VITE_GUN_PEER_CONFIG', JSON.stringify({
      peers: payload.peers,
      signature: 123,
      signerPub: 456,
    }));
    await expect(resolveGunPeerTopology('app.example')).resolves.toMatchObject({
      peers: payload.peers,
      signed: false,
    });

    vi.stubEnv('VITE_GUN_PEER_CONFIG', JSON.stringify({
      peers: payload.peers,
      signature: 'plain-object-bad-signature',
      signerPub: 'plain-object-signer',
    }));
    verifyMock.mockResolvedValue('{"peers":["https://wrong.example/gun"]}');
    await expect(resolveGunPeerTopology('app.example')).rejects.toThrow('signed peer config verification failed');
  });

  it('requires async resolution for signed inline peer configs in sync mode', async () => {
    vi.stubEnv('VITE_GUN_PEER_CONFIG', JSON.stringify({
      payload: {
        peers: ['https://a.example/gun', 'https://b.example/gun', 'https://c.example/gun'],
      },
      signature: 'signed-peer-config',
      signerPub: 'dev-signer',
    }));
    const { resolveGunPeerTopologySync } = await import('./peerConfig');

    expect(() => resolveGunPeerTopologySync('app.example')).toThrow('signed Gun peer config requires async resolution');
  });

  it('rejects peer config payloads that omit peers', async () => {
    vi.stubEnv('VITE_GUN_PEER_CONFIG', JSON.stringify({
      minimumPeerCount: 1,
    }));
    const { resolveGunPeerTopology } = await import('./peerConfig');

    await expect(resolveGunPeerTopology('app.example')).rejects.toThrow('no Gun peers configured');
  });

  it('rejects unsigned or expired strict peer config envelopes', async () => {
    vi.stubEnv('VITE_VH_STRICT_PEER_CONFIG', 'true');
    vi.stubEnv('VITE_GUN_PEER_CONFIG', JSON.stringify({
      peers: ['https://a.example/gun', 'https://b.example/gun', 'https://c.example/gun'],
    }));
    const first = await import('./peerConfig');
    await expect(first.resolveGunPeerTopology('app.example')).rejects.toThrow('requires a signed peer config');

    vi.stubEnv('VITE_VH_ALLOW_UNSIGNED_PEER_CONFIG', 'true');
    vi.stubEnv('VITE_GUN_PEER_CONFIG', JSON.stringify({
      expiresAt: Date.now() - 1,
      peers: ['https://a.example/gun', 'https://b.example/gun', 'https://c.example/gun'],
    }));
    await expect(first.resolveGunPeerTopology('app.example')).rejects.toThrow('peer config is expired');

    vi.stubEnv('VITE_VH_ALLOW_UNSIGNED_PEER_CONFIG', 'false');
    vi.stubEnv('VITE_GUN_PEER_CONFIG', JSON.stringify({
      payload: {
        peers: ['https://a.example/gun', 'https://b.example/gun', 'https://c.example/gun'],
      },
      signature: 'signature',
      signerPub: 'self-asserted-signer',
    }));
    await expect(first.resolveGunPeerTopology('app.example')).rejects.toThrow(
      'strict signed peer config requires VITE_GUN_PEER_CONFIG_PUBLIC_KEY',
    );
  });

  it('rejects failed remote peer-config fetches', async () => {
    vi.stubEnv('VITE_GUN_PEER_CONFIG_URL', 'https://config.example/peers.json');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 503,
      text: async () => '',
    })));
    const { resolveGunPeerTopology } = await import('./peerConfig');

    await expect(resolveGunPeerTopology('app.example')).rejects.toThrow('failed to fetch peer config: 503');
  });

  it('maps Gun peer URLs to relay health endpoints', async () => {
    const { peerHealthUrl } = await import('./peerConfig');

    expect(peerHealthUrl('wss://relay.example/gun')).toBe('https://relay.example/healthz');
    expect(peerHealthUrl('ws://127.0.0.1:7788/gun')).toBe('http://127.0.0.1:7788/healthz');
    expect(peerHealthUrl('not a url')).toBeNull();
  });
});
