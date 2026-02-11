import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, JsonRpcProvider, Wallet, isAddress, keccak256, toUtf8Bytes } from '../../packages/contracts/node_modules/ethers';

const TRUST_SCORE_SCALE = 10_000;
const DEFAULT_SESSION_TTL_SECONDS = 24 * 60 * 60;
const BRIDGE_ENVIRONMENT = 'DEV';
const BRIDGE_DISCLAIMER =
  'DEV-ONLY: bridge wiring is for testnet/dev use and is not production-grade sybil defense';

const UBE_REGISTRATION_ABI = [
  'function registerIdentity(address user, bytes32 nullifier, uint256 trustScore, uint256 expiresAt) external'
] as const;
const FAUCET_REGISTRATION_ABI = [
  'function recordAttestation(address user, uint256 trustScore, uint256 expiresAt) external'
] as const;

export interface SessionProof {
  trustScore: number;
  nullifier: string;
  token: string;
}

export interface BridgeDeploymentArtifact {
  network: string;
  chainId: number;
  contracts: {
    UBE: `0x${string}`;
    Faucet: `0x${string}`;
  };
  config: {
    minTrustScore: number;
  };
}

export interface RegistrationPayload {
  wallet: `0x${string}`;
  scaledTrustScore: number;
  bytes32Nullifier: `0x${string}`;
  token: string;
  expiresAt: number;
}

export interface OnChainTxHashes {
  ubeTxHash: `0x${string}`;
  faucetTxHash: `0x${string}`;
}

export type OnChainWriter = (
  deployment: BridgeDeploymentArtifact,
  payload: RegistrationPayload
) => Promise<OnChainTxHashes>;

export interface BridgeSessionResult extends RegistrationPayload {
  mode: 'dry-run' | 'on-chain';
  network: string;
  chainId: number;
  minTrustScore: number;
  environment: typeof BRIDGE_ENVIRONMENT;
  disclaimer: typeof BRIDGE_DISCLAIMER;
  ubeTxHash?: `0x${string}`;
  faucetTxHash?: `0x${string}`;
}

interface BridgeContractLike {
  registerIdentity(
    wallet: string,
    nullifier: string,
    scaledTrustScore: bigint,
    expiresAt: bigint
  ): Promise<{ hash: string; wait: () => Promise<unknown> }>;
  recordAttestation(
    wallet: string,
    scaledTrustScore: bigint,
    expiresAt: bigint
  ): Promise<{ hash: string; wait: () => Promise<unknown> }>;
}

export interface EthersBindings {
  JsonRpcProvider: new (url: string) => unknown;
  Wallet: new (privateKey: string, provider: unknown) => unknown;
  Contract: new (
    address: string,
    abi: readonly string[],
    signer: unknown
  ) => BridgeContractLike;
}

const DEFAULT_ETHERS_BINDINGS: EthersBindings = {
  JsonRpcProvider,
  Wallet,
  Contract: Contract as unknown as EthersBindings['Contract']
};

type BridgeEnv = Record<string, string | undefined>;
type BridgeWriterFactory = (options: {
  rpcUrl: string;
  attestorPrivateKey: string;
}) => OnChainWriter;

type BridgeLogger = Pick<Console, 'info'>;

export interface CreateOnChainWriterOptions {
  rpcUrl: string;
  attestorPrivateKey: string;
  ethersBindings?: EthersBindings;
}

export interface BridgeStubOptions {
  deploymentArtifactPath?: string;
  sessionTtlSeconds?: number;
  now?: () => number;
  logger?: BridgeLogger;
  writer?: OnChainWriter;
  env?: BridgeEnv;
  writerFactory?: BridgeWriterFactory;
}

