import { time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('Faucet', () => {
  async function deployFixture() {
    const [deployer, user, attestor, stranger] = await ethers.getSigners();
    const rvu = await ethers.deployContract('RVU');
    await rvu.waitForDeployment();

    const drip = ethers.parseUnits('5', 18);
    const cooldown = 60 * 60; // 1 hour
    const minTrust = 5000;
    const faucet = await ethers.deployContract('Faucet', [await rvu.getAddress(), drip, cooldown, minTrust]);
    await faucet.waitForDeployment();

    await rvu.grantRole(await rvu.MINTER_ROLE(), await faucet.getAddress());
    await faucet.grantRole(await faucet.ATTESTOR_ROLE(), attestor.address);

    return { rvu, faucet, deployer, user, attestor, stranger, drip, cooldown, minTrust };
  }

  it('drips tokens for attested users and enforces cooldown', async () => {
    const { faucet, rvu, user, attestor, drip, cooldown } = await deployFixture();

    const expiresAt = (await time.latest()) + 2 * 24 * 60 * 60;
    await expect(faucet.connect(attestor).recordAttestation(user.address, 8000, expiresAt))
      .to.emit(faucet, 'AttestationRecorded')
      .withArgs(user.address, 8000, expiresAt);

    await expect(faucet.connect(user).claim())
      .to.emit(faucet, 'FaucetDrip')
      .withArgs(user.address, drip, anyValue);
    expect(await rvu.balanceOf(user.address)).to.equal(drip);

    await expect(faucet.connect(user).claim()).to.be.revertedWith('cooldown active');

    await time.increase(cooldown + 1);
    await faucet.connect(user).claim();
    expect(await rvu.balanceOf(user.address)).to.equal(drip * 2n);
  });

  it('rejects claims when trust is low or attestation expired', async () => {
    const { faucet, user, attestor, cooldown } = await deployFixture();
    const soonExpiry = (await time.latest()) + cooldown;

    await faucet.connect(attestor).recordAttestation(user.address, 1000, soonExpiry);
    await expect(faucet.connect(user).claim()).to.be.revertedWith('trust too low');

    await faucet.connect(attestor).recordAttestation(user.address, 8000, soonExpiry);
    await time.increase(cooldown + 1);
    await expect(faucet.connect(user).claim()).to.be.revertedWith('attestation expired');
  });

  it('restricts attestation management to authorized roles', async () => {
    const { faucet, attestor, stranger, user, drip, cooldown, minTrust } = await deployFixture();
    const role = await faucet.ATTESTOR_ROLE();

    await expect(faucet.connect(stranger).recordAttestation(user.address, 9000, (await time.latest()) + 1000))
      .to.be.revertedWithCustomError(faucet, 'AccessControlUnauthorizedAccount')
      .withArgs(stranger.address, role);

    const expires = (await time.latest()) + 1000;
    await faucet.connect(attestor).recordAttestation(user.address, 8000, expires);
    await expect(faucet.connect(attestor).revokeAttestation(user.address))
      .to.emit(faucet, 'AttestationRevoked')
      .withArgs(user.address);
    const attestation = await faucet.getAttestation(user.address);
    expect(attestation.exists).to.equal(false);

    await expect(faucet.setConfig(drip * 2n, cooldown * 2, minTrust + 500))
      .to.emit(faucet, 'ConfigUpdated')
      .withArgs(drip * 2n, cooldown * 2, minTrust + 500);
  });
});
