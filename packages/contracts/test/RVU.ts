import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('RVU', () => {
  it('allows minters to mint tokens', async () => {
    const [owner, user] = await ethers.getSigners();
    const rvu = await ethers.deployContract('RVU');
    await rvu.waitForDeployment();

    const amount = ethers.parseUnits('100', 18);
    await expect(rvu.connect(owner).mint(user.address, amount))
      .to.emit(rvu, 'Transfer')
      .withArgs(ethers.ZeroAddress, user.address, amount);

    const balance = await rvu.balanceOf(user.address);
    expect(balance).to.equal(amount);
  });

  it('prevents non minters from minting', async () => {
    const [, user, attacker] = await ethers.getSigners();
    const rvu = await ethers.deployContract('RVU');
    await rvu.waitForDeployment();

    const minterRole = await rvu.MINTER_ROLE();
    await expect(rvu.connect(attacker).mint(user.address, 1))
      .to.be.revertedWithCustomError(rvu, 'AccessControlUnauthorizedAccount')
      .withArgs(attacker.address, minterRole);
  });

  it('allows burners to burn tokens', async () => {
    const [owner, user] = await ethers.getSigners();
    const rvu = await ethers.deployContract('RVU');
    await rvu.waitForDeployment();

    const amount = ethers.parseUnits('50', 18);
    await rvu.connect(owner).mint(user.address, amount);

    await expect(rvu.connect(owner).burn(user.address, amount))
      .to.emit(rvu, 'Transfer')
      .withArgs(user.address, ethers.ZeroAddress, amount);

    expect(await rvu.balanceOf(user.address)).to.equal(0);
  });

  it('prevents non burners from burning', async () => {
    const [owner, user, attacker] = await ethers.getSigners();
    const rvu = await ethers.deployContract('RVU');
    await rvu.waitForDeployment();

    const burnerRole = await rvu.BURNER_ROLE();
    await rvu.connect(owner).mint(user.address, 1);
    await expect(rvu.connect(attacker).burn(user.address, 1))
      .to.be.revertedWithCustomError(rvu, 'AccessControlUnauthorizedAccount')
      .withArgs(attacker.address, burnerRole);
  });
});
