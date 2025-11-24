import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ethers } from 'hardhat';

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with ${deployer.address}`);

  const rvu = await ethers.deployContract('RVU');
  await rvu.waitForDeployment();
  const rvuAddress = await rvu.getAddress();
  console.log(`RVU deployed at ${rvuAddress}`);

  const mintAmount = ethers.parseUnits('1000000', 18);
  const mintTx = await rvu.mint(deployer.address, mintAmount);
  await mintTx.wait();
  console.log('Minted 1,000,000 RVU to deployer');

  const oracle = await ethers.deployContract('MedianOracle');
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log(`MedianOracle deployed at ${oracleAddress}`);

  const deploymentsDir = path.resolve(__dirname, '../deployments');
  mkdirSync(deploymentsDir, { recursive: true });
  const outputPath = path.join(deploymentsDir, 'localhost.json');
  const output = {
    network: 'localhost',
    deployedAt: new Date().toISOString(),
    contracts: {
      RVU: rvuAddress,
      MedianOracle: oracleAddress
    }
  };

  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Deployment info saved to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
