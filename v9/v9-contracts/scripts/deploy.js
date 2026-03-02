const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);

  const NodesV8 = await hre.ethers.getContractFactory("NodesV8");
  const nodes = await NodesV8.deploy();
  await nodes.waitForDeployment();

  const FinalAuction = await hre.ethers.getContractFactory("FinalAuction");
  const auction = await FinalAuction.deploy(await nodes.getAddress());
  await auction.waitForDeployment();

  const FinalArtwork = await hre.ethers.getContractFactory("FinalArtwork");
  const finalArtwork = await FinalArtwork.deploy(
    await auction.getAddress(),
    await nodes.getAddress()
  );
  await finalArtwork.waitForDeployment();

  await (await nodes.setFinalAuctionContract(await auction.getAddress())).wait();
  await (await nodes.setFinalArtworkContract(await finalArtwork.getAddress())).wait();

  const nodesAddress = await nodes.getAddress();
  const auctionAddress = await auction.getAddress();
  const finalArtworkAddress = await finalArtwork.getAddress();

  const payload = {
    network: hre.network.name,
    chainId,
    deployer: deployer.address,
    nodesV8: {
      contractName: "NodesV8",
      address: nodesAddress,
    },
    finalAuction: {
      contractName: "FinalAuction",
      address: auctionAddress,
      nodesAddress,
    },
    finalArtwork: {
      contractName: "FinalArtwork",
      address: finalArtworkAddress,
      auctionAddress,
      nodesAddress,
    },
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(
    path.join(deploymentsDir, `${hre.network.name}.json`),
    JSON.stringify(payload, null, 2)
  );

  console.log("NodesV8 deployed to:", nodesAddress);
  console.log("FinalAuction deployed to:", auctionAddress);
  console.log("FinalArtwork deployed to:", finalArtworkAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
