/**
 * Validates a deployment artifact JSON file for structural integrity.
 * Usage: npx ts-node scripts/validate-deployment-artifact.ts <path-to-artifact>
 *
 * DEV-ONLY: This validates artifact schema, not on-chain state.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/* ── Schema ─────────────────────────────────────────────────── */

const REQUIRED_CONTRACTS = ['RVU', 'MedianOracle', 'Faucet', 'UBE', 'QuadraticFunding'] as const;
const VALID_NETWORKS = ['sepolia', 'baseSepolia', 'localhost', 'hardhat'] as const;
const CHAIN_IDS: Record<string, number> = {
  sepolia: 11155111,
  baseSepolia: 84532,
  localhost: 31337,
  hardhat: 31337,
};

interface DeploymentArtifact {
  network: string;
  chainId: number;
  deployedAt: string;
  deployer: string;
  dryRun?: boolean;
  contracts: Record<string, string>;
  config: {
    faucet: { dripAmount: string; cooldownSeconds: number };
    ube: { dripAmount: string; claimIntervalSeconds: number };
    minTrustScore: number;
  };
}

/* ── Validators ─────────────────────────────────────────────── */

function isValidAddress(addr: unknown): addr is string {
  return typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function isValidISO8601(date: unknown): date is string {
  if (typeof date !== 'string') return false;
  const d = new Date(date);
  return !isNaN(d.getTime());
}

export function validateArtifact(artifact: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (typeof artifact !== 'object' || artifact === null) {
    return { valid: false, errors: ['Artifact must be a non-null object'] };
  }

  const data = artifact as Record<string, unknown>;

  // network
  if (!VALID_NETWORKS.includes(data.network as (typeof VALID_NETWORKS)[number])) {
    errors.push(`Invalid network: ${String(data.network)}. Expected one of: ${VALID_NETWORKS.join(', ')}`);
  }

  // chainId
  if (typeof data.chainId !== 'number') {
    errors.push(`chainId must be a number, got ${typeof data.chainId}`);
  } else if (typeof data.network === 'string' && CHAIN_IDS[data.network] !== undefined) {
    if (data.chainId !== CHAIN_IDS[data.network]) {
      errors.push(`chainId mismatch: expected ${CHAIN_IDS[data.network]} for ${data.network}, got ${data.chainId}`);
    }
  }

  // deployedAt
  if (!isValidISO8601(data.deployedAt)) {
    errors.push(`deployedAt must be a valid ISO-8601 timestamp`);
  }

  // deployer
  if (!isValidAddress(data.deployer)) {
    errors.push(`deployer must be a valid Ethereum address`);
  }

  // contracts
  if (typeof data.contracts !== 'object' || data.contracts === null) {
    errors.push('contracts must be an object');
  } else {
    const contracts = data.contracts as Record<string, unknown>;
    for (const name of REQUIRED_CONTRACTS) {
      if (!isValidAddress(contracts[name])) {
        errors.push(`contracts.${name} must be a valid address, got ${String(contracts[name])}`);
      }
    }

    // uniqueness check
    const addresses = Object.values(contracts).filter(isValidAddress);
    const unique = new Set(addresses);
    if (unique.size !== addresses.length) {
      errors.push('Contract addresses must be unique — duplicate detected');
    }
  }

  // config
  if (typeof data.config !== 'object' || data.config === null) {
    errors.push('config must be an object');
  } else {
    const config = data.config as Record<string, unknown>;

    // faucet config
    if (typeof config.faucet !== 'object' || config.faucet === null) {
      errors.push('config.faucet must be an object');
    } else {
      const faucet = config.faucet as Record<string, unknown>;
      if (typeof faucet.dripAmount !== 'string' || !/^\d+$/.test(faucet.dripAmount)) {
        errors.push('config.faucet.dripAmount must be a numeric string');
      }
      if (typeof faucet.cooldownSeconds !== 'number' || faucet.cooldownSeconds <= 0) {
        errors.push('config.faucet.cooldownSeconds must be a positive number');
      }
    }

    // ube config
    if (typeof config.ube !== 'object' || config.ube === null) {
      errors.push('config.ube must be an object');
    } else {
      const ube = config.ube as Record<string, unknown>;
      if (typeof ube.dripAmount !== 'string' || !/^\d+$/.test(ube.dripAmount)) {
        errors.push('config.ube.dripAmount must be a numeric string');
      }
      if (typeof ube.claimIntervalSeconds !== 'number' || ube.claimIntervalSeconds <= 0) {
        errors.push('config.ube.claimIntervalSeconds must be a positive number');
      }
    }

    // minTrustScore
    if (typeof config.minTrustScore !== 'number') {
      errors.push('config.minTrustScore must be a number');
    } else if (config.minTrustScore < 0 || config.minTrustScore > 10000) {
      errors.push('config.minTrustScore must be between 0 and 10000');
    }
  }

  return { valid: errors.length === 0, errors };
}

/* ── CLI ────────────────────────────────────────────────────── */

function main() {
  const artifactPath = process.argv[2];
  if (!artifactPath) {
    const deploymentsDir = path.resolve(__dirname, '../deployments');
    console.log('Usage: ts-node validate-deployment-artifact.ts <artifact.json>');
    console.log(`  e.g. ts-node validate-deployment-artifact.ts ${deploymentsDir}/sepolia.json`);
    process.exitCode = 1;
    return;
  }

  const resolved = path.resolve(artifactPath);
  if (!existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exitCode = 1;
    return;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resolved, 'utf-8'));
  } catch {
    console.error(`Failed to parse JSON: ${resolved}`);
    process.exitCode = 1;
    return;
  }

  const result = validateArtifact(raw);
  if (result.valid) {
    console.log(`✅ Artifact valid: ${resolved}`);
  } else {
    console.error(`❌ Artifact invalid: ${resolved}`);
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    process.exitCode = 1;
  }
}

// Only run CLI when executed directly (not imported)
if (require.main === module) {
  main();
}
