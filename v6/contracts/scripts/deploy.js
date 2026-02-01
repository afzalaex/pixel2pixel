const hre = require("hardhat");

async function main() {
  const NodesV6 = await hre.ethers.getContractFactory("NodesV6");
  const nodes = await NodesV6.deploy();

  await nodes.deployed();

  console.log("NodesV6 deployed to:", nodes.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
