const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Nodes v6", function () {
  async function deployFixture() {
    const [deployer, other] = await ethers.getSigners();
    const Nodes = await ethers.getContractFactory("Nodes");
    const nodes = await Nodes.deploy();
    await nodes.waitForDeployment();

    return { nodes, deployer, other };
  }

  it("mints once and sets nodeOf", async function () {
    const { nodes, deployer } = await deployFixture();

    await expect(nodes.connect(deployer).mint())
      .to.emit(nodes, "Transfer")
      .withArgs(ethers.ZeroAddress, deployer.address, 1n);

    expect(await nodes.nodeOf(deployer.address)).to.equal(1n);
    expect(await nodes.ownerOf(1n)).to.equal(deployer.address);
    expect(await nodes.nextTokenId()).to.equal(2n);

    await expect(nodes.connect(deployer).mint()).to.be.revertedWith("Already minted");
  });

  it("keeps nodeOf in sync across transfers", async function () {
    const { nodes, deployer, other } = await deployFixture();

    await nodes.connect(deployer).mint();

    expect(await nodes.nodeOf(deployer.address)).to.equal(1n);
    expect(await nodes.nodeOf(other.address)).to.equal(0n);

    await nodes.connect(deployer).transferFrom(deployer.address, other.address, 1n);

    expect(await nodes.nodeOf(deployer.address)).to.equal(0n);
    expect(await nodes.nodeOf(other.address)).to.equal(1n);

    await expect(nodes.connect(deployer).mint()).to.be.revertedWith("Already minted");
    await expect(nodes.connect(other).mint()).to.be.revertedWith("Wallet already has node");
  });

  it("enforces max supply of 100", async function () {
    const { nodes, deployer } = await deployFixture();

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

    expect(await nodes.nextTokenId()).to.equal(101n);

    const extra = ethers.Wallet.createRandom().connect(ethers.provider);
    await deployer.sendTransaction({
      to: extra.address,
      value: ethers.parseEther("0.05"),
    });

    await expect(nodes.connect(extra).mint()).to.be.revertedWith("All nodes minted");
  });

  it("returns base64 metadata and base64 svg image from tokenURI", async function () {
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
