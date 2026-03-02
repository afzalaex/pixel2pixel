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
    await expect(nodes.connect(wallet).mint()).to.not.be.reverted;
  }

  return wallets;
}

describe("NodesV8", function () {
  async function deployMintedFixture() {
    const [owner, auctionSigner, artworkSigner, outsider] = await ethers.getSigners();
    const NodesV8 = await ethers.getContractFactory("NodesV8");
    const nodes = await NodesV8.deploy();
    await nodes.waitForDeployment();

    await mintAll(nodes, owner);

    return { nodes, owner, auctionSigner, artworkSigner, outsider };
  }

  it("reaches supply 100, activates, and blocks extra minting", async function () {
    const { nodes, owner } = await loadFixture(deployMintedFixture);

    expect(await nodes.totalSupply()).to.equal(100n);
    expect(await nodes.nextTokenId()).to.equal(101n);
    expect(await nodes.gameActive()).to.equal(true);

    const extra = ethers.Wallet.createRandom().connect(ethers.provider);
    await owner.sendTransaction({
      to: extra.address,
      value: ethers.parseEther("0.05"),
    });

    await expect(nodes.connect(extra).mint()).to.be.revertedWith("Game active");
  });

  it("locks final snapshot with owner/auction auth and computes deterministic shuffle seed", async function () {
    const { nodes, owner, auctionSigner, outsider } = await loadFixture(deployMintedFixture);
    const snapshotHash = ethers.id("terminal-snapshot-round-1");

    await expect(nodes.connect(outsider).lockFinalSnapshot(snapshotHash)).to.be.revertedWith(
      "Not authorized"
    );

    await nodes.connect(owner).setFinalAuctionContract(auctionSigner.address);
    await expect(nodes.connect(auctionSigner).lockFinalSnapshot(snapshotHash)).to.not.be.reverted;

    expect(await nodes.finalSnapshotHash()).to.equal(snapshotHash);
    expect(await nodes.finalSnapshotHashByRound(1n)).to.equal(snapshotHash);

    const expectedSeed = ethers.keccak256(
      ethers.solidityPacked(["bytes32", "uint256"], [snapshotHash, 1n])
    );
    expect(await nodes.shuffleSeed()).to.equal(expectedSeed);
  });

  it("registers final artwork token only from configured artwork contract and enforces reset gate", async function () {
    const { nodes, owner, artworkSigner, outsider } = await loadFixture(deployMintedFixture);
    const snapshotHash = ethers.id("terminal-snapshot-round-1");

    await expect(nodes.connect(owner).resetGame()).to.be.revertedWith("Snapshot not set");

    await nodes.connect(owner).lockFinalSnapshot(snapshotHash);
    await expect(nodes.connect(owner).resetGame()).to.be.revertedWith("Final artwork not minted");

    await expect(nodes.connect(outsider).registerFinalArtworkToken(1n)).to.be.revertedWith(
      "Only final artwork"
    );

    await nodes.connect(owner).setFinalArtworkContract(artworkSigner.address);
    await expect(nodes.connect(artworkSigner).registerFinalArtworkToken(1n)).to.not.be.reverted;

    expect(await nodes.finalArtworkTokenId()).to.equal(1n);
    expect(await nodes.finalArtworkTokenIdByRound(1n)).to.equal(1n);

    await expect(nodes.connect(owner).resetGame()).to.not.be.reverted;
    expect(await nodes.roundId()).to.equal(2n);
    expect(await nodes.finalSnapshotHash()).to.equal(ethers.ZeroHash);
    expect(await nodes.finalArtworkTokenId()).to.equal(0n);
  });
});
