import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  BridgeStub,
  createOnChainWriter,
  createWriterFromEnv,
  parseDeploymentArtifact,
  readDeploymentArtifact,
  resolveDefaultSepoliaArtifactPath,
  toBytes32Nullifier,
  toScaledTrustScore,
  type BridgeDeploymentArtifact,
  type RegistrationPayload
} from './index';

const VALID_DEPLOYMENT: BridgeDeploymentArtifact = {
  network: 'sepolia',
  chainId: 11155111,
  contracts: {
    UBE: '0x0000000000000000000000000000000000000001',
    Faucet: '0x0000000000000000000000000000000000000002'
  },
  config: {
    minTrustScore: 5000
  }
};

const VALID_WALLET = '0x000000000000000000000000000000000000dEaD';
const VALID_PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945385d5f5f4d6f8f5e2b9b9d2c8f40f2e95c3';
const VALID_SESSION = {
  trustScore: 0.8,
  nullifier: 'nullifier-123',
  token: 'session-token'
};

describe('bridge deployment artifact parsing', () => {
  it('loads the default sepolia deployment artifact', () => {
    const artifact = readDeploymentArtifact(resolveDefaultSepoliaArtifactPath());
    expect(artifact.network).toBe('sepolia');
    expect(artifact.chainId).toBe(11155111);
    expect(artifact.config.minTrustScore).toBe(5000);
  });

  it('parses a valid artifact shape', () => {
    const parsed = parseDeploymentArtifact(VALID_DEPLOYMENT, 'unit-test');
    expect(parsed).toEqual(VALID_DEPLOYMENT);
  });

  it('rejects malformed artifacts', () => {
    expect(() => parseDeploymentArtifact(null, 'broken')).toThrow('must be an object');
    expect(() => parseDeploymentArtifact('nope' as unknown, 'broken')).toThrow('must be an object');
    expect(() => parseDeploymentArtifact([] as unknown, 'broken')).toThrow('must be an object');

    expect(() =>
      parseDeploymentArtifact(
        {
          ...VALID_DEPLOYMENT,
          network: 123 as unknown as string
        },
        'broken'
      )
    ).toThrow('must be a non-empty string');

    expect(() =>
      parseDeploymentArtifact(
        {
          ...VALID_DEPLOYMENT,
          chainId: '11155111' as unknown as number
        },
        'broken'
      )
    ).toThrow('must be an integer');

    expect(() =>
      parseDeploymentArtifact(
        {
          ...VALID_DEPLOYMENT,
          chainId: 0
        },
        'broken'
      )
    ).toThrow('must be between 1');

    expect(() =>
      parseDeploymentArtifact(
        {
          ...VALID_DEPLOYMENT,
          contracts: {
            ...VALID_DEPLOYMENT.contracts,
            UBE: 'not-an-address'
          }
        },
        'broken'
      )
    ).toThrow('valid EVM address');

    expect(() =>
      parseDeploymentArtifact(
        {
          ...VALID_DEPLOYMENT,
          config: {
            minTrustScore: '5000' as unknown as number
          }
        },
        'broken'
      )
    ).toThrow('must be an integer');

    expect(() =>
      parseDeploymentArtifact(
        {
          ...VALID_DEPLOYMENT,
          config: {
            minTrustScore: 20_000
          }
        },
        'broken'
      )
    ).toThrow('must be between 0 and 10000');
  });

  it('wraps JSON parse errors when reading artifact files', () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'bridge-stub-'));
    const artifactPath = path.join(tempDir, 'sepolia.json');
    writeFileSync(artifactPath, '{bad-json', 'utf8');

    expect(() => readDeploymentArtifact(artifactPath)).toThrow('failed to read deployment artifact');

    rmSync(tempDir, { recursive: true, force: true });
  });
});

describe('helpers', () => {
  it('scales trust score and hashes nullifier deterministically', () => {
    expect(toScaledTrustScore(0)).toBe(0);
    expect(toScaledTrustScore(0.8)).toBe(8000);
    expect(toScaledTrustScore(1)).toBe(10000);

    const n1 = toBytes32Nullifier('abc');
    const n2 = toBytes32Nullifier('abc');
    const n3 = toBytes32Nullifier('def');

    expect(n1).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(n1).toBe(n2);
    expect(n1).not.toBe(n3);
  });

  it('rejects invalid trust score and nullifier values', () => {
    expect(() => toScaledTrustScore(Number.NaN)).toThrow('trustScore');
    expect(() => toScaledTrustScore(Number.POSITIVE_INFINITY)).toThrow('trustScore');
    expect(() => toScaledTrustScore(-0.1)).toThrow('trustScore');
    expect(() => toScaledTrustScore(1.1)).toThrow('trustScore');
    expect(() => toBytes32Nullifier('')).toThrow('nullifier');
    expect(() => toBytes32Nullifier(123 as unknown as string)).toThrow('nullifier');
  });
});

