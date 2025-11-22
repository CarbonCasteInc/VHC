import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('RGU', () => {
  it('allows minters to mint tokens', async () => {
    const [owner, user] = await ethers.getSigners();
    const rgu = await ethers.deployContract('RGU');
    await rgu.waitForDeployment();

    const amount = ethers.parseUnits('100', 18);
    await expect(rgu.connect(owner).mint(user.address, amount))
      .to.emit(rgu, 'Transfer')
      .withArgs(ethers.ZeroAddress, user.address, amount);

    const balance = await rgu.balanceOf(user.address);
    expect(balance).to.equal(amount);
  });

  it('prevents non minters from minting', async () => {
    const [, user, attacker] = await ethers.getSigners();
    const rgu = await ethers.deployContract('RGU');
    await rgu.waitForDeployment();

    const minterRole = await rgu.MINTER_ROLE();
    await expect(rgu.connect(attacker).mint(user.address, 1))
      .to.be.revertedWithCustomError(rgu, 'AccessControlUnauthorizedAccount')
      .withArgs(attacker.address, minterRole);
  });

  it('allows burners to burn tokens', async () => {
    const [owner, user] = await ethers.getSigners();
    const rgu = await ethers.deployContract('RGU');
    await rgu.waitForDeployment();

    const amount = ethers.parseUnits('50', 18);
    await rgu.connect(owner).mint(user.address, amount);

    await expect(rgu.connect(owner).burn(user.address, amount))
      .to.emit(rgu, 'Transfer')
      .withArgs(user.address, ethers.ZeroAddress, amount);

    expect(await rgu.balanceOf(user.address)).to.equal(0);
  });

  it('prevents non burners from burning', async () => {
    const [owner, user, attacker] = await ethers.getSigners();
    const rgu = await ethers.deployContract('RGU');
    await rgu.waitForDeployment();

    const burnerRole = await rgu.BURNER_ROLE();
    await rgu.connect(owner).mint(user.address, 1);
    await expect(rgu.connect(attacker).burn(user.address, 1))
      .to.be.revertedWithCustomError(rgu, 'AccessControlUnauthorizedAccount')
      .withArgs(attacker.address, burnerRole);
  });
});
