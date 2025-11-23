import { time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('UBE', () => {
  async function deployFixture() {
    const [deployer, attestor, user, other] = await ethers.getSigners();
    const rgu = await ethers.deployContract('RGU');
    await rgu.waitForDeployment();

    const drip = ethers.parseUnits('12', 18);
    const interval = 24 * 60 * 60;
    const minTrust = 5000;
    const ube = await ethers.deployContract('UBE', [await rgu.getAddress(), drip, interval, minTrust]);
    await ube.waitForDeployment();

    await rgu.grantRole(await rgu.MINTER_ROLE(), await ube.getAddress());
    await ube.grantRole(await ube.ATTESTOR_ROLE(), attestor.address);

    return { rgu, ube, deployer, attestor, user, other, drip, interval, minTrust };
  }

  it('allows attested users to claim on cadence', async () => {
    const { ube, rgu, user, attestor, drip, interval } = await deployFixture();
    const expires = (await time.latest()) + 2 * interval;
    const nullifier = ethers.encodeBytes32String('nullifier-1');

    await expect(ube.connect(attestor).registerIdentity(user.address, nullifier, 8000, expires))
      .to.emit(ube, 'IdentityRegistered')
      .withArgs(user.address, nullifier, 8000, expires);

    const statusBefore = await ube.getClaimStatus(user.address);
    expect(statusBefore.eligible).to.equal(true);

    await expect(ube.connect(user).claim())
      .to.emit(ube, 'UBEClaimed')
      .withArgs(user.address, drip, anyValue, anyValue);
    expect(await rgu.balanceOf(user.address)).to.equal(drip);

    await expect(ube.connect(user).claim()).to.be.revertedWith('claim cooldown');
    await time.increase(interval + 1);
    await ube.connect(user).claim();
    expect(await rgu.balanceOf(user.address)).to.equal(drip * 2n);
  });

  it('prevents claims when trust is low or attestation expired', async () => {
    const { ube, user, attestor, interval } = await deployFixture();
    const expires = (await time.latest()) + interval;

    await ube.connect(attestor).registerIdentity(user.address, ethers.encodeBytes32String('nullifier-2'), 1000, expires);
    await expect(ube.connect(user).claim()).to.be.revertedWith('trust too low');

    await ube.connect(attestor).registerIdentity(user.address, ethers.encodeBytes32String('nullifier-3'), 7000, expires);
    await time.increase(interval + 1);
    await expect(ube.connect(user).claim()).to.be.revertedWith('attestation expired');
  });

  it('enforces nullifier uniqueness and exposes status', async () => {
    const { ube, attestor, user, other, interval, minTrust } = await deployFixture();
    const expires = (await time.latest()) + interval;
    const reusedNullifier = ethers.encodeBytes32String('shared');

    await ube.connect(attestor).registerIdentity(user.address, reusedNullifier, 7000, expires);
    await expect(
      ube.connect(attestor).registerIdentity(other.address, reusedNullifier, 7000, expires)
    ).to.be.revertedWith('nullifier used');

    const status = await ube.getClaimStatus(other.address);
    expect(status.eligible).to.equal(false);
    expect(status.trustScore).to.equal(0);
    expect(status.expiresAt).to.equal(0);
    expect(status.nullifier).to.equal(ethers.ZeroHash);

    await expect(ube.setClaimConfig(ethers.parseUnits('5', 18), interval / 2, minTrust + 500))
      .to.emit(ube, 'ClaimConfigUpdated');
  });
});
