import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  buildChromiumHostResolverRules,
  parsePublicProofConfig,
  publicProofBrowserHostnames,
  validatePublicPeerConfigEnvelope,
} from './deployed-wss-peer-config-canary.mjs';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(thisFile), '../../../..');
const gunRequire = createRequire(path.join(repoRoot, 'packages/gun-client/package.json'));
const SEA = gunRequire('gun/sea');

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined && key !== 'signature' && key !== 'signerPub')
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

async function signedEnvelope(payload, pair) {
  return {
    payload,
    signature: await SEA.sign(canonicalize(payload), pair),
    signerPub: pair.pub,
  };
}

function validEnv(overrides = {}) {
  return {
    VH_MESH_PUBLIC_PEER_CONFIG_URL: 'https://config.mesh.example.com/mesh-peer-config.json',
    VH_MESH_PUBLIC_PEER_CONFIG_PUBLIC_KEY: 'public-peer-config-key',
    VH_MESH_PUBLIC_CONFIG_ID: 'mesh-public-config-v1',
    VH_MESH_PUBLIC_WSS_PEERS: JSON.stringify([
      'wss://relay-a.mesh.example.com/gun',
      'wss://relay-b.mesh.example.com/gun',
      'wss://relay-c.mesh.example.com/gun',
    ]),
    VH_MESH_PUBLIC_CSP_CONNECT_SRC: "'self' https://config.mesh.example.com wss://relay-a.mesh.example.com wss://relay-b.mesh.example.com wss://relay-c.mesh.example.com",
    VH_MESH_PUBLIC_MINIMUM_PEER_COUNT: '3',
    VH_MESH_PUBLIC_QUORUM_REQUIRED: '2',
    VH_MESH_PUBLIC_APP_URL: 'https://app.mesh.example.com/',
    ...overrides,
  };
}

describe('public WSS proof input validation', () => {
  it('fails closed when required operator inputs are missing', () => {
    const parsed = parsePublicProofConfig({});

    expect(parsed.ok).toBe(false);
    expect(parsed.failures).toEqual(expect.arrayContaining([
      'missing VH_MESH_PUBLIC_PEER_CONFIG_URL',
      'missing VH_MESH_PUBLIC_PEER_CONFIG_PUBLIC_KEY',
      'missing VH_MESH_PUBLIC_WSS_PEERS',
      'missing VH_MESH_PUBLIC_CSP_CONNECT_SRC',
      'missing VH_MESH_PUBLIC_APP_URL',
    ]));
  });

  it('accepts only exact public HTTPS/WSS inputs and derives health endpoints', () => {
    const parsed = parsePublicProofConfig(validEnv());

    expect(parsed.ok).toBe(true);
    expect(parsed.config.healthEndpoints).toHaveLength(3);
    expect(parsed.config.healthEndpoints[0]).toMatchObject({
      healthz: 'https://relay-a.mesh.example.com/healthz',
      readyz: 'https://relay-a.mesh.example.com/readyz',
      metrics: 'https://relay-a.mesh.example.com/metrics',
      source: 'derived_from_wss_peer',
    });
  });

  it('can build explicit IPv4 resolver rules for public proof browser launches', async () => {
    const parsed = parsePublicProofConfig(validEnv({
      VH_MESH_PUBLIC_FORCE_IPV4: 'true',
      VH_MESH_PUBLIC_IPV4_HOSTS: 'cdn.mesh.example.com',
    }));

    expect(parsed.ok).toBe(true);
    expect(parsed.config.forceIpv4).toBe(true);
    expect(publicProofBrowserHostnames(parsed.config)).toEqual([
      'app.mesh.example.com',
      'cdn.mesh.example.com',
      'config.mesh.example.com',
      'relay-a.mesh.example.com',
      'relay-b.mesh.example.com',
      'relay-c.mesh.example.com',
    ]);

    const rules = await buildChromiumHostResolverRules(
      publicProofBrowserHostnames(parsed.config),
      async (hostname) => ({ address: `203.0.113.${hostname.charCodeAt(0) % 10}` }),
    );
    expect(rules).toContain('--host-resolver-rules=MAP app.mesh.example.com 203.0.113.7');
    expect(rules).toContain('MAP relay-c.mesh.example.com 203.0.113.4');
  });

  it('rejects localhost, private-network, insecure, and broad CSP proof inputs', () => {
    const parsed = parsePublicProofConfig(validEnv({
      VH_MESH_PUBLIC_PEER_CONFIG_URL: 'https://127.0.0.1:8443/mesh-peer-config.json',
      VH_MESH_PUBLIC_WSS_PEERS: 'ws://relay-a.mesh.example.com/gun,wss://10.1.2.3/gun,wss://[::ffff:10.1.2.3]/gun,wss://[fd00::1]/gun,wss://[2001:db8::1]/gun,wss://relay.local/gun',
      VH_MESH_PUBLIC_CSP_CONNECT_SRC: "'self' https: wss://*.mesh.example.com ws://relay-a.mesh.example.com",
      VH_MESH_PUBLIC_APP_URL: 'http://app.mesh.example.com/',
    }));

    expect(parsed.ok).toBe(false);
    expect(parsed.failures.join('\n')).toContain('public peer-config URL https://127.0.0.1:8443/mesh-peer-config.json rejected');
    expect(parsed.failures.join('\n')).toContain('public WSS peer ws://relay-a.mesh.example.com/gun must use wss:');
    expect(parsed.failures.join('\n')).toContain('public WSS peer wss://10.1.2.3/gun rejected');
    expect(parsed.failures.join('\n')).toContain('uses an IPv4-embedded IPv6 literal');
    expect(parsed.failures.join('\n')).toContain('public WSS peer wss://[fd00::1]/gun rejected');
    expect(parsed.failures.join('\n')).toContain('public WSS peer wss://[2001:db8::1]/gun rejected');
    expect(parsed.failures.join('\n')).toContain('public WSS peer wss://relay.local/gun rejected');
    expect(parsed.failures.join('\n')).toContain('CSP connect-src token https: is too broad');
    expect(parsed.failures.join('\n')).toContain('CSP connect-src token wss://*.mesh.example.com is too broad');
    expect(parsed.failures.join('\n')).toContain('public app URL http://app.mesh.example.com/ must use https:');
  });

  it('rejects accidental private signing material in public-key inputs', () => {
    const parsed = parsePublicProofConfig(validEnv({
      VH_MESH_PUBLIC_PEER_CONFIG_PUBLIC_KEY: '-----BEGIN PRIVATE KEY-----\nnot-a-public-key\n-----END PRIVATE KEY-----',
    }));

    expect(parsed.ok).toBe(false);
    expect(parsed.failures).toContain('public key input appears to contain private signing material');
  });

  it('requires all rollover inputs together for service-worker stale-cache proof', () => {
    const parsed = parsePublicProofConfig(validEnv({
      VH_MESH_PUBLIC_ROLLOVER_CONFIG_ID: 'mesh-public-config-v2',
    }));

    expect(parsed.ok).toBe(false);
    expect(parsed.failures).toContain(
      'public rollover proof requires VH_MESH_PUBLIC_ROLLOVER_PEER_CONFIG_URL, VH_MESH_PUBLIC_ROLLOVER_CONFIG_ID, and VH_MESH_PUBLIC_ROLLOVER_APP_URL together',
    );
  });
});