describe('on-chain writer wiring', () => {
  it('rejects blank writer configuration', () => {
    expect(() => createOnChainWriter({ rpcUrl: '   ', attestorPrivateKey: '0xabc' })).toThrow('non-empty string');
    expect(() => createOnChainWriter({ rpcUrl: 'http://rpc', attestorPrivateKey: '   ' })).toThrow('non-empty string');
    expect(() =>
      createOnChainWriter({
        rpcUrl: 123 as unknown as string,
        attestorPrivateKey: '0xabc'
      })
    ).toThrow('non-empty string');
    expect(() =>
      createOnChainWriter({
        rpcUrl: 'http://rpc',
        attestorPrivateKey: 123 as unknown as string
      })
    ).toThrow('non-empty string');
  });

  it('creates a writer with default ethers bindings', () => {
    const writer = createOnChainWriter({
      rpcUrl: 'http://127.0.0.1:8545',
      attestorPrivateKey: VALID_PRIVATE_KEY
    });
    expect(typeof writer).toBe('function');
  });

  it('creates a writer that invokes UBE/Faucet registration calls', async () => {
    const providerUrls: string[] = [];
    const wallets: Array<{ key: string; provider: unknown }> = [];
    const waits: string[] = [];

    const registerIdentity = vi.fn(async () => ({
      hash: '0xaaa111' as const,
      wait: async () => {
        waits.push('ube');
      }
    }));
    const recordAttestation = vi.fn(async () => ({
      hash: '0xbbb222' as const,
      wait: async () => {
        waits.push('faucet');
      }
    }));

    class FakeProvider {
      constructor(url: string) {
        providerUrls.push(url);
      }
    }

    class FakeWallet {
      constructor(key: string, provider: unknown) {
        wallets.push({ key, provider });
      }
    }

    const contractCtor = vi.fn((address: string) => {
      if (address === VALID_DEPLOYMENT.contracts.UBE) {
        return {
          registerIdentity,
          recordAttestation: vi.fn()
        };
      }
      return {
        registerIdentity: vi.fn(),
        recordAttestation
      };
    });

    const writer = createOnChainWriter({
      rpcUrl: 'https://rpc.test',
      attestorPrivateKey: '0xdev-private-key',
      ethersBindings: {
        JsonRpcProvider: FakeProvider as unknown as new (url: string) => unknown,
        Wallet: FakeWallet as unknown as new (privateKey: string, provider: unknown) => unknown,
        Contract: contractCtor as unknown as new (address: string, abi: readonly string[], signer: unknown) => {
          registerIdentity: (...args: unknown[]) => Promise<{ hash: string; wait: () => Promise<unknown> }>;
          recordAttestation: (...args: unknown[]) => Promise<{ hash: string; wait: () => Promise<unknown> }>;
        }
      }
    });

    const payload: RegistrationPayload = {
      wallet: VALID_WALLET,
      scaledTrustScore: 8000,
      bytes32Nullifier: toBytes32Nullifier(VALID_SESSION.nullifier),
      token: VALID_SESSION.token,
      expiresAt: 2_000_000_000
    };

    const result = await writer(VALID_DEPLOYMENT, payload);

    expect(providerUrls).toEqual(['https://rpc.test']);
    expect(wallets).toHaveLength(1);
    expect(wallets[0].key).toBe('0xdev-private-key');

    expect(contractCtor).toHaveBeenCalledTimes(2);
    expect(registerIdentity).toHaveBeenCalledWith(
      VALID_WALLET,
      payload.bytes32Nullifier,
      8000n,
      BigInt(payload.expiresAt)
    );
    expect(recordAttestation).toHaveBeenCalledWith(VALID_WALLET, 8000n, BigInt(payload.expiresAt));
    expect(waits.sort()).toEqual(['faucet', 'ube']);
    expect(result).toEqual({
      ubeTxHash: '0xaaa111',
      faucetTxHash: '0xbbb222'
    });
  });

  it('builds writers from env only when explicitly enabled', async () => {
    const mockWriter = vi.fn(async () => ({
      ubeTxHash: '0x111' as const,
      faucetTxHash: '0x222' as const
    }));

    const writerFactory = vi.fn(() => mockWriter);

    expect(createWriterFromEnv({}, writerFactory)).toBeUndefined();

    expect(() =>
      createWriterFromEnv(
        {
          BRIDGE_ENABLE_ONCHAIN_REGISTRATION: 'true'
        },
        writerFactory
      )
    ).toThrow('requires BRIDGE_RPC_URL and BRIDGE_ATTESTOR_PRIVATE_KEY');

    expect(() =>
      createWriterFromEnv(
        {
          BRIDGE_ENABLE_ONCHAIN_REGISTRATION: 'true',
          BRIDGE_RPC_URL: 'https://rpc.test'
        },
        writerFactory
      )
    ).toThrow('requires BRIDGE_RPC_URL and BRIDGE_ATTESTOR_PRIVATE_KEY');

    expect(() =>
      createWriterFromEnv(
        {
          BRIDGE_ENABLE_ONCHAIN_REGISTRATION: 'true',
          BRIDGE_ATTESTOR_PRIVATE_KEY: '0xdev-private-key'
        },
        writerFactory
      )
    ).toThrow('requires BRIDGE_RPC_URL and BRIDGE_ATTESTOR_PRIVATE_KEY');

    const fromEnv = createWriterFromEnv(
      {
        BRIDGE_ENABLE_ONCHAIN_REGISTRATION: 'true',
        BRIDGE_RPC_URL: 'https://rpc.test',
        BRIDGE_ATTESTOR_PRIVATE_KEY: '0xdev-private-key'
      },
      writerFactory
    );

    expect(fromEnv).toBeDefined();
    expect(writerFactory).toHaveBeenCalledWith({
      rpcUrl: 'https://rpc.test',
      attestorPrivateKey: '0xdev-private-key'
    });

    await fromEnv?.(VALID_DEPLOYMENT, {
      wallet: VALID_WALLET,
      scaledTrustScore: 9000,
      bytes32Nullifier: toBytes32Nullifier('z'),
      token: 't',
      expiresAt: 100
    });

    expect(mockWriter).toHaveBeenCalled();
  });
});

