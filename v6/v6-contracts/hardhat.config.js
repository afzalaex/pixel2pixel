require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const networks = {};

if (process.env.SEPOLIA_RPC && process.env.PRIVATE_KEY) {
  networks.sepolia = {
    url: process.env.SEPOLIA_RPC,
    accounts: [process.env.PRIVATE_KEY],
  };
}

module.exports = {
  solidity: "0.8.28",
  networks,
};
