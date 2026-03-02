const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

function loadDeployment(networkName) {
  const filePath = path.join(__dirname, "..", "deployments", `${networkName}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Deployment file not found: ${filePath}`);
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertAddressEqual(label, actual, expected) {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`);
  }
}

async function assertHasCode(address, label) {
  const code = await hre.ethers.provider.getCode(address);
  if (code === "0x") {
    throw new Error(`${label} has no code at ${address}`);
  }
}

async function main() {
  const deployment = loadDeployment(hre.network.name);

  const nodesAddress = deployment.nodesV8?.address;
  const auctionAddress = deployment.finalAuction?.address;
  const finalArtworkAddress = deployment.finalArtwork?.address;

  if (!nodesAddress || !auctionAddress || !finalArtworkAddress) {
    throw new Error("Deployment file is missing contract addresses");
  }

  await assertHasCode(nodesAddress, "NodesV8");
  await assertHasCode(auctionAddress, "FinalAuction");
  await assertHasCode(finalArtworkAddress, "FinalArtwork");

  const NodesV8 = await hre.ethers.getContractFactory("NodesV8");
  const FinalAuction = await hre.ethers.getContractFactory("FinalAuction");
  const FinalArtwork = await hre.ethers.getContractFactory("FinalArtwork");

  const nodes = NodesV8.attach(nodesAddress);
  const auction = FinalAuction.attach(auctionAddress);
  const finalArtwork = FinalArtwork.attach(finalArtworkAddress);

  assertAddressEqual(
    "nodes.finalAuctionContract",
    await nodes.finalAuctionContract(),
    auctionAddress
  );
  assertAddressEqual(
    "nodes.finalArtworkContract",
    await nodes.finalArtworkContract(),
    finalArtworkAddress
  );
  assertAddressEqual("auction.nodes", await auction.nodes(), nodesAddress);
  assertAddressEqual("finalArtwork.auction", await finalArtwork.auction(), auctionAddress);
  assertAddressEqual("finalArtwork.nodes", await finalArtwork.nodes(), nodesAddress);

  const roundId = await nodes.roundId();
  const totalSupply = await nodes.totalSupply();
  const gameActive = await nodes.gameActive();
  const auctionActive = await auction.auctionActive();
  const finalized = await auction.finalized();

  console.log("Deployment check passed.");
  console.log(`Network: ${hre.network.name}`);
  console.log(`NodesV8: ${nodesAddress}`);
  console.log(`FinalAuction: ${auctionAddress}`);
  console.log(`FinalArtwork: ${finalArtworkAddress}`);
  console.log(`Round: ${roundId.toString()}, totalSupply: ${totalSupply.toString()}`);
  console.log(`gameActive: ${gameActive}, auctionActive: ${auctionActive}, finalized: ${finalized}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
