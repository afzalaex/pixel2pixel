const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");

const MNEMONIC = "test test test test test test test test test test test junk";

async function mintAll(nodes, funder) {
  const wallets = [];

  for (let i = 0; i < 100; i += 1) {
    const wallet = ethers.HDNodeWallet.fromPhrase(
      MNEMONIC,
      undefined,
      `m/44'/60'/0'/0/${i}`
    ).connect(ethers.provider);
    wallets.push(wallet);
  }

  for (const wallet of wallets) {
    if (wallet.address !== funder.address) {
      await funder.sendTransaction({
        to: wallet.address,
        value: ethers.parseEther("0.05"),
      });
    }
  }

  for (const wallet of wallets) {
    await nodes.connect(wallet).mint();
  }
}

describe("FinalAuction + FinalArtwork (v8)", function () {
  async function deployFixture() {
    const [owner, bidderA, bidderB] = await ethers.getSigners();

    const outsider = ethers.Wallet.createRandom().connect(ethers.provider);
    await owner.sendTransaction({
      to: outsider.address,
      value: ethers.parseEther("1"),
    });

    const NodesV8 = await ethers.getContractFactory("NodesV8");
    const nodes = await NodesV8.deploy();
    await nodes.waitForDeployment();
    await mintAll(nodes, owner);

    const FinalAuction = await ethers.getContractFactory("FinalAuction");
    const auction = await FinalAuction.deploy(await nodes.getAddress());
    await auction.waitForDeployment();

    const FinalArtwork = await ethers.getContractFactory("FinalArtwork");
    const finalArtwork = await FinalArtwork.deploy(
      await auction.getAddress(),
      await nodes.getAddress()
    );
    await finalArtwork.waitForDeployment();

    await nodes.connect(owner).setFinalAuctionContract(await auction.getAddress());
    await nodes.connect(owner).setFinalArtworkContract(await finalArtwork.getAddress());

    return { nodes, auction, finalArtwork, owner, bidderA, bidderB, outsider };
  }

  it("runs terminal snapshot -> auction -> winner claim flow", async function () {
    const { nodes, auction, finalArtwork, owner, bidderA, bidderB, outsider } =
      await loadFixture(deployFixture);

    expect(await nodes.nodeOf(bidderA.address)).to.not.equal(0n);
    expect(await nodes.nodeOf(bidderB.address)).to.not.equal(0n);

    const snapshotHash = ethers.id("terminal-snapshot-v8-round-1");
    await auction.connect(owner).activateAuction(snapshotHash, 3600);

    await expect(
      auction.connect(outsider).bid({ value: ethers.parseEther("1.0") })
    ).to.be.revertedWith("Only node owners");

    await auction.connect(bidderA).bid({ value: ethers.parseEther("1.0") });
    await expect(
      auction.connect(bidderA).bid({ value: ethers.parseEther("1.5") })
    ).to.be.revertedWith("Already bid");

    await auction.connect(bidderB).bid({ value: ethers.parseEther("2.0") });
    expect(await auction.pendingReturns(bidderA.address)).to.equal(
      ethers.parseEther("1.0")
    );

    await ethers.provider.send("evm_increaseTime", [3601]);
    await ethers.provider.send("evm_mine", []);

    await expect(auction.connect(outsider).finalizeAuction()).to.changeEtherBalances(
      [auction, owner],
      [ethers.parseEther("-2.0"), ethers.parseEther("2.0")]
    );

    await expect(finalArtwork.connect(bidderA).claim("<svg/>")).to.be.revertedWith(
      "Only auction winner"
    );

    const finalSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><rect width="600" height="600" fill="#000"/><circle cx="300" cy="300" r="180" fill="#fff"/></svg>';
    await expect(finalArtwork.connect(bidderB).claim(finalSvg))
      .to.emit(finalArtwork, "FinalArtworkClaimed")
      .withArgs(1n, 1n, bidderB.address, snapshotHash);

    expect(await finalArtwork.ownerOf(1n)).to.equal(bidderB.address);
    expect(await nodes.finalSnapshotHash()).to.equal(snapshotHash);
    expect(await nodes.finalArtworkTokenId()).to.equal(1n);
    expect(await finalArtwork.tokenIdByRound(1n)).to.equal(1n);

    const uri = await finalArtwork.tokenURI(1n);
    const encodedJson = uri.split(",")[1];
    const metadata = JSON.parse(Buffer.from(encodedJson, "base64").toString("utf8"));
    expect(metadata.name).to.equal("P2P Final Artwork #1");
    expect(metadata.image.startsWith("data:image/svg+xml;base64,")).to.equal(true);
    expect(metadata.attributes[1].value.toLowerCase()).to.equal(snapshotHash.toLowerCase());

    await expect(auction.connect(bidderA).withdrawRefund()).to.changeEtherBalances(
      [auction, bidderA],
      [ethers.parseEther("-1.0"), ethers.parseEther("1.0")]
    );
  });

  it("prevents round reset until final artwork is claimed, then allows next round auction", async function () {
    const { nodes, auction, finalArtwork, owner, bidderA, bidderB } = await loadFixture(
      deployFixture
    );

    const snapshotHashRound1 = ethers.id("terminal-snapshot-v8-round-1");
    await auction.connect(owner).activateAuction(snapshotHashRound1, 10);
    await auction.connect(bidderA).bid({ value: ethers.parseEther("1.0") });
    await auction.connect(bidderB).bid({ value: ethers.parseEther("1.5") });

    await ethers.provider.send("evm_increaseTime", [11]);
    await ethers.provider.send("evm_mine", []);
    await auction.connect(owner).finalizeAuction();

    await expect(nodes.connect(owner).resetGame()).to.be.revertedWith("Final artwork not minted");
    await expect(
      auction.connect(owner).activateAuction(ethers.id("another-snapshot"), 10)
    ).to.be.revertedWith("Previous artwork unclaimed");

    await finalArtwork.connect(bidderB).claim("<svg xmlns='http://www.w3.org/2000/svg'/>");
    await nodes.connect(owner).resetGame();
    expect(await nodes.roundId()).to.equal(2n);

    const snapshotHashRound2 = ethers.id("terminal-snapshot-v8-round-2");
    await expect(auction.connect(owner).activateAuction(snapshotHashRound2, 10)).to.not.be
      .reverted;
    expect(await auction.auctionRoundId()).to.equal(2n);
    expect(await nodes.finalSnapshotHashByRound(2n)).to.equal(snapshotHashRound2);
  });

  it("allows re-opening the same round auction when no bids were placed", async function () {
    const { nodes, auction, owner } = await loadFixture(deployFixture);

    const snapshotHashRound1 = ethers.id("terminal-snapshot-v8-round-1");
    await auction.connect(owner).activateAuction(snapshotHashRound1, 10);

    await ethers.provider.send("evm_increaseTime", [11]);
    await ethers.provider.send("evm_mine", []);

    await expect(auction.connect(owner).finalizeAuction())
      .to.emit(auction, "AuctionClosedWithoutWinner")
      .withArgs(1n);

    expect(await auction.auctionActive()).to.equal(false);
    expect(await auction.finalized()).to.equal(false);

    await expect(
      auction.connect(owner).activateAuction(ethers.id("different-snapshot"), 10)
    ).to.be.revertedWith("Snapshot mismatch");

    await expect(auction.connect(owner).activateAuction(snapshotHashRound1, 10)).to.not.be
      .reverted;
    expect(await auction.auctionRoundId()).to.equal(1n);
    expect(await nodes.finalSnapshotHashByRound(1n)).to.equal(snapshotHashRound1);
  });
});
