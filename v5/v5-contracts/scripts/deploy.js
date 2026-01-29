const hre = require("hardhat");

async function main() {
  const Nodes = await hre.ethers.getContractFactory("Nodes");
  const nodes = await Nodes.deploy();

  await nodes.waitForDeployment();

  console.log("Nodes deployed to:", await nodes.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