function requireRecord(value: unknown, field: string, source: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`[vh:bridge-stub] ${field} in ${source} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(object: Record<string, unknown>, field: string, source: string): string {
  const value = object[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`[vh:bridge-stub] ${field} in ${source} must be a non-empty string`);
  }
  return value.trim();
}

function requireInteger(
  object: Record<string, unknown>,
  field: string,
  source: string,
  min: number,
  max = Number.MAX_SAFE_INTEGER
): number {
  const value = object[field];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`[vh:bridge-stub] ${field} in ${source} must be an integer`);
  }
  if (value < min || value > max) {
    throw new Error(`[vh:bridge-stub] ${field} in ${source} must be between ${min} and ${max}`);
  }
  return value;
}

function requireAddress(object: Record<string, unknown>, field: string, source: string): `0x${string}` {
  const value = requireString(object, field, source);
  if (!isAddress(value)) {
    throw new Error(`[vh:bridge-stub] ${field} in ${source} must be a valid EVM address`);
  }
  return value as `0x${string}`;
}

function requireWalletAddress(wallet: string): `0x${string}` {
  if (!isAddress(wallet)) {
    throw new Error('[vh:bridge-stub] wallet must be a valid EVM address');
  }
  return wallet as `0x${string}`;
}

function requireSessionToken(token: string): string {
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new Error('[vh:bridge-stub] token must be a non-empty string');
  }
  return token.trim();
}

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`[vh:bridge-stub] ${field} must be a positive integer`);
  }
  return value;
}

export function resolveDefaultSepoliaArtifactPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(thisFile), '../../packages/contracts/deployments/sepolia.json');
}

export function parseDeploymentArtifact(raw: unknown, source = 'deployment artifact'): BridgeDeploymentArtifact {
  const root = requireRecord(raw, 'artifact', source);
  const contracts = requireRecord(root.contracts, 'contracts', source);
  const config = requireRecord(root.config, 'config', source);

  return {
    network: requireString(root, 'network', source),
    chainId: requireInteger(root, 'chainId', source, 1),
    contracts: {
      UBE: requireAddress(contracts, 'UBE', source),
      Faucet: requireAddress(contracts, 'Faucet', source)
    },
    config: {
      minTrustScore: requireInteger(config, 'minTrustScore', source, 0, TRUST_SCORE_SCALE)
    }
  };
}

export function readDeploymentArtifact(filePath: string): BridgeDeploymentArtifact {
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    return parseDeploymentArtifact(raw, filePath);
  } catch (error) {
    throw new Error(`[vh:bridge-stub] failed to read deployment artifact at ${filePath}: ${(error as Error).message}`);
  }
}

export function toScaledTrustScore(trustScore: number): number {
  if (!Number.isFinite(trustScore) || trustScore < 0 || trustScore > 1) {
    throw new Error('[vh:bridge-stub] trustScore must be a finite number in [0, 1]');
  }
  return Math.round(trustScore * TRUST_SCORE_SCALE);
}

export function toBytes32Nullifier(nullifier: string): `0x${string}` {
  if (typeof nullifier !== 'string' || nullifier.trim().length === 0) {
    throw new Error('[vh:bridge-stub] nullifier must be a non-empty string');
  }
  return keccak256(toUtf8Bytes(nullifier.trim())) as `0x${string}`;
}

export function createOnChainWriter(options: CreateOnChainWriterOptions): OnChainWriter {
  const rpcUrl = requireSessionToken(options.rpcUrl);
  const attestorPrivateKey = requireSessionToken(options.attestorPrivateKey);
  const bindings = options.ethersBindings ?? DEFAULT_ETHERS_BINDINGS;

  const provider = new bindings.JsonRpcProvider(rpcUrl);
  const signer = new bindings.Wallet(attestorPrivateKey, provider);

  return async (deployment, payload) => {
    const ubeContract = new bindings.Contract(deployment.contracts.UBE, UBE_REGISTRATION_ABI, signer);
    const faucetContract = new bindings.Contract(deployment.contracts.Faucet, FAUCET_REGISTRATION_ABI, signer);

    const [ubeTx, faucetTx] = await Promise.all([
      ubeContract.registerIdentity(
        payload.wallet,
        payload.bytes32Nullifier,
        BigInt(payload.scaledTrustScore),
        BigInt(payload.expiresAt)
      ),
      faucetContract.recordAttestation(payload.wallet, BigInt(payload.scaledTrustScore), BigInt(payload.expiresAt))
    ]);

    await Promise.all([ubeTx.wait(), faucetTx.wait()]);

    return {
      ubeTxHash: ubeTx.hash as `0x${string}`,
      faucetTxHash: faucetTx.hash as `0x${string}`
    };
  };
}

export function createWriterFromEnv(
  env: BridgeEnv,
  writerFactory: BridgeWriterFactory = createOnChainWriter
): OnChainWriter | undefined {
  const enabled = env.BRIDGE_ENABLE_ONCHAIN_REGISTRATION === 'true';
  if (!enabled) {
    return undefined;
  }

  const rpcUrl = env.BRIDGE_RPC_URL;
  const attestorPrivateKey = env.BRIDGE_ATTESTOR_PRIVATE_KEY;
  if (!rpcUrl || !attestorPrivateKey) {
    throw new Error(
      '[vh:bridge-stub] BRIDGE_ENABLE_ONCHAIN_REGISTRATION=true requires BRIDGE_RPC_URL and BRIDGE_ATTESTOR_PRIVATE_KEY'
    );
  }

  return writerFactory({ rpcUrl, attestorPrivateKey });
}

export interface AttestorBridge {
  bridgeSession(session: SessionProof, wallet: string): Promise<BridgeSessionResult>;
}

export class BridgeStub implements AttestorBridge {
  private readonly deployment: BridgeDeploymentArtifact;
  private readonly sessionTtlSeconds: number;
  private readonly writer?: OnChainWriter;
  private readonly now: () => number;
  private readonly logger: BridgeLogger;

  constructor(options: BridgeStubOptions = {}) {
    const deploymentArtifactPath = options.deploymentArtifactPath ?? resolveDefaultSepoliaArtifactPath();
    this.deployment = readDeploymentArtifact(deploymentArtifactPath);
    this.sessionTtlSeconds = requirePositiveInteger(options.sessionTtlSeconds ?? DEFAULT_SESSION_TTL_SECONDS, 'sessionTtlSeconds');
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.logger = options.logger ?? console;
    this.writer = options.writer ?? createWriterFromEnv(options.env ?? process.env, options.writerFactory);
  }

  async bridgeSession(session: SessionProof, wallet: string): Promise<BridgeSessionResult> {
    const nowSeconds = requirePositiveInteger(this.now(), 'now()');

    const payload: RegistrationPayload = {
      wallet: requireWalletAddress(wallet),
      scaledTrustScore: toScaledTrustScore(session.trustScore),
      bytes32Nullifier: toBytes32Nullifier(session.nullifier),
      token: requireSessionToken(session.token),
      expiresAt: nowSeconds + this.sessionTtlSeconds
    };

    const result: BridgeSessionResult = {
      ...payload,
      mode: 'dry-run',
      network: this.deployment.network,
      chainId: this.deployment.chainId,
      minTrustScore: this.deployment.config.minTrustScore,
      environment: BRIDGE_ENVIRONMENT,
      disclaimer: BRIDGE_DISCLAIMER
    };

    if (!this.writer) {
      this.logger.info('[vh:bridge-stub][DEV-ONLY] dry-run: would register session proof with UBE/Faucet', result);
      return result;
    }

    const txHashes = await this.writer(this.deployment, payload);
    const onChainResult: BridgeSessionResult = {
      ...result,
      mode: 'on-chain',
      ...txHashes
    };

    this.logger.info('[vh:bridge-stub][DEV-ONLY] registered session proof with UBE/Faucet', onChainResult);
    return onChainResult;
  }
}
