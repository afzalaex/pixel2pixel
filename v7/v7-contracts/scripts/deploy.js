const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);

  const NodesV7 = await hre.ethers.getContractFactory("NodesV7");
  const nodes = await NodesV7.deploy();
  await nodes.waitForDeployment();

  const FinalAuction = await hre.ethers.getContractFactory("FinalAuction");
  const auction = await FinalAuction.deploy(await nodes.getAddress());
  await auction.waitForDeployment();

  const nodesAddress = await nodes.getAddress();
  const auctionAddress = await auction.getAddress();

  const payload = {
    network: hre.network.name,
    chainId,
    deployer: deployer.address,
    nodesV7: {
      contractName: "NodesV7",
      address: nodesAddress,
    },
    finalAuction: {
      contractName: "FinalAuction",
      address: auctionAddress,
      nodesAddress,
    },
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(
    path.join(deploymentsDir, `${hre.network.name}.json`),
    JSON.stringify(payload, null, 2)
  );

  console.log("NodesV7 deployed to:", nodesAddress);
  console.log("FinalAuction deployed to:", auctionAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
