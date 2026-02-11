import { expect } from 'chai';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { validateArtifact } from '../validate-deployment-artifact';

/* ── Artifact validator unit tests ──────────────────────────── */

describe('validateArtifact', function () {
  const VALID_ARTIFACT = {
    network: 'sepolia',
    chainId: 11155111,
    deployedAt: '2026-02-10T00:30:00.000Z',
    deployer: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    contracts: {
      RVU: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      MedianOracle: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
      Faucet: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
      UBE: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
      QuadraticFunding: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
    },
    config: {
      faucet: { dripAmount: '10000000000000000000', cooldownSeconds: 21600 },
      ube: { dripAmount: '25000000000000000000', claimIntervalSeconds: 86400 },
      minTrustScore: 5000,
    },
  };

  it('accepts a valid artifact', function () {
    const result = validateArtifact(VALID_ARTIFACT);
    expect(result.valid).to.equal(true);
    expect(result.errors).to.have.length(0);
  });

  it('rejects null input', function () {
    const result = validateArtifact(null);
    expect(result.valid).to.equal(false);
  });

  it('rejects invalid network', function () {
    const result = validateArtifact({ ...VALID_ARTIFACT, network: 'mainnet' });
    expect(result.valid).to.equal(false);
    expect(result.errors.some((e: string) => e.includes('network'))).to.equal(true);
  });

  it('rejects chainId mismatch', function () {
    const result = validateArtifact({ ...VALID_ARTIFACT, chainId: 1 });
    expect(result.valid).to.equal(false);
    expect(result.errors.some((e: string) => e.includes('chainId'))).to.equal(true);
  });

  it('rejects invalid deployer address', function () {
    const result = validateArtifact({ ...VALID_ARTIFACT, deployer: 'not-an-address' });
    expect(result.valid).to.equal(false);
    expect(result.errors.some((e: string) => e.includes('deployer'))).to.equal(true);
  });

  it('rejects missing contract', function () {
    const incomplete = { ...VALID_ARTIFACT, contracts: { ...VALID_ARTIFACT.contracts } };
    delete (incomplete.contracts as Record<string, unknown>).Faucet;
    const result = validateArtifact(incomplete);
    expect(result.valid).to.equal(false);
    expect(result.errors.some((e: string) => e.includes('Faucet'))).to.equal(true);
  });

  it('rejects duplicate contract addresses', function () {
    const duped = {
      ...VALID_ARTIFACT,
      contracts: {
        ...VALID_ARTIFACT.contracts,
        Faucet: VALID_ARTIFACT.contracts.RVU, // duplicate
      },
    };
    const result = validateArtifact(duped);
    expect(result.valid).to.equal(false);
    expect(result.errors.some((e: string) => e.includes('unique'))).to.equal(true);
  });

  it('rejects invalid deployedAt', function () {
    const result = validateArtifact({ ...VALID_ARTIFACT, deployedAt: 'not-a-date' });
    expect(result.valid).to.equal(false);
    expect(result.errors.some((e: string) => e.includes('ISO-8601'))).to.equal(true);
  });

  it('rejects minTrustScore out of range', function () {
    const bad = {
      ...VALID_ARTIFACT,
      config: { ...VALID_ARTIFACT.config, minTrustScore: 20000 },
    };
    const result = validateArtifact(bad);
    expect(result.valid).to.equal(false);
    expect(result.errors.some((e: string) => e.includes('minTrustScore'))).to.equal(true);
  });

  it('rejects invalid faucet dripAmount', function () {
    const bad = {
      ...VALID_ARTIFACT,
      config: {
        ...VALID_ARTIFACT.config,
        faucet: { ...VALID_ARTIFACT.config.faucet, dripAmount: -5 },
      },
    };
    const result = validateArtifact(bad);
    expect(result.valid).to.equal(false);
  });

  it('rejects zero cooldownSeconds', function () {
    const bad = {
      ...VALID_ARTIFACT,
      config: {
        ...VALID_ARTIFACT.config,
        faucet: { ...VALID_ARTIFACT.config.faucet, cooldownSeconds: 0 },
      },
    };
    const result = validateArtifact(bad);
    expect(result.valid).to.equal(false);
  });

  it('accepts valid dryRun flag', function () {
    const result = validateArtifact({ ...VALID_ARTIFACT, dryRun: true });
    expect(result.valid).to.equal(true);
  });
});

/* ── Sepolia artifact smoke test ────────────────────────────── */

describe('sepolia.json artifact', function () {
  const artifactPath = path.resolve(__dirname, '../../deployments/sepolia.json');

  before(function () {
    if (!existsSync(artifactPath)) {
      this.skip();
    }
  });

  it('exists and is valid JSON', function () {
    const raw = JSON.parse(readFileSync(artifactPath, 'utf-8'));
    expect(raw).to.be.an('object');
  });

  it('passes schema validation', function () {
    const raw = JSON.parse(readFileSync(artifactPath, 'utf-8'));
    const result = validateArtifact(raw);
    expect(result.errors).to.deep.equal([]);
    expect(result.valid).to.equal(true);
  });

  it('targets sepolia network with correct chainId', function () {
    const raw = JSON.parse(readFileSync(artifactPath, 'utf-8'));
    expect(raw.network).to.equal('sepolia');
    expect(raw.chainId).to.equal(11155111);
  });

  it('contains all five contracts', function () {
    const raw = JSON.parse(readFileSync(artifactPath, 'utf-8'));
    expect(raw.contracts).to.have.all.keys(
      'RVU', 'MedianOracle', 'Faucet', 'UBE', 'QuadraticFunding'
    );
  });

  it('has sane configuration values', function () {
    const raw = JSON.parse(readFileSync(artifactPath, 'utf-8'));
    expect(raw.config.minTrustScore).to.equal(5000);
    expect(raw.config.faucet.cooldownSeconds).to.equal(21600);
    expect(raw.config.ube.claimIntervalSeconds).to.equal(86400);
  });
});
