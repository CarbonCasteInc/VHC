import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('MedianOracle', () => {
  async function deploy() {
    const [admin, provider, other] = await ethers.getSigners();
    const oracle = await ethers.deployContract('MedianOracle');
    await oracle.waitForDeployment();
    await oracle.grantRole(await oracle.PROVIDER_ROLE(), provider.address);
    return { oracle, admin, provider, other };
  }

  it('prevents non-providers from committing', async () => {
    const { oracle, other } = await deploy();
    await expect(oracle.connect(other).commitPrice(ethers.ZeroHash)).to.be.revertedWithCustomError(
      oracle,
      'AccessControlUnauthorizedAccount'
    );
  });

  it('prevents reveal without commit', async () => {
    const { oracle, provider } = await deploy();
    await expect(oracle.connect(provider).revealPrice(1, 1)).to.be.revertedWith('no commit');
  });

  it('enforces commitment hash', async () => {
    const { oracle, provider } = await deploy();
    const commitment = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256'], [10, 123]));
    await oracle.connect(provider).commitPrice(commitment);
    await expect(oracle.connect(provider).revealPrice(11, 123)).to.be.revertedWith('commit mismatch');
  });

  it('computes median for odd and even counts', async () => {
    const { oracle, provider, admin } = await deploy();
    const commitment = (price: number, salt: number) =>
      ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['uint256', 'uint256'], [price, salt]));

    const commitReveal = async (signer: any, price: number, salt: number) => {
      await oracle.connect(signer).commitPrice(commitment(price, salt));
      await oracle.connect(signer).revealPrice(price, salt);
    };

    await commitReveal(provider, 10, 1);
    expect(await oracle.getMedian(0)).to.equal(10);

    // Advance epoch and add two prices (even)
    await oracle.connect(admin).setCurrentEpoch(1);
    await commitReveal(provider, 10, 2);
    await commitReveal(admin, 20, 3);
    expect(await oracle.getMedian(1)).to.equal(15);
  });

  it('prevents epoch regression', async () => {
    const { oracle, admin } = await deploy();
    await oracle.connect(admin).setCurrentEpoch(2);
    await expect(oracle.connect(admin).setCurrentEpoch(1)).to.be.revertedWith('epoch regression');
  });
});