describe('BridgeStub', () => {
  it('returns DEV dry-run payload when writer is not configured', async () => {
    const logger = {
      info: vi.fn()
    };

    const bridge = new BridgeStub({
      deploymentArtifactPath: resolveDefaultSepoliaArtifactPath(),
      logger,
      now: () => 1_700_000_000,
      sessionTtlSeconds: 120,
      env: {}
    });

    const result = await bridge.bridgeSession(VALID_SESSION, VALID_WALLET);

    expect(result.mode).toBe('dry-run');
    expect(result.scaledTrustScore).toBe(8000);
    expect(result.bytes32Nullifier).toBe(toBytes32Nullifier(VALID_SESSION.nullifier));
    expect(result.expiresAt).toBe(1_700_000_120);
    expect(result.environment).toBe('DEV');
    expect(result.disclaimer).toContain('DEV-ONLY');
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('dry-run'),
      expect.objectContaining({ mode: 'dry-run' })
    );
  });

  it('submits registration via configured writer', async () => {
    const writer = vi.fn(async () => ({
      ubeTxHash: '0xabc' as const,
      faucetTxHash: '0xdef' as const
    }));

    const bridge = new BridgeStub({
      deploymentArtifactPath: resolveDefaultSepoliaArtifactPath(),
      now: () => 42,
      sessionTtlSeconds: 10,
      writer
    });

    const result = await bridge.bridgeSession(VALID_SESSION, VALID_WALLET);

    expect(writer).toHaveBeenCalledWith(
      expect.objectContaining({
        network: 'sepolia',
        contracts: expect.objectContaining({
          UBE: expect.stringMatching(/^0x/),
          Faucet: expect.stringMatching(/^0x/)
        })
      }),
      {
        wallet: VALID_WALLET,
        scaledTrustScore: 8000,
        bytes32Nullifier: toBytes32Nullifier(VALID_SESSION.nullifier),
        token: VALID_SESSION.token,
        expiresAt: 52
      }
    );

    expect(result.mode).toBe('on-chain');
    expect(result.ubeTxHash).toBe('0xabc');
    expect(result.faucetTxHash).toBe('0xdef');
  });

  it('supports env-driven writer setup via writerFactory', async () => {
    const writer = vi.fn(async () => ({
      ubeTxHash: '0xaaa' as const,
      faucetTxHash: '0xbbb' as const
    }));
    const writerFactory = vi.fn(() => writer);

    const bridge = new BridgeStub({
      deploymentArtifactPath: resolveDefaultSepoliaArtifactPath(),
      now: () => 100,
      env: {
        BRIDGE_ENABLE_ONCHAIN_REGISTRATION: 'true',
        BRIDGE_RPC_URL: 'https://rpc.from-env',
        BRIDGE_ATTESTOR_PRIVATE_KEY: '0xkey'
      },
      writerFactory
    });

    const result = await bridge.bridgeSession(VALID_SESSION, VALID_WALLET);

    expect(writerFactory).toHaveBeenCalledWith({
      rpcUrl: 'https://rpc.from-env',
      attestorPrivateKey: '0xkey'
    });
    expect(result.mode).toBe('on-chain');
    expect(writer).toHaveBeenCalled();
  });

  it('supports constructor defaults (artifact path, clock, env)', async () => {
    const previousEnable = process.env.BRIDGE_ENABLE_ONCHAIN_REGISTRATION;
    const previousRpc = process.env.BRIDGE_RPC_URL;
    const previousKey = process.env.BRIDGE_ATTESTOR_PRIVATE_KEY;

    delete process.env.BRIDGE_ENABLE_ONCHAIN_REGISTRATION;
    delete process.env.BRIDGE_RPC_URL;
    delete process.env.BRIDGE_ATTESTOR_PRIVATE_KEY;

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    try {
      const bridge = new BridgeStub();
      const result = await bridge.bridgeSession(VALID_SESSION, VALID_WALLET);
      expect(result.mode).toBe('dry-run');
      expect(result.network).toBe('sepolia');
      expect(result.chainId).toBe(11155111);
    } finally {
      infoSpy.mockRestore();

      if (previousEnable === undefined) {
        delete process.env.BRIDGE_ENABLE_ONCHAIN_REGISTRATION;
      } else {
        process.env.BRIDGE_ENABLE_ONCHAIN_REGISTRATION = previousEnable;
      }
      if (previousRpc === undefined) {
        delete process.env.BRIDGE_RPC_URL;
      } else {
        process.env.BRIDGE_RPC_URL = previousRpc;
      }
      if (previousKey === undefined) {
        delete process.env.BRIDGE_ATTESTOR_PRIVATE_KEY;
      } else {
        process.env.BRIDGE_ATTESTOR_PRIVATE_KEY = previousKey;
      }
    }
  });

  it('rejects invalid bridge inputs and clock values', async () => {
    const bridge = new BridgeStub({
      deploymentArtifactPath: resolveDefaultSepoliaArtifactPath(),
      now: () => 1,
      env: {}
    });

    await expect(bridge.bridgeSession({ ...VALID_SESSION, trustScore: -1 }, VALID_WALLET)).rejects.toThrow('trustScore');
    await expect(bridge.bridgeSession({ ...VALID_SESSION, nullifier: '' }, VALID_WALLET)).rejects.toThrow('nullifier');
    await expect(bridge.bridgeSession({ ...VALID_SESSION, token: '   ' }, VALID_WALLET)).rejects.toThrow('token');
    await expect(bridge.bridgeSession(VALID_SESSION, 'not-an-address')).rejects.toThrow('wallet');

    const badClock = new BridgeStub({
      deploymentArtifactPath: resolveDefaultSepoliaArtifactPath(),
      now: () => 0,
      env: {}
    });
    await expect(badClock.bridgeSession(VALID_SESSION, VALID_WALLET)).rejects.toThrow('now()');

    const fractionalClock = new BridgeStub({
      deploymentArtifactPath: resolveDefaultSepoliaArtifactPath(),
      now: () => 1.5,
      env: {}
    });
    await expect(fractionalClock.bridgeSession(VALID_SESSION, VALID_WALLET)).rejects.toThrow('now()');

    expect(
      () =>
        new BridgeStub({
          deploymentArtifactPath: resolveDefaultSepoliaArtifactPath(),
          sessionTtlSeconds: 0,
          env: {}
        })
    ).toThrow('sessionTtlSeconds');

    expect(
      () =>
        new BridgeStub({
          deploymentArtifactPath: resolveDefaultSepoliaArtifactPath(),
          sessionTtlSeconds: 1.5,
          env: {}
        })
    ).toThrow('sessionTtlSeconds');
  });
});
