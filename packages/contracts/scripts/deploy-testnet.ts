import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ethers, network, run } from 'hardhat';

const SUPPORTED_NETWORKS = new Set(['sepolia', 'baseSepolia']);
const DAY_IN_SECONDS = 24 * 60 * 60;

/** When DRY_RUN=true, run against hardhat network and write artifact for the target network. */
const DRY_RUN = process.env.DRY_RUN === 'true';
const DRY_RUN_TARGET = process.env.DRY_RUN_TARGET || 'sepolia';

async function verify(address: string, constructorArguments: unknown[]) {
  if (DRY_RUN || network.name === 'hardhat' || network.name === 'localhost') {
    return;
  }
  try {
    await run('verify:verify', { address, constructorArguments });
    console.log(`Verified ${address}`);
  } catch (err) {
    console.warn(`Verification skipped for ${address}: ${(err as Error).message}`);
  }
}

async function main() {
  const isHardhatNetwork = network.name === 'hardhat' || network.name === 'localhost';

  if (DRY_RUN && !isHardhatNetwork) {
    throw new Error('DRY_RUN requires hardhat or localhost network');
  }

  if (!DRY_RUN) {
    if (!SUPPORTED_NETWORKS.has(network.name)) {
      throw new Error(`deploy-testnet supports only Sepolia/Base Sepolia. Received: ${network.name}`);
    }

    if (!process.env.TESTNET_PRIVATE_KEY) {
      throw new Error('TESTNET_PRIVATE_KEY is required for testnet deployment');
    }
  }

  if (process.env.MAINNET_PRIVATE_KEY) {
    console.warn('MAINNET_PRIVATE_KEY is ignored. Only TESTNET_PRIVATE_KEY is used for this script.');
  }

  const targetNetwork = DRY_RUN ? DRY_RUN_TARGET : network.name;
  console.log(`Mode: ${DRY_RUN ? 'DRY_RUN' : 'LIVE'} | Target: ${targetNetwork}`);

  const [deployer] = await ethers.getSigners();
  console.log(`Deploying to ${network.name} with ${deployer.address}`);

  const rvu = await ethers.deployContract('RVU');
  await rvu.waitForDeployment();
  const rvuAddress = await rvu.getAddress();
  console.log(`RVU deployed at ${rvuAddress}`);

  const initialMint = ethers.parseUnits('1000000', 18);
  await (await rvu.mint(deployer.address, initialMint)).wait();
  console.log('Seeded deployer with 1,000,000 RVU');

  const oracle = await ethers.deployContract('MedianOracle');
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log(`MedianOracle deployed at ${oracleAddress}`);

  const minTrustScore = 5000; // 0.5 on TRUST_SCORE_SCALE (1e4)
  const faucetDrip = ethers.parseUnits('10', 18);
  const faucetCooldown = 6 * 60 * 60; // 6 hours
  const faucet = await ethers.deployContract('Faucet', [rvuAddress, faucetDrip, faucetCooldown, minTrustScore]);
  await faucet.waitForDeployment();
  const faucetAddress = await faucet.getAddress();
  await (await rvu.grantRole(await rvu.MINTER_ROLE(), faucetAddress)).wait();
  console.log(`Faucet deployed at ${faucetAddress} (minter role granted)`);

  const ubeDrip = ethers.parseUnits('25', 18);
  const ube = await ethers.deployContract('UBE', [rvuAddress, ubeDrip, DAY_IN_SECONDS, minTrustScore]);
  await ube.waitForDeployment();
  const ubeAddress = await ube.getAddress();
  await (await rvu.grantRole(await rvu.MINTER_ROLE(), ubeAddress)).wait();
  console.log(`UBE deployed at ${ubeAddress} (minter role granted)`);

  const quadraticFunding = await ethers.deployContract('QuadraticFunding', [rvuAddress, minTrustScore]);
  await quadraticFunding.waitForDeployment();
  const qfAddress = await quadraticFunding.getAddress();
  await (await quadraticFunding.grantRole(await quadraticFunding.ATTESTOR_ROLE(), deployer.address)).wait();
  await (await quadraticFunding.grantRole(await quadraticFunding.TREASURER_ROLE(), deployer.address)).wait();
  console.log(`QuadraticFunding deployed at ${qfAddress}`);

  const matchingSeed = ethers.parseUnits('50000', 18);
  await (await rvu.approve(qfAddress, matchingSeed)).wait();
  await (await quadraticFunding.fundMatchingPool(matchingSeed)).wait();
  console.log(`Seeded matching pool with ${ethers.formatUnits(matchingSeed, 18)} RVU`);

  await verify(rvuAddress, []);
  await verify(oracleAddress, []);
  await verify(faucetAddress, [rvuAddress, faucetDrip, faucetCooldown, minTrustScore]);
  await verify(ubeAddress, [rvuAddress, ubeDrip, DAY_IN_SECONDS, minTrustScore]);
  await verify(qfAddress, [rvuAddress, minTrustScore]);

  const deploymentsDir = path.resolve(__dirname, '../deployments');
  mkdirSync(deploymentsDir, { recursive: true });
  const filePath = path.join(deploymentsDir, `${targetNetwork}.json`);

  const chainId = DRY_RUN
    ? (targetNetwork === 'sepolia' ? 11155111 : 84532)
    : Number((await ethers.provider.getNetwork()).chainId);

  const output = {
    network: targetNetwork,
    chainId,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    dryRun: DRY_RUN || undefined,
    contracts: {
      RVU: rvuAddress,
      MedianOracle: oracleAddress,
      Faucet: faucetAddress,
      UBE: ubeAddress,
      QuadraticFunding: qfAddress
    },
    config: {
      faucet: { dripAmount: faucetDrip.toString(), cooldownSeconds: faucetCooldown },
      ube: { dripAmount: ubeDrip.toString(), claimIntervalSeconds: DAY_IN_SECONDS },
      minTrustScore
    }
  };
  writeFileSync(filePath, JSON.stringify(output, null, 2));
  console.log(`Deployment info saved to ${filePath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
