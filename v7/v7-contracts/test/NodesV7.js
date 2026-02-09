const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NodesV7", function () {
  async function mintAll(nodes, deployer) {
    const phrase = "test test test test test test test test test test test junk";
    const wallets = [];

    for (let i = 0; i < 100; i += 1) {
      const wallet = ethers.HDNodeWallet.fromPhrase(
        phrase,
        undefined,
        `m/44'/60'/0'/0/${i}`
      ).connect(ethers.provider);
      wallets.push(wallet);
    }

    for (const wallet of wallets) {
      if (wallet.address !== deployer.address) {
        await deployer.sendTransaction({
          to: wallet.address,
          value: ethers.parseEther("0.05"),
        });
      }
    }

    for (const wallet of wallets) {
      await expect(nodes.connect(wallet).mint()).to.not.be.reverted;
    }
  }

  async function deployFixture() {
    const [deployer, other] = await ethers.getSigners();
    const NodesV7 = await ethers.getContractFactory("NodesV7");
    const nodes = await NodesV7.deploy();
    await nodes.waitForDeployment();

    return { nodes, deployer, other };
  }

  it("mints once, tracks nodeOf, and stays inactive before supply is full", async function () {
    const { nodes, deployer } = await deployFixture();

    await expect(nodes.connect(deployer).mint())
      .to.emit(nodes, "Transfer")
      .withArgs(ethers.ZeroAddress, deployer.address, 1n);

    expect(await nodes.nodeOf(deployer.address)).to.equal(1n);
    expect(await nodes.ownerOf(1n)).to.equal(deployer.address);
    expect(await nodes.hasMinted(deployer.address)).to.equal(true);
    expect(await nodes.nextTokenId()).to.equal(2n);
    expect(await nodes.totalSupply()).to.equal(1n);
    expect(await nodes.roundId()).to.equal(1n);
    expect(await nodes.gameActive()).to.equal(false);

    await expect(nodes.connect(deployer).mint()).to.be.revertedWith("Already minted");
  });

  it("keeps nodeOf in sync across transfers and blocks wallets that already hold a node", async function () {
    const { nodes, deployer, other } = await deployFixture();

    await nodes.connect(deployer).mint();

    await nodes.connect(deployer).transferFrom(deployer.address, other.address, 1n);

    expect(await nodes.nodeOf(deployer.address)).to.equal(0n);
    expect(await nodes.nodeOf(other.address)).to.equal(1n);

    await expect(nodes.connect(deployer).mint()).to.be.revertedWith("Already minted");
    await expect(nodes.connect(other).mint()).to.be.revertedWith("Wallet already has node");
  });

  it("activates game at token #100 and blocks further minting", async function () {
    const { nodes, deployer } = await deployFixture();

    await mintAll(nodes, deployer);

    expect(await nodes.totalSupply()).to.equal(100n);
    expect(await nodes.nextTokenId()).to.equal(101n);
    expect(await nodes.gameActive()).to.equal(true);

    const extra = ethers.Wallet.createRandom().connect(ethers.provider);
    await deployer.sendTransaction({
      to: extra.address,
      value: ethers.parseEther("0.05"),
    });
    await expect(nodes.connect(extra).mint()).to.be.revertedWith("Game active");
  });

  it("only allows owner to reset and advances roundId", async function () {
    const { nodes, deployer, other } = await deployFixture();

    await nodes.connect(deployer).mint();
    expect(await nodes.roundId()).to.equal(1n);
    expect(await nodes.gameActive()).to.equal(false);

    await expect(nodes.connect(other).resetGame()).to.be.revertedWithCustomError(
      nodes,
      "OwnableUnauthorizedAccount"
    );

    await expect(nodes.connect(deployer).resetGame()).to.not.be.reverted;
    expect(await nodes.roundId()).to.equal(2n);
  });

  it("allows owner reset after full mint, but cap still blocks new mints", async function () {
    const { nodes, deployer } = await deployFixture();
    await mintAll(nodes, deployer);

    expect(await nodes.roundId()).to.equal(1n);
    expect(await nodes.gameActive()).to.equal(true);
    await expect(nodes.connect(deployer).resetGame()).to.not.be.reverted;
    expect(await nodes.roundId()).to.equal(2n);
    expect(await nodes.gameActive()).to.equal(false);

    await expect(nodes.connect(deployer).resetGame()).to.not.be.reverted;
    expect(await nodes.roundId()).to.equal(3n);

    const extra = ethers.Wallet.createRandom().connect(ethers.provider);
    await deployer.sendTransaction({
      to: extra.address,
      value: ethers.parseEther("0.05"),
    });
    await expect(nodes.connect(extra).mint()).to.be.revertedWith("All nodes minted");
  });

  it("returns base64 metadata and deterministic svg image from tokenURI", async function () {
    const { nodes, deployer, other } = await deployFixture();

    await nodes.connect(deployer).mint();
    await nodes.connect(other).mint();

    const uri1 = await nodes.tokenURI(1n);
    const uri2 = await nodes.tokenURI(2n);

    expect(uri1.startsWith("data:application/json;base64,")).to.equal(true);
    expect(uri1).to.equal(await nodes.tokenURI(1n));
    expect(uri1).to.not.equal(uri2);

    const encodedJson = uri1.split(",")[1];
    const metadata = JSON.parse(Buffer.from(encodedJson, "base64").toString("utf8"));

    expect(metadata.name).to.equal("P2P Node #1");
    expect(metadata.image.startsWith("data:image/svg+xml;base64,")).to.equal(true);

    const encodedSvg = metadata.image.split(",")[1];
    const svg = Buffer.from(encodedSvg, "base64").toString("utf8");

    expect(svg.includes("<svg")).to.equal(true);
    expect(svg.includes("<rect")).to.equal(true);
    expect(svg.includes("fill=\"#")).to.equal(true);
  });
});
