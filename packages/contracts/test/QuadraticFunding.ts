import { loadFixture, time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

function sqrtBig(value: bigint): bigint {
  if (value === 0n) {
    return 0n;
  }
  let z = (value + 1n) / 2n;
  let y = value;
  while (z < y) {
    y = z;
    z = (value / z + z) / 2n;
  }
  return y;
}

describe('QuadraticFunding', () => {
  async function deployFixture() {
    const [deployer, attestor, treasurer, voter1, voter2, recipient1, recipient2, outsider] =
      await ethers.getSigners();
    const rgu = await ethers.deployContract('RGU');
    await rgu.waitForDeployment();

    const minTrust = 6000;
    const qf = await ethers.deployContract('QuadraticFunding', [await rgu.getAddress(), minTrust]);
    await qf.waitForDeployment();

    await qf.grantRole(await qf.ATTESTOR_ROLE(), attestor.address);
    await qf.grantRole(await qf.TREASURER_ROLE(), treasurer.address);

    await qf.registerProject(recipient1.address);
    const project1Id = await qf.projectCount();
    await qf.registerProject(recipient2.address);
    const project2Id = await qf.projectCount();

    return {
      rgu,
      qf,
      deployer,
      attestor,
      treasurer,
      voter1,
      voter2,
      recipient1,
      recipient2,
      outsider,
      project1Id,
      project2Id,
      minTrust
    };
  }

  it('distributes matching pool and contributions after a round', async () => {
    const {
      rgu,
      qf,
      attestor,
      treasurer,
      voter1,
      voter2,
      recipient1,
      recipient2,
      project1Id,
      project2Id
    } = await loadFixture(deployFixture);

    const expiry = (await time.latest()) + 7 * 24 * 60 * 60;
    await qf.connect(attestor).recordParticipant(voter1.address, 9000, expiry);
    await qf.connect(attestor).recordParticipant(voter2.address, 7000, expiry);

    const matchingPool = ethers.parseUnits('200', 18);
    await rgu.mint(treasurer.address, matchingPool);
    await rgu.connect(treasurer).approve(await qf.getAddress(), matchingPool);
    await expect(qf.connect(treasurer).fundMatchingPool(matchingPool))
      .to.emit(qf, 'MatchingPoolFunded')
      .withArgs(treasurer.address, matchingPool, matchingPool);

    const contrib1 = ethers.parseUnits('100', 18);
    const contrib2 = ethers.parseUnits('25', 18);
    const contrib3 = ethers.parseUnits('10', 18);

    await rgu.mint(voter1.address, contrib1 + contrib3);
    await rgu.mint(voter2.address, contrib2);

    const qfAddress = await qf.getAddress();
    await rgu.connect(voter1).approve(qfAddress, contrib1 + contrib3);
    await rgu.connect(voter2).approve(qfAddress, contrib2);

    await expect(qf.connect(voter1).castVote(project2Id, contrib3))
      .to.emit(qf, 'VoteCast')
      .withArgs(project2Id, voter1.address, contrib3, contrib3);
    await qf.connect(voter1).castVote(project1Id, contrib1);
    await qf.connect(voter2).castVote(project1Id, contrib2);

    expect(await qf.contributionOf(project1Id, voter1.address)).to.equal(contrib1);
    expect(await qf.contributionOf(project2Id, voter1.address)).to.equal(contrib3);

    const root1 = sqrtBig(contrib1);
    const root2 = sqrtBig(contrib2);
    const root3 = sqrtBig(contrib3);

    const weight1 = (root1 + root2) * (root1 + root2);
    const weight2 = root3 * root3;
    const totalWeight = weight1 + weight2;

    expect(await qf.matchingWeight()).to.equal(totalWeight);

    const expectedMatch1 = totalWeight === 0n ? 0n : (matchingPool * weight1) / totalWeight;
    const expectedMatch2 = totalWeight === 0n ? 0n : (matchingPool * weight2) / totalWeight;
    expect(await qf.previewMatch(project1Id)).to.equal(expectedMatch1);
    expect(await qf.previewMatch(project2Id)).to.equal(expectedMatch2);

    await expect(qf.closeRound()).to.emit(qf, 'RoundClosed');
    await expect(qf.matchFunds()).to.emit(qf, 'MatchingCalculated');

    const beforeRecipient1 = await rgu.balanceOf(recipient1.address);
    await expect(qf.connect(recipient1).withdraw(project1Id))
      .to.emit(qf, 'FundsWithdrawn')
      .withArgs(project1Id, recipient1.address, contrib1 + contrib2 + expectedMatch1);
    expect(await rgu.balanceOf(recipient1.address)).to.equal(
      beforeRecipient1 + contrib1 + contrib2 + expectedMatch1
    );
    expect(await qf.distributedMatching()).to.equal(expectedMatch1);
    expect(await qf.matchingPool()).to.equal(matchingPool);

    await expect(qf.connect(recipient1).withdraw(project1Id)).to.be.revertedWith('already withdrawn');

    const beforeRecipient2 = await rgu.balanceOf(recipient2.address);
    await qf.connect(recipient2).withdraw(project2Id);
    expect(await rgu.balanceOf(recipient2.address)).to.equal(beforeRecipient2 + contrib3 + expectedMatch2);
    expect(await qf.distributedMatching()).to.equal(expectedMatch1 + expectedMatch2);
  });

  it('should allow treasurer to pool funds via poolFunds alias', async function () {
    const { qf, rgu, treasurer } = await loadFixture(deployFixture);
    const amount = ethers.parseEther('100');
    await rgu.mint(treasurer.address, amount);
    await rgu.connect(treasurer).approve(await qf.getAddress(), amount);

    await expect(qf.connect(treasurer).poolFunds(amount))
      .to.emit(qf, 'MatchingPoolFunded')
      .withArgs(treasurer.address, amount, amount);

    await expect(qf.connect(treasurer).poolFunds(0)).to.be.revertedWith('amount required');
  });

  it('reverts matching when no contributions exist', async function () {
    const { qf, recipient1 } = await loadFixture(deployFixture);
    await qf.registerProject(recipient1.address);
    await qf.closeRound();

    await expect(qf.matchFunds()).to.be.revertedWith('no weight');
  });

  it('should cap match amount if pool is exhausted', async function () {
    const { qf, rgu, treasurer, recipient1, voter1 } = await loadFixture(deployFixture);

    const poolAmount = ethers.parseEther('10');
    await rgu.mint(treasurer.address, poolAmount);
    await rgu.connect(treasurer).approve(await qf.getAddress(), poolAmount);
    await qf.connect(treasurer).fundMatchingPool(poolAmount);

    const qfFresh = await ethers.getContractAt('QuadraticFunding', await qf.getAddress());
    const expiry = (await time.latest()) + 3600;
    await qfFresh.recordParticipant(voter1.address, 10000, expiry);

    const voteAmount = ethers.parseEther('100');
    await rgu.mint(voter1.address, voteAmount);
    await rgu.connect(voter1).approve(await qf.getAddress(), voteAmount);
    await qfFresh.connect(voter1).castVote(1, voteAmount);

    await qf.closeRound();
    await qf.matchFunds();

    const details = await qf.projectDetails(1);
    expect(details.matchedAmount).to.equal(poolAmount);
  });

  it('returns 0 for previewMatch if project does not exist or has no contributions', async function () {
    const { qf } = await loadFixture(deployFixture);
    expect(await qf.previewMatch(999)).to.equal(0);
    expect(await qf.previewMatch(1)).to.equal(0); // Exists but no contribs
  });

  it('enforces attestation and round rules for voting and withdrawals', async () => {
    const { qf, attestor, voter1, treasurer, rgu, project1Id, outsider } = await loadFixture(deployFixture);
    const expiry = (await time.latest()) + 1000;

    // Attest voter
    await qf.connect(attestor).getFunction("recordParticipant")(voter1.address, 10000, expiry);

    // Fund voter
    await rgu.mint(voter1.address, ethers.parseEther("100"));
    await rgu.connect(voter1).approve(await qf.getAddress(), ethers.parseEther("100"));

    // Vote
    await expect(qf.connect(voter1).getFunction("castVote")(project1Id, ethers.parseEther("10")))
      .to.emit(qf, 'VoteCast');

    // Outsider cannot vote
    await expect(qf.connect(outsider).getFunction("castVote")(project1Id, ethers.parseEther("10")))
      .to.be.revertedWith("not attested");
    await expect(qf.connect(voter1).castVote(999, ethers.parseEther("10"))).to.be.revertedWith('invalid project');
    await expect(qf.connect(voter1).castVote(project1Id, 0)).to.be.revertedWith('amount required');

    await expect(qf.withdraw(project1Id)).to.be.revertedWith('round open');
    await qf.closeRound();

    // Should succeed because we have votes
    await expect(qf.matchFunds()).to.emit(qf, 'MatchingCalculated');

    // Should fail if called again
    await expect(qf.matchFunds()).to.be.revertedWith('already matched');

    await expect(qf.connect(voter1).getFunction("castVote")(project1Id, ethers.parseEther("10"))).to.be.revertedWith('round closed');

    await expect(qf.connect(outsider).withdraw(project1Id)).to.be.revertedWith('not recipient');

    await expect(qf.connect(treasurer).fundMatchingPool(0)).to.be.revertedWith('amount required');
  });

  it('validates participants, thresholds, and admin actions', async () => {
    const { qf, attestor, voter1, voter2, recipient1, outsider, minTrust } = await loadFixture(deployFixture);
    const role = await qf.ATTESTOR_ROLE();

    await expect(
      qf.connect(outsider).recordParticipant(voter1.address, 9000, (await time.latest()) + 1000)
    )
      .to.be.revertedWithCustomError(qf, 'AccessControlUnauthorizedAccount')
      .withArgs(outsider.address, role);

    await expect(qf.connect(attestor).recordParticipant(voter1.address, 9000, await time.latest())).to.be.revertedWith(
      'attestation expired'
    );
    await expect(
      qf.connect(attestor).recordParticipant(voter1.address, 20000, (await time.latest()) + 1000)
    ).to.be.revertedWith('score too high');

    await expect(qf.registerProject(ethers.ZeroAddress)).to.be.revertedWith('invalid recipient');
    await expect(qf.setMinTrustScore(20000)).to.be.revertedWith('min trust too high');

    const expiry = (await time.latest()) + 100;
    await qf.connect(attestor).recordParticipant(voter1.address, 1000, expiry);
    await expect(qf.connect(voter1).castVote(1, 1)).to.be.revertedWith('trust too low');

    await qf.connect(attestor).recordParticipant(voter1.address, minTrust, expiry);
    await time.increase(expiry + 1);
    await expect(qf.connect(voter1).castVote(1, 1)).to.be.revertedWith('attestation expired');

    await qf.connect(attestor).recordParticipant(voter2.address, minTrust, (await time.latest()) + 1000);
    const info = await qf.participantInfo(voter2.address);
    expect(info.exists).to.equal(true);

    const details = await qf.projectDetails(1);
    expect(details.exists).to.equal(true);

    await qf.setMinTrustScore(7000);
    await expect(qf.closeRound()).to.emit(qf, 'RoundClosed');
    await expect(qf.closeRound()).to.be.revertedWith('round already closed');
  });
});
