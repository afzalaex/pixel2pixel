const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FinalAuction", function () {
  async function deployFixture() {
    const [owner, bidderA, bidderB, outsider] = await ethers.getSigners();

    const NodesV7 = await ethers.getContractFactory("NodesV7");
    const nodes = await NodesV7.deploy();
    await nodes.waitForDeployment();

    const FinalAuction = await ethers.getContractFactory("FinalAuction");
    const auction = await FinalAuction.deploy(await nodes.getAddress());
    await auction.waitForDeployment();

    return { nodes, auction, owner, bidderA, bidderB, outsider };
  }

  async function seedOwners(nodes, bidderA, bidderB) {
    await nodes.connect(bidderA).mint();
    await nodes.connect(bidderB).mint();
    expect(await nodes.nodeOf(bidderA.address)).to.equal(1n);
    expect(await nodes.nodeOf(bidderB.address)).to.equal(2n);
  }

  it("allows only node owners to bid and mints final 1/1 to winner", async function () {
    const { nodes, auction, owner, bidderA, bidderB, outsider } = await deployFixture();
    await seedOwners(nodes, bidderA, bidderB);

    const snapshotHash = ethers.id("terminal-snapshot-v7");
    await auction.connect(owner).activateAuction(snapshotHash, 3600);

    await expect(
      auction.connect(outsider).bid({ value: ethers.parseEther("1.0") })
    ).to.be.revertedWith("Only node owners");

    await expect(
      auction.connect(bidderA).bid({ value: ethers.parseEther("1.0") })
    ).to.not.be.reverted;
    await expect(
      auction.connect(bidderB).bid({ value: ethers.parseEther("2.0") })
    ).to.not.be.reverted;

    expect(await auction.pendingReturns(bidderA.address)).to.equal(
      ethers.parseEther("1.0")
    );

    await ethers.provider.send("evm_increaseTime", [3601]);
    await ethers.provider.send("evm_mine", []);

    await expect(
      auction.connect(outsider).finalizeAuction()
    ).to.changeEtherBalances(
      [auction, owner],
      [ethers.parseEther("-2.0"), ethers.parseEther("2.0")]
    );

    expect(await auction.ownerOf(1n)).to.equal(bidderB.address);
    expect(await auction.auctionActive()).to.equal(false);
    expect(await auction.finalized()).to.equal(true);
  });

  it("allows outbid wallets to withdraw refunds", async function () {
    const { nodes, auction, owner, bidderA, bidderB } = await deployFixture();
    await seedOwners(nodes, bidderA, bidderB);

    await auction.connect(owner).activateAuction(ethers.id("snapshot-2"), 3600);
    await auction.connect(bidderA).bid({ value: ethers.parseEther("1.0") });
    await auction.connect(bidderB).bid({ value: ethers.parseEther("1.5") });

    await expect(
      auction.connect(bidderA).withdrawRefund()
    ).to.changeEtherBalances(
      [auction, bidderA],
      [ethers.parseEther("-1.0"), ethers.parseEther("1.0")]
    );
  });

  it("cannot finalize with no bids", async function () {
    const { auction, owner } = await deployFixture();

    await auction.connect(owner).activateAuction(ethers.id("snapshot-3"), 10);
    await ethers.provider.send("evm_increaseTime", [11]);
    await ethers.provider.send("evm_mine", []);

    await expect(auction.finalizeAuction()).to.be.revertedWith("No bids");
  });
});