describe('public WSS signed peer-config validation', () => {
  it('accepts a fresh signed config only when it exactly matches expected public peers and quorum', async () => {
    const pair = await SEA.pair();
    const issuedAt = Date.parse('2026-05-09T12:00:00.000Z');
    const parsed = parsePublicProofConfig(validEnv({
      VH_MESH_PUBLIC_PEER_CONFIG_PUBLIC_KEY: pair.pub,
    }));
    const payload = {
      schemaVersion: 'mesh-peer-config-v1',
      configId: parsed.config.configId,
      issuedAt,
      expiresAt: issuedAt + 60_000,
      peers: parsed.config.peers,
      minimumPeerCount: 3,
      quorumRequired: 2,
    };

    const result = await validatePublicPeerConfigEnvelope({
      envelope: await signedEnvelope(payload, pair),
      expected: parsed.config,
      nowMs: issuedAt + 10_000,
    });

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('rejects unsigned, stale, future-issued, wrong-quorum, and wrong-peer configs', async () => {
    const pair = await SEA.pair();
    const issuedAt = Date.parse('2026-05-09T12:00:00.000Z');
    const parsed = parsePublicProofConfig(validEnv({
      VH_MESH_PUBLIC_PEER_CONFIG_PUBLIC_KEY: pair.pub,
      VH_MESH_PUBLIC_CONFIG_MAX_AGE_MS: '1000',
    }));
    const basePayload = {
      schemaVersion: 'mesh-peer-config-v1',
      configId: parsed.config.configId,
      issuedAt,
      expiresAt: issuedAt + 60_000,
      peers: parsed.config.peers,
      minimumPeerCount: 3,
      quorumRequired: 2,
    };

    const unsigned = await validatePublicPeerConfigEnvelope({
      envelope: { payload: basePayload },
      expected: parsed.config,
      nowMs: issuedAt + 10,
    });
    expect(unsigned.failures).toContain('peer config is unsigned');

    const stale = await validatePublicPeerConfigEnvelope({
      envelope: await signedEnvelope(basePayload, pair),
      expected: parsed.config,
      nowMs: issuedAt + 2_000,
    });
    expect(stale.failures).toContain('peer config issuedAt is older than 1000ms');

    const future = await validatePublicPeerConfigEnvelope({
      envelope: await signedEnvelope({ ...basePayload, issuedAt: issuedAt + 60_000, expiresAt: issuedAt + 120_000 }, pair),
      expected: parsed.config,
      nowMs: issuedAt,
    });
    expect(future.failures).toContain('peer config is not yet valid');

    const wrongQuorum = await validatePublicPeerConfigEnvelope({
      envelope: await signedEnvelope({ ...basePayload, quorumRequired: 4 }, pair),
      expected: parsed.config,
      nowMs: issuedAt + 10,
    });
    expect(wrongQuorum.failures).toEqual(expect.arrayContaining([
      'expected quorumRequired 2, observed 4',
      'peer config quorumRequired exceeds configured peers',
    ]));

    const wrongPeer = await validatePublicPeerConfigEnvelope({
      envelope: await signedEnvelope({ ...basePayload, peers: ['wss://other.mesh.example.com/gun'] }, pair),
      expected: parsed.config,
      nowMs: issuedAt + 10,
    });
    expect(wrongPeer.failures).toContain('peer config peers do not exactly match expected public peers');
  });
});
